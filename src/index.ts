import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { generateScript } from './scriptGenerator.js';
import { generateImages } from './imageGen.js';
import { generateAudio } from './tts.js';
import { assembleVideo } from './videoAssembler.js';
import { loadAuthClient } from './auth.js';
import { uploadBoth } from './uploader.js';
import { requestApproval, sendNotification, sendUploadConfirmation } from './telegramBot.js';
import type { SeedTopic } from './types.js';

const SEED_TOPICS: SeedTopic[] = [
  {
    passage: 'John 5:1-47',
    question: 'Why would Jesus ask a sick man if he wants to be healed?',
  },
  {
    passage: 'Genesis 22',
    question: 'What kind of God asks Abraham to sacrifice his son?',
  },
  {
    passage: 'Job 38-42',
    question: 'God answers Job out of the whirlwind: is that an answer?',
  },
  {
    passage: 'Luke 15',
    question: 'The prodigal son and the brother who stayed: who is the real subject?',
  },
  {
    passage: 'Exodus 3',
    question: 'The burning bush and the name no one can pin down',
  },
  {
    passage: 'John 11',
    question: 'Jesus weeps at Lazarus\'s tomb: why, if he knew what he was about to do?',
  },
  {
    passage: 'Matthew 5:38-48',
    question: 'Turn the other cheek: resistance or passivity?',
  },
  {
    passage: 'Mark 5:1-20',
    question: 'The Gerasene demoniac: what does Legion mean?',
  },
  {
    passage: 'Romans 9',
    question: 'Does God harden hearts? The problem of divine sovereignty',
  },
  {
    passage: 'Revelation 21',
    question: 'A new heaven and earth: what is the shape of the end?',
  },
];

interface PipelineState {
  nextTopicIndex: number;
}

const STATE_FILE = '.theophany_state.json';

function loadState(): PipelineState {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as PipelineState;
  } catch {
    return { nextTopicIndex: 0 };
  }
}

function saveState(state: PipelineState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function nextTopic(): SeedTopic {
  const state = loadState();
  const topic = SEED_TOPICS[state.nextTopicIndex % SEED_TOPICS.length];
  if (!topic) throw new Error('SEED_TOPICS is empty');
  state.nextTopicIndex = (state.nextTopicIndex + 1) % SEED_TOPICS.length;
  saveState(state);
  return topic;
}

async function runPipeline(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Starting Theophany pipeline`);

  const topic = nextTopic();
  console.log(`Topic: ${topic.passage} — ${topic.question}`);

  // 1. Generate script
  console.log('\nStep 1: Generating script via Groq...');
  const script = await generateScript(topic);
  console.log(`Script ready: "${script.hookQuestion}"`);

  // 2. Telegram HITL approval
  console.log('\nStep 2: Awaiting Telegram approval...');
  const approved = await requestApproval(script);

  if (!approved) {
    console.log('Script not approved or timed out. Aborting pipeline.');
    await sendNotification('⚠️ Theophany pipeline aborted: script was rejected or timed out.');
    return;
  }
  console.log('Script approved.');

  const runId = `run_${Date.now()}`;
  const outputDir = path.join('output', runId);
  await fs.promises.mkdir(outputDir, { recursive: true });

  try {
    // 3. Generate TTS audio with beat timestamps
    console.log('\nStep 3: Generating audio (ElevenLabs)...');
    const audioSegments = await generateAudio(script, outputDir);

    // 4. Generate images — 3 per segment = 18 total, synced to beat timestamps
    console.log('\nStep 4: Generating images (FLUX.1-schnell)...');
    const imageGroups = await generateImages(script, outputDir);

    // 5. Assemble video — images swap at beat boundaries
    console.log('\nStep 5: Assembling video (ffmpeg)...');
    const { landscapeVideo, shortsVideo } = await assembleVideo(imageGroups, audioSegments, outputDir);

    // 6. Upload to YouTube
    console.log('\nStep 6: Uploading to YouTube...');
    const auth = loadAuthClient();
    const result = await uploadBoth(auth, script, landscapeVideo, shortsVideo);

    console.log(`\nUploaded:`);
    console.log(`  Longform: ${result.longformUrl}`);
    console.log(`  Shorts:   ${result.shortsUrl}`);

    // 7. Send Telegram confirmation
    await sendUploadConfirmation(result);

    console.log(`\n[${new Date().toISOString()}] Pipeline complete (${runId})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Pipeline error:', message);
    await sendNotification(`❌ Theophany pipeline error:\n\`${message}\``).catch(() => undefined);
    throw err;
  }
}

// Schedule: 8pm WAT daily (WAT = Africa/Lagos = UTC+1)
cron.schedule(
  '0 20 * * *',
  () => {
    runPipeline().catch((err: unknown) => {
      console.error('Unhandled pipeline error:', err);
    });
  },
  { timezone: 'Africa/Lagos' }
);

console.log('Theophany pipeline scheduled for 20:00 WAT (Africa/Lagos) daily.');
console.log('Run "npm run auth" first if you haven\'t authenticated with YouTube.');

// await runPipeline();
