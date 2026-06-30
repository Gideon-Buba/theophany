import Groq from 'groq-sdk';
import type { SeedTopic, TheologyScript, ExplainerSegment, ScriptBeat, SegmentName } from './types.js';

const SEGMENT_NAMES: SegmentName[] = [
  'hook', 'context', 'text', 'tension', 'interpretation', 'application',
];

const SYSTEM_PROMPT = `You are a scripture and theology explainer for the YouTube channel Theophany. Calm, reflective, intellectually honest. NOT devotional, NOT preachy. Do not assert doctrine as fact.

Narration rules:
- "The text says..." / "In this passage..." for textual observation
- "One reading is..." / "Some scholars argue..." / "Another perspective holds..." for interpretation
- Spoken narration only — no headers, bullets, markdown

Image prompt rules — this is critical:
- Each beat gets a specific imagePrompt describing a CONCRETE SCENE from the passage's actual story world
- Name the specific people, objects, setting — the pool, the mat, the mountain, the tomb, etc.
- Vary the visual angle and focus across beats within a segment (wide establishing → close detail → emotional moment)
- Never depict the face of Jesus or central religious figures — show from behind, in silhouette, or as a presence indicated by light
- No text, labels, or writing in the image
- End every imagePrompt with: "ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels"

Each segment is split into exactly 3 beats. The beats flow as continuous narration — beat 1 + beat 2 + beat 3 = the full segment read aloud.

Return this exact JSON:
{
  "passage": "string",
  "hookQuestion": "string — the central provocative question, becomes the video title",
  "segments": [
    {
      "name": "hook",
      "beats": [
        {
          "narration": "~50 words. The strange or jarring opening — why does this question matter at all?",
          "imagePrompt": "wide establishing shot of the scene — who, where, what is happening, specific to this passage. ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels"
        },
        {
          "narration": "~50 words. Deepen the strangeness — what exactly is odd or unsettling about this?",
          "imagePrompt": "closer focus on the central figure or object that makes this question strange. ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels"
        },
        {
          "narration": "~50 words. Land the hook — this is what we are going to explore.",
          "imagePrompt": "the emotional or theological tension in a single image — something unresolved, a moment of uncertainty. ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels"
        }
      ]
    },
    {
      "name": "context",
      "beats": [
        {
          "narration": "~70 words. The physical and historical setting — where and when.",
          "imagePrompt": "wide view of the physical location described in the passage — landscape, architecture, era. ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels"
        },
        {
          "narration": "~70 words. The cultural and religious context — what was normal, expected, or assumed.",
          "imagePrompt": "people going about the ordinary practices of the era that this story interrupts. ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels"
        },
        {
          "narration": "~70 words. The literary context — where this sits in the larger book or narrative.",
          "imagePrompt": "a detail or object from the setting that carries symbolic weight — the pool, the mountain, the temple, the road. ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels"
        }
      ]
    },
    {
      "name": "text",
      "beats": [
        {
          "narration": "~70 words. What the passage literally says happens first.",
          "imagePrompt": "the opening action of the passage — the specific moment described in the first movement of the text. ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels"
        },
        {
          "narration": "~70 words. The key exchange or turning point in the text.",
          "imagePrompt": "the pivotal moment — the question asked, the command given, the touch made, the thing said. ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels"
        },
        {
          "narration": "~70 words. What happens after — the result and what the author notes.",
          "imagePrompt": "the aftermath — what changed, who reacts, what the scene looks like after the event. ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels"
        }
      ]
    },
    {
      "name": "tension",
      "beats": [
        {
          "narration": "~70 words. The first hard question this text raises.",
          "imagePrompt": "the scene in the passage that most embodies the first tension — something ambiguous or uncomfortable. ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels"
        },
        {
          "narration": "~70 words. A second tension or complication — something the text leaves unresolved.",
          "imagePrompt": "a second moment in the passage where two things are in conflict or unresolved — show the clash. ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels"
        },
        {
          "narration": "~70 words. Why these tensions resist easy resolution.",
          "imagePrompt": "the figure or setting at the center of the unresolved tension — dark and light meeting, two groups facing each other. ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels"
        }
      ]
    },
    {
      "name": "interpretation",
      "beats": [
        {
          "narration": "~70 words. One reading is... — the first interpretive tradition.",
          "imagePrompt": "the specific moment in the passage that this first reading focuses on — the scene as that tradition sees it. ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels"
        },
        {
          "narration": "~70 words. Another reading holds... — a second distinct interpretation.",
          "imagePrompt": "the same or adjacent scene reframed for the second reading — same moment, different emphasis. ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels"
        },
        {
          "narration": "~70 words. A third perspective, or why both readings remain live options.",
          "imagePrompt": "the passage's central image held open — something that could be read either way, neither resolved. ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels"
        }
      ]
    },
    {
      "name": "application",
      "beats": [
        {
          "narration": "~50 words. What this passage opens up — frame as a question, not an instruction.",
          "imagePrompt": "a quiet human-scale scene from the passage world — a person alone, a threshold, a moment before something changes. ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels"
        },
        {
          "narration": "~50 words. What it might mean to sit with this — the thing worth not resolving.",
          "imagePrompt": "a detail from the passage — an object, a gesture, a quality of light — that holds the unresolved feeling. ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels"
        },
        {
          "narration": "~50 words. A closing image or question to leave the viewer with.",
          "imagePrompt": "the final image — still, contemplative, the passage's world at rest, open horizon or still water. ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels"
        }
      ]
    }
  ]
}`;

