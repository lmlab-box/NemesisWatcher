import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyHistory } from './history.js';
import { indexBossList } from './bosslist.js';

const HISTORY_PATH = fileURLToPath(new URL('../data/history.json', import.meta.url));
const STATE_PATH = fileURLToPath(new URL('../data/state.json', import.meta.url));
const BOSSLIST_PATH = fileURLToPath(new URL('./data/nemesis.json', import.meta.url));

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function loadBossList() {
  return indexBossList(await readJson(BOSSLIST_PATH, null));
}

export async function loadHistory() {
  return { ...emptyHistory(), ...(await readJson(HISTORY_PATH, {})) };
}

export const saveHistory = (history) => writeJson(HISTORY_PATH, history);

export const loadState = () => readJson(STATE_PATH, { lastReportedDay: null, lastRunAt: null });

export const saveState = (state) => writeJson(STATE_PATH, state);
