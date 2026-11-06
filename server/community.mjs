// Kullanici bildirimleri ve onayli duzeltmeler.
// pedalya.db kaynak veriden yeniden uretilebilir; bu dosya uretilemez, yedeklenmelidir.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';

export function openCommunity(file = config.communityDb) {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY,
      placeId TEXT NOT NULL, placeName TEXT,
      name TEXT, phone TEXT, hours TEXT, closed INTEGER NOT NULL DEFAULT 0, note TEXT,
      status TEXT NOT NULL DEFAULT 'pending', createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS corrections (
      placeId TEXT PRIMARY KEY,
      name TEXT, phone TEXT, hours TEXT, closed INTEGER NOT NULL DEFAULT 0, updatedAt INTEGER NOT NULL
    );
  `);

  const insert = db.prepare(`
    INSERT INTO reports (placeId, placeName, name, phone, hours, closed, note, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const all = db.prepare('SELECT * FROM corrections');
  const byId = db.prepare('SELECT * FROM reports WHERE id = ?');
  const byStatus = db.prepare('SELECT * FROM reports WHERE status = ? ORDER BY id');
  const setStatus = db.prepare('UPDATE reports SET status = ? WHERE id = ?');
  // Bos alan mevcut duzeltmeyi silmez; ayni noktaya gelen onaylar birikir
  const upsert = db.prepare(`
    INSERT INTO corrections (placeId, name, phone, hours, closed, updatedAt) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (placeId) DO UPDATE SET
      name = COALESCE(excluded.name, name), phone = COALESCE(excluded.phone, phone),
      hours = COALESCE(excluded.hours, hours), closed = excluded.closed, updatedAt = excluded.updatedAt`);

  return {
    addReport({ placeId, placeName, name, phone, hours, closed, note }) {
      return Number(insert.run(placeId, placeName, name, phone, hours, closed ? 1 : 0, note, Date.now()).lastInsertRowid);
    },
    list: (status) => byStatus.all(status),
    approve(id) {
      const report = byId.get(id);
      if (!report) throw new Error(`Bildirim yok: ${id}`);
      upsert.run(report.placeId, report.name, report.phone, report.hours, report.closed, Date.now());
      setStatus.run('approved', id);
      return report;
    },
    reject(id) {
      if (!setStatus.run('rejected', id).changes) throw new Error(`Bildirim yok: ${id}`);
    },
    apply(items) {
      const corrections = new Map(all.all().map((c) => [c.placeId, c]));
      if (!corrections.size) return items;
      return items.flatMap((item) => {
        const c = corrections.get(item.id);
        if (!c) return [item];
        if (c.closed) return [];
        return [{ ...item, name: c.name ?? item.name, phone: c.phone ?? item.phone, hours: c.hours ?? item.hours }];
      });
    },
    // Calisan veritabanindan tutarli kopya; WAL dosyalarini elle kopyalamak gerekmez
    backup(target) {
      db.prepare('VACUUM INTO ?').run(target);
    },
    close: () => db.close(),
  };
}
