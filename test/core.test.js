const test = require("node:test");
const assert = require("node:assert/strict");

const {
  filterMarkersInRange,
  normalizeDeepSeekJson,
  buildInterviewMessages,
  buildGenerationMessages,
  buildDeepSeekRequest,
  buildExternalLlmPrompt,
  defaultGenerationSystemPrompt,
  normalizeInterviewJson,
  validateCueForGeneration,
  formatCueText,
  additionalContextStorageKey,
  legacyAdditionalContextStorageKey,
  buildInterviewSummaryMessages,
  normalizeInterviewSummaryJson,
  extractPromptFromMarkdown,
  normalizeRecentPromptFiles,
} = require("../SunoCueWriter/js/core");

test("attaches core API to window even when CommonJS module exists", () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../SunoCueWriter/js/core.js"), "utf8");
  const context = {
    window: {},
    module: { exports: {} },
    self: {},
  };

  vm.runInNewContext(source, context);

  assert.equal(typeof context.window.SunoCueCore.filterMarkersInRange, "function");
  assert.equal(typeof context.module.exports.filterMarkersInRange, "function");
});

test("filters markers to the active In/Out range and adds relative seconds", () => {
  const cue = filterMarkersInRange({
    sequenceName: "Scene_04_Rooftop",
    inSeconds: 42.5,
    outSeconds: 118,
    markers: [
      { startSeconds: 12, name: "before", comments: "ignore" },
      { startSeconds: 60, endSeconds: 60, name: "open", comments: "music slowly enters" },
      { startSeconds: 95.25, endSeconds: 97.25, name: "rise", comments: "pressure releases" },
      { startSeconds: 130, name: "after", comments: "ignore" },
    ],
  });

  assert.equal(cue.sequenceName, "Scene_04_Rooftop");
  assert.equal(cue.durationSeconds, 75.5);
  assert.deepEqual(
    cue.markers.map((marker) => ({
      name: marker.name,
      relativeSeconds: marker.relativeSeconds,
      durationSeconds: marker.durationSeconds,
    })),
    [
      { name: "open", relativeSeconds: 17.5, durationSeconds: 0 },
      { name: "rise", relativeSeconds: 52.75, durationSeconds: 2 },
    ],
  );
});

test("normalizes fenced or plain DeepSeek JSON into output fields", () => {
  const parsed = normalizeDeepSeekJson(
    "```json\n{\"title\":\"Rooftop Release\",\"prompt\":\"restrained opening\",\"style\":\"cinematic score\",\"lyricsStructure\":\"[Instrumental]\",\"exclude\":\"vocals\",\"editorNotes\":\"timing is approximate\"}\n```",
  );

  assert.deepEqual(parsed, {
    title: "Rooftop Release",
    prompt: "restrained opening",
    style: "cinematic score",
    lyricsStructure: "[Instrumental]",
    exclude: "vocals",
    editorNotes: "timing is approximate",
  });
});

test("builds an interview request that asks only high-value context questions", () => {
  const messages = buildInterviewMessages({
    sequenceName: "Scene_04_Rooftop",
    durationSeconds: 75.5,
    markers: [
      {
        relativeSeconds: 17.5,
        name: "open",
        comments: "这里的音乐要慢慢的进，代表角色从压抑到打开",
      },
    ],
  });

  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /film music supervisor/i);
  assert.match(messages[0].content, /Ask in Chinese/i);
  assert.match(messages[0].content, /avoid music-theory/i);
  assert.match(messages[0].content, /director or editor can answer/i);
  assert.match(messages[1].content, /2-4/);
  assert.match(messages[1].content, /用中文提问/);
  assert.match(messages[1].content, /comments and brief do not already explain/i);
  assert.match(messages[1].content, /audience should feel/i);
  assert.match(messages[1].content, /Scene_04_Rooftop/);
  assert.match(messages[1].content, /压抑到打开/);
});

