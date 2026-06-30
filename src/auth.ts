import 'dotenv/config';
import fs from 'fs';
import readline from 'readline';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

const TOKEN_PATH = '.theophany_token.json';
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
];

function createOAuthClient(): OAuth2Client {
  const clientId = process.env.THEOPHANY_YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.THEOPHANY_YOUTUBE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'THEOPHANY_YOUTUBE_CLIENT_ID and THEOPHANY_YOUTUBE_CLIENT_SECRET must be set in .env'
    );
  }

  return new google.auth.OAuth2(clientId, clientSecret, 'urn:ietf:wg:oauth:2.0:oob');
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function loadAuthClient(): OAuth2Client {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(`No token found at ${TOKEN_PATH}. Run: npm run auth`);
  }

  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8')) as Record<string, unknown>;
  const client = createOAuthClient();
  client.setCredentials(tokens);
  return client;
}

async function main(): Promise<void> {
  const client = createOAuthClient();

  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\nOpen this URL in your browser:\n');
  console.log(authUrl);
  console.log('\nAfter authorising, Google will show you a code.\n');

  const code = await prompt('Paste the code here: ');

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log(`\nToken saved to ${TOKEN_PATH}`);
  console.log('You can now run the pipeline: npm run dev');
}

main().catch((err: unknown) => {
  console.error('Auth failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
