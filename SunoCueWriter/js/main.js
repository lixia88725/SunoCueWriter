(function () {
  "use strict";

  var core = window.SunoCueCore;
  var cep = window.SunoCueCEP;
  var state = {
    cue: null,
    questions: [],
    generated: {},
    history: [],
    historyCompare: {
      aId: "",
      bId: "",
      review: "",
      error: "",
    },
    styleVariants: [],
    model: "deepseek-v4-pro",
  };
  var progressState = {
    timer: null,
    hideTimer: null,
    startedAt: 0,
    message: "",
    showElapsed: false,
  };
  var manualBriefState = {
    storageKey: "",
    saveTimer: null,
  };
  var PROMPT_MARKDOWN_PATH_KEY = "promptMarkdownPath";
  var RECENT_PROMPT_MARKDOWN_FILES_KEY = "recentPromptMarkdownFiles";
  var HISTORY_LIMIT = 20;

  var $ = function (id) {
    return document.getElementById(id);
  };

  function setTextIfPresent(id, value) {
    var node = $(id);
    if (node) {
      node.textContent = value;
    }
  }

  function setStatus(message, isError) {
    $("statusText").textContent = message;
    $("statusText").classList.toggle("is-error", !!isError);
  }

  function setTimelineStatus(message, isError) {
    $("timelineStatus").textContent = message;
    $("timelineStatus").classList.toggle("is-error", !!isError);
  }

  function setTimelineDiagnostics(message, forceVisible) {
    $("timelineDiagnosticsText").textContent = message || "";
    $("timelineDiagnostics").classList.toggle("hidden", !message || !forceVisible);
  }

  function setActivity(message) {
    var hasMessage = !!message;
    if (hasMessage && progressState.hideTimer) {
      window.clearTimeout(progressState.hideTimer);
      progressState.hideTimer = null;
    }
    $("activityIndicator").classList.toggle("hidden", !hasMessage);
    if (hasMessage) {
      $("activityText").textContent = message;
    }
  }

  function clearProgressTimers() {
    if (progressState.timer) {
      window.clearInterval(progressState.timer);
      progressState.timer = null;
    }
    if (progressState.hideTimer) {
      window.clearTimeout(progressState.hideTimer);
      progressState.hideTimer = null;
    }
  }

  function progressElapsedSeconds() {
    return Math.max(0, Math.floor((Date.now() - progressState.startedAt) / 1000));
  }

  function renderProgress() {
    if (!progressState.message) {
      setActivity("");
      return;
    }
    if (!progressState.showElapsed) {
      setActivity(progressState.message);
      return;
    }

    var elapsed = progressElapsedSeconds();
    var message = elapsed >= 25 ? "仍在等待模型返回..." : progressState.message;
    setActivity(message + " " + elapsed + "s");
  }

  function startProgress(label) {
    clearProgressTimers();
    progressState.startedAt = Date.now();
    progressState.message = label;
    progressState.showElapsed = false;
    renderProgress();
  }

  function updateProgress(message, showElapsed) {
    if (!progressState.startedAt) {
      progressState.startedAt = Date.now();
    }
    if (progressState.timer) {
      window.clearInterval(progressState.timer);
      progressState.timer = null;
    }
    progressState.message = message;
    progressState.showElapsed = !!showElapsed;
    renderProgress();
    if (progressState.showElapsed) {
      progressState.timer = window.setInterval(renderProgress, 1000);
    }
  }

  function stopProgress(finalMessage) {
    clearProgressTimers();
    progressState.message = "";
    progressState.showElapsed = false;
    progressState.startedAt = 0;
    if (finalMessage) {
      setActivity(finalMessage);
      progressState.hideTimer = window.setTimeout(function () {
        progressState.hideTimer = null;
        setActivity("");
      }, 1200);
    } else {
      setActivity("");
    }
  }

  function setBusy(isBusy) {
    ["generateButton", "styleVariantsButton", "interviewButton", "generateWithAnswersButton", "saveInterviewSummaryButton", "refreshButton"].forEach(function (id) {
      var node = $(id);
      if (node) {
        node.disabled = isBusy;
      }
    });
  }

  function getApiKey() {
    return $("apiKey").value.trim();
  }

  function saveApiKeyPreference() {
    var key = getApiKey();
    sessionStorage.setItem("deepseekApiKey", key);
    if ($("rememberKey").checked) {
      localStorage.setItem("deepseekApiKey", key);
    } else {
      localStorage.removeItem("deepseekApiKey");
    }
    setStatus("API key preference saved.");
  }

  function loadApiKeyPreference() {
    var remembered = localStorage.getItem("deepseekApiKey");
    var session = sessionStorage.getItem("deepseekApiKey");
    var key = remembered || session || "";
    $("apiKey").value = key;
    $("rememberKey").checked = !!remembered;
  }

  function toggleSection(bodyId, buttonId) {
    setSectionOpen(bodyId, buttonId, $(bodyId).classList.contains("hidden"));
  }

  function setSectionOpen(bodyId, buttonId, isOpen) {
    var body = $(bodyId);
    var button = $(buttonId);
    body.classList.toggle("hidden", !isOpen);
    button.classList.toggle("is-open", isOpen);
    button.setAttribute("aria-expanded", isOpen ? "true" : "false");
  }

  function getGenerationPromptTemplate() {
    return $("generationPromptTemplate").value.trim() || core.defaultGenerationSystemPrompt();
  }

  function getPromptSourcePath() {
    return localStorage.getItem(PROMPT_MARKDOWN_PATH_KEY) || $("promptMarkdownPath").value || "";
  }

  function loadPromptTemplatePreference() {
    $("generationPromptTemplate").value = localStorage.getItem("generationPromptTemplate") || core.defaultGenerationSystemPrompt();
  }

  function savePromptTemplatePreference() {
    localStorage.setItem("generationPromptTemplate", getGenerationPromptTemplate());
    setStatus("API prompt template saved.");
  }

  function resetPromptTemplatePreference() {
    localStorage.removeItem("generationPromptTemplate");
    $("generationPromptTemplate").value = core.defaultGenerationSystemPrompt();
    setStatus("API prompt template reset to default.");
  }

  function promptMarkdownName(path) {
    return String(path || "")
      .split(/[\\/]/)
      .filter(Boolean)
      .pop();
  }

  function isMarkdownPath(path) {
    return /\.(md|markdown)$/i.test(String(path || "").trim());
  }

  function getRecentPromptMarkdownFiles() {
    try {
      return JSON.parse(localStorage.getItem(RECENT_PROMPT_MARKDOWN_FILES_KEY) || "[]");
    } catch (error) {
      return [];
    }
  }

  function saveRecentPromptMarkdownFiles(list) {
    localStorage.setItem(RECENT_PROMPT_MARKDOWN_FILES_KEY, JSON.stringify(list || []));
  }

  function renderRecentPromptMarkdownFiles() {
    var list = getRecentPromptMarkdownFiles();
    var body = $("recentPromptMarkdownList");
    body.innerHTML = list.length
      ? list
          .map(function (item, index) {
            return (
              '<button class="recent-prompt-item" type="button" data-recent-prompt-index="' +
              index +
              '">' +
              '<span class="recent-prompt-name">' +
              escapeHtml(item.name || promptMarkdownName(item.path) || "Prompt") +
              "</span>" +
              "</button>"
            );
          })
          .join("")
      : '<div class="helper-text">No recent Markdown prompts.</div>';
  }

  function setRecentPromptListOpen(isOpen) {
    $("recentPromptMarkdownList").classList.toggle("hidden", !isOpen);
    $("recentPromptMarkdownButton").setAttribute("aria-expanded", isOpen ? "true" : "false");
    if (isOpen) {
      renderRecentPromptMarkdownFiles();
    }
  }

  function clearRecentPromptMarkdownFiles() {
    localStorage.removeItem(RECENT_PROMPT_MARKDOWN_FILES_KEY);
    renderRecentPromptMarkdownFiles();
    setRecentPromptListOpen(false);
    setStatus("Recent Markdown prompts cleared.");
  }

  function rememberPromptMarkdownFile(path) {
    var file = {
      path: path,
      name: promptMarkdownName(path) || path,
      lastLoadedAt: Date.now(),
    };
    saveRecentPromptMarkdownFiles(core.normalizeRecentPromptFiles(getRecentPromptMarkdownFiles(), file));
    renderRecentPromptMarkdownFiles();
  }

  function applyPromptMarkdown(path, markdownText) {
    if (!isMarkdownPath(path)) {
      throw new Error("Choose a .md or .markdown prompt file.");
    }
    var prompt = core.extractPromptFromMarkdown(core.assertPromptMarkdownSize(markdownText));
    if (!prompt) {
      throw new Error("Markdown prompt file did not contain usable prompt text.");
    }
    $("generationPromptTemplate").value = prompt;
    localStorage.setItem("generationPromptTemplate", prompt);
    localStorage.setItem(PROMPT_MARKDOWN_PATH_KEY, path);
    $("promptMarkdownPath").value = path;
    rememberPromptMarkdownFile(path);
    setRecentPromptListOpen(false);
    setStatus("Loaded Engineer Prompt from " + promptMarkdownName(path) + ". Generate and To LLM will use it.");
  }

  function readPromptMarkdownWithCep(path) {
    return new Promise(function (resolve, reject) {
      if (!window.cep || !window.cep.fs || !window.cep.fs.readFile) {
        reject(new Error("CEP file access is unavailable."));
        return;
      }
      var result = window.cep.fs.readFile(path);
      if (result && result.err === 0) {
        resolve(result.data || "");
        return;
      }
      reject(new Error("Could not read Markdown prompt file."));
    });
  }

  function loadPromptMarkdownPath(path) {
    var trimmedPath = String(path || "").trim();
    if (!trimmedPath) {
      setStatus("Enter or choose a Markdown prompt path.", true);
      return;
    }
    if (!isMarkdownPath(trimmedPath)) {
      setStatus("Choose a .md or .markdown prompt file.", true);
      return;
    }
    readPromptMarkdownWithCep(trimmedPath)
      .then(function (text) {
        applyPromptMarkdown(trimmedPath, text);
      })
      .catch(function (error) {
        setStatus(error.message, true);
      });
  }

  function browsePromptMarkdownWithCep() {
    if (!window.cep || !window.cep.fs || !window.cep.fs.showOpenDialogEx) {
      return false;
    }
    var result = window.cep.fs.showOpenDialogEx(false, false, "Choose Engineer Prompt Markdown", "", []);
    if (!result || result.err !== 0 || !result.data || !result.data.length) {
      return true;
    }
    var path = result.data[0];
    $("promptMarkdownPath").value = path;
    loadPromptMarkdownPath(path);
    return true;
  }

  function browsePromptMarkdownFallback() {
    $("promptMarkdownFileInput").value = "";
    $("promptMarkdownFileInput").click();
  }

  function loadPromptMarkdownFileObject(file) {
    if (!file) {
      return;
    }
    var path = file.path || file.name || "";
    if (!isMarkdownPath(path)) {
      setStatus("Choose a .md or .markdown prompt file.", true);
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        applyPromptMarkdown(path, reader.result || "");
      } catch (error) {
        setStatus(error.message, true);
      }
    };
    reader.onerror = function () {
      setStatus("Could not read Markdown prompt file.", true);
    };
    reader.readAsText(file);
  }

  function loadPromptMarkdownPreference() {
    $("promptMarkdownPath").value = localStorage.getItem(PROMPT_MARKDOWN_PATH_KEY) || "";
    renderRecentPromptMarkdownFiles();
  }

  function loadManualBriefForCue(cue) {
    flushManualBriefSave();
    manualBriefState.storageKey = cue ? core.additionalContextStorageKey(cue) : "";
    var value = manualBriefState.storageKey ? localStorage.getItem(manualBriefState.storageKey) || "" : "";
    if (!value && cue && core.legacyAdditionalContextStorageKey) {
      value = localStorage.getItem(core.legacyAdditionalContextStorageKey(cue)) || "";
      if (value && manualBriefState.storageKey) {
        localStorage.setItem(manualBriefState.storageKey, value);
      }
    }
    $("manualBrief").value = value;
  }

  function saveManualBriefForCue() {
    if (!manualBriefState.storageKey) {
      return;
    }
    var value = $("manualBrief").value;
    if (value) {
      localStorage.setItem(manualBriefState.storageKey, value);
    } else {
      localStorage.removeItem(manualBriefState.storageKey);
    }
  }

  function scheduleManualBriefSave() {
    if (!manualBriefState.storageKey && state.cue) {
      manualBriefState.storageKey = core.additionalContextStorageKey(state.cue);
    }
    if (manualBriefState.saveTimer) {
      window.clearTimeout(manualBriefState.saveTimer);
    }
    manualBriefState.saveTimer = window.setTimeout(function () {
      manualBriefState.saveTimer = null;
      saveManualBriefForCue();
    }, 300);
  }

  function flushManualBriefSave() {
    if (manualBriefState.saveTimer) {
      window.clearTimeout(manualBriefState.saveTimer);
      manualBriefState.saveTimer = null;
    }
    saveManualBriefForCue();
  }

  function historyKeyForCue(cue) {
    return cue ? core.historyStorageKey(cue) : "";
  }

  function loadHistoryForCue(cue) {
    var key = historyKeyForCue(cue);
    clearHistoryCompareSelection(false);
    if (!key) {
      state.history = [];
      renderHistory();
      return;
    }
    try {
      state.history = JSON.parse(localStorage.getItem(key) || "[]");
    } catch (error) {
      state.history = [];
    }
    renderHistory();
  }

  function saveHistoryForCue(cue) {
    var key = historyKeyForCue(cue);
    if (key) {
      localStorage.setItem(key, JSON.stringify(state.history || []));
    }
  }

  function currentSunoFields() {
    return {
      lyrics: $("lyricsOutput").value || "",
      style: $("styleOutput").value || "",
      exclude: $("excludeOutput").value || "",
      title: $("titleOutput").value || "",
      editorNotes: $("notesOutput").value || "",
    };
  }

  function addHistoryEntry(method, fields, cue) {
    var sourceCue = cue || cueWithManualBrief();
    if (!sourceCue) {
      return;
    }
    var entry = core.createHistoryEntry(sourceCue, fields, {
      method: method,
      promptSource: getPromptSourcePath(),
    });
    state.history = core.normalizeHistoryEntries(state.history, entry, HISTORY_LIMIT);
    saveHistoryForCue(sourceCue);
    renderHistory();
  }

  function historyLabel(entry) {
    var date = entry.createdAt ? new Date(entry.createdAt) : new Date();
    var time = isNaN(date.getTime())
      ? ""
      : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return [time, entry.method || "Generate", entry.promptSourceName || "Default Prompt"].filter(Boolean).join(" · ");
  }

  function historyEntryById(id) {
    return (state.history || []).filter(function (entry) {
      return entry && entry.id === id;
    })[0];
  }

  function historyCompareEntries() {
    return {
      a: historyEntryById(state.historyCompare.aId),
      b: historyEntryById(state.historyCompare.bId),
    };
  }

  function compareSelectionLabel(entry) {
    if (entry && entry.id === state.historyCompare.aId) {
      return "A";
    }
    if (entry && entry.id === state.historyCompare.bId) {
      return "B";
    }
    return "";
  }

  function clearHistoryCompareSelection(shouldRender) {
    state.historyCompare = {
      aId: "",
      bId: "",
      review: "",
      error: "",
    };
    if (shouldRender !== false) {
      renderHistory();
    }
  }

  function selectHistoryCompareEntry(entry) {
    if (!core.isHistoryEntryComparable(entry)) {
      setStatus("Only Generate history entries can be compared.", true);
      return;
    }
    if (!state.historyCompare.aId || (state.historyCompare.aId && state.historyCompare.bId)) {
      state.historyCompare.aId = entry.id;
      state.historyCompare.bId = "";
      state.historyCompare.review = "";
      state.historyCompare.error = "";
      setStatus("Selected history version A. Choose another Generate entry for B.");
      renderHistory();
      return;
    }
    if (state.historyCompare.aId === entry.id) {
      setStatus("Choose a different Generate history entry for B.", true);
      return;
    }
    state.historyCompare.bId = entry.id;
    state.historyCompare.review = "";
    state.historyCompare.error = "";
    setStatus("Selected history version B. Compare result is ready.");
    renderHistory();
  }

  function historyFieldCompareBlock(label, fieldName, entryA, entryB) {
    var fieldsA = (entryA && entryA.fields) || {};
    var fieldsB = (entryB && entryB.fields) || {};
    return (
      '<div class="history-compare-field">' +
      '<div class="history-compare-label">' +
      escapeHtml(label) +
      "</div>" +
      '<div class="history-compare-columns">' +
      '<div><strong>A</strong><pre>' +
      escapeHtml(fieldsA[fieldName] || "") +
      "</pre></div>" +
      '<div><strong>B</strong><pre>' +
      escapeHtml(fieldsB[fieldName] || "") +
      "</pre></div>" +
      "</div>" +
      "</div>"
    );
  }

  function renderHistoryCompareResult() {
    var entries = historyCompareEntries();
    if (!entries.a || !entries.b) {
      return "";
    }
    return (
      '<div class="history-compare-result">' +
      '<div class="history-head">' +
      '<div class="history-title">Compare Result</div>' +
      '<div class="history-meta">' +
      escapeHtml("A: " + historyLabel(entries.a) + " | B: " + historyLabel(entries.b)) +
      "</div>" +
      "</div>" +
      '<div class="history-actions">' +
      '<button type="button" data-history-compare-action="use-a">Use A</button>' +
      '<button type="button" data-history-compare-action="use-b">Use B</button>' +
      '<button type="button" data-history-compare-action="review">Ask AI Review</button>' +
      '<button type="button" data-history-compare-action="clear">Clear Compare</button>' +
      "</div>" +
      historyFieldCompareBlock("Lyrics", "lyrics", entries.a, entries.b) +
      historyFieldCompareBlock("Styles", "style", entries.a, entries.b) +
      historyFieldCompareBlock("Exclude Styles", "exclude", entries.a, entries.b) +
      historyFieldCompareBlock("Song Title", "title", entries.a, entries.b) +
      historyFieldCompareBlock("AI Notes", "editorNotes", entries.a, entries.b) +
      (state.historyCompare.review
        ? '<div class="history-compare-review"><div class="history-compare-label">AI Review</div><pre>' + escapeHtml(state.historyCompare.review) + "</pre></div>"
        : "") +
      (state.historyCompare.error ? '<div class="history-compare-error">' + escapeHtml(state.historyCompare.error) + "</div>" : "") +
      "</div>"
    );
  }

  function renderHistory() {
    $("historyCount").textContent = String((state.history || []).length);
    if (!state.history || !state.history.length) {
      $("historyList").innerHTML = "No history yet.";
      return;
    }

    var items = state.history
      .map(function (entry, index) {
        var fieldPreview = entry.fields && entry.fields.style ? entry.fields.style : entry.fields && entry.fields.title ? entry.fields.title : "Saved cue context";
        var selection = compareSelectionLabel(entry);
        var compareButton = core.isHistoryEntryComparable(entry)
          ? '<button type="button" data-history-action="compare">' + escapeHtml(selection ? "Selected " + selection : "Compare") + "</button>"
          : "";
        return (
          '<div class="history-item" data-history-index="' +
          index +
          '">' +
          '<div class="history-head">' +
          '<div class="history-title">' +
          escapeHtml(historyLabel(entry)) +
          "</div>" +
          '<div class="history-meta">' +
          escapeHtml(entry.markerCount + " markers") +
          "</div>" +
          "</div>" +
          '<div class="history-meta">' +
          escapeHtml((entry.sequenceName || "Untitled sequence") + " · " + (entry.range || "") + " · " + fieldPreview) +
          "</div>" +
          '<div class="history-actions">' +
          '<button type="button" data-history-action="load">Load</button>' +
          '<button type="button" data-history-action="copy">Copy</button>' +
          compareButton +
          '<button type="button" data-history-action="delete">Delete</button>' +
          "</div>" +
          "</div>"
        );
      })
      .join("");
    $("historyList").innerHTML = items + renderHistoryCompareResult();
  }

  function loadHistoryEntry(entry) {
    var fields = (entry && entry.fields) || {};
    $("titleOutput").value = fields.title || "";
    $("styleOutput").value = fields.style || "";
    $("lyricsOutput").value = fields.lyrics || "";
    $("excludeOutput").value = fields.exclude || "";
    $("notesOutput").value = fields.editorNotes || "";
    state.generated = {
      title: fields.title || "",
      prompt: fields.lyrics || "",
      lyricsStructure: "",
      style: fields.style || "",
      exclude: fields.exclude || "",
      editorNotes: fields.editorNotes || "",
    };
    setStatus("Loaded history entry.");
  }

  function copyHistoryEntry(entry) {
    var fields = (entry && entry.fields) || {};
    var text = fields.externalPrompt || core.formatCueText({
      title: fields.title || "",
      prompt: fields.lyrics || "",
      lyricsStructure: "",
      style: fields.style || "",
      exclude: fields.exclude || "",
      editorNotes: fields.editorNotes || "",
    });
    if (!text.trim()) {
      setStatus("History entry is empty.", true);
      return;
    }
    copyText(text)
      .then(function () {
        setStatus("Copied history entry.");
      })
      .catch(function (error) {
        setStatus("Could not copy history entry: " + error.message, true);
      });
  }

  function deleteHistoryEntry(index) {
    var deleted = state.history[index];
    state.history.splice(index, 1);
    if (deleted && (deleted.id === state.historyCompare.aId || deleted.id === state.historyCompare.bId)) {
      clearHistoryCompareSelection(false);
    }
    saveHistoryForCue(state.cue);
    renderHistory();
    setStatus("Deleted history entry.");
  }

  function useHistoryCompareEntry(label) {
    var entries = historyCompareEntries();
    var entry = label === "A" ? entries.a : entries.b;
    if (!entry) {
      setStatus("Choose two Generate history entries before using a compare version.", true);
      return;
    }
    loadHistoryEntry(entry);
    setStatus("Loaded history compare version " + label + ".");
  }

  function askHistoryCompareReview() {
    var entries = historyCompareEntries();
    if (!entries.a || !entries.b) {
      setStatus("Choose two Generate history entries before asking for AI review.", true);
      return;
    }
    startProgress("准备 History 对比...");
    var messages = core.buildHistoryCompareReviewMessages(entries.a, entries.b);
    setBusy(true);
    updateProgress("发送给 DeepSeek 评审...");
    setStatus("Asking AI to compare history versions...");
    updateProgress("等待 DeepSeek 返回对比结论...", true);
    callDeepSeek(messages)
      .then(function (response) {
        updateProgress("解析对比结论...");
        state.historyCompare.review = core.normalizeHistoryCompareReviewJson(getAssistantContent(response));
        state.historyCompare.error = "";
        renderHistory();
        setStatus("History compare review is ready.");
        stopProgress("完成，已生成对比结论。");
      })
      .catch(function (error) {
        state.historyCompare.error = error.message;
        renderHistory();
        setStatus(error.message, true);
        stopProgress("评审失败，已保留对比内容。");
      })
      .finally(function () {
        setBusy(false);
      });
  }

  function cepRequire(name) {
    if (window.cep_node && window.cep_node.require) {
      return window.cep_node.require(name);
    }
    if (typeof window.require === "function") {
      return window.require(name);
    }
    return null;
  }

  function postJsonWithNode(url, apiKey, body) {
    return new Promise(function (resolve, reject) {
      var https = cepRequire("https");
      var urlModule = cepRequire("url");
      var bufferModule = cepRequire("buffer");
      var BufferCtor = window.Buffer || (bufferModule && bufferModule.Buffer);
      if (!https) {
        reject(new Error("Node https is unavailable in this CEP environment."));
        return;
      }
      if (!BufferCtor) {
        reject(new Error("Node Buffer is unavailable in this CEP environment."));
        return;
      }

      var parsed = typeof URL === "function" ? new URL(url) : new urlModule.URL(url);
      var payload = JSON.stringify(body);
      var request = https.request(
        {
          method: "POST",
          hostname: parsed.hostname,
          path: parsed.pathname + (parsed.search || ""),
          headers: {
            "Content-Type": "application/json",
            "Content-Length": BufferCtor.byteLength(payload),
            Authorization: "Bearer " + apiKey,
          },
        },
        function (response) {
          var chunks = "";
          response.on("data", function (chunk) {
            chunks += chunk;
          });
          response.on("end", function () {
            if (response.statusCode < 200 || response.statusCode >= 300) {
              reject(new Error("DeepSeek API returned HTTP " + response.statusCode + ": " + chunks));
              return;
            }
            try {
              resolve(core.parseDeepSeekApiJson(chunks));
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      request.on("error", reject);
      request.write(payload);
      request.end();
    });
  }

  function postJsonWithFetch(url, apiKey, body) {
    if (!window.fetch) {
      return Promise.reject(new Error("fetch is unavailable."));
    }
    return window
      .fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
        },
        body: JSON.stringify(body),
      })
      .then(function (response) {
        return response.text().then(function (text) {
          if (!response.ok) {
            throw new Error("DeepSeek API returned HTTP " + response.status + ": " + text);
          }
          return core.parseDeepSeekApiJson(text);
        });
      });
  }

  function callDeepSeek(messages) {
    var apiKey = getApiKey();
    if (!apiKey) {
      return Promise.reject(new Error("Enter a DeepSeek API key first."));
    }

    var body = core.buildDeepSeekRequest(messages, { model: state.model });
    var url = "https://api.deepseek.com/chat/completions";

    if (cep.hasCep()) {
      return postJsonWithNode(url, apiKey, body);
    }
    return postJsonWithFetch(url, apiKey, body);
  }

  function getAssistantContent(response) {
    if (!response || !response.choices || !response.choices[0] || !response.choices[0].message) {
      throw new Error("DeepSeek response did not include an assistant message.");
    }
    return response.choices[0].message.content || "";
  }

  function sampleCue() {
    return core.filterMarkersInRange({
      sequenceName: "Preview_Rooftop_Scene",
      inTime: "00:00:42.500",
      outTime: "00:01:58.000",
      inSeconds: 42.5,
      outSeconds: 118,
      markers: [
        {
          absoluteTime: "00:01:00.000",
          startSeconds: 60,
          endSeconds: 60,
          name: "Music enters",
          comments: "这里的音乐要慢慢的进，代表角色从压抑到打开",
        },
        {
          absoluteTime: "00:01:35.250",
          startSeconds: 95.25,
          endSeconds: 97.25,
          name: "Emotion rises",
          comments: "A restrained swell, not too melodramatic.",
        },
      ],
    });
  }

  function parseHostCue(result) {
    if (!result || result === "NO_CEP") {
      return sampleCue();
    }
    if (String(result).indexOf("EvalScript error") === 0) {
      throw new Error(result);
    }
    var parsed = JSON.parse(result);
    if (parsed.error) {
      throw new Error(parsed.error);
    }
    return core.filterMarkersInRange(parsed);
  }

  function escapeForExtendScript(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function evalHostCue() {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timeout = window.setTimeout(function () {
        if (!settled) {
          settled = true;
          reject(new Error("Premiere did not return timeline data within 6 seconds. Try Refresh Timeline again; if it repeats, reopen the panel."));
        }
      }, 6000);

      var hostPath = escapeForExtendScript(cep.getExtensionPath() + "/jsx/host.jsx");
      var script =
        '(function(){if(typeof SunoCueHost==="undefined"||!SunoCueHost.getActiveSequenceCue){$.evalFile("' +
        hostPath +
        '");}return SunoCueHost.getActiveSequenceCue();})()';

      cep.evalScript(script, function (result) {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        try {
          resolve(parseHostCue(result));
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  function refreshCue() {
    setBusy(true);
    setActivity("Reading timeline...");
    setTimelineStatus("Reading Premiere timeline...");
    setTimelineDiagnostics("", false);

    return new Promise(function (resolve) {
      if (!cep.hasCep()) {
        resolve(sampleCue());
        return;
      }
      resolve(evalHostCue());
    })
      .then(function (cue) {
        state.cue = cue;
        loadManualBriefForCue(cue);
        loadHistoryForCue(cue);
        renderCue();
        setTimelineStatus("Timeline loaded.");
        setTimelineDiagnostics(cue.diagnostics || "", false);
        return cue;
      })
      .catch(function (error) {
        setTimelineStatus(error.message, true);
        setTimelineDiagnostics(error.message, true);
      })
      .finally(function () {
        setBusy(false);
        setActivity("");
      });
  }

  function cueWithManualBrief() {
    var cue = state.cue;
    var manualBrief = $("manualBrief").value.trim();
    if (!cue && manualBrief) {
      cue = core.filterMarkersInRange({
        sequenceName: "Manual Scene Brief",
        inSeconds: 0,
        outSeconds: 60,
        markers: [{ startSeconds: 0, name: "Manual brief", comments: manualBrief }],
      });
    } else if (cue && manualBrief && (!cue.markers || cue.markers.length === 0)) {
      cue = Object.assign({}, cue, {
        markers: [{ relativeSeconds: 0, startSeconds: cue.inSeconds || 0, name: "Manual brief", comments: manualBrief, durationSeconds: 0 }],
        additionalContext: manualBrief,
      });
    } else if (cue && manualBrief) {
      cue = Object.assign({}, cue, {
        additionalContext: manualBrief,
      });
    }
    return cue;
  }

  function renderCue() {
    var cue = state.cue;
    if (!cue) {
      return;
    }
    setTextIfPresent("sequenceName", cue.sequenceName);
    setTextIfPresent("rangeText", (cue.inTime || cue.inSeconds + "s") + " - " + (cue.outTime || cue.outSeconds + "s"));
    setTextIfPresent("durationText", cue.durationSeconds + "s");
    setTextIfPresent("markerCount", cue.markers.length);
    $("timelineSummary").innerHTML =
      "<strong>" +
      escapeHtml(cue.sequenceName) +
      "</strong>" +
      ' <span class="readout-separator">|</span> ' +
      escapeHtml(cue.inTime || cue.inSeconds + "s") +
      " - " +
      escapeHtml(cue.outTime || cue.outSeconds + "s") +
      ' <span class="readout-separator">|</span> ' +
      escapeHtml(cue.durationSeconds + "s") +
      ' <span class="readout-separator">|</span> ' +
      escapeHtml(cue.markers.length + " markers");
    $("markerPreviewCount").textContent = cue.markers.length;
    $("markerPreview").innerHTML =
      cue.markers.length === 0
        ? "No markers loaded."
        : cue.markers
            .map(function (marker) {
              return (
                '<div class="marker-item"><strong>+' +
                marker.relativeSeconds +
                "s " +
                escapeHtml(marker.name || "Untitled marker") +
                "</strong><br>" +
                escapeHtml(marker.comments || "(empty comment)") +
                "</div>"
              );
            })
            .join("");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderQuestions() {
    $("interviewSection").classList.toggle("hidden", state.questions.length === 0);
    $("questionList").innerHTML = state.questions
      .map(function (item, index) {
        return (
          '<div class="question-card">' +
          "<p>" +
          escapeHtml(index + 1 + ". " + item.question) +
          "</p>" +
          '<textarea rows="2" data-question-index="' +
          index +
          '" placeholder="Your answer...">' +
          escapeHtml(item.answer || "") +
          "</textarea>" +
          "</div>"
        );
      })
      .join("");
  }

  function collectAnswers() {
    var answers = state.questions.slice();
    Array.prototype.forEach.call(document.querySelectorAll("[data-question-index]"), function (textarea) {
      var index = Number(textarea.getAttribute("data-question-index"));
      answers[index].answer = textarea.value.trim();
    });
    return answers;
  }

  function collectAvailableAnswers() {
    if (state.questions.length === 0) {
      return [];
    }
    return collectAnswers();
  }

  function collectAnsweredQuestions() {
    return collectAvailableAnswers().filter(function (item) {
      return item && item.answer;
    });
  }

  function closeInterview() {
    state.questions = [];
    renderQuestions();
  }

  function formatDateForSummary() {
    var date = new Date();
    function pad2(value) {
      return value < 10 ? "0" + value : String(value);
    }
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
  }

  function appendSummaryToAdditionalContext(summary) {
    var current = $("manualBrief").value.trim();
    var block = "[Grill me summary · " + formatDateForSummary() + "]\n" + summary.trim();
    $("manualBrief").value = current ? current + "\n\n" + block : block;
    saveManualBriefForCue();
  }

  function renderGenerated(fields) {
    state.generated = fields;
    $("titleOutput").value = fields.title || "";
    $("styleOutput").value = fields.style || "";
    $("lyricsOutput").value = [fields.prompt, fields.lyricsStructure].filter(Boolean).join("\n\n");
    $("excludeOutput").value = fields.exclude || "";
    $("notesOutput").value = fields.editorNotes || "";
  }

  function renderStyleVariants() {
    $("styleVariantsSection").classList.toggle("hidden", !state.styleVariants.length);
    $("styleVariantList").innerHTML = state.styleVariants
      .map(function (variant, index) {
        return (
          '<div class="variant-item" data-style-variant-index="' +
          index +
          '">' +
          '<div class="variant-head">' +
          '<div class="variant-title">' +
          escapeHtml(variant.name || "Style Option " + (index + 1)) +
          "</div>" +
          '<button type="button" data-style-variant-action="add-context">Add to Context</button>' +
          "</div>" +
          '<div class="variant-style">' +
          escapeHtml(variant.style || "") +
          "</div>" +
          (variant.rationale ? '<div class="variant-rationale">' + escapeHtml(variant.rationale) + "</div>" : "") +
          "</div>"
        );
      })
      .join("");
  }

  function askInterview() {
    startProgress("准备时间线和导演批注...");
    var cue = cueWithManualBrief();
    var validation = core.validateCueForGeneration(cue);
    if (!validation.ok) {
      stopProgress("");
      setStatus(validation.message, true);
      setTimelineStatus(validation.message, true);
      return;
    }

    updateProgress("整理成 AI 提问 brief...");
    var messages = core.buildInterviewMessages(cue);
    setBusy(true);
    updateProgress("发送给 DeepSeek...");
    setStatus("Asking AI for context questions...");
    updateProgress("等待 DeepSeek 返回中文问题...", true);
    callDeepSeek(messages)
      .then(function (response) {
        updateProgress("解析问题...");
        state.questions = core.normalizeInterviewJson(getAssistantContent(response));
        renderQuestions();
        if (state.questions.length) {
          setSectionOpen("manualBriefBody", "toggleManualBriefButton", true);
        }
        setStatus(state.questions.length ? "Answer the questions, then generate." : "AI returned no usable questions.", !state.questions.length);
        stopProgress("完成，可以回答问题了。");
      })
      .catch(function (error) {
        setStatus(error.message + " You can still use direct generation.", true);
        stopProgress("请求失败，已保留当前内容。");
      })
      .finally(function () {
        setBusy(false);
      });
  }

  function generateFields(useAnswers) {
    startProgress("准备 marker、brief 和回答...");
    var cue = cueWithManualBrief();
    var validation = core.validateCueForGeneration(cue);
    if (!validation.ok) {
      stopProgress("");
      setStatus(validation.message, true);
      setTimelineStatus(validation.message, true);
      return;
    }

    var answers = useAnswers ? collectAnswers() : [];
    updateProgress("套用 Engineer Prompt...");
    var messages = core.buildGenerationMessages(cue, answers, { generationSystemPrompt: getGenerationPromptTemplate() });
    setBusy(true);
    updateProgress("发送给 DeepSeek...");
    setStatus("Generating Suno fields...");
    updateProgress("等待 DeepSeek 生成 Suno fields...", true);
    callDeepSeek(messages)
      .then(function (response) {
        updateProgress("解析 JSON...");
        var fields = core.normalizeDeepSeekJson(getAssistantContent(response));
        updateProgress("写入 Suno Fields...");
        renderGenerated(fields);
        addHistoryEntry(useAnswers ? "Generate With Answers" : "Generate", currentSunoFields(), cue);
        if (useAnswers) {
          closeInterview();
        }
        setStatus("Generated. Edit or copy fields below.");
        stopProgress("完成，已写入 Suno Fields。");
      })
      .catch(function (error) {
        setStatus(error.message, true);
        stopProgress("请求失败，已保留当前内容。");
      })
      .finally(function () {
        setBusy(false);
      });
  }

  function generateStyleVariants() {
    startProgress("准备 marker 和当前 Suno fields...");
    var cue = cueWithManualBrief();
    var validation = core.validateCueForGeneration(cue);
    if (!validation.ok) {
      stopProgress("");
      setStatus(validation.message, true);
      setTimelineStatus(validation.message, true);
      return;
    }

    updateProgress("套用 Engineer Prompt...");
    var messages = core.buildStyleVariantMessages(cue, currentSunoFields(), {
      generationSystemPrompt: getGenerationPromptTemplate(),
    });
    setBusy(true);
    updateProgress("发送给 DeepSeek...");
    setStatus("Generating style variants...");
    updateProgress("等待 DeepSeek 生成 style variants...", true);
    callDeepSeek(messages)
      .then(function (response) {
        updateProgress("解析 style variants...");
        state.styleVariants = core.normalizeStyleVariantsJson(getAssistantContent(response));
        renderStyleVariants();
        if (state.styleVariants.length) {
          setSectionOpen("manualBriefBody", "toggleManualBriefButton", true);
        }
        setStatus(state.styleVariants.length ? "Choose a style direction to add into Additional Context." : "AI returned no usable style variants.", !state.styleVariants.length);
        stopProgress("完成，已生成 Style Variants。");
      })
      .catch(function (error) {
        setStatus(error.message, true);
        stopProgress("请求失败，已保留当前内容。");
      })
      .finally(function () {
        setBusy(false);
      });
  }

  function appendStyleVariantToAdditionalContext(index) {
    var variant = state.styleVariants[index];
    if (!variant) {
      return;
    }
    var current = $("manualBrief").value.trim();
    var lines = [
      "Style direction: " + (variant.name || "Style Option") + " — " + (variant.style || ""),
    ];
    if (variant.rationale) {
      lines.push("Why: " + variant.rationale);
    }
    $("manualBrief").value = current ? current + "\n\n" + lines.join("\n") : lines.join("\n");
    saveManualBriefForCue();
    setSectionOpen("manualBriefBody", "toggleManualBriefButton", true);
    setStatus("Added style direction to Additional Context. Use To LLM or Generate when ready.");
  }

  function saveInterviewSummaryToContext() {
    var answers = collectAnsweredQuestions();
    if (!answers.length) {
      setStatus("Answer at least one Grill me question before saving a summary.", true);
      return;
    }

    var cue = state.cue;
    if (!cue) {
      setStatus("Open or refresh a sequence before saving interview context.", true);
      return;
    }

    startProgress("整理采访回答...");
    var existingContext = $("manualBrief").value.trim();
    var messages = core.buildInterviewSummaryMessages(cue, existingContext, answers);
    if (!messages) {
      stopProgress("");
      setStatus("Answer at least one Grill me question before saving a summary.", true);
      return;
    }

    setBusy(true);
    updateProgress("发送给 DeepSeek 总结...");
    setStatus("Summarizing interview into Additional Context...");
    updateProgress("等待 DeepSeek 返回总结...", true);
    callDeepSeek(messages)
      .then(function (response) {
        updateProgress("追加到 Additional Context...");
        var summary = core.normalizeInterviewSummaryJson(getAssistantContent(response));
        if (!summary) {
          throw new Error("DeepSeek returned an empty interview summary.");
        }
        appendSummaryToAdditionalContext(summary);
        setSectionOpen("manualBriefBody", "toggleManualBriefButton", true);
        closeInterview();
        setStatus("Saved Grill me summary to Additional Context.");
        stopProgress("已保存到 Additional Context。");
      })
      .catch(function (error) {
        setStatus(error.message + " Existing Additional Context was not changed.", true);
        stopProgress("总结失败，已保留当前内容。");
      })
      .finally(function () {
        setBusy(false);
      });
  }

  function copyText(text) {
    function nodeClipboardCopy() {
      return new Promise(function (resolve, reject) {
        var childProcess = cepRequire("child_process");
        var processModule = cepRequire("process");
        var platform = (processModule && processModule.platform) || (window.process && window.process.platform);
        var command = platform === "win32" ? "clip" : platform === "darwin" ? "/usr/bin/pbcopy" : "xclip";

        if (!childProcess || !platform) {
          reject(new Error("Node clipboard access is unavailable."));
          return;
        }

        var child = childProcess.spawn(command);
        child.on("error", reject);
        child.on("close", function (code) {
          if (code !== 0) {
            reject(new Error(command + " exited with code " + code));
            return;
          }

          if (platform === "darwin" && childProcess.execFile) {
            childProcess.execFile("/usr/bin/pbpaste", function (error, stdout) {
              if (error) {
                reject(error);
              } else if (stdout === text) {
                resolve();
              } else {
                reject(new Error("Clipboard verification failed."));
              }
            });
          } else {
            resolve();
          }
        });
        child.stdin.write(text);
        child.stdin.end();
      });
    }

    function fallbackCopy() {
      var scratch = document.createElement("textarea");
      scratch.value = text;
      scratch.setAttribute("readonly", "readonly");
      scratch.style.position = "fixed";
      scratch.style.left = "-9999px";
      document.body.appendChild(scratch);
      scratch.select();
      var copied = document.execCommand("copy");
      document.body.removeChild(scratch);
      if (!copied) {
        return Promise.reject(new Error("Clipboard permission denied."));
      }
      return Promise.resolve();
    }

    if (cep.hasCep()) {
      return nodeClipboardCopy().catch(function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          return navigator.clipboard.writeText(text).catch(fallbackCopy);
        }
        return fallbackCopy();
      });
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(fallbackCopy);
    }
    return fallbackCopy();
  }

  function copyOutputField(button) {
    var targetId = button.getAttribute("data-copy-target");
    var label = button.getAttribute("data-copy-label") || "Field";
    var target = $(targetId);
    var value = target ? target.value : "";
    if (!value.trim()) {
      setStatus(label + " is empty.", true);
      return;
    }

    copyText(value)
      .then(function () {
        setStatus("Copied " + label + ".");
      })
      .catch(function (error) {
        setStatus("Could not copy " + label + ": " + error.message, true);
      });
  }

  function buildExternalPrompt() {
    var cue = cueWithManualBrief();
    var validation = core.validateCueForGeneration(cue);
    if (!validation.ok) {
      setStatus(validation.message, true);
      setTimelineStatus(validation.message, true);
      return "";
    }

    var prompt = core.buildExternalLlmPrompt(cue, collectAvailableAnswers(), {
      generationSystemPrompt: getGenerationPromptTemplate(),
      generationPromptSource: localStorage.getItem(PROMPT_MARKDOWN_PATH_KEY) || $("promptMarkdownPath").value,
    });
    setStatus("External prompt built with current Engineer Prompt. Copy it into GPT, Gemini, or another model.");
    return prompt;
  }

  function bindEvents() {
    $("toggleAiConfigButton").addEventListener("click", function () {
      toggleSection("aiConfigBody", "toggleAiConfigButton");
    });
    $("toggleEngineerPromptButton").addEventListener("click", function () {
      toggleSection("engineerPromptBody", "toggleEngineerPromptButton");
    });
    $("toggleManualBriefButton").addEventListener("click", function () {
      toggleSection("manualBriefBody", "toggleManualBriefButton");
    });
    $("toggleMarkerPreviewButton").addEventListener("click", function () {
      toggleSection("markerPreviewBody", "toggleMarkerPreviewButton");
    });
    $("toggleFieldDetailsButton").addEventListener("click", function () {
      toggleSection("fieldDetailsBody", "toggleFieldDetailsButton");
    });
    $("toggleHistoryButton").addEventListener("click", function () {
      toggleSection("historyBody", "toggleHistoryButton");
    });
    $("saveKeyButton").addEventListener("click", saveApiKeyPreference);
    $("savePromptTemplateButton").addEventListener("click", savePromptTemplatePreference);
    $("resetPromptTemplateButton").addEventListener("click", resetPromptTemplatePreference);
    $("browsePromptMarkdownButton").addEventListener("click", function () {
      if (!browsePromptMarkdownWithCep()) {
        browsePromptMarkdownFallback();
      }
    });
    $("recentPromptMarkdownButton").addEventListener("click", function () {
      setRecentPromptListOpen($("recentPromptMarkdownList").classList.contains("hidden"));
    });
    $("clearRecentPromptMarkdownButton").addEventListener("click", clearRecentPromptMarkdownFiles);
    $("recentPromptMarkdownList").addEventListener("click", function (event) {
      var button = event.target.closest("[data-recent-prompt-index]");
      if (!button) {
        return;
      }
      var item = getRecentPromptMarkdownFiles()[Number(button.getAttribute("data-recent-prompt-index"))];
      if (item && item.path) {
        $("promptMarkdownPath").value = item.path;
        loadPromptMarkdownPath(item.path);
      }
    });
    $("promptMarkdownPath").addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        loadPromptMarkdownPath($("promptMarkdownPath").value);
      }
    });
    $("promptMarkdownFileInput").addEventListener("change", function () {
      loadPromptMarkdownFileObject($("promptMarkdownFileInput").files && $("promptMarkdownFileInput").files[0]);
    });
    $("manualBrief").addEventListener("input", scheduleManualBriefSave);
    $("manualBrief").addEventListener("blur", flushManualBriefSave);
    window.addEventListener("beforeunload", flushManualBriefSave);
    $("refreshButton").addEventListener("click", refreshCue);
    $("interviewButton").addEventListener("click", askInterview);
    $("generateButton").addEventListener("click", function () {
      generateFields(false);
    });
    $("styleVariantsButton").addEventListener("click", generateStyleVariants);
    $("generateWithAnswersButton").addEventListener("click", function () {
      generateFields(true);
    });
    $("saveInterviewSummaryButton").addEventListener("click", saveInterviewSummaryToContext);
    $("clearInterviewButton").addEventListener("click", function () {
      state.questions = [];
      renderQuestions();
      setStatus("Interview cleared.");
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-copy-target]"), function (button) {
      button.addEventListener("click", function () {
        copyOutputField(button);
      });
    });
    $("clearStyleVariantsButton").addEventListener("click", function () {
      state.styleVariants = [];
      renderStyleVariants();
      setStatus("Style variants cleared.");
    });
    $("styleVariantList").addEventListener("click", function (event) {
      var button = event.target.closest("[data-style-variant-action]");
      if (!button) {
        return;
      }
      var card = event.target.closest("[data-style-variant-index]");
      appendStyleVariantToAdditionalContext(Number(card.getAttribute("data-style-variant-index")));
    });
    $("historyList").addEventListener("click", function (event) {
      var compareButton = event.target.closest("[data-history-compare-action]");
      if (compareButton) {
        var compareAction = compareButton.getAttribute("data-history-compare-action");
        if (compareAction === "use-a") {
          useHistoryCompareEntry("A");
        } else if (compareAction === "use-b") {
          useHistoryCompareEntry("B");
        } else if (compareAction === "review") {
          askHistoryCompareReview();
        } else if (compareAction === "clear") {
          clearHistoryCompareSelection();
          setStatus("History compare cleared.");
        }
        return;
      }

      var button = event.target.closest("[data-history-action]");
      if (!button) {
        return;
      }
      var card = event.target.closest("[data-history-index]");
      var index = Number(card.getAttribute("data-history-index"));
      var entry = state.history[index];
      var action = button.getAttribute("data-history-action");
      if (action === "load") {
        loadHistoryEntry(entry);
      } else if (action === "copy") {
        copyHistoryEntry(entry);
      } else if (action === "compare") {
        selectHistoryCompareEntry(entry);
      } else if (action === "delete") {
        deleteHistoryEntry(index);
      }
    });
    $("copyExternalPromptButton").addEventListener("click", function () {
      startProgress("整理外部 LLM prompt...");
      var text = buildExternalPrompt();
      if (!text) {
        stopProgress("");
        return;
      }
      addHistoryEntry("To LLM", { externalPrompt: text, title: "External LLM Prompt" }, cueWithManualBrief());
      copyText(text).then(function () {
        setStatus("Copied To LLM prompt to clipboard.");
        setTimelineStatus("Copied To LLM prompt. Paste it into Gemini, GPT, or another model.");
        stopProgress("已复制。");
      }).catch(function (error) {
        setStatus("Could not copy automatically: " + error.message, true);
        setTimelineStatus("Copy failed. Please try To LLM again.", true);
        stopProgress("复制失败。");
      });
    });
  }

  function init() {
    $("modelName").textContent = state.model;
    loadApiKeyPreference();
    loadPromptTemplatePreference();
    loadPromptMarkdownPreference();
    bindEvents();

    refreshCue();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