test("builds generation messages with markers and optional interview answers", () => {
  const messages = buildGenerationMessages(
    {
      sequenceName: "Scene_04_Rooftop",
      durationSeconds: 75.5,
      markers: [
        {
          relativeSeconds: 17.5,
          name: "open",
          comments: "music should slowly enter",
        },
      ],
    },
    [
      {
        question: "Should the cue follow inner emotion?",
        answer: "Yes, stay close to the character and avoid obvious melodrama.",
      },
    ],
  );

  assert.match(messages[0].content, /Suno Advanced\/Custom Mode prompt engineer/i);
  assert.match(messages[0].content, /Convert Premiere timeline markers, director comments, and optional editor answers/i);
  assert.match(messages[0].content, /marker comments often describe story action, character psychology, and the emotion the audience should feel/i);
  assert.match(messages[0].content, /infer each marker's narrative beat, character point of view, audience emotion, and energy change/i);
  assert.match(messages[0].content, /translate those abstractions into musical behavior: instrumentation, texture, harmony, rhythm, density, register, dynamics, tempo feel, and transitions/i);
  assert.match(messages[0].content, /Do not merely repeat plot or feelings in the Suno fields/i);
  assert.match(messages[0].content, /turn them into playable music direction/i);
  assert.match(messages[0].content, /by default, assume this is an instrumental cue and do not write sung lyrics/i);
  assert.match(messages[0].content, /If the user explicitly asks for vocals, a song, or lyrics/i);
  assert.match(messages[0].content, /Final Suno-facing fields must be in English/i);
  assert.match(messages[0].content, /Prefer specific musical behavior over abstract adjectives/i);
  assert.match(messages[0].content, /Keep outputs usable for copy-paste into Suno/i);
  assert.doesNotMatch(messages[0].content, /whose point of view/i);
  assert.doesNotMatch(messages[0].content, /Do not flatten emotional or narrative notes/i);
  assert.doesNotMatch(messages[0].content, /mythic peak|roar space|sunbreak/i);
  assert.doesNotMatch(messages[0].content, /3-5 most important cue moments/i);
  assert.doesNotMatch(messages[0].content, /Preserve the director\/editor's original intent/i);
  assert.doesNotMatch(messages[0].content, /copyrighted artist/i);
  assert.match(messages[1].content, /internal JSON fields/);
  assert.match(messages[1].content, /avoid obvious melodrama/);
});

test("uses an editable generation system prompt for API and external workflows", () => {
  const customPrompt = "You are my custom Suno cue prompt engineer. Favor icy synth textures.";
  const cue = {
    sequenceName: "Scene_04_Rooftop",
    durationSeconds: 75.5,
    markers: [{ relativeSeconds: 17.5, name: "open", comments: "music should slowly enter" }],
  };

  const messages = buildGenerationMessages(cue, [], { generationSystemPrompt: customPrompt });
  const externalPrompt = buildExternalLlmPrompt(cue, [], { generationSystemPrompt: customPrompt });

  assert.equal(messages[0].content, customPrompt);
  assert.match(externalPrompt, /You are my custom Suno cue prompt engineer/);
  assert.match(defaultGenerationSystemPrompt(), /Suno Advanced\/Custom Mode prompt engineer/);
  assert.match(defaultGenerationSystemPrompt(), /turn them into playable music direction/);
  assert.match(defaultGenerationSystemPrompt(), /Final Suno-facing fields must be in English/);
  assert.match(defaultGenerationSystemPrompt(), /Return strict JSON only with keys: title, prompt, style, lyricsStructure, exclude, editorNotes/);
  assert.doesNotMatch(defaultGenerationSystemPrompt(), /v5/i);
  assert.doesNotMatch(defaultGenerationSystemPrompt(), /v5\.5/i);
});

test("formats all generated fields for text export and copy-all", () => {
  const text = formatCueText({
    title: "Rooftop Release",
    prompt: "A restrained cue",
    style: "cinematic score",
    lyricsStructure: "[Instrumental]",
    exclude: "vocals",
    editorNotes: "Use timing as emotional guidance.",
  });

  assert.match(text, /Lyrics:\nA restrained cue\n\n\[Instrumental\]/);
  assert.match(text, /Styles:\ncinematic score/);
  assert.match(text, /Exclude Styles:\nvocals/);
  assert.match(text, /Song Title \(Optional\):\nRooftop Release/);
  assert.match(text, /AI Notes:\nUse timing/);
});

test("renders copy buttons for direct Suno paste fields", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "../SunoCueWriter/index.html"), "utf8");

  [
    ["lyricsOutput", "Lyrics"],
    ["styleOutput", "Styles"],
    ["excludeOutput", "Exclude Styles"],
    ["titleOutput", "Song Title"],
  ].forEach(([targetId, label]) => {
    assert.match(html, new RegExp('data-copy-target="' + targetId + '"'));
    assert.match(html, new RegExp('data-copy-label="' + label + '"'));
    assert.match(html, new RegExp('aria-label="Copy ' + label + '"'));
  });

  assert.doesNotMatch(html, /data-copy-target="notesOutput"/);
});

