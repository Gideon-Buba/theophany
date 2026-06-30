import TelegramBot from 'node-telegram-bot-api';
import type { TheologyScript, UploadResult } from './types.js';

const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

function getEnv(): { token: string; chatId: string } {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  if (!chatId) throw new Error('TELEGRAM_CHAT_ID is not set');
  return { token, chatId };
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(text: string, maxChars = 300): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function segmentText(seg: import('./types.js').ExplainerSegment): string {
  return seg.beats.map((b) => b.narration).join(' ');
}

function formatApprovalMessage(script: TheologyScript): string {
  const previewLines = script.segments.slice(0, 3)
    .map((s) => `<b>${s.name.toUpperCase()}</b>\n${esc(truncate(segmentText(s), 280))}`)
    .join('\n\n');

  return [
    '📖 <b>New Theophany Episode for Review</b>',
    '',
    `<b>Passage:</b> ${esc(script.passage)}`,
    `<b>Hook Question:</b> ${esc(script.hookQuestion)}`,
    '',
    '<b>Script Preview (3 of 6 segments):</b>',
    '',
    previewLines,
    '',
    '─────────────────────────',
    '⚠️ <b>Before approving:</b> Please verify all scriptural references, historical claims, and factual statements for accuracy.',
    '',
    '<i>Both the long-form video (16:9) and Shorts (9:16) will be generated from this script.</i>',
    '',
    'Approve or reject below. Timeout in 10 minutes — no response = rejected.',
  ].join('\n');
}

export async function requestApproval(script: TheologyScript): Promise<boolean> {
  const { token, chatId } = getEnv();
  const bot = new TelegramBot(token, { polling: true });

  let resolved = false;
  let resolveApproval: (approved: boolean) => void;

  const approvalPromise = new Promise<boolean>((resolve) => {
    resolveApproval = resolve;
  });

  const cleanup = async (approved: boolean): Promise<void> => {
    if (resolved) return;
    resolved = true;
    resolveApproval(approved);
    clearTimeout(timer);
    bot.removeListener('callback_query', onCallbackQuery);
    try {
      await bot.stopPolling();
    } catch {
      // ignore stop errors
    }
  };

  const timer = setTimeout(() => {
    console.log('Telegram approval timed out after 10 minutes');
    void cleanup(false);
  }, APPROVAL_TIMEOUT_MS);

  let approvalMessageId: number | undefined;

  const onCallbackQuery = async (query: TelegramBot.CallbackQuery): Promise<void> => {
    if (query.message?.message_id !== approvalMessageId) return;
    if (resolved) return;

    const approved = query.data === 'approve';
    const label = approved ? 'Approved ✅' : 'Rejected ❌';

    try {
      await bot.answerCallbackQuery(query.id, { text: label });
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: chatId, message_id: approvalMessageId }
      );
      await bot.sendMessage(chatId, `Script ${label}. Pipeline ${approved ? 'continuing' : 'aborted'}.`);
    } catch {
      // best-effort — don't block approval resolution
    }

    await cleanup(approved);
  };

  bot.on('callback_query', onCallbackQuery);

  try {
    const message = await bot.sendMessage(chatId, formatApprovalMessage(script), {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Approve', callback_data: 'approve' },
            { text: '❌ Reject', callback_data: 'reject' },
          ],
        ],
      },
    });
    approvalMessageId = message.message_id;
  } catch (err) {
    clearTimeout(timer);
    await bot.stopPolling().catch(() => undefined);
    throw new Error(
      `Failed to send Telegram approval message: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return approvalPromise;
}

export async function sendNotification(text: string): Promise<void> {
  const { token, chatId } = getEnv();
  const bot = new TelegramBot(token, { polling: false });
  await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
}

export async function sendUploadConfirmation(result: UploadResult): Promise<void> {
  const message = [
    '🎉 <b>Theophany episode published!</b>',
    '',
    `📺 Long-form: ${result.longformUrl}`,
    `📱 Shorts: ${result.shortsUrl}`,
  ].join('\n');

  await sendNotification(message);
}
