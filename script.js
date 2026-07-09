const API_BASE_URL = (() => {
  const configured =
    (typeof globalThis !== "undefined" &&
      typeof globalThis.__APP_CONFIG__?.apiBaseUrl === "string" &&
      globalThis.__APP_CONFIG__.apiBaseUrl.trim()) ||
    "";

  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  if (typeof window !== "undefined" && window.location) {
    const { hostname } = window.location;

    if (hostname === "127.0.0.1" || hostname === "localhost") {
      return "http://localhost:3000";
    }

    if (/^https?:$/i.test(window.location.protocol)) {
      return window.location.origin.replace(/\/+$/, "");
    }
  }

  return "http://localhost:3000";
})();
const DEFAULT_RESULT_MESSAGE = "";
const THEME_STORAGE_KEY = "theme";
const DEFAULT_SUMMARY_TEXT = "Your analysis will appear here after processing.";
const DEFAULT_HISTORY_EMPTY = "No saved analyses yet. Generate one while logged in to see it here.";
const GUEST_HISTORY_MESSAGE = "Login to view your saved analyses";
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
    fileNameText: document.getElementById("fileName"),
    form: document.getElementById("uploadform"),
    guestActions: document.getElementById("guestActions"),
    historyList: document.getElementById("historyList"),
    historySidebar: document.getElementById("historySidebar"),
    historyShortcut: document.getElementById("historyShortcut"),
    loginButton: document.getElementById("loginButton"),
    loginTab: document.getElementById("loginTab"),
    logoutButton: document.getElementById("logoutButton"),
    messageBox: document.getElementById("messageBox"),
    profileDropdown: document.getElementById("profileDropdown"),
    profileEmail: document.getElementById("profileEmail"),
    profileName: document.getElementById("profileName"),
    profileMenu: document.getElementById("profileMenu"),
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
    dropzoneDragDepth: 0,
  };

  const summaryTypeOptions = [
    { value: "summary", label: "Summary" },
    { value: "claims", label: "Key Claims" },
    { value: "references", label: "References" },
  ];

  const missingCriticalElements = [
    "fileInput",
    "form",
    "historyList",
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
    const found = summaryTypeOptions.find((option) => option.value === value);
    if (found) {
      return found.label;
    }
    // Backward compatibility for older summaries in user history
    if (value === "short") return "Short Summary";
    if (value === "detailed") return "Detailed Summary";
    if (value === "bullets") return "Bullet Points";
    return value || "Summary";
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

  function setMessage(message, variant) {
    elements.messageBox.textContent = message;
    elements.messageBox.className = "message-box";

    if (variant) {
      elements.messageBox.classList.add(`is-${variant}`);
    }

    elements.messageBox.hidden = !message;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeReferences(text) {
    if (typeof text !== "string" || !text.trim()) {
      return text;
    }

    const lines = text.split(/\n/).map(line => line.trim()).filter(line => line.length > 0);
    
    if (lines.length === 0) {
      return text;
    }

    const normalizedReferences = [];
    let currentReference = "";

    // Patterns that indicate a new reference
    const newReferencePatterns = [
      /^\d+\./,           // Numbered list: "1.", "2.", etc.
      /^[-*]\s/,          // Bullet points: "- ", "* "
      /^\[[^\]]+\]\s/,    // Bracketed numbers: "[1] ", "[2] ", etc.
      /^[A-Z][a-z]+,\s/,  // Author name pattern: "Smith, ", "Johnson, "
      /^[A-Z]\.\s/,       // Initial pattern: "A. ", "B. "
    ];

    // Patterns that indicate a continuation line (wrapped from PDF)
    const continuationPatterns = [
      /^\d{4}/,           // Year at start (continuation from previous line)
      /^\d+\s*\(/,        // Page numbers: "282-288" or "282 ("
      /^\(/,              // Opening parenthesis (continuation)
      /^\./,              // Continuation starting with period
      /^[a-z]/,           // Lowercase letter start (continuation)
      /^,\s/,             // Comma at start (continuation)
      /^and\s/i,          // "and" at start (continuation)
      /^[ivx]+\./,        // Roman numerals: "i.", "ii.", etc.
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isContinuation = continuationPatterns.some(pattern => pattern.test(line));
      const isNewReference = newReferencePatterns.some(pattern => pattern.test(line));

      // Check for blank line separator (double newline in original)
      const hasBlankLineSeparator = i > 0 && text.includes("\n\n") && !isContinuation;

      if (isNewReference || (hasBlankLineSeparator && currentReference.length > 0)) {
        // Save current reference if it exists and is not empty
        if (currentReference.trim().length > 0) {
          normalizedReferences.push(currentReference.trim());
        }
        currentReference = line;
      } else if (isContinuation && currentReference.length > 0) {
        // Append to current reference
        currentReference += " " + line;
      } else if (currentReference.length === 0) {
        // First line
        currentReference = line;
      } else {
        // Check if this looks like a new reference by context
        // If the line starts with a capital letter and previous line ends with punctuation
        const endsWithPunctuation = /[.!?]$/.test(currentReference.trim());
        const startsWithCapital = /^[A-Z]/.test(line) && !/^[A-Z]\./.test(line);
        
        if (endsWithPunctuation && startsWithCapital && !isContinuation) {
          normalizedReferences.push(currentReference.trim());
          currentReference = line;
        } else {
          currentReference += " " + line;
        }
      }
    }

    // Add the last reference if it's not empty
    if (currentReference.trim().length > 0) {
      normalizedReferences.push(currentReference.trim());
    }

    // Filter out empty references and join with double newlines
    return normalizedReferences
      .filter(ref => ref.trim().length > 0)
      .join("\n\n");
  }

  function buildSummaryContentMarkup(summaryText, summaryType) {
    const safeSummary =
      typeof summaryText === "string" && summaryText.trim()
        ? summaryText.trim()
        : DEFAULT_SUMMARY_TEXT;

    // Normalize references if this is a references summary
    const processedSummary = summaryType === "references" 
      ? normalizeReferences(safeSummary) 
      : safeSummary;

    const lines = processedSummary.split(/\n+/).filter(Boolean);

    if (!lines.length) {
      return `<p class="summary-paragraph">${escapeHtml(safeSummary)}</p>`;
    }

    const isReferences = summaryType === "references";

    return lines
      .map((line) => {
        const trimmedLine = line.trim();
        const escapedLine = escapeHtml(line);

        if (/^[-*]/.test(trimmedLine) || /^\d+\./.test(trimmedLine)) {
          if (isReferences) {
            return `
              <div class="reference-row">
                <p class="summary-bullet"><mark>${escapedLine}</mark></p>
                <a href="https://scholar.google.com/scholar?q=${encodeURIComponent(trimmedLine)}" target="_blank" rel="noopener" class="ghost-button scholar-button" title="Search on Google Scholar">
                  Search →
                </a>
              </div>
            `;
          }
          return `<p class="summary-bullet"><mark>${escapedLine}</mark></p>`;
        }

        if (isReferences && trimmedLine.length > 0) {
          return `
            <div class="reference-row">
              <p class="summary-paragraph">${escapedLine}</p>
              <a href="https://scholar.google.com/scholar?q=${encodeURIComponent(trimmedLine)}" target="_blank" rel="noopener" class="ghost-button scholar-button" title="Search on Google Scholar">
                Search →
              </a>
            </div>
          `;
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
        <div class="empty-state">
          <div class="empty-state-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
          </div>
          <h4 class="empty-state-title">No analysis yet</h4>
          <p class="empty-state-text">Upload a research paper to begin AI analysis.</p>
        </div>
      `;
      return;
    }

    const now = new Date();
    const timestamp = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    elements.summaryResults.innerHTML = normalizedCards
      .map((card, index) => {
        const fileName = escapeHtml(card.fileName || `Document ${index + 1}`);
        const summaryType = escapeHtml(card.summaryType || "Summary");
        const status = card.status === "error" ? "error" : "success";
        const bodyText =
          status === "error"
            ? `<p class="summary-paragraph">${escapeHtml(card.error || "We couldn\u2019t analyze this paper. Please verify that the document contains selectable text or try another file.")}</p>`
            : buildSummaryContentMarkup(card.summary, card.summaryType);

        return `
          <article class="summary-card summary-card--${status}">
            <div class="summary-header">
              <div>
                <p class="summary-label">${summaryType}</p>
                <h3 title="${fileName}">${fileName}</h3>
              </div>
              <div class="summary-header-actions">
                <button type="button" data-copy-summary="${index}" ${
                  status === "error" ? "disabled" : ""
                } title="Copy to clipboard">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  Copy
                </button>
                <button type="button" data-download-summary="${index}" ${
                  status === "error" ? "disabled" : ""
                } title="Download as text file">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download
                </button>
              </div>
            </div>
            <div class="summary-content">${bodyText}</div>
            <div class="summary-timestamp">${timestamp}</div>
          </article>
        `;
      })
      .join("");
  }

  function setSummaryState(cards = []) {
    renderSummaryCards(cards);
    const resultsCard = document.getElementById("resultsCard");
    if (resultsCard) {
      const hasResults = Array.isArray(cards) && cards.length > 0;
      resultsCard.classList.toggle("is-visible", hasResults);
    }
  }

  function setLoadingState(isLoading) {
    elements.submitButton.disabled = isLoading;
    elements.buttonSpinner.hidden = !isLoading;
    elements.submitButtonLabel.textContent = isLoading ? "Analyzing..." : "Analyze";
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
          ? "Login to save analyses and access history later."
          : "Create an account to save analyses and unlock history.";
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
    const rawError = result?.data?.error;
    const userMessage = result?.data?.details?.userMessage;
    const providerReason = result?.data?.details?.providerReason;

    if (providerReason && rawError !== userMessage) {
      console.warn("Provider error (not shown to user):", providerReason);
    }

    return userMessage || rawError || fallbackMessage;
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

  function renderSelectedFiles(files) {
    state.selectedFiles = Array.isArray(files) ? files : [];
    syncFileInputWithState();

    if (!state.selectedFiles.length) {
      elements.selectedFiles.innerHTML =
        '<p class="selected-files-empty">No files selected yet. Add documents to begin.</p>';
      elements.fileNameText.textContent = "No files selected";
      elements.fileNameText.removeAttribute("title");
      elements.dropzone?.classList.remove("has-files");
      return;
    }

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
    elements.statusText.textContent = nextFiles.length ? "Ready to analyze" : "Waiting for upload";
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

      setMessage("Signed in. New analyses will be saved automatically.", "success");
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
    const nextTheme = document.body.classList.contains("dark-mode") ? "light" : "dark";
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
      elements.statusText.textContent = "No files selected";
      return;
    }

    try {
      setLoadingState(true);
      state.selectedHistoryId = null;
      elements.statusText.textContent = "Uploading and extracting text";
      setMessage("Uploading and extracting text from your selected files\u2026", "loading");
      elements.summaryResults.innerHTML = files
        .map(
          (file) => `
        <div class="summary-skeleton">
          <div class="skeleton-line" style="width: 40%; height: 16px; margin-bottom: 16px;"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line" style="width: 92%;"></div>
          <div class="skeleton-line" style="width: 78%;"></div>
          <div class="skeleton-line" style="width: 85%;"></div>
          <div class="skeleton-line" style="width: 60%;"></div>
        </div>
      `
        )
        .join("");

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

      elements.statusText.textContent = `${uploadResult.data.characterCount.toLocaleString()} characters extracted`;
      setMessage("Generating AI analysis\u2026", "loading");

      console.log(
        "Summarize request started",
        createSafeDebugPayload({
          url: `${API_BASE_URL}/api/summarize`,
          hasAuthorization: Boolean(authHeaders.Authorization),
          payload: {
            fileCount: uploadResult.data.files?.length || 0,
            summaryType: elements.summaryTypeSelect.value,
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
        }),
      });
      const summaryResult = await parseApiResponse(summaryResponse);

      if (!summaryResult.ok || !summaryResult.data) {
        throw new Error(getApiErrorMessage(summaryResult, "The summary request failed."));
      }

      const results = Array.isArray(summaryResult.data.results) ? summaryResult.data.results : [];
      setSummaryState(results);

      elements.statusText.textContent = "Analysis complete";
      const successCount = results.filter((result) => result.status === "success").length;
      const errorCount = results.filter((result) => result.status === "error").length;
      setMessage(
        errorCount
          ? `${successCount} analysis${successCount === 1 ? "" : "s"} complete. ${errorCount} file${errorCount === 1 ? "" : "s"} could not be analyzed.`
          : `Analysis complete for ${successCount} file${successCount === 1 ? "" : "s"}.`,
        "success"
      );

      await fetchHistory();
    } catch (error) {
      console.error("Analysis request failed:", error);
      elements.statusText.textContent = "Something went wrong";
      const friendlyMessage = "We couldn\u2019t complete the analysis. Please try again.";
      setSummaryState(
        files.map((file) => ({
          fileName: file.name,
          summaryType: getSummaryTypeLabel(elements.summaryTypeSelect.value),
          status: "error",
          error: friendlyMessage,
        }))
      );
      setMessage(friendlyMessage, "error");
    } finally {
      setLoadingState(false);
    }
  });

  applyTheme(getInitialTheme());
  syncSummaryTypeUI(elements.summaryTypeSelect.value);
  document.body.classList.remove("sidebar-open");
  elements.historySidebar?.classList.add("is-closed");
  elements.authModal?.classList.add("is-closed");
  setAuthMode("login");
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

  initializeFirebase().catch((error) => {
    console.warn("Firebase startup check failed.", error);
  });
});