test("renders markdown prompt loader controls in engineer prompt config", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "../SunoCueWriter/index.html"), "utf8");

  assert.match(html, /id="promptMarkdownPath"/);
  assert.match(html, /id="browsePromptMarkdownButton"/);
  assert.match(html, /id="recentPromptMarkdownButton"/);
  assert.match(html, /id="recentPromptMarkdownList"/);
  assert.match(html, /id="promptMarkdownFileInput"/);
  assert.match(html, /accept="\.md,\.markdown,text\/markdown,text\/plain"/);
});

test("extracts prompt text from markdown fenced code blocks", () => {
  assert.equal(
    extractPromptFromMarkdown("# Prompt note\n\nSome setup.\n\n```text\n  Use this prompt.\nKeep line breaks.  \n```\n\nMore notes."),
    "Use this prompt.\nKeep line breaks.",
  );

  assert.equal(extractPromptFromMarkdown("Intro\n\n~~~\nWave one\n~~~"), "Wave one");
  assert.equal(extractPromptFromMarkdown("```\n   \n```\n\n```prompt\nSecond block\n```"), "Second block");
});

test("extracts markdown prompt from body without headings when no code block exists", () => {
  assert.equal(
    extractPromptFromMarkdown("---\ntitle: Test\n---\n# Main Prompt\n\nKeep this line.\n## Notes\nKeep this too."),
    "Keep this line.\nKeep this too.",
  );
  assert.equal(extractPromptFromMarkdown("# Only title"), "");
  assert.equal(extractPromptFromMarkdown(""), "");
});

test("normalizes recent prompt markdown files", () => {
  const current = [
    { path: "/vault/a.md", name: "a.md", lastLoadedAt: 1 },
    { path: "/vault/b.md", name: "b.md", lastLoadedAt: 2 },
    { path: "/vault/c.md", name: "c.md", lastLoadedAt: 3 },
    { path: "/vault/d.md", name: "d.md", lastLoadedAt: 4 },
    { path: "/vault/e.md", name: "e.md", lastLoadedAt: 5 },
  ];
  const recent = normalizeRecentPromptFiles(current, { path: "/vault/c.md", name: "Custom C.md", lastLoadedAt: 10 });

  assert.deepEqual(
    recent.map((item) => item.path),
    ["/vault/c.md", "/vault/a.md", "/vault/b.md", "/vault/d.md", "/vault/e.md"],
  );
  assert.equal(recent[0].name, "Custom C.md");
  assert.equal(normalizeRecentPromptFiles(current, { path: "/vault/f.md", name: "f.md", lastLoadedAt: 6 }).length, 5);
  assert.deepEqual(normalizeRecentPromptFiles([{ path: "" }, null], null), []);
});

test("builds an additional context storage key scoped to the project", () => {
  const key = additionalContextStorageKey({
    projectPath: "/Users/xiali/film/scene.prproj",
    projectName: "scene",
    sequenceName: "S330_V8_0515",
    inTime: "00:00:00.000",
    outTime: "00:07:18.458",
  });

  assert.equal(key, "sunoCueWriter.additionalContext::/Users/xiali/film/scene.prproj");
});

