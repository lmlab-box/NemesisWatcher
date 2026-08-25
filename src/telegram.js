const API = 'https://api.telegram.org';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * `TELEGRAM_CHAT_ID` holds one or more destinations, separated by commas, semicolons or
 * whitespace. A destination is a numeric chat id (a person, or a channel — channels are
 * negative and start with -100), or a public channel's `@username`.
 *
 * Revoking someone's access is deleting their id from the secret; for a channel it is
 * removing them from the member list.
 */
export function parseRecipients(raw) {
  return String(raw ?? '')
    .split(/[,;\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Sends one message. The two failures that actually happen: "chat not found" when the
 * person never pressed START (or the bot is not an admin of the channel), and
 * "Unauthorized" when the token was truncated on paste.
 */
export async function sendMessage(token, chatId, text, { attempt = 0 } = {}) {
  const res = await fetch(`${API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  const payload = await res.json().catch(() => ({}));
  if (payload.ok) return payload.result;

  const retryAfter = payload?.parameters?.retry_after;
  if (retryAfter && attempt < 3) {
    await sleep((retryAfter + 1) * 1000);
    return sendMessage(token, chatId, text, { attempt: attempt + 1 });
  }

  throw new Error(`Telegram ${res.status}: ${payload.description ?? 'unknown error'}`);
}

/** Sends the chain to one destination, pausing so Telegram keeps the order. */
export async function sendChain(token, chatId, messages) {
  const sent = [];
  for (const [index, message] of messages.entries()) {
    if (index > 0) await sleep(700);
    sent.push(await sendMessage(token, chatId, message));
  }
  return sent;
}

/**
 * Delivers the report to every destination. One recipient failing — somebody blocked the
 * bot, or an id went stale — must not cost everybody else their report, so failures are
 * collected and returned instead of thrown. The caller decides that a run where *nobody*
 * received anything is a real failure.
 */
export async function broadcast(token, recipients, messages) {
  const results = [];
  for (const [index, chatId] of recipients.entries()) {
    if (index > 0) await sleep(400);
    try {
      const sent = await sendChain(token, chatId, messages);
      results.push({ chatId, ok: true, firstMessageId: sent[0]?.message_id ?? null });
    } catch (error) {
      results.push({ chatId, ok: false, error: error.message });
    }
  }
  return results;
}

/**
 * Pinning the first message of the chain gives anyone arriving later an anchor: Telegram
 * shows it in the bar at the top of the chat, and tapping it jumps to the start of the
 * day's report instead of an empty screen.
 *
 * Requires the "Pin messages" admin right in a channel or group; in a private chat it
 * always works. A refusal is returned rather than thrown — a missing permission must not
 * cost anybody their report.
 */
async function pinCall(token, method, body) {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  return payload.ok ? { ok: true } : { ok: false, error: payload.description ?? `HTTP ${res.status}` };
}

export function pinMessage(token, chatId, messageId) {
  return pinCall(token, 'pinChatMessage', { chat_id: chatId, message_id: messageId, disable_notification: true });
}

export function unpinMessage(token, chatId, messageId) {
  return pinCall(token, 'unpinChatMessage', { chat_id: chatId, message_id: messageId });
}
