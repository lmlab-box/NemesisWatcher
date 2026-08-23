import { WORLD, THRESHOLDS, MODEL } from './config.js';
import { shortLabel, addDays } from './lib/dates.js';
import { escapeHtml } from './lib/names.js';

const TELEGRAM_LIMIT = 4096;
const SAFE_LIMIT = 3800;

const pct = (value) => `${Math.round(value * 100)}%`;
const link = (row) => `<a href="${escapeHtml(row.wiki)}">${escapeHtml(row.name)}</a>`;

/**
 * Telegram renders `<blockquote expandable>` collapsed, showing the first few lines with
 * a "show more" affordance (Bot API 7.4+). Clients too old to know the attribute fall
 * back to a plain quote, which still reads fine.
 *
 * Only the two sections you act on every morning — what can spawn today — are left
 * expanded. Everything else is reference material and stays folded away.
 */
const collapsed = (body) => `<blockquote expandable>${body}</blockquote>`;

const SOURCE_SHORT = {
  exevopan: 'Exevo',
  guildstats: 'GS',
  tibiastatistic: 'TStat',
  tibiabossespl: 'TB.pl',
  tibiaboss: 'TBoss',
};

const AGREEMENT_MARK = { alto: '🟢', medio: '🟠', bajo: '🔴' };

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
  if (own.sightings) bits.push(`n=${own.sightings}`);
  if (own.status === 'overdue') bits.push('atrasado');
  return bits.length ? `   ${bits.join(' · ')}` : null;
}

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

/**
 * Bundles the reference sections into as few messages as possible, each section folded
 * into its own expandable quote so opening one leaves the others alone. A section too
 * long to fit is truncated rather than split, because a blockquote cannot straddle two
 * messages.
 */
function packCollapsed(sections) {
  const messages = [];
  let current = '';

  for (const { title, lines } of sections) {
    if (!lines.length) continue;

    let body = lines.join('\n');
    let block = `${title}\n${collapsed(body)}`;

    if (block.length > SAFE_LIMIT) {
      const kept = [];
      let size = 0;
      for (const line of lines) {
        if (size + line.length + 40 > SAFE_LIMIT - title.length) break;
        kept.push(line);
        size += line.length + 1;
      }
      body = `${kept.join('\n')}\n… y ${lines.length - kept.length} más`;
      block = `${title}\n${collapsed(body)}`;
    }

    if (current && `${current}\n\n${block}`.length > SAFE_LIMIT) {
      messages.push(current);
      current = block;
    } else {
      current = current ? `${current}\n\n${block}` : block;
    }
  }

  if (current) messages.push(current);
  return messages;
}