test("falls back to project name or sequence when building the project context key", () => {
  assert.equal(
    additionalContextStorageKey({
      projectName: "Untitled Project",
      sequenceName: "Seq",
      inSeconds: 10,
      outSeconds: 20,
    }),
    "sunoCueWriter.additionalContext::Untitled Project",
  );
  assert.equal(
    additionalContextStorageKey({
      sequenceName: "Seq",
      inSeconds: 10,
      outSeconds: 20,
    }),
    "sunoCueWriter.additionalContext::Seq",
  );
});

test("keeps the legacy additional context range key available for migration", () => {
  const key = legacyAdditionalContextStorageKey({
    projectPath: "/Users/xiali/film/scene.prproj",
    sequenceName: "S330_V8_0515",
    inTime: "00:00:00.000",
    outTime: "00:07:18.458",
  });

  assert.equal(key, "sunoCueWriter.additionalContext::/Users/xiali/film/scene.prproj::S330_V8_0515::00:00:00.000::00:07:18.458");
});

test("builds a DeepSeek request with JSON output and V4 Pro defaults", () => {
  const request = buildDeepSeekRequest([{ role: "user", content: "Hello" }]);

  assert.equal(request.model, "deepseek-v4-pro");
  assert.equal(request.stream, false);
  assert.equal(request.response_format.type, "json_object");
  assert.deepEqual(request.messages, [{ role: "user", content: "Hello" }]);
});

test("normalizes interview questions and drops unusable entries", () => {
  const parsed = normalizeInterviewJson({
    questions: [
      { id: "pov", question: "Inner emotion or external tension?" },
      { id: "", question: "" },
      { question: "Any instruments to avoid?" },
    ],
  });

  assert.deepEqual(parsed, [
    { id: "pov", question: "Inner emotion or external tension?", answer: "" },
    { id: "question_2", question: "Any instruments to avoid?", answer: "" },
  ]);
});

test("builds an interview summary request with cue context, existing context, and answers", () => {
  const messages = buildInterviewSummaryMessages(
    {
      sequenceName: "Scene_04_Rooftop",
      durationSeconds: 75.5,
      markers: [
        {
          relativeSeconds: 17.5,
          name: "open",
          comments: "这里的音乐要慢慢的进，代表角色从压抑到打开",
        },
      ],
    },
    "已有设定：音乐贴近角色内心。",
    [
      {
        question: "这里的人声要像歌词还是氛围？",
        answer: "这一段不要歌词，只要空灵女声氛围。",
      },
    ],
  );

  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /reusable cue context/i);
  assert.match(messages[0].content, /Return strict JSON only/i);
  assert.match(messages[1].content, /Scene_04_Rooftop/);
  assert.match(messages[1].content, /已有设定/);
  assert.match(messages[1].content, /这一段不要歌词/);
  assert.match(messages[1].content, /only to avoid repeating/i);
  assert.match(messages[1].content, /Do not summarize, rewrite, or include existing context/i);
  assert.match(messages[1].content, /director intention/i);
  assert.match(messages[1].content, /music requirements/i);
});

test("does not build an interview summary request without answered questions", () => {
  assert.equal(
    buildInterviewSummaryMessages(
      { sequenceName: "Scene_04_Rooftop", durationSeconds: 75.5, markers: [] },
      "",
      [{ question: "Question?", answer: "" }],
    ),
    null,
  );
});

test("normalizes interview summary JSON into plain summary text", () => {
  assert.equal(normalizeInterviewSummaryJson("```json\n{\"summary\":\"- Keep vocals wordless.\\n- Avoid heroic drums.\"}\n```"), "- Keep vocals wordless.\n- Avoid heroic drums.");
  assert.equal(normalizeInterviewSummaryJson({ summary: "  - Keep it intimate.  " }), "- Keep it intimate.");
});

test("validates active sequence and marker generation preconditions", () => {
  assert.deepEqual(validateCueForGeneration(null), {
    ok: false,
    code: "NO_SEQUENCE",
    message: "Open a sequence first.",
  });

  assert.deepEqual(validateCueForGeneration({ inSeconds: 20, outSeconds: 10, markers: [] }), {
    ok: false,
    code: "MISSING_IN_OUT",
    message: "Set a valid sequence In/Out range before generating.",
  });

  assert.deepEqual(validateCueForGeneration({ inSeconds: 0, outSeconds: 10, markers: [] }), {
    ok: false,
    code: "NO_MARKERS",
    message: "No timeline markers were found in the active In/Out range. Add a manual scene brief or set markers first.",
  });
});

