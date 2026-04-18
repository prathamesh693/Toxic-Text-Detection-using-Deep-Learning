/**
 * popup.js — Popup Interface Logic
 * 
 * Handles:
 *  1. Toggle switch for enabling/disabling detection
 *  2. Highlight style selection with persistence
 *  3. API health check
 *  4. Stats display (scans, detections, last score)
 */

document.addEventListener("DOMContentLoaded", () => {
  // ─── DOM References ─────────────────────────────────────────────────────
  const toggleSwitch = document.getElementById("toggleSwitch");
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const statusCard = document.getElementById("statusCard");
  const styleOptions = document.getElementById("styleOptions");
  const styleBtns = document.querySelectorAll(".style-btn");
  const apiDot = document.getElementById("apiDot");
  const apiText = document.getElementById("apiText");
  const scanCount = document.getElementById("scanCount");
  const toxicCount = document.getElementById("toxicCount");
  const accuracyValue = document.getElementById("accuracyValue");

  // ─── Load Saved State ───────────────────────────────────────────────────
  chrome.storage.local.get(
    ["enabled", "highlightStyle", "scanCount", "toxicCount", "lastScore"],
    (result) => {
      // Toggle state
      const enabled = result.enabled !== false; // Default: true
      toggleSwitch.checked = enabled;
      updateStatusUI(enabled);

      // Highlight style
      const style = result.highlightStyle || "background";
      setActiveStyle(style);

      // Stats
      scanCount.textContent = formatNumber(result.scanCount || 0);
      toxicCount.textContent = formatNumber(result.toxicCount || 0);
      accuracyValue.textContent =
        result.lastScore !== undefined
          ? `${(result.lastScore * 100).toFixed(1)}%`
          : "—";
    }
  );

  // ─── Toggle Switch ─────────────────────────────────────────────────────
  toggleSwitch.addEventListener("change", () => {
    const enabled = toggleSwitch.checked;
    chrome.storage.local.set({ enabled }, () => {
      updateStatusUI(enabled);
      console.log("[ToxicDetector Popup] Protection", enabled ? "enabled" : "disabled");
    });
  });

  function updateStatusUI(enabled) {
    if (enabled) {
      statusDot.className = "status-dot status-dot-active";
      statusText.textContent = "Protection Active";
      statusCard.className = "status-card status-card-active";
    } else {
      statusDot.className = "status-dot status-dot-paused";
      statusText.textContent = "Paused";
      statusCard.className = "status-card status-card-paused";
    }
  }

  // ─── Highlight Style Selector ──────────────────────────────────────────
  styleBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const style = btn.dataset.style;
      chrome.storage.local.set({ highlightStyle: style }, () => {
        setActiveStyle(style);
        console.log("[ToxicDetector Popup] Highlight style:", style);
      });
    });
  });

  function setActiveStyle(style) {
    styleBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.style === style);
    });
  }

  // ─── API Health Check ─────────────────────────────────────────────────
  checkAPIHealth();

  async function checkAPIHealth() {
    apiDot.className = "api-dot api-dot-checking";
    apiText.textContent = "Checking API...";

    try {
      const response = await fetch("http://localhost:8000/health", {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const data = await response.json();
        apiDot.className = "api-dot api-dot-online";
        apiText.textContent = `API Online — ${data.model || "Model Loaded"}`;
      } else {
        throw new Error(`Status ${response.status}`);
      }
    } catch (error) {
      apiDot.className = "api-dot api-dot-offline";
      apiText.textContent = "API Offline — Start your server";
      console.warn("[ToxicDetector Popup] API health check failed:", error.message);
    }
  }

  // ─── Listen for Stats Updates ──────────────────────────────────────────
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    if (changes.scanCount) {
      scanCount.textContent = formatNumber(changes.scanCount.newValue || 0);
    }
    if (changes.toxicCount) {
      toxicCount.textContent = formatNumber(changes.toxicCount.newValue || 0);
    }
    if (changes.lastScore) {
      accuracyValue.textContent = `${(changes.lastScore.newValue * 100).toFixed(1)}%`;
    }
  });

  // ─── Utilities ─────────────────────────────────────────────────────────
  function formatNumber(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return n.toString();
  }
});
