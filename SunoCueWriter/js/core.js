(function (root, factory) {
  var api = factory();
  root.SunoCueCore = api;
  if (typeof window !== "undefined") {
    window.SunoCueCore = api;
  }
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function roundSeconds(value) {
    return Math.round(Number(value || 0) * 1000) / 1000;
  }

  function filterMarkersInRange(rawCue) {
    var inSeconds = Number(rawCue.inSeconds);
    var outSeconds = Number(rawCue.outSeconds);
    var durationSeconds = roundSeconds(outSeconds - inSeconds);

    var markers = (rawCue.markers || [])
      .filter(function (marker) {
        var startSeconds = Number(marker.startSeconds);
        return startSeconds >= inSeconds && startSeconds <= outSeconds;
      })
      .map(function (marker) {
        var startSeconds = Number(marker.startSeconds);
        var endSeconds = Number(marker.endSeconds || marker.startSeconds || 0);
        return {
          absoluteTime: marker.absoluteTime || "",
          relativeSeconds: roundSeconds(startSeconds - inSeconds),
          startSeconds: roundSeconds(startSeconds),
          durationSeconds: Math.max(0, roundSeconds(endSeconds - startSeconds)),
          name: marker.name || "",
          comments: marker.comments || "",
          type: marker.type || "Comment",
        };
      });

    return {
      projectPath: rawCue.projectPath || "",
      projectName: rawCue.projectName || "",
      sequenceName: rawCue.sequenceName || "Untitled sequence",
      inTime: rawCue.inTime || "",
      outTime: rawCue.outTime || "",
      inSeconds: roundSeconds(inSeconds),
      outSeconds: roundSeconds(outSeconds),
      durationSeconds: durationSeconds,
      markers: markers,
      diagnostics: rawCue.diagnostics || "",
    };
  }

  function stripJsonFence(text) {
    return String(text || "")
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
  }

  function normalizeDeepSeekJson(text) {
    var parsed = typeof text === "string" ? JSON.parse(stripJsonFence(text)) : text || {};
    return {
      title: parsed.title || "",
      prompt: parsed.prompt || "",
      style: parsed.style || "",
      lyricsStructure: parsed.lyricsStructure || parsed.lyrics || "",
      exclude: parsed.exclude || "",
      editorNotes: parsed.editorNotes || "",
    };
  }

  function parseDeepSeekApiJson(text) {
    try {
      return JSON.parse(String(text || ""));
    } catch (error) {
      throw new Error("DeepSeek returned invalid JSON response.");
    }
  }

  function normalizeInterviewJson(payload) {
    var parsed = typeof payload === "string" ? JSON.parse(stripJsonFence(payload)) : payload || {};
    return (parsed.questions || [])
      .filter(function (item) {
        return item && String(item.question || "").trim().length > 0;
      })
      .slice(0, 4)
      .map(function (item, index) {
        return {
          id: item.id || "question_" + (index + 1),
          question: String(item.question || "").trim(),
          answer: item.answer || "",
        };
      });
  }

  function normalizeInterviewSummaryJson(payload) {
    var parsed = typeof payload === "string" ? JSON.parse(stripJsonFence(payload)) : payload || {};
    return String(parsed.summary || "").trim();
  }

  function extractPromptFromMarkdown(markdownText) {
    var text = String(markdownText || "").replace(/\r\n/g, "\n");
    var fencePattern = /(^|\n)(```|~~~)[^\n]*\n([\s\S]*?)\n\2(?=\n|$)/g;
    var match;
    while ((match = fencePattern.exec(text))) {
      var block = String(match[3] || "").trim();
      if (block) {
        return block;
      }
    }

    return text
      .replace(/^---\n[\s\S]*?\n---\n?/, "")
      .split("\n")
      .filter(function (line) {
        return !/^\s{0,3}#{1,6}\s+/.test(line);
      })
      .join("\n")
      .trim();
  }

  function assertPromptMarkdownSize(markdownText, maxCharacters) {
    var text = String(markdownText || "");
    var limit = maxCharacters || 1024 * 1024;
    if (text.length > limit) {
      throw new Error("Markdown prompt file is too large. Choose a smaller prompt file.");
    }
    return text;
  }

  function promptFileNameFromPath(path) {
    return String(path || "")
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() || "";
  }

  function normalizeRecentPromptFiles(list, nextFile) {
    var items = [];
    if (nextFile && nextFile.path) {
      items.push({
        path: String(nextFile.path),
        name: String(nextFile.name || promptFileNameFromPath(nextFile.path) || nextFile.path),
        lastLoadedAt: nextFile.lastLoadedAt || Date.now(),
      });
    }

    (list || []).forEach(function (item) {
      if (!item || !item.path) {
        return;
      }
      items.push({
        path: String(item.path),
        name: String(item.name || promptFileNameFromPath(item.path) || item.path),
        lastLoadedAt: item.lastLoadedAt || 0,
      });
    });

    var seen = {};
    return items
      .filter(function (item) {
        if (seen[item.path]) {
          return false;
        }
        seen[item.path] = true;
        return true;
      })
      .slice(0, 5);
  }

  function buildDeepSeekRequest(messages, options) {
    var settings = options || {};
    return {
      model: settings.model || "deepseek-v4-pro",
      messages: messages,
      response_format: { type: "json_object" },
      stream: false,
    };
  }

  function validateCueForGeneration(cue) {
    if (!cue) {
      return {
        ok: false,
        code: "NO_SEQUENCE",
        message: "Open a sequence first.",
      };
    }

    if (!isFinite(Number(cue.inSeconds)) || !isFinite(Number(cue.outSeconds)) || Number(cue.outSeconds) <= Number(cue.inSeconds)) {
      return {
        ok: false,
        code: "MISSING_IN_OUT",
        message: "Set a valid sequence In/Out range before generating.",
      };
    }

    if (!cue.markers || cue.markers.length === 0) {
      return {
        ok: false,
        code: "NO_MARKERS",
        message: "No timeline markers were found in the active In/Out range. Add a manual scene brief or set markers first.",
      };
    }

    return { ok: true };
  }

  function cueSummary(cue) {
    var lines = [
      "Sequence: " + (cue.sequenceName || "Untitled sequence"),
      "Duration seconds: " + roundSeconds(cue.durationSeconds || 0),
      "Markers:",
    ];

    (cue.markers || []).forEach(function (marker, index) {
      lines.push(
        [
          index + 1 + ".",
          "[" + roundSeconds(marker.relativeSeconds || 0) + "s]",
          marker.name ? "Name: " + marker.name + "." : "",
          marker.comments ? "Comments: " + marker.comments : "Comments: (empty)",
        ]
          .filter(Boolean)
          .join(" "),
      );
    });

    if (cue.additionalContext) {
      lines.push("", "Additional context from editor:", cue.additionalContext);
    }

    return lines.join("\n");
  }

  function buildInterviewMessages(cue) {
    return [
      {
        role: "system",
        content:
          "You are a film music supervisor preparing a short cue brief. Ask in Chinese. Ask only high-value questions that reveal missing context for a Suno music cue. Avoid music-theory, orchestration, and technical production questions unless the notes clearly invite them. Use plain questions a director or editor can answer about story intention, character point of view, audience feeling, narrative emphasis, pacing, vocals, and things to avoid. Return strict JSON only.",
      },
      {
        role: "user",
        content:
          "From this Premiere marker brief, ask 2-4 concise questions in Chinese. 用中文提问。Ask about what the comments and brief do not already explain. Focus on missing direction and intent: what the audience should feel, whose inner experience the cue follows, what should be emphasized or held back, whether the music should be noticed or stay underneath, whether vocals/lyrics are desired, and any taboo moods or sounds. Do not ask the user to choose instruments, harmony, rhythm, or music-production details unless they already mentioned those. Do not answer the questions. Return JSON as {\"questions\":[{\"id\":\"snake_case\",\"question\":\"...\"}]}.\n\n" +
          cueSummary(cue),
      },
    ];
  }

  function answeredInterviewItems(interviewAnswers) {
    return (interviewAnswers || []).filter(function (item) {
      return item && String(item.answer || "").trim().length > 0;
    });
  }

  function buildInterviewSummaryMessages(cue, existingContext, interviewAnswers) {
    var answered = answeredInterviewItems(interviewAnswers);
    if (!answered.length) {
      return null;
    }

    var answers = answered
      .map(function (item, index) {
        return index + 1 + ". Q: " + item.question + "\nA: " + item.answer;
      })
      .join("\n\n");

    return [
      {
        role: "system",
        content:
          "You are a film music supervisor summarizing editor interview answers into reusable cue context. Write concise context that can be reused later for Suno prompt generation. Focus on director intention, audience emotion, music requirements, vocal/lyrics direction, avoidance notes, sound-design handoffs, and local production constraints. Return strict JSON only.",
      },
      {
        role: "user",
        content:
          "Summarize only the new information from this Grill me interview into 3-6 concise bullet points for Additional Context. Focus on director intention, audience emotion, music requirements, vocal/lyrics direction, avoidance notes, sound-design handoffs, and local production constraints. Use Existing Additional Context only to avoid repeating it. Do not summarize, rewrite, or include existing context unless an interview answer changes or clarifies it. Do not preserve raw Q&A. Write in Chinese unless a short English music term is clearer. Return JSON as {\"summary\":\"- ...\\n- ...\"}.\n\n" +
          "Existing Additional Context:\n" +
          (existingContext || "(empty)") +
          "\n\nPremiere cue context:\n" +
          cueSummary(cue) +
          "\n\nInterview answers:\n" +
          answers,
      },
    ];
  }

  function defaultGenerationSystemPrompt() {
    return [
      "You are a film music supervisor and Suno Advanced/Custom Mode prompt engineer.",
      "",
      "Convert Premiere timeline markers, director comments, and optional editor answers into concise English fields for Suno. The cue is usually for picture, and marker comments often describe story action, character psychology, and the emotion the audience should feel rather than direct music terminology.",
      "",
      "First infer each marker's narrative beat, character point of view, audience emotion, and energy change. Then translate those abstractions into musical behavior: instrumentation, texture, harmony, rhythm, density, register, dynamics, tempo feel, and transitions. Do not merely repeat plot or feelings in the Suno fields; turn them into playable music direction.",
      "",
      "Write for these Suno fields:",
      "",
      "- Lyrics: by default, assume this is an instrumental cue and do not write sung lyrics. For instrumental cues, use bracketed arrangement guidance and cue-map language, such as [Instrumental], [restrained intro], [slow emotional build], [soft resolve]. Include approximate relative timings only as creative guidance, not as promises Suno can hit exactly. If the user explicitly asks for vocals, a song, or lyrics, then write concise singable lyrics that follow the scene's emotional point of view, and still use bracketed section tags where helpful.",
      "- Styles: write a compact comma-separated style prompt covering genre/subgenre, mood, tempo feel, core instruments, production texture, and cinematic function. Avoid vague filler.",
      "- Exclude Styles: list concrete things to avoid, such as vocals, pop hook, heavy drums, bright comedy tone, distorted guitars, choir, trap drums, or any unwanted instruments/styles inferred from the brief.",
      "- Song Title (Optional): short and evocative.",
      "- AI Notes: briefly explain interpretation choices, timing caveats, and any uncertainty.",
      "",
      "Rules:",
      "- Final Suno-facing fields must be in English, even if source comments are Chinese.",
      "- Prefer specific musical behavior over abstract adjectives: what enters, what recedes, what builds, what should stay restrained, what becomes denser or thinner, and how transitions should feel.",
      "- Keep outputs usable for copy-paste into Suno without extra explanation inside the Suno fields.",
      "- Return strict JSON only with keys: title, prompt, style, lyricsStructure, exclude, editorNotes.",
    ].join("\n");
  }

  function generationSystemPrompt(options) {
    var settings = options || {};
    return settings.generationSystemPrompt || defaultGenerationSystemPrompt();
  }

  function externalGenerationGuidancePrompt(options) {
    return generationSystemPrompt(options)
      .split("\n")
      .filter(function (line) {
        return !/return strict json only/i.test(line);
      })
      .join("\n")
      .trim();
  }

  function generationPromptSourceLine(options) {
    var settings = options || {};
    var name = promptFileNameFromPath(settings.generationPromptSource || "");
    return name ? "Engineer prompt source: " + name : "";
  }

  function buildGenerationMessages(cue, interviewAnswers, options) {
    var answers = (interviewAnswers || [])
      .filter(function (item) {
        return item && item.answer;
      })
      .map(function (item, index) {
        return index + 1 + ". Q: " + item.question + "\nA: " + item.answer;
      })
      .join("\n\n");

    return [
      {
        role: "system",
        content: generationSystemPrompt(options),
      },
      {
        role: "user",
        content:
          "Generate internal JSON fields with keys title, prompt, style, lyricsStructure, exclude, editorNotes. The UI will combine prompt and lyricsStructure into Suno's Lyrics field. The lyricsStructure field should use bracketed instrumental arrangement guidance such as [Instrumental] [0:00 restrained intro].\n\n" +
          cueSummary(cue) +
          (answers ? "\n\nAdditional context from editor:\n" + answers : ""),
      },
    ];
  }

  function formatInterviewAnswers(interviewAnswers) {
    var answers = (interviewAnswers || [])
      .filter(function (item) {
        return item && item.answer;
      })
      .map(function (item, index) {
        return index + 1 + ". " + item.answer;
      });

    return answers.join("\n");
  }

  function externalCueContext(cue) {
    var range = (cue.inTime || cue.inSeconds + "s") + " - " + (cue.outTime || cue.outSeconds + "s");
    var lines = [
      "Sequence: " + (cue.sequenceName || "Untitled sequence"),
      "In/Out range: " + range,
      "Duration seconds: " + roundSeconds(cue.durationSeconds || 0),
      "",
      "Markers:",
    ];

    (cue.markers || []).forEach(function (marker, index) {
      lines.push(
        [
          index + 1 + ".",
          "[" + roundSeconds(marker.relativeSeconds || 0) + "s]",
          marker.name ? "Name: " + marker.name + "." : "",
          marker.comments ? "Comments: " + marker.comments : "Comments: (empty)",
        ]
          .filter(Boolean)
          .join(" "),
      );
    });

    if (cue.additionalContext) {
      lines.push("", "Additional context from editor:", cue.additionalContext);
    }

    return lines.join("\n");
  }

  function buildExternalLlmPrompt(cue, interviewAnswers, options) {
    var formattedInterviewAnswers = formatInterviewAnswers(interviewAnswers);
    var sourceLine = generationPromptSourceLine(options);
    var parts = [
      "You are generating text for Suno's current Advanced Create UI.",
      "",
      "Important output format:",
      "- Do not return JSON, Markdown tables, or a code block.",
      "- Return plain text only, using exactly these field labels: Lyrics, Styles, Exclude Styles, Song Title (Optional), AI Notes.",
      "- The first four fields should be directly copyable into Suno's Lyrics, Styles, Exclude styles, and Song Title inputs.",
      "",
      "Engineer guidance:",
      sourceLine,
      externalGenerationGuidancePrompt(options),
      "",
      "Task:",
      "Use the included Premiere marker data and director notes to generate Suno Advanced/Custom Mode fields. Translate scene action, character psychology, and intended audience emotion into concrete musical instructions. The source comments may be in Chinese or English, but your final Suno fields should be concise, production-oriented English.",
      "",
      "Constraints:",
      "- Do not write sung lyrics unless the context explicitly asks for a song with vocals.",
      "- Treat timeline timestamps as emotional and arrangement guidance, not as timing guarantees Suno can obey perfectly.",
      "- Preserve the director's emotional arc and important hit points.",
      "- Convert narrative and emotional descriptions into musical parameters such as instrumentation, texture, harmony, rhythm, density, register, dynamics, tempo feel, and transitions.",
      "- Prefer clear genre, mood, instrumentation, dynamics, tempo feel, and arrangement language over vague adjectives.",
      "",
      "Premiere cue context:",
      externalCueContext(cue),
    ];

    if (formattedInterviewAnswers) {
      parts = parts.concat(["", "Additional context from editor interview:", formattedInterviewAnswers]);
    }

    return parts.concat([
      "",
      "Return the result as plain text in this exact structure:",
      "",
      "Lyrics:",
      "<combine a compact cue prompt with instrumental structure guidance. Include bracketed arrangement tags when useful, for example [Instrumental] [0:00 restrained intro]>",
      "",
      "Styles:",
      "<comma-separated Suno style text: genre, instrumentation, mood, tempo feel, production texture>",
      "",
      "Exclude Styles:",
      "<things Suno should avoid, such as vocals, pop hook, heavy drums, bright comedy tone>",
      "",
      "Song Title (Optional):",
      "<short cue title>",
      "",
      "AI Notes:",
      "<brief internal note about interpretation choices and any timing caveats>",
    ]).join("\n");
  }

  function formatCueText(fields) {
    var lyrics = [fields.prompt, fields.lyricsStructure].filter(Boolean).join("\n\n");
    return [
      ["Lyrics", lyrics],
      ["Styles", fields.style],
      ["Exclude Styles", fields.exclude],
      ["Song Title (Optional)", fields.title],
      ["AI Notes", fields.editorNotes],
    ]
      .filter(function (pair) {
        return pair[1] !== undefined && pair[1] !== null && String(pair[1]).length > 0;
      })
      .map(function (pair) {
        return pair[0] + ":\n" + pair[1];
      })
      .join("\n\n");
  }

  function additionalContextStorageKey(cue) {
    var projectKey = cue.projectPath || cue.projectName || cue.sequenceName || "Unknown project";
    return ["sunoCueWriter.additionalContext", projectKey].join("::");
  }

  function historyStorageKey(cue) {
    var projectKey = (cue && (cue.projectPath || cue.projectName || cue.sequenceName)) || "Unknown project";
    return ["sunoCueWriter.history", projectKey].join("::");
  }

  function cueRangeText(cue) {
    if (!cue) {
      return "";
    }
    return (cue.inTime || roundSeconds(cue.inSeconds || 0) + "s") + " - " + (cue.outTime || roundSeconds(cue.outSeconds || 0) + "s");
  }

  function createHistoryId(createdAt) {
    return "history_" + String(createdAt || new Date().toISOString()).replace(/[^0-9a-z]/gi, "");
  }

  function normalizeHistoryFields(fields) {
    var source = fields || {};
    var normalized = {
      lyrics: String(source.lyrics || [source.prompt, source.lyricsStructure].filter(Boolean).join("\n\n") || ""),
      style: String(source.style || ""),
      exclude: String(source.exclude || ""),
      title: String(source.title || ""),
      editorNotes: String(source.editorNotes || source.notes || ""),
    };
    if (source.externalPrompt) {
      normalized.externalPrompt = String(source.externalPrompt);
    }
    return normalized;
  }

  function createHistoryEntry(cue, fields, options) {
    var settings = options || {};
    var createdAt = settings.createdAt || new Date().toISOString();
    return {
      id: settings.id || createHistoryId(createdAt),
      createdAt: createdAt,
      method: settings.method || "Generate",
      sequenceName: (cue && cue.sequenceName) || "Untitled sequence",
      range: cueRangeText(cue),
      durationSeconds: roundSeconds((cue && cue.durationSeconds) || 0),
      markerCount: ((cue && cue.markers) || []).length,
      promptSourceName: promptFileNameFromPath(settings.promptSource || ""),
      additionalContext: String((cue && cue.additionalContext) || ""),
      markers: ((cue && cue.markers) || []).map(function (marker) {
        return {
          relativeSeconds: roundSeconds(marker.relativeSeconds || 0),
          name: marker.name || "",
          comments: marker.comments || "",
        };
      }),
      fields: normalizeHistoryFields(fields),
    };
  }

  function normalizeHistoryEntries(list, nextEntry, maxEntries) {
    var limit = maxEntries || 20;
    var items = [];
    if (nextEntry && nextEntry.id) {
      items.push(nextEntry);
    }
    (list || []).forEach(function (entry) {
      if (entry && entry.id) {
        items.push(entry);
      }
    });

    var seen = {};
    return items
      .filter(function (entry) {
        if (seen[entry.id]) {
          return false;
        }
        seen[entry.id] = true;
        return true;
      })
      .sort(function (a, b) {
        return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
      })
      .slice(0, limit);
  }

  function legacyAdditionalContextStorageKey(cue) {
    var projectKey = cue.projectPath || cue.projectName || "Unknown project";
    var sequenceKey = cue.sequenceName || "Untitled sequence";
    var inKey = cue.inTime || String(roundSeconds(cue.inSeconds || 0));
    var outKey = cue.outTime || String(roundSeconds(cue.outSeconds || 0));
    return ["sunoCueWriter.additionalContext", projectKey, sequenceKey, inKey, outKey].join("::");
  }

  function currentFieldsSummary(fields) {
    var source = fields || {};
    return [
      "Lyrics:\n" + (source.lyrics || ""),
      "Styles:\n" + (source.style || ""),
      "Exclude Styles:\n" + (source.exclude || ""),
      "Song Title:\n" + (source.title || ""),
    ].join("\n\n");
  }

  function buildStyleVariantMessages(cue, currentFields, options) {
    return [
      {
        role: "system",
        content:
          "You are a Suno style palette consultant for film music cues. Generate distinct, concise Suno Styles options. Keep each option focused and practical. Return strict JSON only.",
      },
      {
        role: "user",
        content:
          "Generate exactly 3 alternative Styles options for this cue. Do not rewrite Lyrics. Do not change the story or cue map. Each option should represent a distinct usable musical direction, such as safer cinematic, darker textural, or more song-like/vocal when appropriate. Keep each style as comma-separated Suno style text with 1-3 genre/subgenre tags plus a few mood, instrumentation, production texture, vocal presence, tempo feel, or cinematic function tags. Avoid long paragraphs.\n\n" +
          "Engineer Prompt currently in use:\n" +
          externalGenerationGuidancePrompt(options) +
          "\n\nPremiere cue context:\n" +
          externalCueContext(cue) +
          "\n\nCurrent Suno fields:\n" +
          currentFieldsSummary(currentFields) +
          '\n\nReturn JSON as {"variants":[{"name":"Safe Cinematic","style":"...","rationale":"short note"},{"name":"Dark Texture","style":"...","rationale":"short note"},{"name":"Song-like Vocal","style":"...","rationale":"short note"}]}.',
      },
    ];
  }

  function normalizeStyleVariantsJson(payload) {
    var parsed = typeof payload === "string" ? JSON.parse(stripJsonFence(payload)) : payload || {};
    return (parsed.variants || [])
      .filter(function (item) {
        return item && String(item.style || "").trim();
      })
      .slice(0, 3)
      .map(function (item, index) {
        return {
          id: item.id || "style_variant_" + (index + 1),
          name: String(item.name || "Style Option " + (index + 1)).trim(),
          style: String(item.style || "").trim(),
          rationale: String(item.rationale || item.notes || "").trim(),
        };
      });
  }

  return {
    filterMarkersInRange: filterMarkersInRange,
    normalizeDeepSeekJson: normalizeDeepSeekJson,
    parseDeepSeekApiJson: parseDeepSeekApiJson,
    normalizeInterviewJson: normalizeInterviewJson,
    normalizeInterviewSummaryJson: normalizeInterviewSummaryJson,
    buildDeepSeekRequest: buildDeepSeekRequest,
    validateCueForGeneration: validateCueForGeneration,
    buildInterviewMessages: buildInterviewMessages,
    buildInterviewSummaryMessages: buildInterviewSummaryMessages,
    buildGenerationMessages: buildGenerationMessages,
    buildExternalLlmPrompt: buildExternalLlmPrompt,
    defaultGenerationSystemPrompt: defaultGenerationSystemPrompt,
    formatCueText: formatCueText,
    extractPromptFromMarkdown: extractPromptFromMarkdown,
    assertPromptMarkdownSize: assertPromptMarkdownSize,
    promptFileNameFromPath: promptFileNameFromPath,
    normalizeRecentPromptFiles: normalizeRecentPromptFiles,
    historyStorageKey: historyStorageKey,
    createHistoryEntry: createHistoryEntry,
    normalizeHistoryEntries: normalizeHistoryEntries,
    buildStyleVariantMessages: buildStyleVariantMessages,
    normalizeStyleVariantsJson: normalizeStyleVariantsJson,
    additionalContextStorageKey: additionalContextStorageKey,
    legacyAdditionalContextStorageKey: legacyAdditionalContextStorageKey,
  };
});
