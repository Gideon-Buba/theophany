import fs from 'fs';
import path from 'path';
import type { TheologyScript, AudioSegment, ScriptBeat } from './types.js';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
const MODEL_ID = 'eleven_turbo_v2_5';

function getVoiceId(): string {
  const voiceId = process.env.THEOPHANY_VOICE_ID || process.env.ELEVENLABS_VOICE_ID;
  if (!voiceId) {
    throw new Error('No ElevenLabs voice ID. Set THEOPHANY_VOICE_ID in .env');
  }
  return voiceId;
}

interface ElevenLabsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

interface ElevenLabsTimestampResponse {
  audio_base64: string;
  alignment: ElevenLabsAlignment;
}

function beatStartTimesFromAlignment(
  beats: ScriptBeat[],
  alignment: ElevenLabsAlignment
): number[] {
  const times = [0.0];
  const { character_start_times_seconds: startTimes } = alignment;

  let charPos = 0;
  for (let i = 0; i < beats.length - 1; i++) {
    charPos += beats[i]!.narration.length + 1; // +1 for the space separator
    const idx = Math.min(charPos, startTimes.length - 1);
    times.push(startTimes[idx] ?? 0);
  }

  return times;
}

function wordCountTimes(beats: ScriptBeat[], totalDuration: number): number[] {
  const counts = beats.map((b) => b.narration.split(/\s+/).length);
  const total = counts.reduce((a, b) => a + b, 0);
  const times = [0.0];
  let elapsed = 0;
  for (let i = 0; i < counts.length - 1; i++) {
    elapsed += (counts[i]! / total) * totalDuration;
    times.push(elapsed);
  }
  return times;
}

async function synthesizeWithTimestamps(
  text: string,
  voiceId: string,
  apiKey: string
): Promise<{ audioBuffer: Buffer; alignment: ElevenLabsAlignment }> {
  const response = await fetch(
    `${ELEVENLABS_BASE}/${voiceId}/with-timestamps`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: { stability: 0.65, similarity_boost: 0.75, style: 0.0, use_speaker_boost: false },
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '(unreadable)');
    throw new Error(`ElevenLabs timestamps API failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as ElevenLabsTimestampResponse;
  const audioBuffer = Buffer.from(data.audio_base64, 'base64');
  return { audioBuffer, alignment: data.alignment };
}

export async function generateAudio(
  script: TheologyScript,
  outputDir: string
): Promise<AudioSegment[]> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set');
  const voiceId = getVoiceId();

  const audioDir = path.join(outputDir, 'audio');
  await fs.promises.mkdir(audioDir, { recursive: true });

  const results: AudioSegment[] = [];

  for (const segment of script.segments) {
    const fullText = segment.beats.map((b) => b.narration).join(' ');
    console.log(`  Synthesizing [${segment.name}] (${segment.beats.length} beats)...`);

    const audioPath = path.join(audioDir, `${segment.name}.mp3`);
    let beatStartTimes: number[];
    let totalDurationSeconds: number;

    try {
      const { audioBuffer, alignment } = await synthesizeWithTimestamps(fullText, voiceId, apiKey);
      await fs.promises.writeFile(audioPath, audioBuffer);

      const lastEndTimes = alignment.character_end_times_seconds;
      totalDurationSeconds = lastEndTimes[lastEndTimes.length - 1] ?? 0;
      beatStartTimes = beatStartTimesFromAlignment(segment.beats, alignment);

      console.log(`  Saved: ${audioPath} (${totalDurationSeconds.toFixed(1)}s)`);
      console.log(`  Beat times: ${beatStartTimes.map((t) => t.toFixed(1) + 's').join(', ')}`);
    } catch (err) {
      console.warn(`  ElevenLabs timestamps failed, falling back: ${err instanceof Error ? err.message : String(err)}`);
      // Fall back to plain TTS + word-count timing
      const plainResponse = await fetch(`${ELEVENLABS_BASE}/${voiceId}`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({
          text: fullText,
          model_id: MODEL_ID,
          voice_settings: { stability: 0.65, similarity_boost: 0.75 },
        }),
      });
      if (!plainResponse.ok) {
        throw new Error(`ElevenLabs TTS failed (${plainResponse.status})`);
      }
      const buffer = Buffer.from(await plainResponse.arrayBuffer());
      await fs.promises.writeFile(audioPath, buffer);
      const wordCount = fullText.split(/\s+/).length;
      totalDurationSeconds = Math.round((wordCount / 130) * 60);
      beatStartTimes = wordCountTimes(segment.beats, totalDurationSeconds);
    }

    results.push({ audioPath, beatStartTimes, totalDurationSeconds });
  }

  return results;
}
