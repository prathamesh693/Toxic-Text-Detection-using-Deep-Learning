/**
 * background.js — Service Worker (Manifest V3)
 * 
 * Responsibilities:
 *  1. Proxy API requests from content scripts to avoid CORS issues.
 *  2. Manage the extension badge to indicate toxic text detection.
 *  3. Handle extension lifecycle events and user preference initialization.
 */

// ─── Constants ────────────────────────────────────────────────────────────────
const API_BASE_URL = "http://localhost:8000";
const PREDICT_ENDPOINT = `${API_BASE_URL}/predict`;
const PREDICT_TOXICITY_ENDPOINT = `${API_BASE_URL}/predict_toxicity`;

// ─── Extension Install / Startup ──────────────────────────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
  console.log("[ToxicDetector] Extension installed:", details.reason);

  // Initialize default preferences on first install
  chrome.storage.local.get(["enabled", "highlightStyle"], (result) => {
    const defaults = {};
    if (result.enabled === undefined) defaults.enabled = true;
    if (result.highlightStyle === undefined) defaults.highlightStyle = "background";

    if (Object.keys(defaults).length > 0) {
      chrome.storage.local.set(defaults, () => {
        console.log("[ToxicDetector] Default preferences set:", defaults);
      });
    }
  });

  // Set default badge
  updateBadge(false);
});

// ─── Message Handling ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Route messages by type
  switch (message.type) {
    case "PREDICT":
      handlePrediction(message.text, sender.tab?.id, sendResponse);
      return true; // Keep message channel open for async response

    case "PREDICT_DETAILED":
      handleDetailedPrediction(message.text, sender.tab?.id, sendResponse);
      return true;

    case "UPDATE_BADGE":
      updateBadge(message.isToxic, sender.tab?.id);
      sendResponse({ success: true });
      return false;

    case "GET_STATUS":
      chrome.storage.local.get(["enabled", "highlightStyle"], (result) => {
        sendResponse({
          enabled: result.enabled !== false,
          highlightStyle: result.highlightStyle || "background",
        });
      });
      return true;

    default:
      console.warn("[ToxicDetector] Unknown message type:", message.type);
      sendResponse({ error: "Unknown message type" });
      return false;
  }
});

// ─── API Communication ────────────────────────────────────────────────────────

/**
 * Send text to the /predict endpoint and return the result.
 * Runs in the service worker to bypass content-script CORS restrictions.
 */
async function handlePrediction(text, tabId, sendResponse) {
  try {
    const response = await fetch(PREDICT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error(`API returned status ${response.status}`);
    }

    const data = await response.json();

    // Normalize the response to a consistent shape for the content script
    const result = {
      toxic: data.is_toxic || false,
      score: data.toxicity_score || 0,
      detailed_scores: data.detailed_scores || {},
      original_text: data.original_text || text,
    };

    // Update badge based on toxicity
    updateBadge(result.toxic, tabId);

    // Track stats for the popup dashboard
    chrome.storage.local.get(["scanCount", "toxicCount"], (stored) => {
      const updates = {
        scanCount: (stored.scanCount || 0) + 1,
        lastScore: result.score,
      };
      if (result.toxic) {
        updates.toxicCount = (stored.toxicCount || 0) + 1;
      }
      chrome.storage.local.set(updates);
    });

    sendResponse({ success: true, result });
  } catch (error) {
    console.error("[ToxicDetector] Prediction error:", error.message);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Send text to the /predict_toxicity endpoint for detailed analysis
 * (includes toxic spans and sentiment).
 */
async function handleDetailedPrediction(text, tabId, sendResponse) {
  try {
    const response = await fetch(PREDICT_TOXICITY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error(`API returned status ${response.status}`);
    }

    const data = await response.json();

    const result = {
      toxic: data.is_toxic || false,
      score: data.toxicity_score || 0,
      detailed_scores: data.detailed_scores || {},
      toxic_spans: data.toxic_spans || [],
      sentiment: data.sentiment || "neutral",
      original_text: data.original_text || text,
    };

    updateBadge(result.toxic, tabId);
    sendResponse({ success: true, result });
  } catch (error) {
    console.error("[ToxicDetector] Detailed prediction error:", error.message);
    sendResponse({ success: false, error: error.message });
  }
}

// ─── Badge Management ─────────────────────────────────────────────────────────

/**
 * Update the extension badge to show current detection status.
 * - Red "!" when toxic text is detected
 * - Green "✓" or empty when text is clean
 */
function updateBadge(isToxic, tabId) {
  const badgeConfig = isToxic
    ? { text: "!", color: "#EF4444" }     // Red badge for toxic
    : { text: "", color: "#10B981" };      // Clear badge for safe

  if (tabId) {
    chrome.action.setBadgeText({ text: badgeConfig.text, tabId });
    chrome.action.setBadgeBackgroundColor({ color: badgeConfig.color, tabId });
  } else {
    chrome.action.setBadgeText({ text: badgeConfig.text });
    chrome.action.setBadgeBackgroundColor({ color: badgeConfig.color });
  }
}

// ─── Storage Change Listener ──────────────────────────────────────────────────
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.enabled) {
    const enabled = changes.enabled.newValue;
    console.log("[ToxicDetector] Protection", enabled ? "enabled" : "disabled");

    // Clear badge when disabled
    if (!enabled) {
      chrome.action.setBadgeText({ text: "" });
    }
  }
});
