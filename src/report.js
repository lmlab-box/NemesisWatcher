import { WORLD, THRESHOLDS } from './config.js';
import { shortLabel, addDays } from './lib/dates.js';
import { escapeHtml } from './lib/names.js';

const TELEGRAM_LIMIT = 4096;
const SAFE_LIMIT = 3800;

const pct = (value) => `${Math.round(value * 100)}%`;
const link = (row) => `<a href="${escapeHtml(row.wiki)}">${escapeHtml(row.name)}</a>`;

const SOURCE_SHORT = {
  exevopan: 'Exevo',
  guildstats: 'GS',
  tibiastatistic: 'TStat',
  tibiabossespl: 'TB.pl',
  tibiaboss: 'TBoss',
};

function flags(row) {
  const marks = [];
  if (row.event) marks.push('🌙');
  if (row.own.unreliable) marks.push('⚠️');
  return marks.length ? ` ${marks.join('')}` : '';
}

function externalLine(row) {
  const parts = [];
  for (const [sourceId, value] of Object.entries(row.external)) {
    const short = SOURCE_SHORT[sourceId] ?? sourceId;
    if (typeof value.chance === 'number') parts.push(`${short} ${pct(value.chance)}`);
    else if (typeof value.canSpawn === 'boolean') parts.push(`${short} ${value.canSpawn ? 'sí' : 'no'}`);
  }
  return parts.length ? `   ${parts.join(' · ')}` : null;
}

function modelLine(row) {
  const { own } = row;
  const bits = [];
  if (own.daysSince !== null) bits.push(`${own.daysSince}d sin verse`);
  if (own.minGap !== undefined) bits.push(`min ${own.minGap}d`);
  if (own.medianGap) bits.push(`med ${Math.round(own.medianGap)}d`);
  if (own.appearances) bits.push(`n=${own.appearances}`);
  if (own.status === 'overdue') bits.push('atrasado');
  return bits.length ? `   ${bits.join(' · ')}` : null;
}

const AGREEMENT_MARK = { alto: '🟢', medio: '🟠', bajo: '🔴' };

function candidateBlock(row, index) {
  const mark = row.agreement.level in AGREEMENT_MARK ? ` ${AGREEMENT_MARK[row.agreement.level]}` : '';
  const lines = [
    `${index}. ${link(row)} — <b>${row.consensus === null ? '?' : pct(row.consensus)}</b>${mark}${flags(row)}`,
  ];
  const model = modelLine(row);
  if (model) lines.push(model);
  const external = externalLine(row);
  if (external) lines.push(external);
  return lines.join('\n');
}

/** Packs atomic blocks into as few messages as Telegram's 4096-character limit allows. */
function pack(header, blocks, { empty = null } = {}) {
  if (blocks.length === 0) return empty ? [`${header}\n${empty}`] : [];

  const messages = [];
  let current = header;
  for (const block of blocks) {
    const candidate = `${current}\n${block}`;
    if (candidate.length > SAFE_LIMIT) {
      messages.push(current);
      current = `${header} <i>(cont.)</i>\n${block}`;
    } else {
      current = candidate;
    }
  }
  messages.push(current);
  return messages;
}

export function buildReport({ day, buckets, history, externals, bossList }) {
  const windowStart = addDays(day, -1);
  const messages = [];

  // ---- 1. What died during the window that just closed -----------------------------
  const killedBlocks = buckets.killed.map(
    (row) => `• ${link(row)} ×${row.killedToday}${row.hard ? ' 💪' : ''}`,
  );
  messages.push(
    ...pack(
      [
        `🐉 <b>${WORLD} · Nemesis</b>`,
        `🗓 Killstats del ${shortLabel(day)} (ventana ≈ ${shortLabel(windowStart)} 03:00 → ${shortLabel(day)} 03:00 CE(S)T)`,
        '',
        '☠️ <b>Murieron en esta ventana</b> — su contador se reinició, no los busques hoy',
      ].join('\n'),
      killedBlocks,
      { empty: '<i>Ningún nemesis registrado en esta ventana.</i>' },
    ),
  );

  // ---- 2. Most likely to spawn today ------------------------------------------------
  const high = buckets.high.slice(0, THRESHOLDS.maxPerBucket);
  messages.push(
    ...pack(
      `🔥 <b>Alta probabilidad hoy</b> (≥ ${pct(THRESHOLDS.high)})`,
      high.map((row, i) => candidateBlock(row, i + 1)),
      { empty: '<i>Ninguno supera el umbral hoy.</i>' },
    ),
  );

  // ---- 3. Possible, plus what enters its window shortly ------------------------------
  const possible = buckets.possible.slice(0, THRESHOLDS.maxPerBucket);
  messages.push(
    ...pack(
      `🟡 <b>Posible hoy</b> (${pct(THRESHOLDS.possible)} – ${pct(THRESHOLDS.high)})`,
      possible.map((row, i) => candidateBlock(row, i + 1)),
      { empty: '<i>Nada en este rango.</i>' },
    ),
  );

  const soonBlocks = buckets.soon.map(
    (row) => `• ${link(row)} — entra en ventana en <b>${row.own.daysToWindow}d</b> (${row.own.daysSince}d sin verse, min ${row.own.minGap}d)`,
  );
  if (soonBlocks.length > 0) {
    messages.push(...pack(`🕒 <b>Entran en ventana en ≤ ${THRESHOLDS.soonDays} días</b>`, soonBlocks));
  }

  // ---- 4. Always-available bosses, listed but never predicted ------------------------
  if (buckets.frequent.length > 0) {
    const names = buckets.frequent.map((row) => link(row)).join(' · ');
    messages.push(
      `♻️ <b>Disponibles casi cualquier día</b> (quest o instanciados, sin ventana que predecir)\n${names}`,
    );
  }

  // ---- 5. Provenance ----------------------------------------------------------------
  const sourceStatus = externals
    .map((s) => (s.ok ? `✅ ${s.label}` : `❌ ${s.label} (${escapeHtml(s.error ?? 'error')})`))
    .join(' · ');

  messages.push(
    [
      '📚 <b>Fuentes</b>',
      sourceStatus,
      '',
      `🧠 Modelo propio: historial de ${WORLD} ${history.coverage.from} → ${history.coverage.to} (${history.coverage.days} días, ${bossList.bosses.length} nemesis).`,
      '📐 El % es el hazard empírico de los intervalos observados, suavizado hacia 1/(espera media), ponderado con las demás fuentes.',
      '🟢 fuentes de acuerdo · 🟠 discrepan algo · 🔴 discrepan mucho · ⚠️ intervalos poco fiables (varios spawns o muy dispersos) · 🌙 boss de evento · 💪 hard nemesis',
      '❗ Estimación, no garantía. Un boss tameado o cazado sin registrar kill no aparece en killstats.',
    ].join('\n'),
  );

  return messages.filter((m) => m.trim().length > 0).map((m) => (m.length > TELEGRAM_LIMIT ? `${m.slice(0, TELEGRAM_LIMIT - 20)}\n…` : m));
}
