import fs from 'fs';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { TheologyScript, UploadResult } from './types.js';

const CATEGORY_ID = '27'; // Education
const CHANNEL_ID = 'UC2y3I4eHej3oZDtz46dHisA';

function buildDescription(script: TheologyScript): string {
  return [
    script.hookQuestion,
    '',
    `Passage: ${script.passage}`,
    '',
    'Theophany explores what biblical texts actually say, the hard questions they raise, and the range of ways they have been understood. Calm, reflective, intellectually honest.',
    '',
    'Subscribe for weekly scripture explainers.',
    '',
    `Channel: https://www.youtube.com/channel/${CHANNEL_ID}`,
  ].join('\n');
}

function buildTags(script: TheologyScript): string[] {
  return [
    'theology',
    'scripture',
    'bible',
    'explainer',
    'biblical studies',
    script.passage,
  ];
}

export async function uploadLongform(
  auth: OAuth2Client,
  script: TheologyScript,
  videoPath: string
): Promise<{ id: string; url: string }> {
  const youtube = google.youtube({ version: 'v3', auth });

  console.log(`  Uploading longform: ${script.hookQuestion}`);

  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: script.hookQuestion,
        description: buildDescription(script),
        tags: buildTags(script),
        categoryId: CATEGORY_ID,
        defaultLanguage: 'en',
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      mimeType: 'video/mp4',
      body: fs.createReadStream(videoPath),
    },
  });

  const id = response.data.id;
  if (!id) throw new Error('YouTube upload succeeded but returned no video ID');

  return { id, url: `https://www.youtube.com/watch?v=${id}` };
}

export async function uploadShorts(
  auth: OAuth2Client,
  script: TheologyScript,
  videoPath: string
): Promise<{ id: string; url: string }> {
  const youtube = google.youtube({ version: 'v3', auth });

  const title = `${script.hookQuestion} #Shorts`;
  console.log(`  Uploading Shorts: ${title}`);

  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title,
        description: buildDescription(script),
        tags: [...buildTags(script), 'shorts', 'bibleshorts', 'theophany'],
        categoryId: CATEGORY_ID,
        defaultLanguage: 'en',
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      mimeType: 'video/mp4',
      body: fs.createReadStream(videoPath),
    },
  });

  const id = response.data.id;
  if (!id) throw new Error('YouTube Shorts upload succeeded but returned no video ID');

  return { id, url: `https://www.youtube.com/watch?v=${id}` };
}

export async function uploadBoth(
  auth: OAuth2Client,
  script: TheologyScript,
  landscapeVideo: string,
  shortsVideo: string
): Promise<UploadResult> {
  const [longform, shorts] = await Promise.all([
    uploadLongform(auth, script, landscapeVideo),
    uploadShorts(auth, script, shortsVideo),
  ]);

  return {
    longformId: longform.id,
    longformUrl: longform.url,
    shortsId: shorts.id,
    shortsUrl: shorts.url,
  };
}
