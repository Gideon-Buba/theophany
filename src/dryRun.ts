/**
 * Dry-run — generates a complete, watchable video without uploading to YouTube.
 * All external APIs are called for real when keys are present.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { generateScript } from './scriptGenerator.js';
import { generateAudio } from './tts.js';
import { generateImages } from './imageGen.js';
import { requestApproval, sendNotification } from './telegramBot.js';
import { assembleVideo } from './videoAssembler.js';
import type { TheologyScript, SeedTopic, AudioSegment } from './types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hr(label = ''): void {
  const line = '─'.repeat(60);
  console.log(label ? `\n${line}\n  ${label}\n${line}` : `\n${line}`);
}
const ok   = (m: string) => console.log(`  ✓  ${m}`);
const info = (m: string) => console.log(`  ·  ${m}`);
const warn = (m: string) => console.log(`  ⚠  ${m}`);

function ffmpegLocal(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args]);
    const errs: Buffer[] = [];
    proc.stderr?.on('data', (b: Buffer) => errs.push(b));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${Buffer.concat(errs).toString().slice(-400)}`));
    });
    proc.on('error', (e) => reject(new Error(`spawn ffmpeg: ${e.message}`)));
  });
}

// ─── Stubs ────────────────────────────────────────────────────────────────────

async function silentMp3(outputPath: string, durationSecs: number): Promise<void> {
  await ffmpegLocal([
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', String(durationSecs), '-acodec', 'libmp3lame', '-q:a', '5', '-y', outputPath,
  ]);
}

async function ochreImage(outputPath: string, shade: string): Promise<void> {
  await ffmpegLocal([
    '-f', 'lavfi', '-i', `color=c=${shade}:size=1024x1024:rate=1`,
    '-vframes', '1', '-y', outputPath,
  ]);
}

// Different ochre shades for each beat so you can see them swap
const BEAT_SHADES = ['0xC8A050', '0xA07830', '0xE8C870', '0xB89040', '0xD4B060', '0x604820',
                     '0xC89020', '0xA06010', '0xE0B840'];

// ─── Mock script ──────────────────────────────────────────────────────────────

const MOCK_SCRIPT: TheologyScript = {
  passage: 'John 5:1-47',
  hookQuestion: 'Why would Jesus ask a sick man if he wants to be healed?',
  segments: [
    {
      name: 'hook',
      beats: [
        {
          narration: 'There is a moment in this passage that stops careful readers cold. Jesus walks into a crowd of sick people at the pool of Bethesda and singles out one man — ill for thirty-eight years — and asks him a question.',
          imagePrompt: 'Wide view of the pool of Bethesda in ancient Jerusalem, five stone porticoes, crowds of sick and disabled people lying on mats around the twin pools, late afternoon golden light on still water, ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels',
        },
        {
          narration: '"Do you want to be healed?" It sounds almost cruel. Why would anyone who has been waiting by a healing pool for nearly four decades not want to get better? The question seems absurd on its face.',
          imagePrompt: 'Close view of an elderly man lying on a worn mat at the pool edge, looking up with an uncertain expression toward a figure standing over him, the still water of the pool behind him reflecting the colonnade, ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels',
        },
        {
          narration: 'And yet the text records it. Jesus asks. Something is happening here that a quick reading will miss entirely — something worth sitting with before we rush to an answer.',
          imagePrompt: 'The silhouette of a figure standing at the pool edge, light from the water below casting upward, the sick man on his mat below seen from above, the moment before he answers, suspended, ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels',
        },
      ],
    },
    {
      name: 'context',
      beats: [
        {
          narration: 'The pool of Bethesda is not a literary invention. Archaeologists working near Saint Anne\'s Church in Jerusalem have excavated the site — the twin pools, the five porticoes, exactly as John describes.',
          imagePrompt: 'Archaeological ruins of the pool of Bethesda, stone steps descending into two rectangular pools, the remains of colonnaded porticoes, warm afternoon light on ancient stone, ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels',
        },
        {
          narration: 'People gathered there believing that when the waters stirred — some manuscripts say, when an angel troubled them — the first person into the pool would be healed. This was competitive healing. It favored the mobile, the connected, those with someone to carry them.',
          imagePrompt: 'A crowd pressing toward the edge of the pool as the water ripples, people pushing forward, some being helped by others, others dragging themselves on mats, the urgency of the moment, ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels',
        },
        {
          narration: 'The man Jesus approaches has been there a long time. Thirty-eight years is the number John gives — which in Jewish tradition often signals a generation wandering, going nowhere, a pointed number.',
          imagePrompt: 'A solitary man apart from the crowd, lying on an old mat near the far edge of the pool, others gathered in clusters nearby but no one attending to him, isolated in the middle of a crowd, ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels',
        },
      ],
    },
    {
      name: 'text',
      beats: [
        {
          narration: 'The text says Jesus "saw him lying there and knew that he had already been there a long time." This knowing comes before the question. Jesus is not asking because he lacks information.',
          imagePrompt: 'Jesus viewed from behind, standing at the edge of the pool crowd, looking down at the man on the mat, the crowd around them unaware of this private exchange, warm light from above, ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels',
        },
        {
          narration: 'The man\'s response to "do you want to be healed?" is notable: he does not say yes. He explains why healing has been impossible — he has no one to put him in the water. He has understood the question as being about the pool, not about the person asking it.',
          imagePrompt: 'The sick man on his mat looking up and gesturing toward the water, explaining his situation, his face showing resignation and frustration, the pool visible just beyond arm\'s reach, ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels',
        },
        {
          narration: 'Jesus speaks three imperatives: "Get up. Take your mat. Walk." No touch is described. No ritual, no prayer, no declaration of faith. The man is healed immediately. And then the text notes: Jesus had slipped away into the crowd.',
          imagePrompt: 'A man standing upright for the first time in decades, rolling up his mat, the pool of Bethesda behind him, other people watching in astonishment, the figure of Jesus no longer visible, already gone into the crowd, ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels',
        },
      ],
    },
    {
      name: 'tension',
      beats: [
        {
          narration: 'The first tension is the question itself. Does Jesus ask "do you want to be healed" because the man needs to articulate his desire? Or because, after thirty-eight years, the desire itself has become complicated — shaped by the life built around not being healed?',
          imagePrompt: 'The man on his mat, the pool before him, a long shadow stretching behind him suggesting thirty-eight years, his face unreadable — between hope and resignation, the water still, ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels',
        },
        {
          narration: 'The second tension: the healing happens on the Sabbath. The religious authorities who find the man carrying his mat are not asking about the miracle — they are asking about the mat. Why is he working on the day of rest? The healing itself is less interesting to them than the violation.',
          imagePrompt: 'The healed man carrying his rolled mat through a Jerusalem street, stern-faced figures in religious robes blocking his path and pointing at the mat, the Temple Mount visible in the background, confrontation in the street, ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels',
        },
        {
          narration: 'And then Jesus finds the man in the temple later and says: "Stop sinning, or something worse may happen to you." The text does not explain what this means. The connection between the man\'s illness and sin is introduced and left dangling.',
          imagePrompt: 'The healed man inside a temple courtyard, encountering a figure who gestures toward him with a warning expression, the man looking back uncertain — what sin, what worse thing — surrounded by the columns of the temple, ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels',
        },
      ],
    },
    {
      name: 'interpretation',
      beats: [
        {
          narration: 'One reading is that Jesus\'s question is diagnostic — not about physical desire but about whether the man is oriented toward change at all. Thirty-eight years shapes a person. The question may be asking: are you ready to not be this anymore?',
          imagePrompt: 'The sick man at the pool\'s edge, the moment of the question, his face turned toward Jesus who is out of frame, the still water reflecting the portico columns above — a moment of decision, ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels',
        },
        {
          narration: 'Another reading holds that the question is purely practical — a pastoral inquiry, Jesus assessing the situation before acting. The man\'s explanation reveals the social reality: he has no one. The question surfaces not desire but loneliness.',
          imagePrompt: 'The sick man alone at the pool edge, the crowd of other sick people attended by companions or family nearby, his isolation visible in contrast — no one beside him, no hand reaching toward the water on his behalf, ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels',
        },
        {
          narration: 'A third perspective, drawn from patristic reading, takes the scene typologically: the pool that cannot save this man represents the law — it offers the possibility of healing but always to someone else, always just out of reach. The healer who asks the question is the one who can do what the water cannot.',
          imagePrompt: 'The pool of Bethesda with the water rippling — empty of people, still, the five colonnades reflected in the surface — a pool with healing power no one can quite access, the beauty and uselessness of it together, ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels',
        },
      ],
    },
    {
      name: 'application',
      beats: [
        {
          narration: 'What this passage opens up is not primarily a lesson about faith or healing. It is a question about desire — whether we know what we are asking for, or whether we have narrowed our expectation down to what seems possible.',
          imagePrompt: 'A figure sitting quietly at the edge of the now-empty pool of Bethesda at dusk, the water still and dark, contemplating, a rolled mat beside them on the ancient stone, ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels',
        },
        {
          narration: 'The man by the pool has been waiting thirty-eight years for someone to carry him to the water. He has a very specific theory of how healing works. Jesus does not fit the theory. The healing comes from a direction he was not watching.',
          imagePrompt: 'The pool viewed at an angle, the colonnades reflected in still water, an empty mat left at the edge where the man used to lie — presence without person, the before and after held in a single image, ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels',
        },
        {
          narration: 'The text leaves the question open. What do you want? It is worth sitting with, and worth answering honestly.',
          imagePrompt: 'The pool of Bethesda at dusk, still water, empty colonnades, warm light fading on the stone — a place of waiting, now quiet, open horizon, ancient illustrated manuscript style, warm ochre and gold tones, no text, no labels',
        },
      ],
    },
  ],
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function dryRun(): Promise<void> {
  hr('THEOPHANY PIPELINE — DRY RUN');
  console.log(`  Started: ${new Date().toISOString()}`);

  hr('Step 0: Environment');
  const envVars = [
    'GROQ_API_KEY', 'ELEVENLABS_API_KEY', 'THEOPHANY_VOICE_ID',
    'HF_API_TOKEN', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
    'THEOPHANY_YOUTUBE_CLIENT_ID', 'THEOPHANY_YOUTUBE_CLIENT_SECRET',
  ];
  for (const key of envVars) {
    const val = process.env[key];
    val ? ok(`${key} = ${'*'.repeat(Math.min(val.length, 6))}...`) : warn(`${key} — NOT SET`);
  }
  fs.existsSync('.theophany_token.json')
    ? ok('.theophany_token.json found')
    : warn('.theophany_token.json not found — run `npm run auth` before uploading');

  const hasGroq     = !!process.env.GROQ_API_KEY;
  const hasEL       = !!(process.env.ELEVENLABS_API_KEY && (process.env.THEOPHANY_VOICE_ID || process.env.ELEVENLABS_VOICE_ID));
  const hasHF       = !!process.env.HF_API_TOKEN;
  const hasTelegram = !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);

  // ── Step 1 ────────────────────────────────────────────────────────────────
  hr('Step 1: Script Generation (Groq)');
  const topic: SeedTopic = { passage: 'John 5:1-47', question: 'Why would Jesus ask a sick man if he wants to be healed?' };

  let script: TheologyScript;
  if (hasGroq) {
    info('Calling Groq...');
    try {
      script = await generateScript(topic);
      ok(`"${script.hookQuestion}"`);
      ok(`Segments: ${script.segments.map((s) => `${s.name}(${s.beats.length} beats)`).join(', ')}`);
      hr('Script');
      for (const seg of script.segments) {
        console.log(`\n  ── ${seg.name.toUpperCase()} ──`);
        for (let i = 0; i < seg.beats.length; i++) {
          const beat = seg.beats[i]!;
          console.log(`\n  BEAT ${i + 1}: ${beat.narration}`);
          console.log(`  IMAGE:  ${beat.imagePrompt.slice(0, 120)}...`);
        }
      }
    } catch (err) {
      warn(`Groq failed: ${err instanceof Error ? err.message : String(err)}`);
      warn('Using mock script.');
      script = MOCK_SCRIPT;
    }
  } else {
    warn('GROQ_API_KEY not set — using mock script.');
    script = MOCK_SCRIPT;
    ok(`Mock: "${script.hookQuestion}"`);
    const hookBeat = script.segments[0]!.beats[0]!;
    console.log(`\n  ── HOOK beat 1 ──\n  ${hookBeat.narration}`);
  }

  // ── Step 2 ────────────────────────────────────────────────────────────────
  hr('Step 2: Telegram HITL Approval');
  if (hasTelegram) {
    info('Sending to Telegram...');
    const approved = await requestApproval(script);
    if (!approved) { warn('Rejected or timed out.'); return; }
    ok('Approved.');
  } else {
    warn('Telegram not set — auto-approving.');
    ok('Auto-approved.');
  }

  const runId = `dryrun_${Date.now()}`;
  const outputDir = path.join('output', runId);
  await fs.promises.mkdir(path.join(outputDir, 'audio'),  { recursive: true });
  await fs.promises.mkdir(path.join(outputDir, 'images'), { recursive: true });

  // ── Step 3: TTS ───────────────────────────────────────────────────────────
  hr('Step 3: ElevenLabs TTS (all 6 segments, with timestamps)');
  let audioSegments: AudioSegment[];

  if (hasEL) {
    info('Calling ElevenLabs with-timestamps API for all segments...');
    try {
      audioSegments = await generateAudio(script, outputDir);
      for (const a of audioSegments) {
        ok(`${path.basename(a.audioPath)}  ${a.totalDurationSeconds.toFixed(1)}s  beats at [${a.beatStartTimes.map((t) => t.toFixed(1) + 's').join(', ')}]`);
      }
    } catch (err) {
      warn(`ElevenLabs failed: ${err instanceof Error ? err.message : String(err)}`);
      warn('Falling back to silent stubs.');
      audioSegments = [];
      for (const seg of script.segments) {
        const words = seg.beats.reduce((n, b) => n + b.narration.split(/\s+/).length, 0);
        const dur = Math.max(10, Math.round((words / 130) * 60));
        const p = path.join(outputDir, 'audio', `${seg.name}.mp3`);
        await silentMp3(p, dur);
        const beatTimes = seg.beats.map((_, i) => (i / seg.beats.length) * dur);
        audioSegments.push({ audioPath: p, beatStartTimes: beatTimes, totalDurationSeconds: dur });
      }
    }
  } else {
    warn('ElevenLabs keys not set — silent stubs.');
    audioSegments = [];
    for (const seg of script.segments) {
      const words = seg.beats.reduce((n, b) => n + b.narration.split(/\s+/).length, 0);
      const dur = Math.max(10, Math.round((words / 130) * 60));
      const p = path.join(outputDir, 'audio', `${seg.name}.mp3`);
      info(`[${seg.name}] ${words} words → ${dur}s stub`);
      await silentMp3(p, dur);
      const beatTimes = seg.beats.map((_, i) => (i / seg.beats.length) * dur);
      audioSegments.push({ audioPath: p, beatStartTimes: beatTimes, totalDurationSeconds: dur });
    }
  }
  ok('Audio ready (6 files).');

  // ── Step 4: Images ────────────────────────────────────────────────────────
  hr('Step 4: FLUX.1-schnell Image Gen (18 images — 3 per segment)');
  let imageGroups: string[][];

  if (hasHF) {
    info('Calling HuggingFace FLUX for all 18 images...');
    try {
      imageGroups = await generateImages(script, outputDir);
      let total = 0;
      for (const g of imageGroups) total += g.length;
      ok(`${total} images generated.`);
    } catch (err) {
      warn(`HuggingFace failed: ${err instanceof Error ? err.message : String(err)}`);
      warn('Falling back to ochre stubs.');
      imageGroups = [];
      let shadeIdx = 0;
      for (const seg of script.segments) {
        const paths: string[] = [];
        for (let i = 0; i < seg.beats.length; i++) {
          const p = path.join(outputDir, 'images', `${seg.name}_${i}.png`);
          await ochreImage(p, BEAT_SHADES[shadeIdx++ % BEAT_SHADES.length]!);
          paths.push(p);
        }
        imageGroups.push(paths);
      }
    }
  } else {
    warn('HF_API_TOKEN not set — ochre stubs (different shade per beat).');
    imageGroups = [];
    let shadeIdx = 0;
    for (const seg of script.segments) {
      const paths: string[] = [];
      for (let i = 0; i < seg.beats.length; i++) {
        const p = path.join(outputDir, 'images', `${seg.name}_${i}.png`);
        info(`[${seg.name} beat ${i + 1}] ochre stub`);
        await ochreImage(p, BEAT_SHADES[shadeIdx++ % BEAT_SHADES.length]!);
        paths.push(p);
      }
      imageGroups.push(paths);
    }
  }
  ok('Images ready (18 files).');

  // ── Step 5: FFmpeg ────────────────────────────────────────────────────────
  hr('Step 5: FFmpeg Assembly (images swap at beat timestamps)');
  const { landscapeVideo, shortsVideo } = await assembleVideo(imageGroups, audioSegments, outputDir);
  const lStat = await fs.promises.stat(landscapeVideo);
  const sStat = await fs.promises.stat(shortsVideo);
  ok(`Landscape: ${landscapeVideo}  (${(lStat.size / 1024 / 1024).toFixed(2)} MB)`);
  ok(`Shorts:    ${shortsVideo}  (${(sStat.size / 1024 / 1024).toFixed(2)} MB)`);

  // ── Step 6: Upload stub ───────────────────────────────────────────────────
  hr('Step 6: YouTube Upload (stubbed)');
  info(`Would upload: "${script.hookQuestion}"`);
  info(`Would upload: "${script.hookQuestion} #Shorts"`);
  ok('Skipped.');

  // ── Step 7: Telegram confirm ──────────────────────────────────────────────
  hr('Step 7: Telegram Confirmation');
  const confirmMsg = [
    '🧪 <b>Dry-run complete</b> — no video was uploaded.',
    '',
    '18 images generated, synced to ElevenLabs beat timestamps.',
    'Ready to run for real once YouTube OAuth is done.',
  ].join('\n');

  if (hasTelegram) {
    await sendNotification(confirmMsg);
    ok('Confirmation sent.');
  } else {
    warn('Telegram not set.'); console.log(`\n  ${confirmMsg.replace(/\n/g, '\n  ')}`);
  }

  hr('DONE');
  ok(`Output: ${outputDir}/`);
  ok('Open the MP4s and check image sync against narration.');
  const missing = [
    !hasGroq     && 'GROQ_API_KEY',
    !hasEL       && 'ELEVENLABS_API_KEY / THEOPHANY_VOICE_ID',
    !hasHF       && 'HF_API_TOKEN',
    !hasTelegram && 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID',
    !fs.existsSync('.theophany_token.json') && 'YouTube token (npm run auth)',
  ].filter(Boolean);
  if (missing.length) {
    console.log('\n  Still needed:');
    missing.forEach((m) => console.log(`    ·  ${m}`));
  }
  console.log();
}

dryRun().catch((err: unknown) => {
  console.error('\n  FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
