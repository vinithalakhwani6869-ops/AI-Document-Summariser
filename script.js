const API_BASE_URL = (() => {
  const configured =
    (typeof globalThis !== "undefined" &&
      typeof globalThis.__APP_CONFIG__?.apiBaseUrl === "string" &&
      globalThis.__APP_CONFIG__.apiBaseUrl.trim()) ||
    "";

  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  // Check if running in local development
  if (
    typeof window !== "undefined" &&
    window.location &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "::1" ||
      window.location.hostname.match(/^192\.168\./) ||
      window.location.hostname.match(/^10\./) ||
      window.location.hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./))
  ) {
    return "http://localhost:3000";
  }

  // For production (Render, etc.), use the same origin as the frontend
  if (
    typeof window !== "undefined" &&
    window.location &&
    /^https?:$/i.test(window.location.protocol)
  ) {
    return window.location.origin.replace(/\/+$/, "");
  }

  return "https://ai-document-summariser-j4a7.onrender.com";
})();
const DEFAULT_RESULT_MESSAGE = "Sign in to save and revisit your summaries.";
const THEME_STORAGE_KEY = "theme";
const LANGUAGE_STORAGE_KEY = "summaryLanguage";
const DEFAULT_SUMMARY_TEXT = "Your summary will appear here after processing.";
const DEFAULT_HISTORY_EMPTY = "No saved summaries yet. Generate one while logged in to see it here.";
const GUEST_HISTORY_MESSAGE = "Login to view your saved summaries";
const PROFILE_DROPDOWN_VIEWPORT_GAP = 12;
const MAX_FILES_ALLOWED = 5;
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const allowedExtensions = ["pdf", "txt", "docx"];
const themeIcons = {
  light:
    "M21 12.79A9 9 0 0 1 11.21 3A7 7 0 1 0 21 12.79Z",
  dark:
    "M12 3V5M12 19V21M4.93 4.93L6.34 6.34M17.66 17.66L19.07 19.07M3 12H5M19 12H21M4.93 19.07L6.34 17.66M17.66 6.34L19.07 4.93M12 8A4 4 0 1 1 8 12A4 4 0 0 1 12 8Z",
};

