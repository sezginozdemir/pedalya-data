// Ulke paketleri. Duz .db dosyalaridir: statik barindirma sikistirmayi telefona gorunmez sekilde acmaz.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const PACK_SCHEMA = 2; // Dosya bicimi degisirse artar; eski uygulamalar uyumsuz paketi indirmez
const FIELDS = ['id', 'cat', 'name', 'lat', 'lon', 'phone', 'website', 'hours', 'address', 'repair', 'rental', 'pump'];

export function writePack(file, items, paths = []) {
  rmSync(file, { force: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE pois (
      id TEXT PRIMARY KEY, cat TEXT NOT NULL, name TEXT, lat REAL NOT NULL, lon REAL NOT NULL,
      phone TEXT, website TEXT, hours TEXT, address TEXT,
      repair INTEGER NOT NULL, rental INTEGER NOT NULL, pump INTEGER NOT NULL
    ) WITHOUT ROWID;
    CREATE INDEX pois_position ON pois (lat, lon);
    CREATE TABLE cycleways (kind TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, km REAL NOT NULL, coords TEXT NOT NULL);
    CREATE INDEX cycleways_position ON cycleways (lat, lon);
  `);
  const insert = db.prepare(`INSERT OR IGNORE INTO pois VALUES (${Array(FIELDS.length).fill('?').join(', ')})`);
  db.exec('BEGIN');
  for (const p of items) insert.run(...FIELDS.map((f) => (typeof p[f] === 'boolean' ? Number(p[f]) : p[f])));
  const insertPath = db.prepare('INSERT INTO cycleways VALUES (?, ?, ?, ?, ?)');
  for (const p of paths) insertPath.run(p.kind, p.lat, p.lon, Math.round(p.km * 100) / 100, p.coords);
  db.exec('COMMIT');
  db.exec('VACUUM');
  db.close();
}

const LANGUAGES = ['tr', 'en', 'it', 'de', 'nl']; // mobile/src/lib/i18n.js ile ayni

function packTitle(region, language) {
  const names = new Intl.DisplayNames([language], { type: 'region' });
  return region.countries.length ? region.countries.map((c) => names.of(c)).join(', ') : region.name;
}

// Medyan, sinir kutusunun aksine denize veya bos alana dusmez: noktalarin yogun oldugu yerdir
function medianCenter(items) {
  const middle = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  return { lat: middle(items.map((p) => p.lat)), lon: middle(items.map((p) => p.lon)) };
}

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// Sunucu olmadan onaylanan duzeltmeler config/corrections.json dosyasinda durur
export function applyCorrections(items, corrections) {
  const byId = new Map(corrections.map((c) => [c.id, c]));
  return items.flatMap((item) => {
    if (/^(off|closed)$/i.test(item.hours ?? '')) return []; // Eski icerik aktarimlarindan kalanlar
    const c = byId.get(item.id);
    if (!c) return [item];
    if (c.closed) return [];
    return [{ ...item, name: c.name ?? item.name, phone: c.phone ?? item.phone, hours: c.hours ?? item.hours }];
  });
}

// Parcali uretim: yeni gelen paketler eskilerin yerine gecer, basarisiz ulkenin eski paketi korunur
export function mergeManifests(previous, updates) {
  const packs = new Map();
  const usable = previous?.schema === PACK_SCHEMA ? [previous] : [];
  for (const manifest of [...usable, ...updates]) {
    for (const pack of manifest.packs) packs.set(pack.id, pack);
  }
  return {
    schema: PACK_SCHEMA,
    generatedAt: new Date().toISOString(),
    packs: [...packs.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export async function buildPacks({ store, community, dir }) {
  mkdirSync(dir, { recursive: true });
  const packs = [];

  for (const region of store.regions()) {
    const items = community.apply(store.regionItems(region.id));
    const dbFile = path.join(dir, `${region.id}.db`);
    const paths = store.regionPaths(region.id);
    writePack(dbFile, items, paths);

    packs.push({
      id: region.id,
      name: region.name,
      titles: Object.fromEntries(LANGUAGES.map((language) => [language, packTitle(region, language)])),
      countries: region.countries,
      bounds: { south: region.south, west: region.west, north: region.north, east: region.east },
      center: medianCenter(items),
      dataDate: region.dataDate,
      poiCount: items.length,
      pathKm: Math.round(paths.reduce((sum, p) => sum + p.km, 0)),
      counts: Object.fromEntries(['shop', 'repair', 'rental', 'park', 'water'].map((cat) => [cat, items.filter((p) => p.cat === cat).length])),
      file: `${region.id}.db`,
      sizeBytes: statSync(dbFile).size,
      version: (await digest(dbFile)).slice(0, 16), // Icerik degisince surum degisir
    });
  }

  writeFileSync(path.join(dir, 'LICENSE.txt'), 'Data (c) OpenStreetMap contributors. Licensed under the Open Database License (ODbL) 1.0.\nhttps://www.openstreetmap.org/copyright\n');
  const manifest = { schema: PACK_SCHEMA, generatedAt: new Date().toISOString(), packs };
  writeFileSync(path.join(dir, 'manifest.json.tmp'), JSON.stringify(manifest));
  renameSync(path.join(dir, 'manifest.json.tmp'), path.join(dir, 'manifest.json'));
  return manifest;
}
