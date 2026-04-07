// Debounce helper keeps model calls at ~150ms cadence.
const debounce = (fn, delay = 150) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};

const bodyInput = document.getElementById("bodyInput");
const toxicityScoreEl = document.getElementById("toxicityScore");
const sentimentLabel = document.getElementById("sentimentLabel");
const toxicWordsEl = document.getElementById("toxicWords");
const recommendationsEl = document.getElementById("recommendations");
const detailedScoresEl = document.getElementById("detailedScores");
const analysisPanel = document.getElementById("analysisPanel");
const toggleAnalysis = document.getElementById("toggleAnalysis");
const warningBanner = document.getElementById("toxWarning");
const charCount = document.getElementById("charCount");
const suggestDropdown = document.getElementById("suggestDropdown");

let currentToxicSpans = [];
let currentSuggestions = [];

let lastCaretOffset = 0;

const debouncedAnalyzer = debounce((text) => runAnalysis(text), 160);

bodyInput.addEventListener("input", () => {
  const text = getPlainText();
  lastCaretOffset = getCaretOffset(bodyInput);
  charCount.textContent = `${text.length} characters`;
  hideSuggestions();
  renderHighlights(text, lastCaretOffset);
  debouncedAnalyzer(text);
});

bodyInput.addEventListener("keyup", () => {
  lastCaretOffset = getCaretOffset(bodyInput);
});

bodyInput.addEventListener("mouseup", () => {
  lastCaretOffset = getCaretOffset(bodyInput);
});

bodyInput.addEventListener("paste", (event) => {
  event.preventDefault();
  const text = event.clipboardData.getData("text/plain");
  document.execCommand("insertText", false, text);
});

toggleAnalysis.addEventListener("click", () => {
  const isCollapsed = analysisPanel.classList.contains("collapsed");
  analysisPanel.classList.toggle("collapsed", !isCollapsed);
  analysisPanel.classList.toggle("expanded", isCollapsed);
  toggleAnalysis.textContent = isCollapsed ? "Collapse" : "Expand";
});

bodyInput.addEventListener("click", (event) => {
  const target = event.target.closest(".highlight");
  if (!target) {
    hideSuggestions();
    return;
  }
  const suggestionId = target.dataset.suggestionId;
  if (!suggestionId) {
    hideSuggestions();
    return;
  }
  const suggestion = currentSuggestions.find(
    (entry) => String(entry.id) === suggestionId
  );
  if (!suggestion) {
    hideSuggestions();
    return;
  }
  event.stopPropagation();
  showSuggestionDropdown(target, suggestion);
});

document.addEventListener("click", (event) => {
  if (
    !suggestDropdown.contains(event.target) &&
    !event.target.closest(".highlight")
  ) {
    hideSuggestions();
  }
});

// Runs both toxicity detection and suggestion endpoints in parallel.
async function runAnalysis(text) {
  if (!text.trim()) {
    resetUiState();
    return;
  }

  try {
    const [toxicity, suggestionData] = await Promise.all([
      postJson("/predict_toxicity", { text }),
      postJson("/suggest_words", { text }),
    ]);

    currentToxicSpans = toxicity.toxic_spans || [];
    currentSuggestions = (suggestionData.suggestions || []).map((entry, idx) => ({
      ...entry,
      id: idx.toString(),
    }));

    renderHighlights(text);
    updateWarning();
    updateAnalysisPanel(toxicity, suggestionData);
  } catch (error) {
    console.error("Realtime analysis failed:", error);
  }
}

function resetUiState() {
  currentToxicSpans = [];
  currentSuggestions = [];
  bodyInput.innerHTML = "";
  warningBanner.classList.add("hidden");
  toxicityScoreEl.textContent = "–";
  sentimentLabel.textContent = "–";
  toxicWordsEl.innerHTML = "";
  recommendationsEl.innerHTML = "";
  detailedScoresEl.innerHTML = "";
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Network error");
  }
  return response.json();
}

