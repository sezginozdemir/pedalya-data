// config/bundled.json listesindeki paketleri uygulamanin icine kopyalar ve kod dosyasini uretir.
// Yeni uygulama surumu cikmadan once calistirilir. Kullanim: node scripts/bundle-packs.mjs
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, config } from '../server/config.mjs';

const assets = path.join(ROOT, 'mobile', 'assets', 'packs');
const manifest = JSON.parse(readFileSync(path.join(config.packsDir, 'manifest.json'), 'utf8'));
const wanted = JSON.parse(readFileSync(path.join(ROOT, 'config', 'bundled.json'), 'utf8'));

rmSync(assets, { recursive: true, force: true });
mkdirSync(assets, { recursive: true });

const entries = wanted.map((id) => {
  const pack = manifest.packs.find((p) => p.id === id);
  if (!pack) throw new Error(`Pakette yok: ${id}`);
  copyFileSync(path.join(config.packsDir, pack.file), path.join(assets, pack.file));
  return `  ${JSON.stringify(id)}: {
    info: ${JSON.stringify(pack)},
    asset: require('../../assets/packs/${pack.file}'),
  },`;
});

writeFileSync(path.join(ROOT, 'mobile', 'src', 'lib', 'bundled-packs.js'), `// scripts/bundle-packs.mjs tarafindan uretilir; elle duzenleme.
export const BUNDLED = {
${entries.join('\n')}
};
`);

const total = wanted.reduce((sum, id) => sum + manifest.packs.find((p) => p.id === id).sizeBytes, 0);
console.log(`${wanted.length} paket gomuldu, ${(total / 1048576).toFixed(1)} MB`);
