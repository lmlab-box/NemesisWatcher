import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { UPSTREAM_LISTS } from '../src/config.js';
import { get } from '../src/lib/http.js';
import { wikiUrl } from '../src/lib/names.js';

/**
 * Regenerates src/data/nemesis.json from the two lists maintained in
 * tibiamaps/tibia-kill-stats:
 *
 *   analyze-bosses.mjs   -> the in-game Bosstiary categories, including nemesis-boss
 *   normalize-names.mjs  -> raw kill-statistics spelling -> pretty name
 *
 * Both are plain JS source, so they are parsed with a string-literal regex that handles
 * the two quoting styles the files mix ('Barbaria' and "Gaz'haragoth").
 */
const OUT = fileURLToPath(new URL('../src/data/nemesis.json', import.meta.url));

// Matches a single- or double-quoted JS string literal, capturing its raw body.
const STRING = String.raw`(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")`;

const unquote = (a, b) => (a ?? b ?? '').replace(/\\(['"\\])/g, '$1');

function readSet(source, key) {
  const start = source.indexOf(`['${key}', new Set([`);
  if (start < 0) return [];
  const end = source.indexOf('])],', start);
  const block = source.slice(start, end);
  return [...block.matchAll(new RegExp(STRING, 'g'))]
    .map((m) => unquote(m[1], m[2]))
    .filter((name) => name !== key);
}

function readAliasMap(source) {
  const pairs = new RegExp(String.raw`\[\s*${STRING}\s*,\s*${STRING}\s*\]`, 'g');
  const byPretty = new Map();
  for (const match of source.matchAll(pairs)) {
    const raw = unquote(match[1], match[2]);
    const pretty = unquote(match[3], match[4]);
    if (!byPretty.has(pretty)) byPretty.set(pretty, []);
    if (!byPretty.get(pretty).includes(raw)) byPretty.get(pretty).push(raw);
  }
  return byPretty;
}

const [categoriesSource, aliasSource] = await Promise.all([
  get(UPSTREAM_LISTS.categories),
  get(UPSTREAM_LISTS.aliases),
]);

const nemesis = readSet(categoriesSource, 'nemesis-boss');
if (nemesis.length < 80) throw new Error(`nemesis-boss set looks wrong (${nemesis.length} entries)`);

const hard = new Set(readSet(categoriesSource, 'hard-nemesis-boss'));
const eventCategories = ['full-moon-boss', 'dream-courts-nemesis-boss', 'make-believe-boss', 'candia-boss'];
const eventBosses = new Set(eventCategories.flatMap((category) => readSet(categoriesSource, category)));
const aliases = readAliasMap(aliasSource);

const bosses = [...nemesis].sort().map((name) => ({
  name,
  hard: hard.has(name),
  event: eventBosses.has(name),
  killStatsNames: aliases.get(name) ?? [name],
  wiki: wikiUrl(name),
}));

const payload = {
  generatedAt: new Date().toISOString().slice(0, 10),
  source: 'tibiamaps/tibia-kill-stats',
  count: bosses.length,
  bosses,
};

await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`Wrote ${bosses.length} nemesis bosses (${hard.size} hard, ${eventBosses.size} event-driven).`);

const identity = bosses.filter((b) => !aliases.has(b.name));
if (identity.length) console.log(`No alias entry, using identity: ${identity.map((b) => b.name).join(', ')}`);
