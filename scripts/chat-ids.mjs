/**
 * Prints every chat the bot has recently seen: your private chat, any group, and any
 * channel it administers. Run it from the "List Telegram chat ids" workflow so the token
 * stays in the repository secret instead of being pasted into a URL.
 *
 * getUpdates is not consumed here — no offset is acknowledged — so the queue is left
 * intact and this is safe to run as many times as needed. Telegram keeps updates for
 * about 24 hours, so post a message in the channel shortly before running it.
 */
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not set.');
  process.exit(1);
}

// The token sits in the URL, so nothing derived from it is ever printed on failure.
const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=100&timeout=0`);
const payload = await response.json().catch(() => null);

if (!payload?.ok) {
  const reason = payload?.description ?? `HTTP ${response.status}`;
  console.error(`Telegram refused the request: ${reason}`);
  if (/webhook/i.test(reason)) {
    console.error('A webhook is set for this bot; getUpdates cannot be used while it is active.');
  }
  process.exit(1);
}

const chats = new Map();
for (const update of payload.result) {
  const candidates = [
    update.message?.chat,
    update.edited_message?.chat,
    update.channel_post?.chat,
    update.edited_channel_post?.chat,
    update.my_chat_member?.chat,
    update.callback_query?.message?.chat,
  ];
  for (const chat of candidates) {
    if (chat?.id !== undefined) chats.set(chat.id, chat);
  }
}

if (chats.size === 0) {
  console.log('No chats found in the last 24 hours of updates.');
  console.log('');
  console.log('For a channel, in this order:');
  console.log('  1. add the bot as an administrator of the channel, with "Post messages"');
  console.log('  2. post any message in the channel *after* adding it');
  console.log('  3. run this workflow again');
  console.log('');
  console.log('A bot only receives channel posts from channels it administers, and only');
  console.log('from the moment it became an administrator.');
  process.exit(0);
}

console.log(`Found ${chats.size} chat(s):`);
console.log('');
for (const chat of chats.values()) {
  const label = chat.title ?? [chat.first_name, chat.last_name].filter(Boolean).join(' ') ?? '';
  const handle = chat.username ? ` @${chat.username}` : '';
  console.log(`  id: ${chat.id}`);
  console.log(`  type: ${chat.type}${handle}`);
  console.log(`  name: ${label}`);
  console.log('');
}
console.log('Put the ones you want in the TELEGRAM_CHAT_ID secret, separated by commas.');
console.log('Channel ids are negative and start with -100.');
