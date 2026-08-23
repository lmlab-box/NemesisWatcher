const API = 'https://api.telegram.org';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Sends one message. Telegram rejects sends to a chat that never pressed START with
 * "chat not found", and a truncated token with "Unauthorized" — both are surfaced as-is
 * because they are the two failures that actually happen during setup.
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

/** Sends a chained report, pausing between messages so Telegram keeps them in order. */
export async function sendAll(token, chatId, messages) {
  const sent = [];
  for (const [index, message] of messages.entries()) {
    if (index > 0) await sleep(700);
    sent.push(await sendMessage(token, chatId, message));
  }
  return sent;
}
