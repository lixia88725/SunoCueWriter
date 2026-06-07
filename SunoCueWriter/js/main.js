(function () {
  "use strict";

  var core = window.SunoCueCore;
  var cep = window.SunoCueCEP;
  var state = {
    cue: null,
    questions: [],
    generated: {},
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
    ["generateButton", "interviewButton", "generateWithAnswersButton", "refreshButton"].forEach(function (id) {
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
    var body = $(bodyId);
    var button = $(buttonId);
    var willShow = body.classList.contains("hidden");
    body.classList.toggle("hidden", !willShow);
    button.classList.toggle("is-open", willShow);
    button.setAttribute("aria-expanded", willShow ? "true" : "false");
  }

  function getGenerationPromptTemplate() {
    return $("generationPromptTemplate").value.trim() || core.defaultGenerationSystemPrompt();
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

  function loadManualBriefForCue(cue) {
    flushManualBriefSave();
    manualBriefState.storageKey = cue ? core.additionalContextStorageKey(cue) : "";
    $("manualBrief").value = manualBriefState.storageKey ? localStorage.getItem(manualBriefState.storageKey) || "" : "";
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
            resolve(JSON.parse(chunks));
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
          return JSON.parse(text);
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
      });
    } else if (cue && manualBrief) {
      cue = Object.assign({}, cue, {
        markers: cue.markers.concat([{ relativeSeconds: 0, startSeconds: cue.inSeconds || 0, name: "Additional context", comments: manualBrief, durationSeconds: 0 }]),
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

  function renderGenerated(fields) {
    state.generated = fields;
    $("titleOutput").value = fields.title || "";
    $("styleOutput").value = fields.style || "";
    $("lyricsOutput").value = [fields.prompt, fields.lyricsStructure].filter(Boolean).join("\n\n");
    $("excludeOutput").value = fields.exclude || "";
    $("notesOutput").value = fields.editorNotes || "";
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

  function showExternalPromptForManualCopy() {
    $("externalPromptFallback").classList.remove("hidden");
    $("externalPromptOutput").focus();
    $("externalPromptOutput").select();
  }

  function buildExternalPrompt() {
    var cue = cueWithManualBrief();
    var validation = core.validateCueForGeneration(cue);
    if (!validation.ok) {
      setStatus(validation.message, true);
      setTimelineStatus(validation.message, true);
      return "";
    }

    var prompt = core.buildExternalLlmPrompt(cue, collectAvailableAnswers(), { generationSystemPrompt: getGenerationPromptTemplate() });
    $("externalPromptOutput").value = prompt;
    setStatus("External LLM prompt built. Copy it into GPT, Gemini, or another model.");
    return prompt;
  }

  function exportExternalPrompt() {
    var text = $("externalPromptOutput").value || buildExternalPrompt();
    if (!text) {
      return;
    }
    var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "external-suno-prompt-" + Date.now() + ".txt";
    link.click();
    URL.revokeObjectURL(link.href);
    setStatus("Exported external LLM prompt.");
  }

  function bindEvents() {
    $("toggleAiConfigButton").addEventListener("click", function () {
      toggleSection("aiConfigBody", "toggleAiConfigButton");
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
    $("saveKeyButton").addEventListener("click", saveApiKeyPreference);
    $("savePromptTemplateButton").addEventListener("click", savePromptTemplatePreference);
    $("resetPromptTemplateButton").addEventListener("click", resetPromptTemplatePreference);
    $("manualBrief").addEventListener("input", scheduleManualBriefSave);
    $("manualBrief").addEventListener("blur", flushManualBriefSave);
    window.addEventListener("beforeunload", flushManualBriefSave);
    $("refreshButton").addEventListener("click", refreshCue);
    $("interviewButton").addEventListener("click", askInterview);
    $("generateButton").addEventListener("click", function () {
      generateFields(false);
    });
    $("generateWithAnswersButton").addEventListener("click", function () {
      generateFields(true);
    });
    $("clearInterviewButton").addEventListener("click", function () {
      state.questions = [];
      renderQuestions();
      setStatus("Interview cleared.");
    });
    $("copyExternalPromptButton").addEventListener("click", function () {
      startProgress("整理外部 LLM prompt...");
      var text = buildExternalPrompt();
      if (!text) {
        stopProgress("");
        return;
      }
      showExternalPromptForManualCopy();
      copyText(text).then(function () {
        setStatus("Copied external LLM prompt. It is also selected below.");
        setTimelineStatus("External prompt copied and selected below. Paste it into Gemini, GPT, or another model.");
        stopProgress("已复制。");
      }).catch(function (error) {
        setStatus("Could not copy automatically: " + error.message, true);
        setTimelineStatus("Automatic copy failed. The prompt is selected below; press Command+C to copy it manually.", true);
        stopProgress("自动复制失败，已选中文本。");
      });
    });
  }

  function init() {
    $("modelName").textContent = state.model;
    loadApiKeyPreference();
    loadPromptTemplatePreference();
    bindEvents();

    refreshCue();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
