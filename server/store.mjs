// Nokta deposu. Veritabani erisimi sadece burada; PostGIS'e geciste degisecek tek dosya.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';

const FIELDS = ['id', 'cat', 'name', 'lat', 'lon', 'phone', 'website', 'hours', 'address', 'repair', 'rental', 'pump'];

export function openStore(file = config.placesDb) {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS pois (
      rowid INTEGER PRIMARY KEY,
      region TEXT NOT NULL, id TEXT NOT NULL, cat TEXT NOT NULL, name TEXT,
      lat REAL NOT NULL, lon REAL NOT NULL,
      phone TEXT, website TEXT, hours TEXT, address TEXT,
      repair INTEGER NOT NULL, rental INTEGER NOT NULL, pump INTEGER NOT NULL,
      UNIQUE (region, id)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS pois_index USING rtree(rowid, minLat, maxLat, minLon, maxLon);
    CREATE TABLE IF NOT EXISTS cycleways (
      region TEXT NOT NULL, id INTEGER NOT NULL, kind TEXT NOT NULL,
      lat REAL NOT NULL, lon REAL NOT NULL, km REAL NOT NULL, coords TEXT NOT NULL,
      PRIMARY KEY (region, id)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS regions (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, countries TEXT NOT NULL,
      dataDate TEXT NOT NULL, importedAt INTEGER NOT NULL, poiCount INTEGER NOT NULL,
      south REAL NOT NULL, west REAL NOT NULL, north REAL NOT NULL, east REAL NOT NULL
    );
  `);

  const within = db.prepare(`
    SELECT ${FIELDS.map((f) => 'p.' + f).join(', ')}
    FROM pois_index i JOIN pois p ON p.rowid = i.rowid
    WHERE i.maxLat >= ? AND i.minLat <= ? AND i.maxLon >= ? AND i.minLon <= ?`);
  const covering = db.prepare(`
    SELECT * FROM regions
    WHERE ',' || countries || ',' LIKE ? AND south <= ? AND north >= ? AND west <= ? AND east >= ?`);
  const byId = db.prepare('SELECT * FROM regions WHERE id = ?');
  const all = db.prepare('SELECT * FROM regions ORDER BY name');
  const inRegion = db.prepare(`SELECT ${FIELDS.join(', ')} FROM pois WHERE region = ?`);
  const pathsInRegion = db.prepare('SELECT id, kind, lat, lon, km, coords FROM cycleways WHERE region = ?');

  return {
    regions: () => all.all().map((r) => ({ ...r, countries: r.countries.split(',').filter(Boolean) })),
    regionById: (id) => byId.get(id),
    regionItems: (id) => inRegion.all(id),
    regionPaths: (id) => pathsInRegion.all(id),
    // Secilen ulke ice aktarilmis ve nokta o bolgenin icindeyse dolu doner
    covering: (country, lat, lon) => covering.get(`%,${country},%`, lat, lat, lon, lon),
    within({ south, west, north, east }) {
      // Geofabrik dosyalari sinirda ortusur; ayni nokta iki bolgede olabilir
      const seen = new Set();
      return within.all(south, north, west, east).filter((row) => (seen.has(row.id) ? false : seen.add(row.id)))
        .map((row) => ({ ...row, repair: !!row.repair, rental: !!row.rental, pump: !!row.pump }));
    },
    // Tek islem: yeni veri tamamen yazilana kadar sunucu eski veriyi okur
    replaceRegion({ id, name, countries, dataDate }, items, paths = []) {
      const insert = db.prepare(`INSERT OR IGNORE INTO pois (region, ${FIELDS.join(', ')}) VALUES (${Array(FIELDS.length + 1).fill('?').join(', ')})`);
      const index = db.prepare('INSERT INTO pois_index VALUES (?, ?, ?, ?, ?)');
      const bounds = { south: Infinity, west: Infinity, north: -Infinity, east: -Infinity };
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM pois_index WHERE rowid IN (SELECT rowid FROM pois WHERE region = ?)').run(id);
        db.prepare('DELETE FROM pois WHERE region = ?').run(id);
        db.prepare('DELETE FROM cycleways WHERE region = ?').run(id);
        const insertPath = db.prepare('INSERT OR IGNORE INTO cycleways VALUES (?, ?, ?, ?, ?, ?, ?)');
        for (const p of paths) insertPath.run(id, p.id, p.kind, p.lat, p.lon, p.km, p.coords);
        let count = 0;
        for (const p of items) {
          const { lastInsertRowid, changes } = insert.run(id, ...FIELDS.map((f) => (typeof p[f] === 'boolean' ? Number(p[f]) : p[f])));
          if (!changes) continue;
          index.run(lastInsertRowid, p.lat, p.lat, p.lon, p.lon);
          bounds.south = Math.min(bounds.south, p.lat); bounds.north = Math.max(bounds.north, p.lat);
          bounds.west = Math.min(bounds.west, p.lon); bounds.east = Math.max(bounds.east, p.lon);
          count++;
        }
        db.prepare('INSERT OR REPLACE INTO regions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, name, countries.join(','), dataDate, Date.now(), count, bounds.south, bounds.west, bounds.north, bounds.east);
        db.exec('COMMIT');
        return count;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    close: () => db.close(),
  };
}
