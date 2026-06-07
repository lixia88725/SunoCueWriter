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
  assert.match(messages[0].content, /additional context/i);
  assert.match(messages[0].content, /story action, character psychology, intended audience emotion, vocal direction, arrangement notes, sound-design handoffs, or local production constraints/i);
  assert.match(messages[0].content, /read each marker as a cue instruction/i);
  assert.match(messages[0].content, /vocal\/lyrics instruction, an arrangement note, a sound-design handoff, an avoidance note, or a local production constraint/i);
  assert.match(messages[0].content, /instrumentation, texture, harmony, rhythm, density, register, dynamics, tempo feel, transitions, vocal presence, lyric placement, silence, restraint, and space for dialogue or sound effects/i);
  assert.match(messages[0].content, /Convert exact marker times into relative arrangement guidance/i);
  assert.match(messages[0].content, /opening, early build, midpoint drop, first climax, final release, and aftermath/i);
  assert.match(messages[0].content, /Treat markers as local cue instructions, not only emotional turning points/i);
  assert.match(messages[0].content, /Do not merely repeat plot or feelings/i);
  assert.match(messages[0].content, /by default, assume this is an instrumental cue/i);
  assert.match(messages[0].content, /If the user explicitly asks for vocals, a song, or lyrics/i);
  assert.doesNotMatch(messages[0].content, /3-5 most important cue moments/i);
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

test("builds an additional context storage key scoped to project, sequence, and range", () => {
  const key = additionalContextStorageKey({
    projectPath: "/Users/xiali/film/scene.prproj",
    projectName: "scene",
    sequenceName: "S330_V8_0515",
    inTime: "00:00:00.000",
    outTime: "00:07:18.458",
  });

  assert.equal(key, "sunoCueWriter.additionalContext::/Users/xiali/film/scene.prproj::S330_V8_0515::00:00:00.000::00:07:18.458");
});

test("falls back to project name or sequence when building additional context key", () => {
  assert.equal(
    additionalContextStorageKey({
      projectName: "Untitled Project",
      sequenceName: "Seq",
      inSeconds: 10,
      outSeconds: 20,
    }),
    "sunoCueWriter.additionalContext::Untitled Project::Seq::10::20",
  );
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