export function buildReport({ day, buckets, history, externals, bossList }) {
  const windowStart = addDays(day, -1);
  const messages = [];

  // ---- 1. What happened during the window that just closed ---------------------------
  const header = [
    `🐉 <b>${WORLD} · Nemesis</b>`,
    `🗓 Killstats del ${shortLabel(day)} (ventana ≈ ${shortLabel(windowStart)} 03:00 → ${shortLabel(day)} 03:00 CE(S)T)`,
  ].join('\n');

  const killedLines = buckets.killed.map(
    (row) => `• ${link(row)} ×${row.killedToday}${row.hard ? ' 💪' : ''}`,
  );
  messages.push(
    `${header}\n\n☠️ <b>Murieron en esta ventana</b> — su contador se reinició\n${
      killedLines.length
        ? collapsed(killedLines.join('\n'))
        : '<i>Ningún nemesis registrado en esta ventana.</i>'
    }`,
  );

  // ---- 2. Seen alive and not killed — short, rare, and the most actionable ------------
  // Left expanded on purpose: it is at most a couple of lines and it is the one thing
  // that says "this may be standing there right now".
  if (buckets.survived.length > 0) {
    messages.push(
      ...pack(
        '🩸 <b>Apareció y NO lo mataron</b> — puede seguir arriba ahora mismo',
        buckets.survived.map(
          (row) => `• ${link(row)} — mató a <b>${row.playersKilledToday}</b> jugador(es) y nadie lo mató`,
        ),
      ),
    );
  }

  // ---- 3. The two sections you actually act on, expanded ------------------------------
  messages.push(
    ...pack(
      `🔥 <b>Alta probabilidad hoy</b> (≥ ${pct(THRESHOLDS.high)})`,
      buckets.high.slice(0, THRESHOLDS.maxPerBucket).map((row, i) => candidateBlock(row, i + 1)),
      { empty: '<i>Ninguno supera el umbral hoy.</i>' },
    ),
  );

  messages.push(
    ...pack(
      `🟡 <b>Posible hoy</b> (${pct(THRESHOLDS.possible)} – ${pct(THRESHOLDS.high)})`,
      buckets.possible.slice(0, THRESHOLDS.maxPerBucket).map((row, i) => candidateBlock(row, i + 1)),
      { empty: '<i>Nada en este rango.</i>' },
    ),
  );

  // ---- 4. Reference material, folded ---------------------------------------------------
  const sourceStatus = externals
    .map((s) => (s.ok ? `✅ ${s.label}` : `❌ ${s.label} (${escapeHtml(s.error ?? 'error')})`))
    .join(' · ');

  messages.push(
    ...packCollapsed([
      {
        title: `👀 <b>Vistos vivos y nunca cazados</b> · ${buckets.stillUp.length} (últimos ${THRESHOLDS.stillUpMaxDays} días)`,
        lines: buckets.stillUp.map(
          (row) => `• ${link(row)} — hace <b>${row.own.daysSince}d</b> (${shortLabel(row.own.lastSeen)}), sin muerte registrada desde entonces`,
        ),
      },
      {
        title: `🕒 <b>Entran en ventana en ≤ ${THRESHOLDS.soonDays} días</b> · ${buckets.soon.length}`,
        lines: buckets.soon.map(
          (row) => `• ${link(row)} — en <b>${row.own.daysToWindow}d</b> (${row.own.daysSince}d sin verse, min ${row.own.minGap}d)`,
        ),
      },
      {
        title: `♻️ <b>Disponibles casi cualquier día</b> · ${buckets.frequent.length}`,
        lines: buckets.frequent.length ? [buckets.frequent.map((row) => link(row)).join(' · ')] : [],
      },
      {
        title: `🥶 <b>Sin rastro desde hace mucho</b> · ${buckets.dormant.length}`,
        lines: buckets.dormant.length
          ? [
              `Más de ${MODEL.dormantFactor}× su intervalo más largo observado — probablemente nadie los está haciendo.`,
              buckets.dormant.map((row) => `${link(row)} <i>(${row.own.daysSince}d)</i>`).join(' · '),
            ]
          : [],
      },
      {
        title: '📚 <b>Fuentes y método</b>',
        lines: [
          sourceStatus,
          '',
          `🧠 Modelo propio: historial de ${WORLD} ${history.coverage.from} → ${history.coverage.to} (${history.coverage.days} días, ${bossList.bosses.length} nemesis).`,
          '📐 El % es el hazard empírico de los intervalos observados, suavizado hacia 1/(espera media), ponderado con las demás fuentes.',
          '🟢 fuentes de acuerdo · 🟠 discrepan algo · 🔴 discrepan mucho',
          '⚠️ intervalos poco fiables (varios spawns o muy dispersos) · 🌙 boss de evento · 💪 hard nemesis',
          '❗ Estimación, no garantía. Un boss tameado o cazado sin registrar kill no aparece en killstats.',
        ],
      },
    ]),
  );

  return messages
    .filter((m) => m.trim().length > 0)
    .map((m) => (m.length > TELEGRAM_LIMIT ? `${m.slice(0, TELEGRAM_LIMIT - 20)}\n…` : m));
}
