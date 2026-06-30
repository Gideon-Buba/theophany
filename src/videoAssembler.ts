import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { AudioSegment, AssembledVideo } from './types.js';

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stderr: Buffer[] = [];
    proc.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}:\n${Buffer.concat(stderr).toString().slice(-800)}`));
    });
    proc.on('error', (err) => reject(new Error(`spawn ffmpeg: ${err.message}`)));
  });
}

async function buildSegmentVideo(
  imagePaths: string[],
  audioSegment: AudioSegment,
  outputPath: string
): Promise<void> {
  const { audioPath, beatStartTimes, totalDurationSeconds } = audioSegment;

  // Compute per-image durations from beat boundary timestamps
  const durations = beatStartTimes.map((t, i) =>
    i < beatStartTimes.length - 1
      ? beatStartTimes[i + 1]! - t
      : totalDurationSeconds - t
  );

  if (imagePaths.length === 1 || durations.some((d) => d <= 0)) {
    // Fallback: single image for full segment
    await ffmpeg([
      '-loop', '1', '-i', imagePaths[0]!,
      '-i', audioPath,
      '-c:v', 'libx264', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-shortest', '-y', outputPath,
    ]);
    return;
  }

  // Build inputs: each image looped for its beat duration
  const inputArgs: string[] = [];
  for (let i = 0; i < imagePaths.length; i++) {
    inputArgs.push('-loop', '1', '-t', durations[i]!.toFixed(3), '-i', imagePaths[i]!);
  }
  inputArgs.push('-i', audioPath);

  // filter_complex: scale each image then concat
  const scaleFilters = imagePaths
    .map((_, i) => `[${i}:v]scale=1024:1024:force_original_aspect_ratio=decrease,pad=1024:1024:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`)
    .join(';');
  const concatInput = imagePaths.map((_, i) => `[v${i}]`).join('');
  const filterComplex = `${scaleFilters};${concatInput}concat=n=${imagePaths.length}:v=1:a=0[vout]`;

  await ffmpeg([
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    '-map', `${imagePaths.length}:a`,
    '-c:v', 'libx264', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-y', outputPath,
  ]);
}

async function concatenateSegments(segmentPaths: string[], outputPath: string): Promise<void> {
  const listPath = path.join(path.dirname(outputPath), 'concat_list.txt');
  const content = segmentPaths.map((p) => `file '${path.resolve(p)}'`).join('\n');
  await fs.promises.writeFile(listPath, content);

  await ffmpeg([
    '-f', 'concat', '-safe', '0', '-i', listPath,
    '-c', 'copy', '-y', outputPath,
  ]);

  await fs.promises.unlink(listPath);
}

async function renderFormat(
  inputPath: string,
  width: number,
  height: number,
  outputPath: string
): Promise<void> {
  await ffmpeg([
    '-i', inputPath,
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
    '-c:a', 'copy', '-y', outputPath,
  ]);
}

export async function assembleVideo(
  imageGroups: string[][],
  audioSegments: AudioSegment[],
  outputDir: string
): Promise<AssembledVideo> {
  if (imageGroups.length !== audioSegments.length) {
    throw new Error(`Image groups (${imageGroups.length}) and audio segments (${audioSegments.length}) count mismatch`);
  }

  const segmentsDir = path.join(outputDir, 'segments');
  await fs.promises.mkdir(segmentsDir, { recursive: true });

  console.log('  Building segment videos...');
  const segmentPaths: string[] = [];

  for (let i = 0; i < imageGroups.length; i++) {
    const segPath = path.join(segmentsDir, `segment_${i}.mp4`);
    await buildSegmentVideo(imageGroups[i]!, audioSegments[i]!, segPath);
    segmentPaths.push(segPath);
    console.log(`  Segment ${i + 1}/${imageGroups.length} done`);
  }

  const combinedPath = path.join(outputDir, 'combined.mp4');
  console.log('  Concatenating...');
  await concatenateSegments(segmentPaths, combinedPath);

  const landscapeVideo = path.join(outputDir, 'final_landscape.mp4');
  const shortsVideo = path.join(outputDir, 'final_shorts.mp4');

  console.log('  Rendering landscape (1920×1080)...');
  await renderFormat(combinedPath, 1920, 1080, landscapeVideo);

  console.log('  Rendering shorts (1080×1920)...');
  await renderFormat(combinedPath, 1080, 1920, shortsVideo);

  await fs.promises.unlink(combinedPath);
  return { landscapeVideo, shortsVideo };
}