function validateBeat(b: unknown, segIdx: number, beatIdx: number): ScriptBeat {
  if (typeof b !== 'object' || b === null) {
    throw new Error(`Segment ${segIdx} beat ${beatIdx} is not an object`);
  }
  const beat = b as Record<string, unknown>;
  if (typeof beat['narration'] !== 'string' || !beat['narration']) {
    throw new Error(`Segment ${segIdx} beat ${beatIdx} missing narration`);
  }
  if (typeof beat['imagePrompt'] !== 'string' || !beat['imagePrompt']) {
    throw new Error(`Segment ${segIdx} beat ${beatIdx} missing imagePrompt`);
  }
  return { narration: beat['narration'] as string, imagePrompt: beat['imagePrompt'] as string };
}

function validateScript(raw: unknown): TheologyScript {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Script response is not an object');
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj['passage'] !== 'string' || !obj['passage']) {
    throw new Error('Missing "passage"');
  }
  if (typeof obj['hookQuestion'] !== 'string' || !obj['hookQuestion']) {
    throw new Error('Missing "hookQuestion"');
  }
  if (!Array.isArray(obj['segments']) || obj['segments'].length !== 6) {
    throw new Error(`Expected 6 segments, got ${Array.isArray(obj['segments']) ? obj['segments'].length : 'non-array'}`);
  }

  const segments = (obj['segments'] as unknown[]).map((s: unknown, i: number): ExplainerSegment => {
    if (typeof s !== 'object' || s === null) throw new Error(`Segment ${i} is not an object`);
    const seg = s as Record<string, unknown>;
    const name = seg['name'];
    if (typeof name !== 'string' || !SEGMENT_NAMES.includes(name as SegmentName)) {
      throw new Error(`Segment ${i} invalid name: ${String(name)}`);
    }
    if (!Array.isArray(seg['beats']) || seg['beats'].length !== 3) {
      throw new Error(`Segment ${i} (${name}) must have exactly 3 beats, got ${Array.isArray(seg['beats']) ? seg['beats'].length : 'non-array'}`);
    }
    const beats = (seg['beats'] as unknown[]).map((b, j) => validateBeat(b, i, j));
    return { name: name as SegmentName, beats };
  });

  const ordered = SEGMENT_NAMES.map((n) => {
    const found = segments.find((s) => s.name === n);
    if (!found) throw new Error(`Missing segment: ${n}`);
    return found;
  });

  return { passage: obj['passage'] as string, hookQuestion: obj['hookQuestion'] as string, segments: ordered };
}

export async function generateScript(topic: SeedTopic): Promise<TheologyScript> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Passage: ${topic.passage}\nCentral question: ${topic.question}\n\nEach imagePrompt must depict a concrete, specific scene from THIS passage — not generic symbols. Vary the visual angle across the 3 beats of each segment.`,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.72,
    max_tokens: 6000,
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error('Groq returned empty content');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse Groq JSON: ${raw.slice(0, 200)}`);
  }

  return validateScript(parsed);
}
