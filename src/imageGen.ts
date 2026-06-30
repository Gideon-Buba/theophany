import fs from 'fs';
import path from 'path';
import type { TheologyScript } from './types.js';

// HuggingFace migrated from api-inference.huggingface.co → router.huggingface.co/hf-inference
const HF_MODEL_URL =
  'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell';

async function fetchWithRetry(prompt: string, attempt = 0): Promise<Buffer> {
  const token = process.env.HF_API_TOKEN;
  if (!token) throw new Error('HF_API_TOKEN is not set');

  let response: Response;
  try {
    response = await fetch(HF_MODEL_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputs: prompt,
        parameters: { num_inference_steps: 4, width: 1024, height: 1024 },
      }),
    });
  } catch (err) {
    if (attempt < 2) {
      const delay = Math.pow(2, attempt) * 1500;
      console.log(`    HuggingFace network error, retry in ${delay}ms...`);
      await sleep(delay);
      return fetchWithRetry(prompt, attempt + 1);
    }
    throw err;
  }

  if (response.status === 503) {
    if (attempt < 2) {
      let waitMs = Math.pow(2, attempt) * 3000;
      try {
        const body = (await response.json()) as { estimated_time?: number };
        if (typeof body.estimated_time === 'number') waitMs = Math.max(body.estimated_time * 1000, waitMs);
      } catch { /* ignore */ }
      console.log(`    Model loading, waiting ${waitMs}ms...`);
      await sleep(waitMs);
      return fetchWithRetry(prompt, attempt + 1);
    }
    throw new Error('HuggingFace model unavailable after 3 attempts');
  }

  if (!response.ok) {
    if (attempt < 2) {
      await sleep(Math.pow(2, attempt) * 2000);
      return fetchWithRetry(prompt, attempt + 1);
    }
    const body = await response.text().catch(() => '(unreadable)');
    throw new Error(`HuggingFace API (${response.status}): ${body.slice(0, 200)}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateImages(
  script: TheologyScript,
  outputDir: string
): Promise<string[][]> {
  const imageDir = path.join(outputDir, 'images');
  await fs.promises.mkdir(imageDir, { recursive: true });

  const groups: string[][] = [];

  for (const segment of script.segments) {
    const segmentPaths: string[] = [];

    for (let beatIdx = 0; beatIdx < segment.beats.length; beatIdx++) {
      const beat = segment.beats[beatIdx]!;
      const prompt = beat.imagePrompt;
      const imagePath = path.join(imageDir, `${segment.name}_${beatIdx}.png`);

      console.log(`  [${segment.name} beat ${beatIdx + 1}/${segment.beats.length}] ${prompt.slice(0, 90)}...`);

      const buffer = await fetchWithRetry(prompt);
      await fs.promises.writeFile(imagePath, buffer);
      segmentPaths.push(imagePath);

      console.log(`  Saved: ${imagePath}`);
    }

    groups.push(segmentPaths);
  }

  return groups;
}
