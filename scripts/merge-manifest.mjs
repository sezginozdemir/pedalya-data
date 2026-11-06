// Aylik isin parcalarini tek paket listesinde birlestirir.
// Kullanim: node scripts/merge-manifest.mjs <onceki-manifest> <gelen-klasor> <cikti-dosyasi>
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mergeManifests } from '../server/packs.mjs';

const [previousFile, incoming, output] = process.argv.slice(2);
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));

const previous = existsSync(previousFile) ? read(previousFile) : null;
const updates = readdirSync(incoming)
  .map((name) => path.join(incoming, name, 'manifest.json'))
  .filter(existsSync)
  .map(read);
const merged = mergeManifests(previous, updates);
writeFileSync(output, JSON.stringify(merged));

const fresh = new Set(updates.flatMap((m) => m.packs.map((p) => p.id)));
const stale = merged.packs.filter((p) => !fresh.has(p.id)).map((p) => p.id);
console.log(`${merged.packs.length} paket, ${fresh.size} yeni`);
if (stale.length) console.log(`Eski surumde kalan: ${stale.join(', ')}`);
