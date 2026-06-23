require("dotenv").config();
const express = require("express");
const path = require("path");
const compression = require("compression");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const supabase = require("./server/supabase");

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (required for rate-limiting behind Render's reverse proxy)
app.set("trust proxy", 1);

// --- Security & Performance Middleware ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "blob:"],
      fontSrc: ["'self'", "https://cdn.jsdelivr.net"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());

// Rate limiting — 100 requests per 15 min per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});
app.use("/api/", limiter);

// Increase body size limit for base64 image data
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public"), {
  maxAge: "1h",
  etag: true,
}));

// ---- Supabase Connection Check + Auto-Migration ----
const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS meals (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    calories INTEGER NOT NULL CHECK (calories > 0 AND calories <= 10000),
    type TEXT NOT NULL CHECK (type IN ('breakfast', 'lunch', 'dinner', 'snacks')),
    date TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  ALTER TABLE meals ENABLE ROW LEVEL SECURITY;
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all for anon' AND tablename = 'meals') THEN
      CREATE POLICY 'Allow all for anon' ON meals FOR ALL USING (true);
    END IF;
  END $$;
`;

(async () => {
  if (!supabase) {
    console.warn("⚠️ Supabase client not initialized. Set SUPABASE_URL and SUPABASE_ANON_KEY.");
    return;
  }

  // Check if table exists
  const { error } = await supabase.from("meals").select("id").limit(1);

  if (error && error.code === "42P01") {
    // Table doesn't exist — try auto-creation via Management API or direct SQL
    console.log("⚠️ meals table not found. Attempting auto-migration...");
    try {
      const projectRef = process.env.SUPABASE_URL.replace("https://", "").replace(".supabase.co", "");
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (serviceKey) {
        // Use Management API to run SQL
        const resp = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ query: CREATE_TABLE_SQL }),
        });
        if (resp.ok) {
          console.log("✅ meals table created via Management API");
        } else {
          throw new Error(`Management API returned ${resp.status}`);
        }
      } else {
        // Fallback: try PostgREST schema query to verify
        console.log("ℹ️ No SUPABASE_SERVICE_ROLE_KEY — manual setup required.");
        console.log(`
📋 Run this SQL in Supabase SQL Editor (https://app.supabase.com → SQL Editor):
` + CREATE_TABLE_SQL);
      }
    } catch (migrateErr) {
      console.error("⚠️ Auto-migration failed:", migrateErr.message);
      console.log(`
📋 Run this SQL in Supabase SQL Editor (https://app.supabase.com → SQL Editor):
` + CREATE_TABLE_SQL);
    }
  } else if (error) {
    console.error("Supabase connection error:", error.message);
  } else {
    console.log("🕷️ Supabase connected");
  }
})();

// ---- API: Meals CRUD ----

// GET /api/meals — fetch meals with optional filters
app.get("/api/meals", async (req, res) => {
  try {
    const { date, type, search, limit = 500 } = req.query;

    if (!supabase) {
      return res.status(503).json({ success: false, error: "Database not configured" });
    }

    let query = supabase
      .from("meals")
      .select("*")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(parseInt(limit));

    if (date) query = query.eq("date", date);
    if (type && type !== "all") query = query.eq("type", type);
    if (search) query = query.ilike("name", `%${search}%`);

    const { data: meals, error } = await query;

    if (error) throw error;

    // Map created_at to createdAt for frontend compatibility
    const mapped = meals.map((m) => ({
      ...m,
      createdAt: m.created_at,
    }));

    res.json({ success: true, meals: mapped });
  } catch (error) {
    console.error("GET /api/meals error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/meals — create a new meal
app.post("/api/meals", async (req, res) => {
  try {
    const { name, calories, type, date } = req.body;

    if (!supabase) {
      return res.status(503).json({ success: false, error: "Database not configured" });
    }

    if (!name || !calories || !type) {
      return res
        .status(400)
        .json({ success: false, error: "name, calories, and type are required" });
    }

    const { data: meal, error } = await supabase
      .from("meals")
      .insert({
        name: name.trim(),
        calories: parseInt(calories),
        type,
        date: date || new Date().toISOString().split("T")[0],
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      meal: { ...meal, createdAt: meal.created_at },
    });
  } catch (error) {
    console.error("POST /api/meals error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/meals/:id — update a meal
app.put("/api/meals/:id", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ success: false, error: "Database not configured" });
    }

    const { name, calories, type } = req.body;

    const { data: meal, error } = await supabase
      .from("meals")
      .update({
        ...(name !== undefined && { name: name.trim() }),
        ...(calories !== undefined && { calories }),
        ...(type !== undefined && { type }),
      })
      .eq("id", req.params.id)
      .select()
      .single();

    if (error || !meal) {
      return res.status(404).json({ success: false, error: "Meal not found" });
    }

    res.json({ success: true, meal: { ...meal, createdAt: meal.created_at } });
  } catch (error) {
    console.error("PUT /api/meals error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/meals/all — clear all meals (must be before /:id)
app.delete("/api/meals/all", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ success: false, error: "Database not configured" });
    }
    const { error } = await supabase.from("meals").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) throw error;
    res.json({ success: true, message: "All meals deleted" });
  } catch (error) {
    console.error("DELETE /api/meals/all error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/meals/:id — delete a meal
app.delete("/api/meals/:id", async (req, res) => {
  try {
    if (req.params.id === "all") {
      return res.status(400).json({ success: false, error: "Use DELETE /api/meals/all for bulk delete" });
    }

    if (!supabase) {
      return res.status(503).json({ success: false, error: "Database not configured" });
    }

    const { data: meal, error } = await supabase
      .from("meals")
      .delete()
      .eq("id", req.params.id)
      .select()
      .single();

    if (error || !meal) {
      return res.status(404).json({ success: false, error: "Meal not found" });
    }

    res.json({ success: true, message: "Meal deleted" });
  } catch (error) {
    console.error("DELETE /api/meals error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---- AI Food Recognition Endpoint ----
app.post("/api/analyze-food", async (req, res) => {
  try {
    const { image, mimeType } = req.body;

    if (!image) {
      return res.status(400).json({ error: "No image data provided." });
    }

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "GOOGLE_API_KEY not configured. Create a .env file with your Gemini API key.",
      });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `You are a nutrition expert. Analyze this food image and provide:
1. The name of the food item(s) visible
2. Estimated calorie count
3. A brief nutritional breakdown (protein, carbs, fat if identifiable)
4. A confidence level (high, medium, low)

Respond in JSON format with these fields:
- food_name: string (the main food identified)
- estimated_calories: number (total estimated calories)
- calories_range: string (e.g., "300-400")
- protein_g: number (estimated grams of protein)
- carbs_g: number (estimated grams of carbs)
- fat_g: number (estimated grams of fat)
- confidence: string ("high", "medium", "low")
- description: string (brief 1-sentence description of what you see)`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: image,
          mimeType: mimeType || "image/jpeg",
        },
      },
    ]);

    const response = result.response;
    const text = response.text();

    let analysis;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      } else {
        analysis = { raw_response: text };
      }
    } catch (parseError) {
      analysis = { raw_response: text };
    }

    res.json({ success: true, analysis });
  } catch (error) {
    console.error("AI Food Analysis Error:", error.message);
    res.status(500).json({
      error: "Failed to analyze food image. Please try again.",
      details: error.message,
    });
  }
});

// ---- Health Check (for Render monitoring) ----
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`🕷️ Spider-Man Calorie Tracker running at http://localhost:${PORT}`);
});
