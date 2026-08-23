import { KILLSTATS_TZ, KILLSTATS_BOUNDARY_HOUR } from '../config.js';

const DAY_MS = 86_400_000;

/** Date/hour in the kill-statistics timezone, without dragging in a tz library. */
function zoned(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: KILLSTATS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 };
}

/**
 * The killstats day whose data is available right now.
 * Before the boundary hour the refresh has not landed yet, so the newest closed day
 * is still the previous one.
 */
export function currentKillstatsDay(now = new Date()) {
  const { day, hour } = zoned(now);
  return hour < KILLSTATS_BOUNDARY_HOUR ? addDays(day, -1) : day;
}

export function addDays(day, delta) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function dayRange(from, to) {
  const out = [];
  for (let day = from; daysBetween(day, to) >= 0; day = addDays(day, 1)) out.push(day);
  return out;
}

/** "22 ago" — short Spanish label for report headers. */
export function shortLabel(day) {
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const [, m, d] = day.split('-');
  return `${Number(d)} ${months[Number(m) - 1]}`;
}
