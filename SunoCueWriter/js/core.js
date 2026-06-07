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
      "Convert Premiere timeline markers, director comments, additional context, and optional editor answers into concise English fields for Suno. The source notes usually describe story action, character psychology, intended audience emotion, vocal direction, arrangement notes, sound-design handoffs, or local production constraints rather than direct music terminology.",
      "",
      "Infer the cue's overall emotional arc, then read each marker as a cue instruction: it may describe an emotional or narrative turning point, a vocal/lyrics instruction, an arrangement note, a sound-design handoff, an avoidance note, or a local production constraint.",
      "",
      "Translate these marker instructions into musical behavior: instrumentation, texture, harmony, rhythm, density, register, dynamics, tempo feel, transitions, vocal presence, lyric placement, silence, restraint, and space for dialogue or sound effects. Do not merely repeat plot or feelings in the Suno fields. Turn them into playable music direction.",
      "",
      "Convert exact marker times into relative arrangement guidance such as opening, early build, midpoint drop, first climax, final release, and aftermath, while preserving important approximate timestamps when they help organize the cue.",
      "",
      "Write for these Suno fields:",
      "- Lyrics: by default, assume this is an instrumental cue and do not write sung lyrics. For instrumental cues, write a compact cue map using bracketed section tags, such as [Instrumental], [opening: sparse low tension], [midpoint: restrained emotional lift], [climax: dense heroic surge], [aftermath: soft unresolved fade]. Keep this field focused on essential arrangement instructions. If the user explicitly asks for vocals, a song, or lyrics, then write concise singable lyrics that follow the scene's emotional point of view, with bracketed section tags where helpful.",
      "- Styles: write short comma-separated Suno style tags covering genre/subgenre, mood, tempo feel, core instruments, production texture, and cinematic function. Avoid long sentences.",
      "- Exclude Styles: list concrete things to avoid, such as vocals, pop hook, heavy drums, bright comedy tone, distorted guitars, choir, trap drums, or unwanted instruments/styles inferred from the brief.",
      "- Song Title (Optional): short and evocative.",
      "- AI Notes: briefly explain how the marker timing was translated into arrangement guidance, and note any uncertainty.",
      "",
      "Rules:",
      "- Final Suno-facing fields must be in English, even if source comments are Chinese.",
      "- Prefer a clear emotional arc while preserving the marker-driven progression.",
      "- Treat markers as local cue instructions, not only emotional turning points.",
      "- Prefer specific musical behavior over abstract adjectives: what enters, what recedes, what builds, what stays restrained, what becomes denser or thinner, where vocals or lyrics should appear or disappear, and how transitions should feel.",
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

    return answers.length ? answers.join("\n") : "No additional interview answers provided.";
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
    return [
      "You are generating text for Suno's current Advanced Create UI.",
      "",
      "Important output format:",
      "- Do not return JSON, Markdown tables, or a code block.",
      "- Return plain text only, using exactly these field labels: Lyrics, Styles, Exclude Styles, Song Title (Optional), AI Notes.",
      "- The first four fields should be directly copyable into Suno's Lyrics, Styles, Exclude styles, and Song Title inputs.",
      "",
      "Engineer guidance:",
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
      "",
      "Additional context from editor interview:",
      formatInterviewAnswers(interviewAnswers),
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

  function additionalContextStorageKey(cue) {
    var projectKey = cue.projectPath || cue.projectName || cue.sequenceName || "Unknown project";
    return ["sunoCueWriter.additionalContext", projectKey].join("::");
  }

  function legacyAdditionalContextStorageKey(cue) {
    var projectKey = cue.projectPath || cue.projectName || "Unknown project";
    var sequenceKey = cue.sequenceName || "Untitled sequence";
    var inKey = cue.inTime || String(roundSeconds(cue.inSeconds || 0));
    var outKey = cue.outTime || String(roundSeconds(cue.outSeconds || 0));
    return ["sunoCueWriter.additionalContext", projectKey, sequenceKey, inKey, outKey].join("::");
  }

  return {
    filterMarkersInRange: filterMarkersInRange,
    normalizeDeepSeekJson: normalizeDeepSeekJson,
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
    additionalContextStorageKey: additionalContextStorageKey,
    legacyAdditionalContextStorageKey: legacyAdditionalContextStorageKey,
  };
});
