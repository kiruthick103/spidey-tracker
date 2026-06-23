/* ==============================
   Spider-Man Calorie Tracker
   Premium App Logic
   ============================== */

document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  // ---- State ----
  let meals = [];
  let dailyGoal = parseInt(localStorage.getItem("spideyGoal")) || null;
  let theme = localStorage.getItem("spideyTheme") || "dark";
  let charts = {};
  let lastMaintenance = null;

  // ---- DOM Refs ----
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const els = {
    // Loading
    loadingScreen: $("#loadingScreen"),

    // Dashboard - Progress Ring
    calProgressRing: $("#calProgressRing"),
    progressPercent: $("#progressPercent"),
    caloriesConsumed: $("#caloriesConsumed"),
    caloriesRemaining: $("#caloriesRemaining"),
    mealCount: $("#mealCount"),

    // Dashboard - Stats
    dailyGoal: $("#dailyGoal"),
    streakCount: $("#streakCount"),
    weeklyAvg: $("#weeklyAvg"),
    editGoalBtn: $("#editGoalBtn"),

    // Dashboard - Quick Log
    quickLogToggle: $("#quickLogToggle"),
    quickLogForm: $("#quickLogForm"),
    quickMealName: $("#quickMealName"),
    quickMealCalories: $("#quickMealCalories"),
    quickMealType: $("#quickMealType"),

    // Dashboard - Today & Weekly
    todayMealsList: $("#todayMealsList"),
    weeklySummary: $("#weeklySummary"),

    // Calculator
    calcAge: $("#calcAge"),
    calcGender: $("#calcGender"),
    calcHeight: $("#calcHeight"),
    calcWeight: $("#calcWeight"),
    calcActivity: $("#calcActivity"),
    calcBtn: $("#calcBtn"),
    calcResults: $("#calcResults"),
    resultBMR: $("#resultBMR"),
    resultMaintenance: $("#resultMaintenance"),
    resultLoss: $("#resultLoss"),
    resultGain: $("#resultGain"),

    // Calculator - Analysis
    calcAnalysis: $("#calcAnalysis"),
    bmiValue: $("#bmiValue"),
    bmiCategory: $("#bmiCategory"),
    bmiMarker: $("#bmiMarker"),
    healthyRange: $("#healthyRange"),
    macroProtein: $("#macroProtein"),
    macroProteinCal: $("#macroProteinCal"),
    macroCarbs: $("#macroCarbs"),
    macroCarbsCal: $("#macroCarbsCal"),
    macroFat: $("#macroFat"),
    macroFatCal: $("#macroFatCal"),
    waterValue: $("#waterValue"),
    analysisInsight: $("#analysisInsight"),
    useMaintenanceBtn: $("#useMaintenanceBtn"),

    // Meals
    mealForm: $("#mealForm"),
    mealName: $("#mealName"),
    mealCalories: $("#mealCalories"),
    mealType: $("#mealType"),
    mealsList: $("#mealsList"),
    mealSearch: $("#mealSearch"),
    mealFilter: $("#mealFilter"),
    mealDateFilter: $("#mealDateFilter"),
    totalCaloriesDisplay: $("#totalCaloriesDisplay"),
    clearAllBtn: $("#clearAllBtn"),
    exportCsvBtn: $("#exportCsvBtn"),

    // Modal
    mealModal: $("#mealModal"),
    modalTitle: $("#modalTitle"),
    editMealId: $("#editMealId"),
    editMealName: $("#editMealName"),
    editMealCalories: $("#editMealCalories"),
    editMealType: $("#editMealType"),
    editMealForm: $("#editMealForm"),
    modalClose: $(".modal-close"),

    // Goal Modal
    goalModal: $("#goalModal"),
    goalInput: $("#goalInput"),
    saveGoalBtn: $("#saveGoalBtn"),
    goalModalClose: $(".goal-modal-close"),

    // Camera
    startCameraBtn: $("#startCameraBtn"),
    capturePhotoBtn: $("#capturePhotoBtn"),
    retakePhotoBtn: $("#retakePhotoBtn"),
    stopCameraBtn: $("#stopCameraBtn"),
    cameraFeed: $("#cameraFeed"),
    photoCanvas: $("#photoCanvas"),
    previewImg: $("#previewImg"),
    photoPreview: $("#photoPreview"),
    cameraPlaceholder: $("#cameraPlaceholder"),
    estimatedCalories: $("#estimatedCalories"),

    // Theme & Nav
    themeToggle: $("#themeToggle"),
    menuToggle: $("#menuToggle"),
    sidebar: $("#sidebar"),
    overlay: $("#overlay"),
    navLinks: $$(".nav-link"),
    sections: $$(".section"),
  };

  let mediaStream = null;

  // ---- Helper: Today's date string (local, not UTC) ----
  const todayStr = () => localDateStr(new Date());

  // ---- Helpers ----
  function getTodayMeals() {
    return meals.filter((m) => m.date === todayStr());
  }

  function getMealsForDate(dateStr) {
    return meals.filter((m) => m.date === dateStr);
  }

  // ---- Load meals from API on init ----
  async function loadMeals() {
    try {
      meals = await fetchMeals();
    } catch (err) {
      console.error("Failed to load meals:", err);
      meals = [];
    }
    renderAll();
  }

  // ---- Live sync status badge ----
  function setSyncStatus(state, label) {
    const badge = document.getElementById("syncStatus");
    if (!badge) return;
    badge.classList.remove("is-live", "is-offline");
    if (state === "live") badge.classList.add("is-live");
    else if (state === "offline") badge.classList.add("is-offline");
    const labelEl = badge.querySelector(".sync-label");
    if (labelEl) labelEl.textContent = label;
  }

  // ---- Supabase Realtime: live-sync meal changes across devices ----
  let realtimeChannel = null;
  let realtimeActive = false;
  async function initRealtime() {
    try {
      if (!window.supabase || typeof window.supabase.createClient !== "function") {
        setSyncStatus("default", "Local only");
        return;
      }
      const res = await fetch("/api/config");
      const cfg = await res.json();
      if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        console.warn("Realtime disabled: Supabase not configured.");
        setSyncStatus("default", "Local only");
        return;
      }
      const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      realtimeChannel = client
        .channel("meals-realtime")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "meals" },
          () => { loadMeals(); }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            realtimeActive = true;
            setSyncStatus("live", "Live");
            console.log("🕸️ Realtime connected");
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            realtimeActive = false;
            setSyncStatus("default", "Auto-sync");
          } else if (status === "CLOSED") {
            realtimeActive = false;
            setSyncStatus("offline", "Offline");
          }
        });
    } catch (err) {
      console.error("Realtime init failed:", err);
      setSyncStatus("offline", "Offline");
    }
  }

  // Fallback sync so other devices' changes still appear even if the
  // Supabase realtime publication isn't enabled for the meals table.
  function initSyncFallbacks() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") loadMeals();
    });
    // Poll as a safety net (realtime gives instant updates; this covers the
    // case where the realtime publication isn't enabled for the meals table).
    setInterval(() => {
      if (document.visibilityState === "visible") loadMeals();
    }, 30000);
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function saveState() {
    if (dailyGoal) {
      localStorage.setItem("spideyGoal", dailyGoal);
    } else {
      localStorage.removeItem("spideyGoal");
    }
    localStorage.setItem("spideyTheme", theme);
  }

  // ---- Loading Screen ----
  function hideLoading() {
    if (els.loadingScreen) {
      els.loadingScreen.classList.add("hidden");
    }
  }

  // ---- API Helpers ----
  const API = "/api/meals";

  async function fetchMeals(filters = {}) {
    const params = new URLSearchParams();
    if (filters.date) params.set("date", filters.date);
    if (filters.type && filters.type !== "all") params.set("type", filters.type);
    if (filters.search) params.set("search", filters.search);

    const qs = params.toString();
    const url = qs ? `${API}?${qs}` : API;

    const response = await fetch(url);
    const data = await response.json();
    if (data.success) return data.meals;
    throw new Error(data.error || "Failed to fetch meals");
  }

  async function createMeal(name, calories, type, date) {
    const response = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, calories, type, date }),
    });
    const data = await response.json();
    if (data.success) return data.meal;
    throw new Error(data.error || "Failed to create meal");
  }

  async function updateMeal(id, name, calories, type) {
    const response = await fetch(`${API}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, calories, type }),
    });
    const data = await response.json();
    if (data.success) return data.meal;
    throw new Error(data.error || "Failed to update meal");
  }

  async function deleteMealFromAPI(id) {
    const response = await fetch(`${API}/${id}`, { method: "DELETE" });
    const data = await response.json();
    if (!data.success) throw new Error(data.error || "Failed to delete meal");
  }

  async function clearAllMealsFromAPI() {
    const response = await fetch(`${API}/all`, { method: "DELETE" });
    const data = await response.json();
    if (!data.success) throw new Error(data.error || "Failed to clear meals");
  }

  // ---- Theme Management ----
  function setTheme(t) {
    theme = t;
    document.documentElement.setAttribute("data-theme", t);
    els.themeToggle.textContent = t === "dark" ? "🌙" : "☀️";
    updateHeroVideo(t);
    saveState();
  }

  // Swap the dashboard hero clip: Miles in dark, Spider-Man in light.
  // Falls back to the Spider-Man clip if the requested file is missing.
  function updateHeroVideo(t) {
    const video = document.getElementById("heroVideo");
    if (!video) return;
    const primary = t === "dark" ? "/video/miles.mp4" : "/video/spiderman.mp4";
    const poster = t === "dark" ? "/video/miles-poster.jpg" : "/video/spiderman-poster.jpg";
    const fallback = "/video/spiderman.mp4";
    const target = video.dataset.src === primary ? null : primary;
    if (!target) return;
    video.poster = poster;
    video.dataset.src = primary;
    video.onerror = () => {
      if (video.currentSrc.endsWith("miles.mp4")) {
        video.onerror = null;
        video.src = fallback;
        video.load();
        video.play().catch(() => {});
      }
    };
    video.src = primary;
    video.load();
    video.play().catch(() => {});
  }

  function toggleTheme() {
    setTheme(theme === "dark" ? "light" : "dark");
  }

  // ---- Sidebar ----
  function openSidebar() {
    els.sidebar.classList.add("open");
    els.overlay.classList.add("active");
  }

  function closeSidebar() {
    els.sidebar.classList.remove("open");
    els.overlay.classList.remove("active");
  }

  // ---- Navigation ----
  function navigateTo(sectionId) {
    els.sections.forEach((s) => s.classList.remove("active"));
    els.navLinks.forEach((l) => l.classList.remove("active"));

    const targetSection = document.getElementById(sectionId);
    if (targetSection) targetSection.classList.add("active");

    const targetLink = document.querySelector(`.nav-link[data-section="${sectionId}"]`);
    if (targetLink) targetLink.classList.add("active");

    closeSidebar();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---- Progress Ring Update ----
  function updateProgressRing(percent) {
    if (!els.calProgressRing) return;

    const radius = 88;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percent / 100) * circumference;

    els.calProgressRing.style.strokeDasharray = `${circumference}`;
    els.calProgressRing.style.strokeDashoffset = `${offset}`;

    // Color
    if (percent > 100) {
      els.calProgressRing.style.color = "var(--danger)";
    } else if (percent > 80) {
      els.calProgressRing.style.color = "var(--warning)";
    } else {
      els.calProgressRing.style.color = "var(--accent-red)";
    }

    // Glow intensity based on progress
    const glowIntensity = Math.min(1, percent / 100);
    els.calProgressRing.style.filter = `drop-shadow(0 0 ${6 + glowIntensity * 10}px rgba(226, 54, 54, ${0.2 + glowIntensity * 0.3}))`;
  }

  // ---- Streak Calculation ----
  function calculateStreak() {
    if (meals.length === 0) return 0;

    const dates = [...new Set(meals.map((m) => m.date))].sort().reverse();
    let streak = 0;
    const today = todayStr();

    // Check if today has meals
    if (dates[0] !== today) return 0;

    streak = 1;
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1] + "T00:00:00");
      const curr = new Date(dates[i] + "T00:00:00");
      const diff = (prev - curr) / (1000 * 60 * 60 * 24);
      if (diff === 1) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }

  // ---- Weekly Average ----
  function calculateWeeklyAvg() {
    const today = new Date();
    let totalCal = 0;
    let dayCount = 0;

    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = localDateStr(d);
      const dayM = getMealsForDate(dateStr);
      const cal = dayM.reduce((s, m) => s + m.calories, 0);
      if (cal > 0) {
        totalCal += cal;
        dayCount++;
      }
    }

    return dayCount > 0 ? Math.round(totalCal / dayCount) : 0;
  }

  // ---- Dashboard Update ----
  function updateDashboard() {
    const todayM = getTodayMeals();
    const consumed = todayM.reduce((sum, m) => sum + m.calories, 0);
    const hasGoal = !!dailyGoal;
    const remaining = hasGoal ? Math.max(0, dailyGoal - consumed) : null;
    const percent = hasGoal ? Math.min(100, Math.round((consumed / dailyGoal) * 100)) : 0;

    els.dailyGoal.textContent = hasGoal ? dailyGoal : "—";
    els.caloriesConsumed.textContent = consumed;
    els.caloriesRemaining.textContent = hasGoal ? remaining : "—";
    els.mealCount.textContent = todayM.length;
    els.progressPercent.textContent = hasGoal ? percent + "%" : "—";

    // Update progress ring
    updateProgressRing(percent);

    // Streak & Weekly Avg
    els.streakCount.textContent = calculateStreak();
    els.weeklyAvg.textContent = calculateWeeklyAvg();

    // Today's meals mini list
    renderTodayMealsMini(todayM);

    // Weekly summary
    renderWeeklySummary();
  }

  // ---- Today's Meals Mini ----
  function renderTodayMealsMini(todayM) {
    if (todayM.length === 0) {
      els.todayMealsList.innerHTML =
        '<p class="empty-state">No meals logged yet. Time to fuel up! 🕷️</p>';
      return;
    }

    const typeIcons = { breakfast: "🌅", lunch: "☀️", dinner: "🌙", snacks: "🍿" };

    els.todayMealsList.innerHTML = todayM
      .slice(-5)
      .reverse()
      .map(
        (m) => `
      <div class="meal-item">
        <span class="meal-type-icon">${typeIcons[m.type] || "🍽️"}</span>
        <div class="meal-info">
          <div class="meal-name">${escapeHtml(m.name)}</div>
        </div>
        <span class="meal-calories">${m.calories}</span>
      </div>`
      )
      .join("");

    if (todayM.length > 5) {
      els.todayMealsList.innerHTML +=
        '<p style="text-align:center;font-size:0.75rem;color:var(--text-secondary);padding-top:0.4rem;">+' +
        (todayM.length - 5) +
        " more meals</p>";
    }
  }

  // ---- Local date string (avoids UTC off-by-one from toISOString) ----
  function localDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  // ---- Weekly Summary (Monday → Sunday, real calendar dates) ----
  function renderWeeklySummary() {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const today = new Date();
    const todayKey = localDateStr(today);

    // Monday of the current calendar week (Mon=0 … Sun=6)
    const mondayOffset = (today.getDay() + 6) % 7;
    const monday = new Date(today);
    monday.setDate(today.getDate() - mondayOffset);

    let html = "";
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dateStr = localDateStr(d);
      const dayM = getMealsForDate(dateStr);
      const cal = dayM.reduce((s, m) => s + m.calories, 0);
      const isToday = dateStr === todayKey;
      const isFuture = dateStr > todayKey;
      const emoji =
        cal === 0
          ? "😴"
          : !dailyGoal
            ? "🍽️"
            : cal >= dailyGoal
              ? "🕷️"
              : cal >= dailyGoal * 0.5
                ? "💪"
                : "🍽️";

      html += `
      <div class="weekly-day${isToday ? " is-today" : ""}${isFuture ? " is-future" : ""}">
        <div class="day-name">${days[i]}</div>
        <div class="day-date">${d.getDate()}</div>
        <div class="day-emoji">${emoji}</div>
        <div class="day-calories">${cal}</div>
      </div>`;
    }

    els.weeklySummary.innerHTML = html;
  }

  // ---- Meal CRUD ----
  async function addMeal(name, calories, type, date) {
    try {
      const meal = await createMeal(name.trim(), calories, type, date);
      meals.push(meal);
      renderAll();
    } catch (err) {
      alert("Failed to save meal: " + err.message + " 🕷️");
    }
  }

  function getMealById(id) {
    return meals.find((m) => m.id === id);
  }

  async function deleteMeal(id) {
    if (!confirm("Delete this meal? 🕷️")) return;
    try {
      await deleteMealFromAPI(id);
      meals = meals.filter((m) => m.id !== id);
      renderAll();
    } catch (err) {
      alert("Failed to delete meal: " + err.message + " 🕷️");
    }
  }

  async function editMeal(id, name, calories, type) {
    try {
      const updated = await updateMeal(id, name.trim(), calories, type);
      const idx = meals.findIndex((m) => m.id === id);
      if (idx !== -1) {
        meals[idx] = updated;
      }
      renderAll();
    } catch (err) {
      alert("Failed to update meal: " + err.message + " 🕷️");
    }
  }

  async function clearAllMeals() {
    if (meals.length === 0) return;
    if (!confirm("Delete ALL meals? This cannot be undone! 🕷️")) return;
    try {
      await clearAllMealsFromAPI();
      meals = [];
      renderAll();
    } catch (err) {
      alert("Failed to clear meals: " + err.message + " 🕷️");
    }
  }

  // ---- Render Meals ----
  function renderMeals() {
    const searchTerm = els.mealSearch.value.toLowerCase().trim();
    const filterType = els.mealFilter.value;
    const dateFilter = els.mealDateFilter.value;

    let filtered = [...meals];

    if (dateFilter === "today") {
      filtered = filtered.filter((m) => m.date === todayStr());
    }
    if (filterType !== "all") {
      filtered = filtered.filter((m) => m.type === filterType);
    }
    if (searchTerm) {
      filtered = filtered.filter((m) => m.name.toLowerCase().includes(searchTerm));
    }

    filtered.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return new Date(b.createdAt || b.timestamp) - new Date(a.createdAt || a.timestamp);
    });

    const typeIcons = { breakfast: "🌅", lunch: "☀️", dinner: "🌙", snacks: "🍿" };

    if (filtered.length === 0) {
      els.mealsList.innerHTML =
        '<p class="empty-state">No meals found. Add your first meal! 🕷️</p>';
      els.totalCaloriesDisplay.textContent = "0 cal";
      return;
    }

    const todayCal = getTodayMeals().reduce((s, m) => s + m.calories, 0);
    els.totalCaloriesDisplay.textContent = todayCal + " cal";

    const getId = (m) => m.id;

    els.mealsList.innerHTML = filtered
      .map(
        (m) => `
      <div class="meal-item">
        <span class="meal-type-icon">${typeIcons[m.type] || "🍽️"}</span>
        <div class="meal-info">
          <div class="meal-name">${escapeHtml(m.name)}</div>
          <span class="meal-type-tag">${m.type} · ${formatDate(m.date)}</span>
        </div>
        <span class="meal-calories">${m.calories}</span>
        <div class="meal-actions">
          <button class="btn-meal-edit" data-id="${getId(m)}" title="Edit">✏️</button>
          <button class="btn-meal-delete" data-id="${getId(m)}" title="Delete">🗑️</button>
        </div>
      </div>`
      )
      .join("");

    els.mealsList.querySelectorAll(".btn-meal-edit").forEach((btn) => {
      btn.addEventListener("click", () => openEditModal(btn.dataset.id));
    });
    els.mealsList.querySelectorAll(".btn-meal-delete").forEach((btn) => {
      btn.addEventListener("click", () => deleteMeal(btn.dataset.id));
    });
  }

  // ---- Edit Modal ----
  function openEditModal(id) {
    const meal = getMealById(id);
    if (!meal) return;

    els.modalTitle.textContent = "✏️ Edit Meal";
    els.editMealId.value = meal.id;
    els.editMealName.value = meal.name;
    els.editMealCalories.value = meal.calories;
    els.editMealType.value = meal.type;
    els.mealModal.classList.remove("hidden");
  }

  function closeModal() {
    els.mealModal.classList.add("hidden");
    els.goalModal.classList.add("hidden");
  }

  // ---- Quick Log Toggle ----
  function toggleQuickLog() {
    const isHidden = els.quickLogForm.classList.contains("hidden");
    els.quickLogForm.classList.toggle("hidden");
    els.quickLogToggle.setAttribute("aria-expanded", isHidden);
    if (!isHidden) {
      els.quickMealName.focus();
    }
  }

  // ---- Charts ----
  function initCharts() {
    Object.values(charts).forEach((c) => {
      if (c) c.destroy();
    });
    charts = {};

    const isDark =
      getComputedStyle(document.documentElement).getPropertyValue("--bg-card").trim() === "rgba(255, 255, 255, 0.04)";

    const chartColors = {
      grid: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)",
      text: isDark ? "#8e8ea0" : "#6b6b80",
      red: "#e23636",
      blue: "#1a73e8",
      green: "#34d399",
      yellow: "#fbbf24",
      orange: "#f59e0b",
      purple: "#8b5cf6",
    };

    const options = {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          labels: { color: chartColors.text, font: { size: 11 } },
        },
      },
      scales: {
        x: {
          ticks: { color: chartColors.text, font: { size: 10 } },
          grid: { color: chartColors.grid },
        },
        y: {
          beginAtZero: true,
          ticks: { color: chartColors.text, font: { size: 10 } },
          grid: { color: chartColors.grid },
        },
      },
    };

    // 1. Daily Chart (This Week — Monday → Sunday)
    const dailyCtx = document.getElementById("dailyChart");
    if (dailyCtx) {
      const days = [];
      const calData = [];
      const today = new Date();
      const mondayOffset = (today.getDay() + 6) % 7;
      const monday = new Date(today);
      monday.setDate(today.getDate() - mondayOffset);

      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const dateStr = localDateStr(d);
        const dayM = getMealsForDate(dateStr);
        const cal = dayM.reduce((s, m) => s + m.calories, 0);
        days.push(d.toLocaleDateString("en-US", { weekday: "short" }));
        calData.push(cal);
      }

      charts.daily = new Chart(dailyCtx, {
        type: "bar",
        data: {
          labels: days,
          datasets: [
            {
              label: "Calories",
              data: calData,
              backgroundColor: calData.map((c) =>
                dailyGoal && c > dailyGoal
                  ? "rgba(226, 54, 54, 0.6)"
                  : "rgba(26, 115, 232, 0.6)"
              ),
              borderColor: calData.map((c) =>
                dailyGoal && c > dailyGoal ? chartColors.red : chartColors.blue
              ),
              borderWidth: 1,
              borderRadius: 4,
            },
          ],
        },
        options: { ...options },
      });
    }

    // 2. Meal Type Chart (Today)
    const mealTypeCtx = document.getElementById("mealTypeChart");
    if (mealTypeCtx) {
      const todayM = getTodayMeals();
      const types = { breakfast: 0, lunch: 0, dinner: 0, snacks: 0 };
      todayM.forEach((m) => {
        types[m.type] = (types[m.type] || 0) + m.calories;
      });

      const labels = ["Breakfast", "Lunch", "Dinner", "Snacks"];
      const data = [types.breakfast, types.lunch, types.dinner, types.snacks];

      charts.mealType = new Chart(mealTypeCtx, {
        type: "doughnut",
        data: {
          labels,
          datasets: [
            {
              data,
              backgroundColor: [
                "rgba(251, 191, 36, 0.7)",
                "rgba(52, 211, 153, 0.7)",
                "rgba(26, 115, 232, 0.7)",
                "rgba(226, 54, 54, 0.7)",
              ],
              borderColor: [
                chartColors.yellow,
                chartColors.green,
                chartColors.blue,
                chartColors.red,
              ],
              borderWidth: 2,
            },
          ],
        },
        options: {
          ...options,
          scales: { x: { display: false }, y: { display: false } },
          plugins: {
            ...options.plugins,
            legend: { position: "bottom", labels: { color: chartColors.text, font: { size: 11 } } },
          },
        },
      });
    }

    // 3. Weekly Calorie Distribution
    const weeklyCtx = document.getElementById("weeklyChart");
    if (weeklyCtx) {
      const days = [];
      const calData = [];
      const goalData = [];
      const today = new Date();

      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = localDateStr(d);
        const dayM = getMealsForDate(dateStr);
        const cal = dayM.reduce((s, m) => s + m.calories, 0);
        days.push(d.toLocaleDateString("en-US", { weekday: "short" }));
        calData.push(cal);
        goalData.push(dailyGoal);
      }

      charts.weekly = new Chart(weeklyCtx, {
        type: "line",
        data: {
          labels: days,
          datasets: [
            {
              label: "Calories",
              data: calData,
              borderColor: chartColors.red,
              backgroundColor: "rgba(226, 54, 54, 0.08)",
              fill: true,
              tension: 0.3,
              pointBackgroundColor: chartColors.red,
              pointRadius: 4,
            },
            {
              label: "Goal",
              data: goalData,
              borderColor: chartColors.blue,
              borderDash: [5, 5],
              borderWidth: 2,
              pointRadius: 0,
              fill: false,
            },
          ],
        },
        options: options,
      });
    }

    // 4. Daily Average per Meal Type
    const avgCtx = document.getElementById("avgChart");
    if (avgCtx) {
      const days = [];
      const breakfast = [];
      const lunch = [];
      const dinner = [];
      const snacks = [];
      const today = new Date();

      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = localDateStr(d);
        const dayM = getMealsForDate(dateStr);
        days.push(d.toLocaleDateString("en-US", { weekday: "short" }));
        breakfast.push(
          dayM.filter((m) => m.type === "breakfast").reduce((s, m) => s + m.calories, 0)
        );
        lunch.push(
          dayM.filter((m) => m.type === "lunch").reduce((s, m) => s + m.calories, 0)
        );
        dinner.push(
          dayM.filter((m) => m.type === "dinner").reduce((s, m) => s + m.calories, 0)
        );
        snacks.push(
          dayM.filter((m) => m.type === "snacks").reduce((s, m) => s + m.calories, 0)
        );
      }

      charts.avg = new Chart(avgCtx, {
        type: "bar",
        data: {
          labels: days,
          datasets: [
            {
              label: "Breakfast",
              data: breakfast,
              backgroundColor: "rgba(251, 191, 36, 0.6)",
              borderRadius: 2,
            },
            {
              label: "Lunch",
              data: lunch,
              backgroundColor: "rgba(52, 211, 153, 0.6)",
              borderRadius: 2,
            },
            {
              label: "Dinner",
              data: dinner,
              backgroundColor: "rgba(26, 115, 232, 0.6)",
              borderRadius: 2,
            },
            {
              label: "Snacks",
              data: snacks,
              backgroundColor: "rgba(226, 54, 54, 0.6)",
              borderRadius: 2,
            },
          ],
        },
        options: options,
      });
    }
  }

  // ---- Calorie Calculator (Mifflin-St Jeor) ----
  function calculateCalories() {
    const age = parseInt(els.calcAge.value);
    const gender = els.calcGender.value;
    const height = parseFloat(els.calcHeight.value);
    const weight = parseFloat(els.calcWeight.value);
    const activity = parseFloat(els.calcActivity.value);

    if (!age || !height || !weight || age < 10 || age > 120 || height < 50 || height > 300 || weight < 20 || weight > 500) {
      alert("Please enter valid values for all fields! 🕷️");
      return;
    }

    let bmr;
    if (gender === "male") {
      bmr = 10 * weight + 6.25 * height - 5 * age + 5;
    } else {
      bmr = 10 * weight + 6.25 * height - 5 * age - 161;
    }

    const maintenance = Math.round(bmr * activity);
    const weightLoss = Math.round(maintenance - 500);
    const weightGain = Math.round(maintenance + 500);

    els.resultBMR.textContent = Math.round(bmr);
    els.resultMaintenance.textContent = maintenance;
    els.resultLoss.textContent = weightLoss;
    els.resultGain.textContent = weightGain;
    els.calcResults.classList.remove("hidden");

    lastMaintenance = maintenance;
    renderAnalysis({ age, gender, height, weight, activity, maintenance });

    // Re-trigger animation
    els.calcResults.style.animation = "none";
    els.calcResults.offsetHeight; // Force reflow
    els.calcResults.style.animation = "fadeUp 0.4s ease";
  }

  // ---- Personalized Analysis (derived from calculator inputs) ----
  function renderAnalysis({ age, gender, height, weight, activity, maintenance }) {
    if (!els.calcAnalysis) return;

    // BMI
    const heightM = height / 100;
    const bmi = weight / (heightM * heightM);
    const bmiRounded = bmi.toFixed(1);

    let category, catClass;
    if (bmi < 18.5) {
      category = "Underweight";
      catClass = "under";
    } else if (bmi < 25) {
      category = "Normal";
      catClass = "normal";
    } else if (bmi < 30) {
      category = "Overweight";
      catClass = "over";
    } else {
      category = "Obese";
      catClass = "obese";
    }

    els.bmiValue.textContent = bmiRounded;
    els.bmiCategory.textContent = category;
    els.bmiCategory.className = "analysis-bmi-tag bmi-" + catClass;

    // Marker position on a 15–40 BMI scale
    const pct = Math.max(0, Math.min(100, ((bmi - 15) / (40 - 15)) * 100));
    els.bmiMarker.style.left = pct + "%";

    // Healthy weight range for this height (BMI 18.5–24.9)
    const lowWeight = (18.5 * heightM * heightM).toFixed(1);
    const highWeight = (24.9 * heightM * heightM).toFixed(1);
    els.healthyRange.textContent = `Healthy weight range for your height: ${lowWeight}–${highWeight} kg`;

    // Macros at maintenance: protein 1.6 g/kg, fat 25% of calories, carbs fill the rest
    const proteinG = Math.round(weight * 1.6);
    const proteinCal = proteinG * 4;
    const fatCal = Math.round(maintenance * 0.25);
    const fatG = Math.round(fatCal / 9);
    const carbsCal = Math.max(0, maintenance - proteinCal - fatCal);
    const carbsG = Math.round(carbsCal / 4);

    els.macroProtein.textContent = proteinG + "g";
    els.macroProteinCal.textContent = proteinCal + " cal";
    els.macroCarbs.textContent = carbsG + "g";
    els.macroCarbsCal.textContent = carbsCal + " cal";
    els.macroFat.textContent = fatG + "g";
    els.macroFatCal.textContent = fatCal + " cal";

    // Hydration: ~35 ml per kg
    const waterL = (weight * 0.035).toFixed(1);
    els.waterValue.textContent = `${waterL} L (${Math.round(waterL / 0.25)} glasses)`;

    // Personalized insight
    els.analysisInsight.textContent = buildInsight({ bmi, category, age, gender, activity, maintenance, lowWeight, highWeight, weight });

    els.calcAnalysis.classList.add("visible");
  }

  function buildInsight({ bmi, category, activity, maintenance, lowWeight, highWeight, weight }) {
    const activityLabels = {
      "1.2": "mostly sedentary",
      "1.375": "lightly active",
      "1.55": "moderately active",
      "1.725": "very active",
      "1.9": "extremely active",
    };
    const activityText = activityLabels[String(activity)] || "active";

    let msg;
    if (category === "Normal") {
      msg = `Your BMI of ${bmi.toFixed(1)} is in the healthy range — nice work, web-slinger! Eat around ${maintenance} cal/day to maintain, and keep protein high to stay strong.`;
    } else if (category === "Underweight") {
      const gain = (lowWeight - weight).toFixed(1);
      msg = `Your BMI of ${bmi.toFixed(1)} is below the healthy range. Aiming for a gentle surplus (~${maintenance + 500} cal/day) could help you reach ${lowWeight} kg — about ${gain} kg to go.`;
    } else if (category === "Overweight") {
      const lose = (weight - highWeight).toFixed(1);
      msg = `Your BMI of ${bmi.toFixed(1)} is slightly above the healthy range. A modest deficit (~${maintenance - 500} cal/day) could bring you toward ${highWeight} kg — roughly ${lose} kg away.`;
    } else {
      const lose = (weight - highWeight).toFixed(1);
      msg = `Your BMI of ${bmi.toFixed(1)} is in the obese range. A sustainable deficit (~${maintenance - 500} cal/day) and regular movement can help; a healthy target is around ${highWeight} kg (~${lose} kg to go).`;
    }
    return `${msg} You logged yourself as ${activityText}, which is already factored into your ${maintenance} cal maintenance.`;
  }

  // ---- Camera ----
  async function startCamera() {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      els.cameraFeed.srcObject = mediaStream;
      els.cameraFeed.classList.remove("hidden");
      els.cameraPlaceholder.classList.add("hidden");
      els.startCameraBtn.classList.add("hidden");
      els.capturePhotoBtn.classList.remove("hidden");
      els.retakePhotoBtn.classList.add("hidden");
      els.stopCameraBtn.classList.remove("hidden");
      els.photoPreview.classList.add("hidden");
    } catch (err) {
      alert("Camera access denied. Please allow camera permissions. 🕷️\n\nError: " + err.message);
    }
  }

  function closeCamera() {
    stopCamera();
    els.photoPreview.classList.add("hidden");
    els.capturePhotoBtn.classList.add("hidden");
    els.retakePhotoBtn.classList.add("hidden");
    els.stopCameraBtn.classList.add("hidden");
    els.startCameraBtn.classList.remove("hidden");
  }

  function capturePhoto() {
    const video = els.cameraFeed;
    const canvas = els.photoCanvas;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);

    const imgData = canvas.toDataURL("image/jpeg", 0.8);
    els.previewImg.src = imgData;
    els.photoPreview.classList.remove("hidden");
    els.capturePhotoBtn.classList.add("hidden");
    els.retakePhotoBtn.classList.remove("hidden");
    els.stopCameraBtn.classList.add("hidden");

    const base64Data = imgData.split(",")[1];
    els.estimatedCalories.innerHTML = '<span class="loading-spinner">🕷️</span> Analyzing...';

    analyzeFoodWithAI(base64Data);
    stopCamera();
  }

  async function analyzeFoodWithAI(base64Image) {
    // Timeout after 15 seconds
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch("/api/analyze-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64Image, mimeType: "image/jpeg" }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const data = await response.json();

      if (data.success && data.analysis) {
        displayAIResults(data.analysis);
      } else {
        // Show the error from the server (e.g., missing API key)
        els.estimatedCalories.innerHTML = `
          <div class="ai-error">
            <strong>😕 Analysis failed</strong><br/>
            ${data.error || "Please try again."}<br/>
            <span style="font-size:0.75rem;color:var(--text-secondary);">${data.details ? escapeHtml(data.details) : ""}</span>
            ${data.error && data.error.includes("GOOGLE_API_KEY") ? 
              `<div style="margin-top:0.5rem;padding:0.5rem;background:rgba(226,54,54,0.1);border-radius:8px;font-size:0.75rem;">
                📋 <strong>Setup required:</strong> Create a <code>.env</code> file with:<br/>
                <code style="background:rgba(0,0,0,0.2);padding:0.1rem 0.3rem;border-radius:4px;">GOOGLE_API_KEY=your_key</code><br/>
                <a href="https://aistudio.google.com/apikey" target="_blank" style="color:var(--accent-blue);">Get a free API key →</a>
              </div>` : ""}
          </div>`;
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        els.estimatedCalories.innerHTML = `
          <div class="ai-error">
            ⏱️ Analysis timed out after 15s.<br/>
            <span style="font-size:0.75rem;color:var(--text-secondary);">The AI server may be unavailable. Make sure you have a valid GOOGLE_API_KEY in your .env file.</span>
          </div>`;
      } else {
        els.estimatedCalories.innerHTML = `
          <div class="ai-error">😕 Network error. ${escapeHtml(err.message)}</div>`;
      }
    }
  }

  function displayAIResults(analysis) {
    if (analysis.food_name) {
      const confidenceEmoji = analysis.confidence === "high" ? "🕷️" : analysis.confidence === "medium" ? "💪" : "🤔";
      const confidenceLabel = analysis.confidence === "high" ? "High" : analysis.confidence === "medium" ? "Medium" : "Low";

      els.estimatedCalories.innerHTML = `
        <div class="ai-result-card">
          <div class="ai-food-header">
            <span class="ai-food-icon">🍽️</span>
            <span class="ai-food-name">${escapeHtml(analysis.food_name)}</span>
            <span class="ai-confidence ${analysis.confidence}">${confidenceEmoji} ${confidenceLabel}</span>
          </div>
          <div class="ai-calories-badge">
            <span class="ai-cal-value">${analysis.estimated_calories}</span>
            <span class="ai-cal-label">estimated calories</span>
            ${analysis.calories_range ? `<span class="ai-cal-range">range: ${analysis.calories_range} kcal</span>` : ""}
          </div>
          <div class="ai-macros">
            ${analysis.protein_g != null ? `<div class="macro-item macro-protein"><span class="macro-value">${analysis.protein_g}g</span><span class="macro-label">Protein</span></div>` : ""}
            ${analysis.carbs_g != null ? `<div class="macro-item macro-carbs"><span class="macro-value">${analysis.carbs_g}g</span><span class="macro-label">Carbs</span></div>` : ""}
            ${analysis.fat_g != null ? `<div class="macro-item macro-fat"><span class="macro-value">${analysis.fat_g}g</span><span class="macro-label">Fat</span></div>` : ""}
          </div>
          ${analysis.description ? `<div class="ai-description">${escapeHtml(analysis.description)}</div>` : ""}
        </div>`;
    } else if (analysis.raw_response) {
      els.estimatedCalories.innerHTML = `<div class="ai-result-card"><div class="ai-raw-response">${escapeHtml(analysis.raw_response)}</div></div>`;
    } else {
      els.estimatedCalories.innerHTML = `<div class="ai-result-card"><p>🔬 Analysis complete!</p></div>`;
    }
  }

  function retakePhoto() {
    els.photoPreview.classList.add("hidden");
    els.capturePhotoBtn.classList.remove("hidden");
    els.retakePhotoBtn.classList.add("hidden");
    startCamera();
  }

  function stopCamera() {
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
    els.cameraFeed.classList.add("hidden");
    els.cameraPlaceholder.classList.remove("hidden");
    els.startCameraBtn.classList.remove("hidden");
    els.capturePhotoBtn.classList.add("hidden");
  }

  // ---- CSV Export ----
  function exportCSV() {
    if (meals.length === 0) {
      alert("No meals to export! Add some meals first. 🕷️");
      return;
    }

    const headers = ["Date", "Meal Name", "Calories", "Type"];
    const rows = meals.map((m) => [m.date, `"${m.name.replace(/"/g, '""')}"`, m.calories, m.type]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `spidey-meals-${todayStr()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  // ---- Escape HTML ----
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- Render All ----
  function renderAll() {
    updateDashboard();
    renderMeals();
  }

  // ---- Event Listeners ----

  // Theme
  els.themeToggle.addEventListener("click", toggleTheme);

  // Sidebar
  els.menuToggle.addEventListener("click", openSidebar);
  els.overlay.addEventListener("click", closeSidebar);

  // Navigation
  els.navLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const section = link.dataset.section;
      navigateTo(section);
      if (section === "charts") {
        setTimeout(initCharts, 100);
      }
    });
  });

  // Quick Log Toggle
  els.quickLogToggle.addEventListener("click", toggleQuickLog);

  // Quick Log Submit
  els.quickLogForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = els.quickMealName.value.trim();
    const calories = els.quickMealCalories.value;
    const type = els.quickMealType.value;

    if (!name || !calories) return;

    await addMeal(name, calories, type, todayStr());
    els.quickLogForm.reset();
    els.quickMealName.focus();
    toggleQuickLog();
  });

  // Main Meal Form
  els.mealForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = els.mealName.value.trim();
    const calories = els.mealCalories.value;
    const type = els.mealType.value;

    if (!name || !calories) {
      alert("Please fill in all fields! 🕷️");
      return;
    }

    await addMeal(name, calories, type, todayStr());
    els.mealForm.reset();
    els.mealName.focus();
  });

  // Search & Filter
  els.mealSearch.addEventListener("input", renderMeals);
  els.mealFilter.addEventListener("change", renderMeals);
  els.mealDateFilter.addEventListener("change", renderMeals);

  // Clear All
  els.clearAllBtn.addEventListener("click", clearAllMeals);

  // Export CSV
  els.exportCsvBtn.addEventListener("click", exportCSV);

  // Edit Goal
  els.editGoalBtn.addEventListener("click", () => {
    els.goalInput.value = dailyGoal;
    els.goalModal.classList.remove("hidden");
  });

  els.saveGoalBtn.addEventListener("click", () => {
    const val = parseInt(els.goalInput.value);
    if (val && val >= 500 && val <= 10000) {
      dailyGoal = val;
      saveState();
      renderAll();
      closeModal();
    } else {
      alert("Please enter a valid goal between 500 and 10000 calories. 🕷️");
    }
  });

  els.goalModalClose.addEventListener("click", closeModal);    // Edit Modal
    els.modalClose.addEventListener("click", closeModal);

  els.editMealForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = els.editMealId.value;
    const name = els.editMealName.value.trim();
    const calories = els.editMealCalories.value;
    const type = els.editMealType.value;

    if (!name || !calories) {
      alert("Please fill in all fields! 🕷️");
      return;
    }

    await editMeal(id, name, calories, type);
    closeModal();
  });

  // Camera
  els.startCameraBtn.addEventListener("click", startCamera);
  els.capturePhotoBtn.addEventListener("click", capturePhoto);
  els.retakePhotoBtn.addEventListener("click", retakePhoto);
  els.stopCameraBtn.addEventListener("click", closeCamera);

  // Calculator
  els.calcBtn.addEventListener("click", calculateCalories);
  els.calcActivity.addEventListener("keydown", (e) => {
    if (e.key === "Enter") calculateCalories();
  });

  // Apply maintenance calories as the daily goal
  els.useMaintenanceBtn.addEventListener("click", () => {
    if (!lastMaintenance) return;
    dailyGoal = Math.round(lastMaintenance);
    saveState();
    renderAll();
    navigateTo("dashboard");
  });

  // Close modals on overlay click
  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  });

  // Close modals with Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  // ---- PWA Registration ----
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/sw.js")
      .then(() => console.log("🕷️ Service Worker registered"))
      .catch((err) => console.error("Service Worker registration failed:", err));
  }

  // ---- Init ----
  setTheme(theme);
  navigateTo("dashboard");

  // Load meals from API before rendering, then start realtime sync
  loadMeals().then(() => {
    hideLoading();
    initRealtime();
    initSyncFallbacks();
  });

  els.calcAge.value = 25;
  els.calcHeight.value = 175;
  els.calcWeight.value = 70;

  console.log("🕷️ SpideyTracker loaded!");
  console.log("💪 With great power comes great nutrition.");
});
