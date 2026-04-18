/**
 * content.js — Content Script
 * 
 * Injected into every web page. Handles:
 *  1. Detecting text input in <input>, <textarea>, and contenteditable elements
 *  2. Debouncing input events to reduce API calls
 *  3. Sending text to background.js for toxicity prediction
 *  4. Applying visual highlights and tooltips for toxic text
 *  5. Using MutationObserver for dynamically loaded content
 */

(() => {
  "use strict";

  // ─── State ────────────────────────────────────────────────────────────────
  let isEnabled = true;
  let highlightStyle = "background"; // "background" | "underline" | "color" | "border"
  let tooltipElement = null;
  let statusIndicator = null;
  let activeTimers = new Map();       // element → debounce timer ID
  let trackedElements = new WeakSet(); // prevents duplicate listeners
  let lastResults = new WeakMap();     // element → last prediction result
  let statusTimeout = null;

  // ─── Configuration ────────────────────────────────────────────────────────
  const DEBOUNCE_DELAY = 400;         // ms — sweet spot between 300–500
  const MIN_TEXT_LENGTH = 3;          // Don't send very short strings
  const TOOLTIP_OFFSET_Y = 12;       // px below cursor

  // ─── Initialization ──────────────────────────────────────────────────────
  function init() {
    console.log("[ToxicDetector] Content script loaded");

    // Load user preferences
    loadPreferences();

    // Listen for preference changes in real time
    chrome.storage.onChanged.addListener(handleStorageChange);

    // Create persistent DOM elements (tooltip, status pill)
    createTooltip();
    createStatusIndicator();

    // Track all existing input elements on the page
    attachToAllInputs();

    // Observe DOM mutations for dynamically added elements
    observeDOMMutations();
  }

  // ─── Preference Management ────────────────────────────────────────────────

  function loadPreferences() {
    chrome.storage.local.get(["enabled", "highlightStyle"], (result) => {
      isEnabled = result.enabled !== false;  // Default: enabled
      highlightStyle = result.highlightStyle || "background";
      console.log("[ToxicDetector] Preferences:", { isEnabled, highlightStyle });
    });
  }

  function handleStorageChange(changes, areaName) {
    if (areaName !== "local") return;

    if (changes.enabled !== undefined) {
      isEnabled = changes.enabled.newValue;
      console.log("[ToxicDetector] Protection", isEnabled ? "enabled" : "paused");

      if (!isEnabled) {
        clearAllHighlights();
        hideTooltip();
        hideStatus();
      }
    }

    if (changes.highlightStyle !== undefined) {
      const oldStyle = highlightStyle;
      highlightStyle = changes.highlightStyle.newValue;

      // Re-apply highlights with new style
      document.querySelectorAll(`.ttd-toxic-${oldStyle}`).forEach((el) => {
        el.classList.remove(`ttd-toxic-${oldStyle}`);
        el.classList.add(`ttd-toxic-${highlightStyle}`);
      });
    }
  }

  // ─── DOM Element Discovery & Attachment ───────────────────────────────────

  /**
   * Find and attach listeners to all input-like elements on the page.
   */
  function attachToAllInputs() {
    const selectors = [
      'input[type="text"]',
      'input[type="search"]',
      'input[type="email"]',
      'input[type="url"]',
      'input:not([type])',             // default type is text
      "textarea",
      "[contenteditable=true]",
      "[contenteditable='']",
      '[role="textbox"]',              // ARIA textbox (Slack, Discord, etc.)
      ".ql-editor",                    // Quill editor
      ".ProseMirror",                  // ProseMirror editor (Notion, etc.)
      ".DraftEditor-root",             // Draft.js (Facebook Messenger)
      "[data-testid='tweetTextarea_0']", // Twitter/X compose
    ];

    const elements = document.querySelectorAll(selectors.join(", "));
    elements.forEach(attachToElement);
  }

  /**
   * Attach input/focus/blur listeners to a single element if not already tracked.
   */
  function attachToElement(element) {
    if (trackedElements.has(element)) return;
    trackedElements.add(element);

    const isContentEditable =
      element.isContentEditable ||
      element.getAttribute("contenteditable") === "true" ||
      element.getAttribute("contenteditable") === "";

    // Input event — fires on every keystroke
    element.addEventListener("input", (e) => handleInput(element, isContentEditable), {
      passive: true,
    });

    // Focus — re-check when element receives focus
    element.addEventListener("focus", (e) => handleInput(element, isContentEditable), {
      passive: true,
    });

    // Blur — hide tooltip when leaving the field
    element.addEventListener("blur", () => {
      hideTooltip();
      // Slight delay before hiding status so it doesn't flash
      if (statusTimeout) clearTimeout(statusTimeout);
      statusTimeout = setTimeout(hideStatus, 2000);
    });

    // Mouse enter/leave for tooltip positioning on highlighted elements
    element.addEventListener("mouseenter", (e) => {
      const result = lastResults.get(element);
      if (result && result.toxic) {
        showTooltip(element, result);
      }
    }, { passive: true });

    element.addEventListener("mouseleave", () => {
      hideTooltip();
    }, { passive: true });
  }

  // ─── Input Handling with Debounce ─────────────────────────────────────────

  /**
   * Handle input events with debouncing.
   * Waits DEBOUNCE_DELAY ms after the user stops typing before calling the API.
   */
  function handleInput(element, isContentEditable) {
    if (!isEnabled) return;

    // Cancel any existing timer for this element
    if (activeTimers.has(element)) {
      clearTimeout(activeTimers.get(element));
    }

    // Set a new debounced timer
    const timerId = setTimeout(() => {
      activeTimers.delete(element);

      // Extract text content
      const text = isContentEditable
        ? (element.innerText || element.textContent || "").trim()
        : (element.value || "").trim();

      if (text.length < MIN_TEXT_LENGTH) {
        clearHighlight(element);
        hideTooltip();
        showStatus(false);
        return;
      }

      // Send prediction request through background.js
      predictText(element, text);
    }, DEBOUNCE_DELAY);

    activeTimers.set(element, timerId);
  }

  // ─── API Communication ────────────────────────────────────────────────────

  /**
   * Send text to the background service worker for prediction.
   */
  function predictText(element, text) {
    chrome.runtime.sendMessage(
      { type: "PREDICT", text },
      (response) => {
        // Handle extension context invalidation (e.g., extension updated/reloaded)
        if (chrome.runtime.lastError) {
          console.warn("[ToxicDetector] Runtime error:", chrome.runtime.lastError.message);
          return;
        }

        if (!response || !response.success) {
          // API failure — fail silently, don't disrupt the user
          console.warn("[ToxicDetector] Prediction failed:", response?.error || "Unknown error");
          return;
        }

        const result = response.result;
        lastResults.set(element, result);

        if (result.toxic) {
          applyHighlight(element);
          showStatus(true, result.score);

          // Show tooltip if element is focused
          if (document.activeElement === element) {
            showTooltip(element, result);
          }
        } else {
          clearHighlight(element);
          showStatus(false);

          if (document.activeElement === element) {
            hideTooltip();
          }
        }
      }
    );
  }

  // ─── Visual Feedback ──────────────────────────────────────────────────────

  /**
   * Apply the selected highlight style to an element.
   */
  function applyHighlight(element) {
    // Remove any existing highlight styles first
    removeAllHighlightClasses(element);

    // Apply the selected style
    element.classList.add(`ttd-toxic-${highlightStyle}`);
  }

  /**
   * Remove highlight from an element with a smooth transition.
   */
  function clearHighlight(element) {
    const hadHighlight = [
      "ttd-toxic-background",
      "ttd-toxic-underline",
      "ttd-toxic-color",
      "ttd-toxic-border",
    ].some((cls) => element.classList.contains(cls));

    if (hadHighlight) {
      element.classList.add("ttd-clearing");
      removeAllHighlightClasses(element);

      // Remove the clearing transition class after animation completes
      setTimeout(() => {
        element.classList.remove("ttd-clearing");
      }, 400);
    }
  }

  /**
   * Remove all ttd highlight classes from an element.
   */
  function removeAllHighlightClasses(element) {
    element.classList.remove(
      "ttd-toxic-background",
      "ttd-toxic-underline",
      "ttd-toxic-color",
      "ttd-toxic-border"
    );
  }

  /**
   * Clear highlights from ALL tracked elements on the page.
   */
  function clearAllHighlights() {
    document
      .querySelectorAll(
        ".ttd-toxic-background, .ttd-toxic-underline, .ttd-toxic-color, .ttd-toxic-border"
      )
      .forEach((el) => {
        removeAllHighlightClasses(el);
        el.classList.remove("ttd-clearing");
      });
  }

  // ─── Tooltip Management ───────────────────────────────────────────────────

  /**
   * Create the tooltip DOM element (created once, reused).
   */
  function createTooltip() {
    tooltipElement = document.createElement("div");
    tooltipElement.className = "ttd-tooltip";
    tooltipElement.setAttribute("role", "tooltip");
    tooltipElement.setAttribute("aria-hidden", "true");
    document.body.appendChild(tooltipElement);
  }

  /**
   * Show the tooltip near the given element with prediction results.
   */
  function showTooltip(element, result) {
    if (!tooltipElement || !isEnabled) return;

    // Build tooltip content
    const scorePercent = (result.score * 100).toFixed(1);

    let categoriesHTML = "";
    if (result.detailed_scores && Object.keys(result.detailed_scores).length > 0) {
      const significantCategories = Object.entries(result.detailed_scores)
        .filter(([, score]) => score > 0.3)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);

      if (significantCategories.length > 0) {
        categoriesHTML = `
          <div class="ttd-tooltip-categories">
            ${significantCategories
              .map(
                ([label, score]) =>
                  `<span class="ttd-tooltip-category">${label}: ${(score * 100).toFixed(0)}%</span>`
              )
              .join("")}
          </div>
        `;
      }
    }

    tooltipElement.innerHTML = `
      <div class="ttd-tooltip-header">
        <span class="ttd-tooltip-icon">⚠️</span>
        <span>This message may be toxic</span>
      </div>
      <div class="ttd-tooltip-body">
        Your text has been flagged by the AI model as potentially harmful or offensive.
        Consider rephrasing before sending.
      </div>
      <span class="ttd-tooltip-score">Toxicity: ${scorePercent}%</span>
      ${categoriesHTML}
    `;

    // Position tooltip near the element
    const rect = element.getBoundingClientRect();
    const tooltipRect = tooltipElement.getBoundingClientRect();

    let top = rect.bottom + TOOLTIP_OFFSET_Y;
    let left = rect.left;

    // Ensure tooltip stays within viewport
    if (top + 150 > window.innerHeight) {
      top = rect.top - 150 - TOOLTIP_OFFSET_Y;
    }
    if (left + 320 > window.innerWidth) {
      left = window.innerWidth - 330;
    }
    if (left < 10) left = 10;

    tooltipElement.style.top = `${top}px`;
    tooltipElement.style.left = `${left}px`;

    tooltipElement.setAttribute("aria-hidden", "false");

    // Trigger enter animation on next frame
    requestAnimationFrame(() => {
      tooltipElement.classList.add("ttd-tooltip-visible");
    });
  }

  /**
   * Hide the tooltip with a fade-out animation.
   */
  function hideTooltip() {
    if (!tooltipElement) return;
    tooltipElement.classList.remove("ttd-tooltip-visible");
    tooltipElement.setAttribute("aria-hidden", "true");
  }

  // ─── Status Indicator (Floating Pill) ─────────────────────────────────────

  /**
   * Create the floating status pill (created once, reused).
   */
  function createStatusIndicator() {
    statusIndicator = document.createElement("div");
    statusIndicator.className = "ttd-status-indicator";
    statusIndicator.setAttribute("aria-live", "polite");
    document.body.appendChild(statusIndicator);
  }

  /**
   * Show/update the floating status indicator.
   */
  function showStatus(isToxic, score = 0) {
    if (!statusIndicator || !isEnabled) return;

    if (statusTimeout) clearTimeout(statusTimeout);

    if (isToxic) {
      const scorePercent = (score * 100).toFixed(1);
      statusIndicator.innerHTML = `
        <span class="ttd-status-dot ttd-status-dot-toxic"></span>
        <span>Toxic content detected — ${scorePercent}%</span>
      `;
    } else {
      statusIndicator.innerHTML = `
        <span class="ttd-status-dot ttd-status-dot-safe"></span>
        <span>Text looks clean</span>
      `;
    }

    requestAnimationFrame(() => {
      statusIndicator.classList.add("ttd-status-visible");
    });

    // Auto-hide after 3 seconds for non-toxic results
    if (!isToxic) {
      statusTimeout = setTimeout(hideStatus, 3000);
    }
  }

  /**
   * Hide the floating status indicator.
   */
  function hideStatus() {
    if (!statusIndicator) return;
    statusIndicator.classList.remove("ttd-status-visible");
  }

  // ─── DOM Mutation Observer ────────────────────────────────────────────────

  /**
   * Observe the DOM for dynamically added input elements.
   * Essential for SPAs, chat apps, and dynamically loaded content.
   */
  function observeDOMMutations() {
    const observer = new MutationObserver((mutations) => {
      // Batch processing — don't process every single mutation
      let hasNewNodes = false;

      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          hasNewNodes = true;
          break;
        }
      }

      if (hasNewNodes) {
        // Use requestIdleCallback for performance (falls back to setTimeout)
        if (window.requestIdleCallback) {
          window.requestIdleCallback(() => attachToAllInputs(), { timeout: 1000 });
        } else {
          setTimeout(attachToAllInputs, 200);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    console.log("[ToxicDetector] MutationObserver active");
  }

  // ─── Start ────────────────────────────────────────────────────────────────

  // Wait for DOM to be fully ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