document.addEventListener("DOMContentLoaded", () => {
  console.log("App initialized");
  console.log("Resolved API base URL", API_BASE_URL);

  const elements = {
    authBackdrop: document.getElementById("authBackdrop"),
    authCancelButton: document.getElementById("authCancelButton"),
    authCloseButton: document.getElementById("authCloseButton"),
    authEmail: document.getElementById("authEmail"),
    authForm: document.getElementById("authForm"),
    authMessage: document.getElementById("authMessage"),
    authModal: document.getElementById("authModal"),
    authPassword: document.getElementById("authPassword"),
    authSubmitButton: document.getElementById("authSubmitButton"),
    authSubmitLabel: document.getElementById("authSubmitLabel"),
    authSubtitle: document.getElementById("authSubtitle"),
    authTitle: document.getElementById("authTitle"),
    authWarning: document.getElementById("authWarning"),
    avatarButton: document.getElementById("avatarButton"),
    avatarLabel: document.getElementById("avatarLabel"),
    buttonSpinner: document.getElementById("buttonSpinner"),
    closeSidebarButton: document.getElementById("closeSidebarButton"),
    dropzone: document.getElementById("dropzone"),
    fileInput: document.getElementById("fileInput"),
    fileMeta: document.getElementById("fileMeta"),
    fileNameText: document.getElementById("fileName"),
    form: document.getElementById("uploadform"),
    guestActions: document.getElementById("guestActions"),
    historyList: document.getElementById("historyList"),
    historySidebar: document.getElementById("historySidebar"),
    historyShortcut: document.getElementById("historyShortcut"),
    languageButton: document.getElementById("languageButton"),
    languageLabel: document.getElementById("languageLabel"),
    languageMenu: document.getElementById("languageMenu"),
    languageSelect: document.getElementById("languageSelect"),
    selectedLanguage: document.getElementById("selectedLanguage"),
    loadingState: document.getElementById("loadingState"),
    loginButton: document.getElementById("loginButton"),
    loginTab: document.getElementById("loginTab"),
    logoutButton: document.getElementById("logoutButton"),
    messageBox: document.getElementById("messageBox"),
    profileDropdown: document.getElementById("profileDropdown"),
    profileEmail: document.getElementById("profileEmail"),
    profileName: document.getElementById("profileName"),
    profileMenu: document.getElementById("profileMenu"),
    resultPanel: document.getElementById("resultPanel"),
    selectedFiles: document.getElementById("selectedFiles"),
    sidebarOverlay: document.getElementById("sidebarOverlay"),
    sidebarToggle: document.getElementById("sidebarToggle"),
    signupButton: document.getElementById("signupButton"),
    signupTab: document.getElementById("signupTab"),
    statusText: document.getElementById("statusText"),
    submitButton: document.getElementById("submitButton"),
    submitButtonLabel: document.getElementById("submitButtonLabel"),
    summaryResults: document.getElementById("summaryResults"),
    summaryTypeButton: document.getElementById("summaryTypeButton"),
    summaryTypeLabel: document.getElementById("summaryTypeLabel"),
    summaryTypeMenu: document.getElementById("summaryTypeMenu"),
    summaryTypeSelect: document.getElementById("summaryType"),
    themeToggle: document.getElementById("themeToggle"),
    themeTogglePath: document.getElementById("themeTogglePath"),
    uploadEmptyState: document.getElementById("uploadEmptyState"),
    settingsButton: document.getElementById("settingsButton"),
    settingsPage: document.getElementById("settingsPage"),
    settingsBackButton: document.getElementById("settingsBackButton"),
    settingsThemeToggle: document.getElementById("settingsThemeToggle"),
    settingsThemeIconPath: document.getElementById("settingsThemeIconPath"),
    settingsSummaryUsage: document.getElementById("settingsSummaryUsage"),
    settingsSummaryBar: document.getElementById("settingsSummaryBar"),
    settingsTranslationUsage: document.getElementById("settingsTranslationUsage"),
    settingsTranslationBar: document.getElementById("settingsTranslationBar"),
    settingsUsageReset: document.getElementById("settingsUsageReset"),
  };

  const state = {
    authMode: "login",
    currentUser: null,
    firebaseAuth: null,
    firebaseAvailable: false,
    firebaseLoading: false,
    firebaseModules: null,
    historyItems: [],
    historyRestored: false,
    latestSummaryCards: [],
    selectedFiles: [],
    selectedHistoryId: null,
    summaryTypeMenuOpen: false,
    languageMenuOpen: false,
    dropzoneDragDepth: 0,
  };

  const summaryTypeOptions = [
    { value: "short", label: "Short" },
    { value: "detailed", label: "Detailed" },
    { value: "bullets", label: "Bullet Points" },
  ];

  const languageOptions = [
    "English",
    "Hindi",
    "Spanish",
    "French",
    "German",
    "Italian",
    "Portuguese",
    "Russian",
    "Chinese (Simplified)",
    "Chinese (Traditional)",
    "Japanese",
    "Korean",
    "Arabic",
    "Turkish",
    "Tamil",
    "Telugu",
    "Kannada",
    "Malayalam",
    "Gujarati",
    "Punjabi",
    "Marathi",
    "Bengali",
    "Dutch",
    "Polish",
    "Vietnamese",
    "Thai",
    "Indonesian",
    "Romanian",
    "Greek",
    "Hebrew",
  ];

  const FREE_PLAN = {
    summariesPerDay: 5,
    translationsPerDay: 3,
  };
  const USAGE_STORAGE_KEY = "usageData";

  function isEnglishLanguage(lang) {
    return !lang || lang.toLowerCase().trim() === "english";
  }

  function getTodayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function getUsageData() {
    try {
      const stored = JSON.parse(localStorage.getItem(USAGE_STORAGE_KEY));
      if (!stored || stored.date !== getTodayKey()) {
        return { date: getTodayKey(), summaries: 0, translations: 0 };
      }
      return stored;
    } catch {
      return { date: getTodayKey(), summaries: 0, translations: 0 };
    }
  }

  function saveUsageData(data) {
    try {
      localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(data));
    } catch { /* ignore */ }
  }

  function incrementSummaryUsage() {
    const data = getUsageData();
    data.summaries += 1;
    saveUsageData(data);
    renderUsageWidget();
  }

  function incrementTranslationUsage() {
    const data = getUsageData();
    data.translations += 1;
    saveUsageData(data);
    renderUsageWidget();
  }

  function canGenerate(language) {
    const data = getUsageData();
    if (data.summaries >= FREE_PLAN.summariesPerDay) {
      return { allowed: false, reason: "summary_limit" };
    }
    if (!isEnglishLanguage(language) && data.translations >= FREE_PLAN.translationsPerDay) {
      return { allowed: false, reason: "translation_limit" };
    }
    return { allowed: true };
  }

  function renderUsageWidget() {
    const data = getUsageData();
    if (elements.settingsSummaryUsage) {
      elements.settingsSummaryUsage.textContent = data.summaries;
    }
    if (elements.settingsSummaryBar) {
      const pct = Math.min((data.summaries / FREE_PLAN.summariesPerDay) * 100, 100);
      elements.settingsSummaryBar.style.width = `${pct}%`;
    }
    if (elements.settingsTranslationUsage) {
      elements.settingsTranslationUsage.textContent = data.translations;
    }
    if (elements.settingsTranslationBar) {
      const pct = Math.min((data.translations / FREE_PLAN.translationsPerDay) * 100, 100);
      elements.settingsTranslationBar.style.width = `${pct}%`;
    }
  }

  function showSettingsPage() {
    if (elements.settingsPage) elements.settingsPage.hidden = false;
    const hero = document.querySelector(".hero");
    const workspace = document.querySelector(".workspace-grid");
    const usage = document.getElementById("usageWidget");
    const infoSections = document.querySelectorAll(".info-sections");
    if (hero) hero.hidden = true;
    if (workspace) workspace.hidden = true;
    if (usage) usage.hidden = true;
    infoSections.forEach((el) => {
      el.hidden = true;
    });
    renderUsageWidget();
    updateSettingsThemeIcon();
  }

  function hideSettingsPage() {
    if (elements.settingsPage) elements.settingsPage.hidden = true;
    const hero = document.querySelector(".hero");
    const workspace = document.querySelector(".workspace-grid");
    const infoSections = document.querySelectorAll(".info-sections");
    if (hero) hero.hidden = false;
    if (workspace) workspace.hidden = false;
    infoSections.forEach((el) => {
      el.hidden = false;
    });
  }

  function updateSettingsThemeIcon() {
    if (!elements.settingsThemeIconPath) return;
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    elements.settingsThemeIconPath.setAttribute("d", isDark ? themeIcons.dark : themeIcons.light);
  }

  const missingCriticalElements = [
    "fileInput",
    "form",
    "historyList",
    "languageButton",
    "languageLabel",
    "languageMenu",
    "languageSelect",
    "selectedLanguage",
    "messageBox",
    "statusText",
    "submitButton",
    "submitButtonLabel",
    "summaryResults",
    "summaryTypeSelect",
    "themeToggle",
    "themeTogglePath",
  ].filter((key) => !elements[key]);

  if (missingCriticalElements.length) {
    console.error("Missing critical DOM elements:", missingCriticalElements);
    return;
  }

  function logDebug(message, payload) {
    if (typeof payload === "undefined") {
      console.log(message);
      return;
    }

    console.log(message, payload);
  }

  function bindEvent(element, eventName, label, handler) {
    if (!element) {
      console.warn(`Skipping ${label}; element not found.`);
      return;
    }

    element.addEventListener(eventName, async (event) => {
      logDebug(label);

      try {
        await handler(event);
      } catch (error) {
        console.error(`${label} failed:`, error);
        setMessage(error.message || "Something went wrong.", "error");
      }
    });
  }

  function getSummaryTypeLabel(value) {
    return summaryTypeOptions.find((option) => option.value === value)?.label || "Short";
  }

  function getSummaryTypeOptionElements() {
    return Array.from(document.querySelectorAll("[data-summary-type]"));
  }

  function closeSummaryTypeMenu() {
    if (!elements.summaryTypeMenu || !elements.summaryTypeButton || !elements.summaryTypeSelect) {
      return;
    }

    state.summaryTypeMenuOpen = false;
    elements.summaryTypeSelect.parentElement?.classList.remove("is-open");
    elements.summaryTypeMenu.classList.remove("is-open");
    elements.summaryTypeButton.setAttribute("aria-expanded", "false");
    window.setTimeout(() => {
      if (!state.summaryTypeMenuOpen) {
        elements.summaryTypeMenu.hidden = true;
      }
    }, 180);
  }

  function openSummaryTypeMenu() {
    if (!elements.summaryTypeMenu || !elements.summaryTypeButton || !elements.summaryTypeSelect) {
      return;
    }

    state.summaryTypeMenuOpen = true;
    elements.summaryTypeMenu.hidden = false;
    elements.summaryTypeSelect.parentElement?.classList.add("is-open");
    requestAnimationFrame(() => {
      elements.summaryTypeMenu.classList.add("is-open");
      elements.summaryTypeButton.setAttribute("aria-expanded", "true");
      const selectedOption = getSummaryTypeOptionElements().find(
        (option) => option.dataset.summaryType === elements.summaryTypeSelect.value
      );
      selectedOption?.focus();
    });
  }

  function toggleSummaryTypeMenu() {
    if (state.summaryTypeMenuOpen) {
      closeSummaryTypeMenu();
      return;
    }

    openSummaryTypeMenu();
  }

  function syncSummaryTypeUI(value) {
    if (elements.summaryTypeSelect) {
      elements.summaryTypeSelect.value = value;
    }

    if (elements.summaryTypeLabel) {
      elements.summaryTypeLabel.textContent = getSummaryTypeLabel(value);
    }

    getSummaryTypeOptionElements().forEach((option) => {
      const isSelected = option.dataset.summaryType === value;
      option.classList.toggle("is-selected", isSelected);
      option.setAttribute("aria-selected", String(isSelected));
      option.tabIndex = isSelected ? 0 : -1;
    });
  }

  function moveSummaryTypeSelection(direction) {
    const options = getSummaryTypeOptionElements();

    if (!options.length || !elements.summaryTypeSelect) {
      return;
    }

    const currentIndex = Math.max(
      0,
      options.findIndex((option) => option.dataset.summaryType === elements.summaryTypeSelect.value)
    );
    const nextIndex = (currentIndex + direction + options.length) % options.length;
    const nextOption = options[nextIndex];

    if (!nextOption) {
      return;
    }

    syncSummaryTypeUI(nextOption.dataset.summaryType);
    nextOption.focus();
  }

  function getLanguageOptionElements() {
    return Array.from(document.querySelectorAll("[data-language]"));
  }

  function closeLanguageMenu() {
    if (!elements.languageMenu || !elements.languageButton || !elements.languageSelect) {
      return;
    }

    state.languageMenuOpen = false;
    elements.languageSelect.parentElement?.classList.remove("is-open");
    elements.languageMenu.classList.remove("is-open");
    elements.languageButton.setAttribute("aria-expanded", "false");
    window.setTimeout(() => {
      if (!state.languageMenuOpen) {
        elements.languageMenu.hidden = true;
      }
    }, 180);
  }

  function openLanguageMenu() {
    if (!elements.languageMenu || !elements.languageButton || !elements.languageSelect) {
      return;
    }

    state.languageMenuOpen = true;
    elements.languageMenu.hidden = false;
    elements.languageSelect.parentElement?.classList.add("is-open");
    requestAnimationFrame(() => {
      elements.languageMenu.classList.add("is-open");
      elements.languageButton.setAttribute("aria-expanded", "true");
      const selectedOption = getLanguageOptionElements().find(
        (option) => option.dataset.language === elements.selectedLanguage.value
      );
      selectedOption?.focus();
    });
  }

  function toggleLanguageMenu() {
    if (state.languageMenuOpen) {
      closeLanguageMenu();
      return;
    }

    openLanguageMenu();
  }

  function syncLanguageUI(value) {
    const normalizedValue = languageOptions.includes(value) ? value : "English";
    
    if (elements.selectedLanguage) {
      elements.selectedLanguage.value = normalizedValue;
    }

    if (elements.languageLabel) {
      elements.languageLabel.textContent = normalizedValue;
    }

    getLanguageOptionElements().forEach((option) => {
      const isSelected = option.dataset.language === normalizedValue;
      option.classList.toggle("is-selected", isSelected);
      option.setAttribute("aria-selected", String(isSelected));
      option.tabIndex = isSelected ? 0 : -1;
    });

    // Persist to localStorage
    localStorage.setItem(LANGUAGE_STORAGE_KEY, normalizedValue);
  }

  function moveLanguageSelection(direction) {
    const options = getLanguageOptionElements();

    if (!options.length || !elements.selectedLanguage) {
      return;
    }

    const currentIndex = Math.max(
      0,
      options.findIndex((option) => option.dataset.language === elements.selectedLanguage.value)
    );
    const nextIndex = (currentIndex + direction + options.length) % options.length;
    const nextOption = options[nextIndex];

    if (!nextOption) {
      return;
    }

    syncLanguageUI(nextOption.dataset.language);
    nextOption.focus();
  }

  function getInitialLanguage() {
    const storedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);

    if (storedLanguage && languageOptions.includes(storedLanguage)) {
      return storedLanguage;
    }

    return "English";
  }

  function setMessage(message, variant) {
    elements.messageBox.textContent = message;
    elements.messageBox.className = "message-box";

    if (variant) {
      elements.messageBox.classList.add(`is-${variant}`);
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildSummaryContentMarkup(summaryText) {
    const safeSummary =
      typeof summaryText === "string" && summaryText.trim()
        ? summaryText.trim()
        : DEFAULT_SUMMARY_TEXT;
    const lines = safeSummary.split(/\n+/).filter(Boolean);

    if (!lines.length) {
      return `<p class="summary-paragraph">${escapeHtml(safeSummary)}</p>`;
    }

    return lines
      .map((line) => {
        const trimmedLine = line.trim();
        const escapedLine = escapeHtml(line);

        if (/^[-*]/.test(trimmedLine) || /^\d+\./.test(trimmedLine)) {
          return `<p class="summary-bullet"><mark>${escapedLine}</mark></p>`;
        }

        return `<p class="summary-paragraph">${escapedLine}</p>`;
      })
      .join("");
  }

  function renderSummaryCards(cards) {
    const normalizedCards = Array.isArray(cards) ? cards : [];
    state.latestSummaryCards = normalizedCards;

    if (!normalizedCards.length) {
      elements.summaryResults.innerHTML = `
        <article class="summary-card summary-card--empty">
          <div class="summary-meta">No summary generated yet.</div>
          <div class="summary-content">${escapeHtml(DEFAULT_SUMMARY_TEXT)}</div>
        </article>
      `;
      return;
    }

    elements.summaryResults.innerHTML = normalizedCards
      .map((card, index) => {
        const fileName = escapeHtml(card.fileName || `Document ${index + 1}`);
        const summaryType = escapeHtml(card.summaryType || "Summary");
        const status = card.status === "error" ? "error" : "success";
        const bodyText =
          status === "error"
            ? escapeHtml(card.error || "This file could not be summarized.")
            : buildSummaryContentMarkup(card.summary);

        return `
          <article class="summary-card summary-card--${status}">
            <div class="summary-header">
              <div>
                <p class="summary-label">File</p>
                <h3 title="${fileName}">${fileName}</h3>
              </div>
              <div class="summary-header-actions">
                <button class="ghost-button" type="button" data-copy-summary="${index}" ${
                  status === "error" ? "disabled" : ""
                }>Copy</button>
                <button class="ghost-button" type="button" data-download-summary="${index}" ${
                  status === "error" ? "disabled" : ""
                }>Download</button>
              </div>
            </div>
            <div class="summary-meta">Summary Type: ${summaryType}</div>
            <div class="summary-content">${bodyText}</div>
          </article>
        `;
      })
      .join("");
  }

  function setSummaryState(cards = []) {
    renderSummaryCards(cards);
  }

  function showLoadingState() {
    if (elements.loadingState) {
      elements.loadingState.hidden = false;
    }
    if (elements.summaryResults) {
      elements.summaryResults.hidden = true;
    }
  }

  function hideLoadingState() {
    if (elements.loadingState) {
      elements.loadingState.hidden = true;
    }
    if (elements.summaryResults) {
      elements.summaryResults.hidden = false;
    }
  }

  function setLoadingState(isLoading) {
    elements.submitButton.disabled = isLoading;
    elements.buttonSpinner.hidden = !isLoading;
    elements.submitButtonLabel.textContent = isLoading ? "Processing..." : "Generate Summary";
  }

  function setAuthLoadingState(isLoading) {
    if (!elements.authSubmitButton || !elements.authSubmitLabel) {
      return;
    }

    elements.authSubmitButton.disabled = isLoading;
    elements.authSubmitLabel.textContent = isLoading
      ? state.authMode === "login"
        ? "Signing in..."
        : "Creating account..."
      : state.authMode === "login"
        ? "Login"
        : "Sign up";
  }

  function applyTheme(theme) {
    const isDark = theme === "dark";
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
    document.documentElement.classList.toggle("dark-mode", isDark);
    document.documentElement.classList.toggle("light-mode", !isDark);
    document.body.classList.toggle("dark-mode", isDark);
    document.body.classList.toggle("light-mode", !isDark);
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    elements.themeToggle.setAttribute("aria-pressed", String(isDark));
    elements.themeToggle.setAttribute(
      "aria-label",
      isDark ? "Switch to light mode" : "Switch to dark mode"
    );
    elements.themeTogglePath.setAttribute("d", isDark ? themeIcons.dark : themeIcons.light);
    updateSettingsThemeIcon();
    logDebug("Theme toggled", { theme });
  }

  function getInitialTheme() {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);

    if (storedTheme === "light" || storedTheme === "dark") {
      return storedTheme;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function openSidebar() {
    if (!elements.historySidebar || !elements.sidebarOverlay) {
      return;
    }

    logDebug("Sidebar opened");
    document.body.classList.add("sidebar-open");
    elements.historySidebar.hidden = false;
    elements.sidebarOverlay.hidden = false;
    requestAnimationFrame(() => {
      elements.historySidebar.classList.remove("is-closed");
      elements.historySidebar.classList.add("is-open");
      elements.sidebarOverlay.classList.add("is-visible");
    });
    elements.historySidebar.setAttribute("aria-hidden", "false");
  }

  function isSidebarOpen() {
    return Boolean(elements.historySidebar && elements.historySidebar.classList.contains("is-open"));
  }

  function closeSidebar() {
    if (!elements.historySidebar || !elements.sidebarOverlay) {
      return;
    }

    logDebug("Sidebar closed");
    document.body.classList.remove("sidebar-open");
    elements.historySidebar.classList.remove("is-open");
    elements.historySidebar.classList.add("is-closed");
    elements.sidebarOverlay.classList.remove("is-visible");
    elements.historySidebar.setAttribute("aria-hidden", "true");
    window.setTimeout(() => {
      if (!elements.historySidebar.classList.contains("is-open")) {
        elements.historySidebar.hidden = true;
        elements.sidebarOverlay.hidden = true;
      }
    }, 220);
  }

  function toggleSidebar() {
    logDebug("Sidebar toggled", { open: !isSidebarOpen() });

    if (isSidebarOpen()) {
      closeSidebar();
      return;
    }

    openSidebar();
  }

  function setAuthMode(mode) {
    state.authMode = mode;

    if (elements.loginTab) {
      elements.loginTab.classList.toggle("is-active", mode === "login");
    }

    if (elements.signupTab) {
      elements.signupTab.classList.toggle("is-active", mode === "signup");
    }

    if (elements.authTitle) {
      elements.authTitle.textContent = mode === "login" ? "Login" : "Sign up";
    }

    if (elements.authSubtitle) {
      elements.authSubtitle.textContent =
        mode === "login"
          ? "Login to save summaries and access history later."
          : "Create an account to save summaries and unlock history.";
    }

    if (elements.authSubmitLabel) {
      elements.authSubmitLabel.textContent = mode === "login" ? "Login" : "Sign up";
    }
  }

  function openAuthModal(mode) {
    if (!elements.authModal) {
      return;
    }

    logDebug("Auth modal opened", { mode });
    setAuthMode(mode);

    if (elements.authWarning) {
      elements.authWarning.hidden = state.firebaseAvailable;
    }

    elements.authModal.hidden = false;
    requestAnimationFrame(() => {
      elements.authModal.classList.remove("is-closed");
      elements.authModal.classList.add("is-open");
      elements.authEmail?.focus();
    });
  }

  function closeAuthModal() {
    if (!elements.authModal) {
      return;
    }

    logDebug("Auth modal closed");
    elements.authModal.classList.remove("is-open");
    elements.authModal.classList.add("is-closed");
    elements.authForm?.reset();

    if (elements.authMessage) {
      elements.authMessage.textContent = "Login is optional. Sign in only if you want saved history.";
    }

    window.setTimeout(() => {
      if (!elements.authModal.classList.contains("is-open")) {
        elements.authModal.hidden = true;
      }
    }, 180);
  }

  function isProfileDropdownOpen() {
    return Boolean(
      elements.profileDropdown &&
      !elements.profileDropdown.hidden &&
      elements.profileDropdown.classList.contains("is-open")
    );
  }

  function getProfileDisplayName(user) {
    const displayName = user?.displayName?.trim();

    if (displayName) {
      return displayName;
    }

    const email = user?.email?.trim();

    if (email) {
      return email.split("@")[0];
    }

    return "Signed in user";
  }

  function positionProfileDropdown() {
    if (!elements.profileDropdown || !elements.profileMenu || elements.profileDropdown.hidden) {
      return;
    }

    const dropdown = elements.profileDropdown;
    dropdown.style.removeProperty("--profile-dropdown-shift");

    const availableWidth = Math.max(220, window.innerWidth - PROFILE_DROPDOWN_VIEWPORT_GAP * 2);
    dropdown.style.setProperty(
      "--profile-dropdown-max-width",
      `${Math.min(320, availableWidth)}px`
    );

    const rect = dropdown.getBoundingClientRect();
    let shiftX = 0;

    if (rect.right > window.innerWidth - PROFILE_DROPDOWN_VIEWPORT_GAP) {
      shiftX -= rect.right - (window.innerWidth - PROFILE_DROPDOWN_VIEWPORT_GAP);
    }

    if (rect.left + shiftX < PROFILE_DROPDOWN_VIEWPORT_GAP) {
      shiftX += PROFILE_DROPDOWN_VIEWPORT_GAP - (rect.left + shiftX);
    }

    dropdown.style.setProperty("--profile-dropdown-shift", `${shiftX}px`);
    dropdown.classList.toggle("is-compact", window.innerWidth <= 768);
  }

  function openProfileDropdown() {
    if (!elements.profileDropdown || !elements.avatarButton) {
      return;
    }

    logDebug("Profile dropdown opened");
    elements.profileDropdown.hidden = false;
    requestAnimationFrame(() => {
      positionProfileDropdown();
      elements.profileDropdown.classList.add("is-open");
      requestAnimationFrame(positionProfileDropdown);
    });
    elements.avatarButton.setAttribute("aria-expanded", "true");
  }

  function closeProfileDropdown() {
    if (!elements.profileDropdown || !elements.avatarButton) {
      return;
    }

    if (elements.profileDropdown.hidden && !elements.profileDropdown.classList.contains("is-open")) {
      return;
    }

    logDebug("Profile dropdown closed");
    elements.profileDropdown.classList.remove("is-open");
    elements.profileDropdown.classList.remove("is-compact");
    elements.profileDropdown.style.removeProperty("--profile-dropdown-shift");
    elements.profileDropdown.style.removeProperty("--profile-dropdown-max-width");
    elements.avatarButton.setAttribute("aria-expanded", "false");
    window.setTimeout(() => {
      if (!elements.profileDropdown.classList.contains("is-open")) {
        elements.profileDropdown.hidden = true;
      }
    }, 180);
  }

  function formatTimestamp(value) {
    if (!value) {
      return "Just now";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleString();
  }

  function renderHistory(items) {
    state.historyItems = Array.isArray(items) ? items : [];
    logDebug("History rendered", { count: state.historyItems.length });

    if (!state.currentUser) {
      elements.historyList.innerHTML = `<p class="history-empty">${GUEST_HISTORY_MESSAGE}</p>`;
      return;
    }

    if (!state.historyItems.length) {
      elements.historyList.innerHTML = `<p class="history-empty">${DEFAULT_HISTORY_EMPTY}</p>`;
      return;
    }

    elements.historyList.innerHTML = state.historyItems
      .map((item) => {
        const activeClass = item.id === state.selectedHistoryId ? " is-active" : "";

        return `
          <button class="history-item${activeClass}" type="button" data-history-id="${item.id}">
            <p class="history-item-title">${escapeHtml(item.fileName)}</p>
            <p class="history-item-type">${escapeHtml(item.summaryType)}</p>
            <p class="history-item-time">${escapeHtml(formatTimestamp(item.createdAt))}</p>
          </button>
        `;
      })
      .join("");
  }

  function restoreLatestSummary(item) {
    if (!item) {
      return;
    }

    state.selectedHistoryId = item.id;
    renderHistory(state.historyItems);
    setSummaryState([
      {
        fileName: item.fileName,
        summaryType: item.summaryType,
        summary: item.summary,
        status: "success",
      },
    ]);
    logDebug("Latest summary restored", {
      id: item.id,
      fileName: item.fileName,
    });
  }

  function loadHistoryItem(item) {
    state.selectedHistoryId = item.id;
    renderHistory(state.historyItems);
    setSummaryState([
      {
        fileName: item.fileName,
        summaryType: item.summaryType,
        summary: item.summary,
        status: "success",
      },
    ]);
    closeSidebar();
  }

  function createSafeDebugPayload(payload) {
    if (!payload || typeof payload !== "object") {
      return payload;
    }

    return JSON.parse(
      JSON.stringify(payload, (key, value) => {
        if (typeof value === "string" && /authorization|token|api[_-]?key/i.test(key)) {
          return "[redacted]";
        }

        if (value instanceof File) {
          return {
            name: value.name,
            size: value.size,
            type: value.type,
          };
        }

        return value;
      })
    );
  }

  async function parseApiResponse(response) {
    const rawText = await response.text();
    const contentType = response.headers.get("content-type") || "";
    const looksLikeJson = contentType.includes("application/json");
    const responsePreview = rawText ? rawText.slice(0, 600) : "";

    console.log("API response received", {
      url: response.url,
      status: response.status,
      ok: response.ok,
      contentType,
      bodyPreview: responsePreview,
    });

    if (!rawText) {
      return { ok: response.ok, status: response.status, data: null };
    }

    if (looksLikeJson) {
      try {
        return {
          ok: response.ok,
          status: response.status,
          data: JSON.parse(rawText),
        };
      } catch (error) {
        throw new Error("The server returned invalid JSON.");
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data: { error: rawText },
    };
  }

  function getApiErrorMessage(result, fallbackMessage) {
    return (
      result?.data?.error ||
      result?.data?.details?.userMessage ||
      result?.data?.details?.providerReason ||
      fallbackMessage
    );
  }

  async function getOptionalAuthHeaders() {
    if (!state.currentUser) {
      return {};
    }

    try {
      const token = await state.currentUser.getIdToken();
      return { Authorization: `Bearer ${token}` };
    } catch (error) {
      console.warn("Could not get Firebase ID token. Continuing as guest.", error);
      return {};
    }
  }

  function getExtension(fileName) {
    return fileName.split(".").pop()?.toLowerCase() || "";
  }

  function formatFileSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return "1 KB";
    }

    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
    }

    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  function getFileKey(file) {
    return [file.name, file.size, file.lastModified, file.type].join("::");
  }

  function syncFileInputWithState() {
    if (!elements.fileInput) {
      return;
    }

    try {
      const dataTransfer = new DataTransfer();
      state.selectedFiles.forEach((file) => {
        dataTransfer.items.add(file);
      });
      elements.fileInput.files = dataTransfer.files;
    } catch (error) {
      console.warn("Could not sync file input with selected files state.", error);
    }
  }

  function setDropzoneActive(isActive) {
    elements.dropzone?.classList.toggle("is-drag-active", isActive);
  }

  function setStatus(text, variant) {
    if (!elements.statusText) {
      return;
    }

    elements.statusText.textContent = text;
    elements.statusText.className = "status-text";

    if (variant) {
      elements.statusText.classList.add(`is-${variant}`);
    }
  }

  function showFileCards() {
    if (!elements.fileMeta) {
      return;
    }

    elements.fileMeta.removeAttribute("hidden");
    requestAnimationFrame(() => {
      elements.fileMeta.classList.add("is-visible");
    });
  }

  function hideFileCards() {
    if (!elements.fileMeta) {
      return;
    }

    elements.fileMeta.classList.remove("is-visible");
    elements.fileMeta.setAttribute("hidden", "");
  }

  function renderSelectedFiles(files) {
    state.selectedFiles = Array.isArray(files) ? files : [];
    syncFileInputWithState();

    const hasFiles = state.selectedFiles.length > 0;

    if (elements.uploadEmptyState) {
      elements.uploadEmptyState.hidden = hasFiles;
    }

    if (!hasFiles) {
      hideFileCards();
      elements.selectedFiles.innerHTML = "";
      elements.fileNameText.textContent = "No files selected";
      elements.fileNameText.removeAttribute("title");
      elements.dropzone?.classList.remove("has-files");
      return;
    }

    showFileCards();
    elements.fileNameText.textContent =
      state.selectedFiles.length === 1
        ? state.selectedFiles[0].name
        : `${state.selectedFiles.length} files selected`;

    if (state.selectedFiles.length === 1) {
      elements.fileNameText.setAttribute("title", state.selectedFiles[0].name);
    } else {
      elements.fileNameText.removeAttribute("title");
    }

    elements.dropzone?.classList.add("has-files");

    elements.selectedFiles.innerHTML = state.selectedFiles
      .map((file) => {
        const safeName = escapeHtml(file.name);
        const fileKey = escapeHtml(getFileKey(file));

        return `
          <article class="selected-file-item" title="${safeName}">
            <div class="selected-file-copy">
              <p class="selected-file-name">${safeName}</p>
              <p class="selected-file-meta">${escapeHtml(formatFileSize(file.size))}</p>
            </div>
            <button
              class="selected-file-remove"
              type="button"
              data-remove-file="${fileKey}"
              aria-label="Remove ${safeName}"
            >
              Remove
            </button>
          </article>
        `;
      })
      .join("");
  }

  function applySelectedFiles(nextFiles) {
    renderSelectedFiles(nextFiles);
    if (nextFiles.length) {
      setStatus("Ready to summarize", "ready");
    }
  }

  function mergeSelectedFiles(incomingFiles) {
    const merged = [...state.selectedFiles];
    const existingKeys = new Set(merged.map((file) => getFileKey(file)));
    let duplicateCount = 0;
    const errors = [];

    for (const file of incomingFiles) {
      const extension = getExtension(file.name);

      if (!allowedExtensions.includes(extension)) {
        errors.push(`"${file.name}" is not a supported file type.`);
        continue;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        errors.push(`"${file.name}" exceeds the 25 MB file limit.`);
        continue;
      }

      const fileKey = getFileKey(file);

      if (existingKeys.has(fileKey)) {
        duplicateCount += 1;
        continue;
      }

      if (merged.length >= MAX_FILES_ALLOWED) {
        errors.push(`You can upload up to ${MAX_FILES_ALLOWED} files at a time.`);
        break;
      }

      merged.push(file);
      existingKeys.add(fileKey);
    }

    return {
      files: merged,
      duplicateCount,
      errors,
    };
  }

  function handleIncomingFiles(incomingFiles, source = "picker") {
    const normalizedFiles = Array.from(incomingFiles || []);

    if (!normalizedFiles.length) {
      if (source === "picker" && !state.selectedFiles.length) {
        applySelectedFiles([]);
      }
      return;
    }

    const { files, duplicateCount, errors } = mergeSelectedFiles(normalizedFiles);
    applySelectedFiles(files);

    if (errors.length) {
      setMessage(errors[0], "error");
      return;
    }

    if (duplicateCount) {
      setMessage("Duplicate files were skipped.", "success");
      return;
    }

    setMessage("Files added successfully. Generate a summary when you’re ready.", "success");
    return;

    setMessage(
      state.currentUser
        ? "Files added successfully. Generate a summary when you’re ready."
        : "Files added successfully. Sign in only if you want saved history.",
      "success"
    );
  }

  function removeSelectedFile(fileKey) {
    const nextFiles = state.selectedFiles.filter((file) => getFileKey(file) !== fileKey);
    applySelectedFiles(nextFiles);

    if (!nextFiles.length) {
      setMessage("Your file list is now empty.", null);
      return;
    }

    setMessage("File removed from the upload queue.", "success");
  }

  function processIncomingFiles(incomingFiles, source = "picker") {
    const normalizedFiles = Array.from(incomingFiles || []);

    if (!normalizedFiles.length) {
      if (source === "picker" && !state.selectedFiles.length) {
        applySelectedFiles([]);
      }
      return;
    }

    const { files, duplicateCount, errors } = mergeSelectedFiles(normalizedFiles);
    applySelectedFiles(files);

    if (errors.length) {
      setMessage(errors[0], "error");
      return;
    }

    if (duplicateCount) {
      setMessage("Duplicate files were skipped.", "success");
      return;
    }

    setMessage("Files added successfully. Generate a summary when you’re ready.", "success");
  }

  function resetSummaryPanel() {
    hideLoadingState();
    setSummaryState([]);
  }

  function updateUserState() {
    const isLoggedIn = Boolean(state.currentUser);

    if (elements.guestActions) {
      elements.guestActions.hidden = isLoggedIn;
    }

    if (elements.profileMenu) {
      elements.profileMenu.hidden = !isLoggedIn;
    }

    if (isLoggedIn) {
      const email = state.currentUser.email || "";

      if (elements.avatarLabel) {
        elements.avatarLabel.textContent = email ? email.charAt(0).toUpperCase() : "U";
      }

      if (elements.profileName) {
        elements.profileName.textContent = getProfileDisplayName(state.currentUser);
      }

      if (elements.profileEmail) {
        elements.profileEmail.textContent = email || "Signed in user";
      }

      setMessage("Signed in. New summaries will be saved automatically.", "success");
    } else {
      if (elements.profileName) {
        elements.profileName.textContent = "Signed in user";
      }

      if (elements.profileEmail) {
        elements.profileEmail.textContent = "Signed in user";
      }

      state.selectedHistoryId = null;
      state.historyRestored = false;
      renderHistory([]);
      closeProfileDropdown();
      resetSummaryPanel();
      setMessage(DEFAULT_RESULT_MESSAGE, null);
    }
  }

  async function fetchHistory() {
    if (!state.currentUser) {
      renderHistory([]);
      return;
    }

    try {
      const headers = await getOptionalAuthHeaders();
      console.log(
        "History request started",
        createSafeDebugPayload({
          url: `${API_BASE_URL}/api/history`,
          hasAuthorization: Boolean(headers.Authorization),
        })
      );
      const response = await fetch(`${API_BASE_URL}/api/history`, { headers });
      const result = await parseApiResponse(response);

      if (!result.ok || !result.data) {
        throw new Error(getApiErrorMessage(result, "Could not load your saved history."));
      }

      const items = Array.isArray(result.data.items) ? result.data.items : [];
      logDebug("History fetched", { count: items.length });
      renderHistory(items);

      if (items.length && (!state.historyRestored || !state.selectedHistoryId)) {
        restoreLatestSummary(items[0]);
        state.historyRestored = true;
      } else if (!items.length) {
        resetSummaryPanel();
      }
    } catch (error) {
      elements.historyList.innerHTML = `<p class="history-empty">${escapeHtml(
        error.message || "Could not load history."
      )}</p>`;
    }
  }

  async function loadFirebaseConfig() {
    console.log("Firebase config request started", {
      url: `${API_BASE_URL}/api/config`,
    });
    const response = await fetch(`${API_BASE_URL}/api/config`);
    const result = await parseApiResponse(response);

    if (!result.ok || !result.data?.firebaseConfigured) {
      throw new Error(
        "Firebase is not configured yet. Add the Firebase web and admin environment variables in the backend."
      );
    }

    return result.data.firebase;
  }

  async function initializeFirebase() {
    if (state.firebaseLoading || state.firebaseAvailable) {
      return;
    }

    state.firebaseLoading = true;

    try {
      const firebaseConfig = await loadFirebaseConfig();
      const [{ initializeApp }, authModule] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js"),
      ]);

      state.firebaseModules = authModule;
      const app = initializeApp(firebaseConfig);
      state.firebaseAuth = authModule.getAuth(app);
      state.firebaseAvailable = true;

      authModule.onAuthStateChanged(state.firebaseAuth, async (user) => {
        state.currentUser = user;
        state.historyRestored = false;
        logDebug("Auth restored", {
          loggedIn: Boolean(user),
          email: user?.email || null,
        });
        updateUserState();
        await fetchHistory();
      });

      logDebug("Firebase initialized successfully");
    } catch (error) {
      state.firebaseAvailable = false;
      console.warn("Firebase initialization failed. Auth features will remain optional.", error);

      if (elements.authWarning) {
        elements.authWarning.hidden = false;
        elements.authWarning.textContent =
          error.message || "Firebase is not configured yet. Authentication is unavailable.";
      }
    } finally {
      state.firebaseLoading = false;
    }
  }

  async function ensureFirebaseReady() {
    if (state.firebaseAvailable && state.firebaseAuth && state.firebaseModules) {
      return true;
    }

    await initializeFirebase();
    return Boolean(state.firebaseAvailable && state.firebaseAuth && state.firebaseModules);
  }

  bindEvent(elements.themeToggle, "click", "Theme toggle clicked", () => {
    const nextTheme = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
  });

  bindEvent(elements.settingsButton, "click", "Settings button clicked", () => {
    if (elements.settingsPage && !elements.settingsPage.hidden) {
      hideSettingsPage();
    } else {
      showSettingsPage();
    }
  });

  bindEvent(elements.settingsBackButton, "click", "Settings back clicked", () => {
    hideSettingsPage();
  });

  bindEvent(elements.settingsThemeToggle, "click", "Settings theme toggle clicked", () => {
    const nextTheme = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
  });

  bindEvent(elements.sidebarToggle, "click", "Sidebar toggle clicked", () => {
    toggleSidebar();
  });
  bindEvent(elements.closeSidebarButton, "click", "Sidebar close clicked", () => {
    closeSidebar();
  });
  bindEvent(elements.sidebarOverlay, "click", "Sidebar overlay clicked", () => {
    closeSidebar();
  });

  bindEvent(elements.loginButton, "click", "Login button clicked", async () => {
    openAuthModal("login");
    await initializeFirebase();
  });
  bindEvent(elements.signupButton, "click", "Signup button clicked", async () => {
    openAuthModal("signup");
    await initializeFirebase();
  });
  bindEvent(elements.authCancelButton, "click", "Auth cancel clicked", () => {
    closeAuthModal();
  });
  bindEvent(elements.authCloseButton, "click", "Auth close clicked", () => {
    closeAuthModal();
  });
  bindEvent(elements.authBackdrop, "click", "Auth backdrop clicked", () => {
    closeAuthModal();
  });
  bindEvent(elements.loginTab, "click", "Login tab clicked", () => {
    setAuthMode("login");
  });
  bindEvent(elements.signupTab, "click", "Signup tab clicked", () => {
    setAuthMode("signup");
  });

  bindEvent(elements.summaryTypeButton, "click", "Summary type toggle clicked", (event) => {
    event.stopPropagation();
    toggleSummaryTypeMenu();
  });

  bindEvent(elements.summaryTypeButton, "keydown", "Summary type trigger keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openSummaryTypeMenu();
    }
  });

  getSummaryTypeOptionElements().forEach((option) => {
    bindEvent(option, "click", "Summary type option clicked", () => {
      const value = option.dataset.summaryType;

      if (!value) {
        return;
      }

      syncSummaryTypeUI(value);
      closeSummaryTypeMenu();
      elements.summaryTypeButton?.focus();
    });
  });

  bindEvent(elements.summaryTypeMenu, "keydown", "Summary type menu keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSummaryTypeSelection(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSummaryTypeSelection(-1);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeSummaryTypeMenu();
      elements.summaryTypeButton?.focus();
    }
  });

  bindEvent(elements.languageButton, "click", "Language toggle clicked", (event) => {
    event.stopPropagation();
    toggleLanguageMenu();
  });

  bindEvent(elements.languageButton, "keydown", "Language trigger keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openLanguageMenu();
    }
  });

  getLanguageOptionElements().forEach((option) => {
    bindEvent(option, "click", "Language option clicked", () => {
      const value = option.dataset.language;

      if (!value) {
        return;
      }

      syncLanguageUI(value);
      closeLanguageMenu();
      elements.languageButton?.focus();
    });
  });

  bindEvent(elements.languageMenu, "keydown", "Language menu keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveLanguageSelection(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveLanguageSelection(-1);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeLanguageMenu();
      elements.languageButton?.focus();
    }
  });

  bindEvent(elements.avatarButton, "click", "Avatar clicked", (event) => {
    event.stopPropagation();

    if (elements.profileDropdown?.hidden) {
      openProfileDropdown();
    } else {
      closeProfileDropdown();
    }
  });

  bindEvent(elements.profileDropdown, "click", "Profile dropdown clicked", (event) => {
    event.stopPropagation();
  });

  bindEvent(elements.historyShortcut, "click", "My History clicked", async () => {
    closeProfileDropdown();

    if (!state.currentUser) {
      openAuthModal("login");
      await initializeFirebase();
      return;
    }

    openSidebar();
  });

  bindEvent(elements.logoutButton, "click", "Logout clicked", async () => {
    if (!state.firebaseAuth || !state.firebaseModules?.signOut) {
      return;
    }

    closeProfileDropdown();
    await state.firebaseModules.signOut(state.firebaseAuth);
    logDebug("User logged out");
  });

  document.addEventListener("click", (event) => {
    if (
      elements.summaryTypeSelect &&
      !elements.summaryTypeSelect.parentElement?.contains(event.target)
    ) {
      closeSummaryTypeMenu();
    }

    if (
      elements.languageSelect &&
      !elements.languageSelect.parentElement?.contains(event.target)
    ) {
      closeLanguageMenu();
    }

    if (!elements.profileMenu || elements.profileMenu.hidden) {
      return;
    }

    if (!elements.profileMenu.contains(event.target)) {
      closeProfileDropdown();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    logDebug("Escape key pressed");
    closeSummaryTypeMenu();
    closeLanguageMenu();
    closeProfileDropdown();

    if (elements.authModal && !elements.authModal.hidden) {
      closeAuthModal();
    }
  });

  bindEvent(elements.historyList, "click", "History item clicked", (event) => {
    const button = event.target.closest("[data-history-id]");

    if (!button) {
      return;
    }

    const item = state.historyItems.find((historyItem) => historyItem.id === button.dataset.historyId);

    if (item) {
      loadHistoryItem(item);
    }
  });

  bindEvent(elements.dropzone, "click", "Upload area clicked", (event) => {
    event.preventDefault();
    logDebug("File picker triggered");
    elements.fileInput.value = "";
    elements.fileInput.click();
  });

  bindEvent(elements.dropzone, "dragenter", "Upload drag entered", (event) => {
    event.preventDefault();
    state.dropzoneDragDepth += 1;
    setDropzoneActive(true);
  });

  bindEvent(elements.dropzone, "dragover", "Upload drag over", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropzoneActive(true);
  });

  bindEvent(elements.dropzone, "dragleave", "Upload drag left", (event) => {
    event.preventDefault();
    state.dropzoneDragDepth = Math.max(0, state.dropzoneDragDepth - 1);

    if (!state.dropzoneDragDepth) {
      setDropzoneActive(false);
    }
  });

  bindEvent(elements.dropzone, "drop", "Upload files dropped", (event) => {
    event.preventDefault();
    state.dropzoneDragDepth = 0;
    setDropzoneActive(false);
    processIncomingFiles(event.dataTransfer?.files, "drop");
  });

  bindEvent(elements.fileInput, "change", "Upload files changed", () => {
    const files = Array.from(elements.fileInput.files || []);
    logDebug("Upload files selected", files.map((file) => file.name));
    processIncomingFiles(files, "picker");
  });

  bindEvent(elements.selectedFiles, "click", "Selected file action clicked", (event) => {
    const removeButton = event.target.closest("[data-remove-file]");

    if (!removeButton) {
      return;
    }

    removeSelectedFile(removeButton.dataset.removeFile);
  });

  bindEvent(elements.authForm, "submit", "Auth form submitted", async (event) => {
    event.preventDefault();

    const isReady = await ensureFirebaseReady();

    if (!isReady) {
      if (elements.authWarning) {
        elements.authWarning.hidden = false;
      }

      return;
    }

    try {
      setAuthLoadingState(true);

      if (state.authMode === "login") {
        await state.firebaseModules.signInWithEmailAndPassword(
          state.firebaseAuth,
          elements.authEmail.value.trim(),
          elements.authPassword.value
        );
      } else {
        await state.firebaseModules.createUserWithEmailAndPassword(
          state.firebaseAuth,
          elements.authEmail.value.trim(),
          elements.authPassword.value
        );
      }

      closeAuthModal();
    } catch (error) {
      if (elements.authMessage) {
        elements.authMessage.textContent = error.message || "Authentication failed.";
      }
    } finally {
      setAuthLoadingState(false);
    }
  });

  bindEvent(elements.summaryResults, "click", "Summary card action clicked", async (event) => {
    const copyButton = event.target.closest("[data-copy-summary]");
    const downloadButton = event.target.closest("[data-download-summary]");

    if (copyButton) {
      const index = Number(copyButton.dataset.copySummary);
      const item = state.latestSummaryCards[index];

      if (!item?.summary) {
        setMessage("No summary is available to copy for this file.", "error");
        return;
      }

      await navigator.clipboard.writeText(item.summary);
      setMessage(`Copied summary for ${item.fileName}.`, "success");
      return;
    }

    if (downloadButton) {
      const index = Number(downloadButton.dataset.downloadSummary);
      const item = state.latestSummaryCards[index];

      if (!item?.summary) {
        setMessage("No summary is available to download for this file.", "error");
        return;
      }

      const blob = new Blob([item.summary], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${item.fileName || "summary"}.txt`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage(`Downloaded summary for ${item.fileName}.`, "success");
    }
  });

  bindEvent(elements.form, "submit", "Summary form submitted", async (event) => {
    event.preventDefault();

    const files = [...state.selectedFiles];

    if (!files.length) {
      setMessage("Please choose at least one document before generating a summary.", "error");
      setStatus("Error", "error");
      return;
    }

    const chosenLanguage = elements.selectedLanguage.value;
    const usageCheck = canGenerate(chosenLanguage);
    if (!usageCheck.allowed) {
      if (usageCheck.reason === "summary_limit") {
        setMessage("You've reached your daily summary limit (5/day). Try again tomorrow or sign up for more.", "error");
      } else if (usageCheck.reason === "translation_limit") {
        setMessage("You've reached your daily translation limit (3/day). Switch to English or try again tomorrow.", "error");
      }
      setStatus("Error", "error");
      return;
    }

    try {
      setLoadingState(true);
      showLoadingState();
      if (elements.resultPanel) {
        elements.resultPanel.hidden = false;
      }
      state.selectedHistoryId = null;
      setStatus("Summarizing...", "summarizing");
      setMessage("Uploading and extracting text from your selected files...", "loading");

      const authHeaders = await getOptionalAuthHeaders();
      const formData = new FormData();
      files.forEach((file) => {
        formData.append("document", file);
      });

      console.log(
        "Upload request started",
        createSafeDebugPayload({
          url: `${API_BASE_URL}/api/upload`,
          hasAuthorization: Boolean(authHeaders.Authorization),
          files,
        })
      );

      const uploadResponse = await fetch(`${API_BASE_URL}/api/upload`, {
        method: "POST",
        headers: authHeaders,
        body: formData,
      });
      const uploadResult = await parseApiResponse(uploadResponse);

      if (!uploadResult.ok || !uploadResult.data) {
        throw new Error(getApiErrorMessage(uploadResult, "We could not process those files."));
      }

      setStatus("Summarizing...", "summarizing");
      setMessage("Files processed successfully. Generating your summary now...", "loading");

      console.log(
        "Summarize request started",
        createSafeDebugPayload({
          url: `${API_BASE_URL}/api/summarize`,
          hasAuthorization: Boolean(authHeaders.Authorization),
          payload: {
            fileCount: uploadResult.data.files?.length || 0,
            summaryType: elements.summaryTypeSelect.value,
            language: elements.selectedLanguage.value,
          },
        })
      );

      const summaryResponse = await fetch(`${API_BASE_URL}/api/summarize`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          files: uploadResult.data.files,
          summaryType: elements.summaryTypeSelect.value,
          language: elements.selectedLanguage.value,
        }),
      });
      const summaryResult = await parseApiResponse(summaryResponse);

      if (!summaryResult.ok || !summaryResult.data) {
        throw new Error(getApiErrorMessage(summaryResult, "The summary request failed."));
      }

      const results = Array.isArray(summaryResult.data.results) ? summaryResult.data.results : [];
      hideLoadingState();
      setSummaryState(results);

      incrementSummaryUsage();
      const lang = elements.selectedLanguage.value;
      if (!isEnglishLanguage(lang)) {
        incrementTranslationUsage();
      }

      setStatus("Done", "done");
      const successCount = results.filter((result) => result.status === "success").length;
      const errorCount = results.filter((result) => result.status === "error").length;
      setMessage(
        errorCount
          ? `${successCount} summaries completed. ${errorCount} file${errorCount === 1 ? "" : "s"} could not be summarized.`
          : `Summary generation completed for ${successCount} file${successCount === 1 ? "" : "s"}.`,
        "success"
      );

      await fetchHistory();
    } catch (error) {
      hideLoadingState();
      setStatus("Error", "error");
      setSummaryState(
        files.map((file) => ({
          fileName: file.name,
          summaryType: getSummaryTypeLabel(elements.summaryTypeSelect.value),
          status: "error",
          error: error.message || "The request failed before a summary could be generated.",
        }))
      );
      setMessage(error.message || "An unexpected error occurred.", "error");
    } finally {
      setLoadingState(false);
    }
  });

  applyTheme(getInitialTheme());
  syncSummaryTypeUI(elements.summaryTypeSelect.value);
  syncLanguageUI(getInitialLanguage());
  document.body.classList.remove("sidebar-open");
  elements.historySidebar?.classList.add("is-closed");
  elements.authModal?.classList.add("is-closed");
  setAuthMode("login");
  hideLoadingState();
  setSummaryState([]);
  setMessage(DEFAULT_RESULT_MESSAGE, null);
  renderSelectedFiles([]);
  renderHistory([]);
  updateUserState();

  function syncSidebarOffset() {
    const nav = document.querySelector(".nav-shell");

    if (!nav) {
      return;
    }

    const gapPx = 12;
    const bottom = nav.getBoundingClientRect().bottom;
    document.documentElement.style.setProperty(
      "--sidebar-offset",
      `${Math.ceil(bottom + gapPx)}px`
    );
  }

  function initScrollReveal() {
    const sections = Array.from(document.querySelectorAll("[data-reveal-section]"));
    if (!sections.length) {
      return;
    }

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion || typeof IntersectionObserver === "undefined") {
      sections.forEach((section) => section.classList.add("is-revealed"));
      return;
    }

    document.documentElement.classList.add("js-reveal");

    sections.forEach((section) => {
      section.querySelectorAll("[data-reveal-stagger]").forEach((container) => {
        Array.from(container.children).forEach((child, index) => {
          child.style.setProperty("--reveal-order", String(index));
        });
      });
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }

          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
    );

    sections.forEach((section) => observer.observe(section));
  }

  syncSidebarOffset();
  window.addEventListener("resize", syncSidebarOffset);
  window.addEventListener("resize", () => {
    if (isProfileDropdownOpen()) {
      positionProfileDropdown();
    }
  });
  window.addEventListener(
    "scroll",
    () => {
      if (isProfileDropdownOpen()) {
        positionProfileDropdown();
      }
    },
    { passive: true }
  );

  const navShell = document.querySelector(".nav-shell");

  if (navShell && typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => syncSidebarOffset());
    observer.observe(navShell);
  }

  requestAnimationFrame(() => syncSidebarOffset());

  initScrollReveal();

  initializeFirebase().catch((error) => {
    console.warn("Firebase startup check failed.", error);
  });
});