test("allows external prompt when a cue has context but no markers", () => {
  const prompt = buildExternalLlmPrompt(
    {
      sequenceName: "Manual Only",
      inSeconds: 0,
      outSeconds: 20,
      durationSeconds: 20,
      markers: [{ relativeSeconds: 0, name: "Manual brief", comments: "slow uneasy underscore" }],
    },
    [],
  );

  assert.match(prompt, /Manual Only/);
  assert.match(prompt, /slow uneasy underscore/);
});

test("formats additional context without a fake timeline timestamp in external prompts", () => {
  const prompt = buildExternalLlmPrompt(
    {
      sequenceName: "Scene_With_Context",
      inSeconds: 0,
      outSeconds: 60,
      durationSeconds: 60,
      additionalContext: "整段音乐需要更像第三幕高潮前的诗意告别。",
      markers: [
        {
          relativeSeconds: 12,
          name: "turn",
          comments: "角色做出决定。",
        },
      ],
    },
    [],
  );

  assert.match(prompt, /Additional context from editor:\n整段音乐需要更像第三幕高潮前的诗意告别。/);
  assert.equal((prompt.match(/Sequence: Scene_With_Context/g) || []).length, 1);
  assert.equal((prompt.match(/Duration seconds: 60/g) || []).length, 1);
  assert.doesNotMatch(prompt, /\[0s\] Name: Additional context/);
  assert.doesNotMatch(prompt, /Additional context\. Comments:/);
  assert.doesNotMatch(prompt, /Additional context from editor interview/);
  assert.doesNotMatch(prompt, /No additional interview answers provided/);
});

test("builds an external LLM prompt with cue context and interview answers", () => {
  const prompt = buildExternalLlmPrompt(
    {
      sequenceName: "Scene_04_Rooftop",
      inTime: "00:00:42:12",
      outTime: "00:01:58:03",
      durationSeconds: 75.5,
      markers: [
        {
          relativeSeconds: 17.5,
          name: "open",
          comments: "这里的音乐要慢慢的进，代表角色从压抑到打开",
        },
      ],
    },
    [
      {
        question: "Should the cue follow inner emotion or external tension?",
        answer: "Inner emotion, but keep it restrained.",
      },
    ],
  );

  assert.match(prompt, /You are a film music supervisor and Suno Advanced\/Custom Mode prompt engineer/);
  assert.match(prompt, /Use the included Premiere marker data and director notes to generate Suno Advanced\/Custom Mode fields/);
  assert.match(prompt, /Translate scene action, character psychology, and intended audience emotion into concrete musical instructions/);
  assert.match(prompt, /Convert narrative and emotional descriptions into musical parameters/);
  assert.match(prompt, /Scene_04_Rooftop/);
  assert.match(prompt, /00:00:42:12 - 00:01:58:03/);
  assert.match(prompt, /压抑到打开/);
  assert.match(prompt, /Inner emotion, but keep it restrained/);
  assert.match(prompt, /Additional context from editor interview:\n1\. Inner emotion, but keep it restrained\./);
  assert.doesNotMatch(prompt, /Q: Should the cue follow inner emotion or external tension/);
  assert.match(prompt, /Return the result as plain text in this exact structure/);
  assert.match(prompt, /Lyrics:/);
  assert.match(prompt, /Styles:/);
  assert.match(prompt, /Exclude Styles:/);
  assert.match(prompt, /Song Title \(Optional\):/);
  assert.match(prompt, /Do not return JSON/i);
  assert.match(prompt, /directly copyable into Suno's Lyrics, Styles, Exclude styles, and Song Title inputs/i);
  assert.doesNotMatch(prompt, /Return strict JSON only/i);
  assert.doesNotMatch(prompt, /copyrighted artist/i);
});
