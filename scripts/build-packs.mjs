// Ice aktarilan ulkelerden telefon paketleri uretir. Onayli duzeltmeler pakete islenir.
// Cikti data/packs icindedir; canlida bu klasor herhangi bir statik dosya barindirmaya yuklenebilir.
// Kullanim: node scripts/build-packs.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { openCommunity } from '../server/community.mjs';
import { ROOT, config } from '../server/config.mjs';
import { log } from '../server/lib.mjs';
import { applyCorrections, buildPacks } from '../server/packs.mjs';
import { openStore } from '../server/store.mjs';

const store = openStore();
const community = openCommunity();
const corrections = JSON.parse(readFileSync(path.join(ROOT, 'config', 'corrections.json'), 'utf8'));
const manifest = await buildPacks({
  store,
  community: { apply: (items) => applyCorrections(community.apply(items), corrections) },
  dir: config.packsDir,
});
store.close();
community.close();

for (const p of manifest.packs) {
  log('pack_built', { id: p.id, points: p.poiCount, mb: +(p.sizeBytes / 1048576).toFixed(2), version: p.version });
}
