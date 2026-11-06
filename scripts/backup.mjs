// Kullanici bildirimlerini yedekler. pedalya.db yeniden uretilebildigi icin yedeklenmez.
// Kullanim: node scripts/backup.mjs
// Yedekler ayni diskte kalirsa disk arizasina karsi korumaz; BACKUP_DIR baska bir birime baglanmalidir.
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { openCommunity } from '../server/community.mjs';
import { config } from '../server/config.mjs';
import { log } from '../server/lib.mjs';

const KEEP = 14;
const dir = process.env.BACKUP_DIR ?? config.backupDir;
mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(dir, `community-${stamp}.db`);
const community = openCommunity();
community.backup(target);
community.close();

const old = readdirSync(dir).filter((f) => /^community-.*\.db$/.test(f)).sort().slice(0, -KEEP);
for (const file of old) rmSync(path.join(dir, file));
log('backup_done', { target, removed: old.length });
