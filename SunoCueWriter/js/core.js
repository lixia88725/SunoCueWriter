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

    return lines.join("\n");
  }

  function buildInterviewMessages(cue) {
    return [
      {
        role: "system",
        content:
          "You are a film music supervisor preparing a short cue brief. Ask only high-value questions that reveal missing context for a Suno music cue. Return strict JSON only.",
      },
      {
        role: "user",
        content:
          "From this Premiere marker brief, ask 2-4 concise questions about missing emotional, narrative, sonic, or avoidance context. Do not answer the questions. Return JSON as {\"questions\":[{\"id\":\"snake_case\",\"question\":\"...\"}]}.\n\n" +
          cueSummary(cue),
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
        return index + 1 + ". Q: " + item.question + "\n   A: " + item.answer;
      });

    return answers.length ? answers.join("\n") : "No additional interview answers provided.";
  }

  function buildExternalLlmPrompt(cue, interviewAnswers, options) {
    var range = (cue.inTime || cue.inSeconds + "s") + " - " + (cue.outTime || cue.outSeconds + "s");
    return [
      generationSystemPrompt(options),
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
      "Sequence: " + (cue.sequenceName || "Untitled sequence"),
      "In/Out range: " + range,
      "Duration seconds: " + roundSeconds(cue.durationSeconds || 0),
      "",
      cueSummary(cue),
      "",
      "Additional context from editor interview:",
      formatInterviewAnswers(interviewAnswers),
      "",
      "Return the result in this exact structure:",
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
    ].join("\n");
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

  return {
    filterMarkersInRange: filterMarkersInRange,
    normalizeDeepSeekJson: normalizeDeepSeekJson,
    normalizeInterviewJson: normalizeInterviewJson,
    buildDeepSeekRequest: buildDeepSeekRequest,
    validateCueForGeneration: validateCueForGeneration,
    buildInterviewMessages: buildInterviewMessages,
    buildGenerationMessages: buildGenerationMessages,
    buildExternalLlmPrompt: buildExternalLlmPrompt,
    defaultGenerationSystemPrompt: defaultGenerationSystemPrompt,
    formatCueText: formatCueText,
  };
});
