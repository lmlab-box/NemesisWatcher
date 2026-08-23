/**
 * Boss names differ per site: "Arthom The Hunter" vs "Arthom the Hunter",
 * "Gaz'haragoth" vs "gaz-haragoth", "The Voice Of Ruin" vs "The Voice of Ruin".
 * Everything is matched on this aggressively stripped key.
 */
export function normalizeName(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function wikiUrl(name) {
  return `https://tibia.fandom.com/wiki/${name.replace(/ /g, '_')}`;
}

export function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