function renderHighlights(text, caretOverride) {
  const highlightMap = new Map();
  currentToxicSpans.forEach((span) => {
    highlightMap.set(`${span.start}:${span.end}`, {
      start: span.start,
      end: span.end,
      className: "highlight highlight-toxic",
      suggestionId: null,
    });
  });

  currentSuggestions.forEach((suggestion) => {
    const key = `${suggestion.start}:${suggestion.end}`;
    let className = "highlight highlight-spelling";
    if (suggestion.type === "toxicity") className = "highlight highlight-toxic";
    if (suggestion.type === "tone") className = "highlight highlight-tone";
    highlightMap.set(key, {
      start: suggestion.start,
      end: suggestion.end,
      className,
      suggestionId: suggestion.id,
    });
  });

  const entries = Array.from(highlightMap.values()).sort(
    (a, b) => a.start - b.start
  );

  const caretPosition = typeof caretOverride === "number" ? caretOverride : getCaretOffset(bodyInput);

  let cursor = 0;
  let html = "";
  entries.forEach((entry) => {
    if (entry.start < cursor) return;
    html += escapeHtml(text.slice(cursor, entry.start));
    const token = text.slice(entry.start, entry.end);
    const suggestionAttr = entry.suggestionId
      ? ` data-suggestion-id="${entry.suggestionId}"`
      : "";
    html += `<span class="${entry.className}"${suggestionAttr}>${escapeHtml(
      token
    )}</span>`;
    cursor = entry.end;
  });

  html += escapeHtml(text.slice(cursor));
  bodyInput.innerHTML = html || "";
  setCaretOffset(bodyInput, caretPosition);
  lastCaretOffset = caretPosition;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function updateWarning() {
  if (currentToxicSpans.length > 0) {
    warningBanner.classList.remove("hidden");
  } else {
    warningBanner.classList.add("hidden");
  }
}

function updateAnalysisPanel(toxicity, suggestionData) {
  toxicityScoreEl.textContent = toxicity.toxicity_score
    ? `${(toxicity.toxicity_score * 100).toFixed(1)}%`
    : "–";

  sentimentLabel.textContent = toxicity.sentiment || suggestionData.sentiment || "neutral";

  renderDetailedScores(toxicity.detailed_scores || {});
  renderToxicChips(currentToxicSpans);
  renderRecommendations(currentSuggestions);
}

function renderDetailedScores(scores) {
  const entries = Object.entries(scores);
  if (!entries.length) {
    detailedScoresEl.textContent = "No scores available.";
    return;
  }

  detailedScoresEl.innerHTML = entries
    .map(
      ([label, value]) =>
        `<div class="score-row"><span>${label}</span><span>${(value * 100).toFixed(
          1
        )}%</span></div>`
    )
    .join("");
}

function renderToxicChips(spans) {
  if (!spans.length) {
    toxicWordsEl.innerHTML = '<span class="muted">Clean</span>';
    return;
  }
  toxicWordsEl.innerHTML = spans
    .map((span) => `<span class="chip">${span.word}</span>`)
    .join("");
}

function renderRecommendations(suggestions) {
  if (!suggestions.length) {
    recommendationsEl.innerHTML = "<li>No issues detected.</li>";
    return;
  }
  recommendationsEl.innerHTML = suggestions
    .map(
      (suggestion) => `<li><strong>${suggestion.word}</strong>: ${suggestion.message}</li>`
    )
    .join("");
}

function showSuggestionDropdown(target, suggestion) {
  const rect = target.getBoundingClientRect();
  suggestDropdown.style.top = `${rect.bottom + window.scrollY + 8}px`;
  suggestDropdown.style.left = `${rect.left + window.scrollX}px`;

  const buttons = (suggestion.replacements || [])
    .map(
      (replacement) =>
        `<button type="button" data-replacement="${replacement}">${replacement}</button>`
    )
    .join("");

  suggestDropdown.innerHTML = `
    <div class="suggest-item">
      <strong>${suggestion.type.toUpperCase()}</strong>
      <div class="suggest-caption">${suggestion.message}</div>
      ${buttons || "<span class='suggest-caption'>No alternatives available.</span>"}
    </div>
  `;
  suggestDropdown.classList.remove("hidden");

  suggestDropdown.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () =>
      applySuggestion(suggestion, button.dataset.replacement)
    );
  });
}

function hideSuggestions() {
  suggestDropdown.classList.add("hidden");
}

function applySuggestion(suggestion, replacement) {
  const text = getPlainText();
  const updated =
    text.slice(0, suggestion.start) + replacement + text.slice(suggestion.end);
  lastCaretOffset = suggestion.start + replacement.length;
  bodyInput.textContent = updated;
  renderHighlights(updated, lastCaretOffset);
  bodyInput.focus();
  hideSuggestions();
  debouncedAnalyzer(updated);
}

function getPlainText() {
  return bodyInput.textContent || "";
}

function getCaretOffset(root) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return root.textContent.length;
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.endContainer)) {
    return root.textContent.length;
  }
  const preRange = range.cloneRange();
  preRange.selectNodeContents(root);
  preRange.setEnd(range.endContainer, range.endOffset);
  return preRange.toString().length;
}

function setCaretOffset(root, offset) {
  const selection = window.getSelection();
  const range = document.createRange();
  let currentOffset = 0;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let node = walker.nextNode();
  while (node) {
    const nextOffset = currentOffset + node.textContent.length;
    if (offset <= nextOffset) {
      range.setStart(node, Math.max(0, offset - currentOffset));
      range.collapse(true);
      break;
    }
    currentOffset = nextOffset;
    node = walker.nextNode();
  }

  if (!node) {
    range.selectNodeContents(root);
    range.collapse(false);
  }

  selection.removeAllRanges();
  selection.addRange(range);
}

// Kick off placeholder text on load.
renderHighlights("");

