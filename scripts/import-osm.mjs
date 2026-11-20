// Geofabrik bolge dosyalarini indirir, bisiklet noktalarini cikarir ve depoya yazar.
// Kullanim: node scripts/import-osm.mjs <ulke-kodu|geofabrik-id>... [--force] [--keep-raw]
//           node scripts/import-osm.mjs --configured [--shard=i/n]   (config/regions.json listesi; aylik is parca parca calistirir)
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { open, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { PbfReader } from 'pbf';
import { ROOT, config } from '../server/config.mjs';
import { chainWays, cycleKind, encodePolyline, pathLengthKm, simplify } from '../server/cycle.mjs';
import { isPoi, normalize } from '../server/poi.mjs';
import { openStore } from '../server/store.mjs';

const RAW_DIR = config.rawDir;
const CATALOG = 'https://download.geofabrik.de/index-v1-nogeom.json';

const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

// --- Indirme ---

function md5(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5');
    createReadStream(file).on('data', (d) => hash.update(d)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

async function loadCatalog() {
  const res = await fetch(CATALOG);
  if (!res.ok) throw new Error(`Katalog HTTP ${res.status}`);
  return (await res.json()).features.map((f) => f.properties);
}

// Geofabrik katalogdan ISO ulke kodlarini kaldirdi: ulke -> bolge eslemesi config/regions.json'da tutulur.
// arg: bolge kimligi (germany) veya tek ulkelik bolgenin ISO kodu (de)
const configured = JSON.parse(await readFile(path.join(ROOT, 'config', 'regions.json'), 'utf8'));

function resolveRegion(catalog, arg) {
  const code = arg.toUpperCase();
  const entry = configured.find((r) => r.id === arg || (r.countries.length === 1 && r.countries[0] === code));
  const region = catalog.find((r) => r.id === (entry?.id ?? arg));
  if (!region) throw new Error(`Katalogda yok: ${arg}`);
  return { ...region, countries: entry?.countries ?? [] };
}

async function remoteDate(url) {
  const head = await fetch(url, { method: 'HEAD' });
  if (!head.ok) throw new Error(`Geofabrik HTTP ${head.status}`);
  return new Date(head.headers.get('last-modified'));
}

// Saglama dosyasi alinamadi diye gigabaytlarca inmis dosya silinmez: baglanti hatasinda yeniden denenir.
// Geofabrik bazi buyuk dosyalar icin .md5 yayinlamaz (404); o zaman null doner ve boyut kontrolu yapilir.
async function remoteMd5(url, attempts = 5) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url + '.md5').catch(() => null);
    if (res?.status === 404) return null;
    const value = res?.ok ? (await res.text()).split(/\s+/)[0] : '';
    if (/^[0-9a-f]{32}$/.test(value)) return value;
    if (attempt === attempts) throw new Error(`MD5 dosyasi alinamadi (HTTP ${res?.status ?? 'baglanti hatasi'})`);
    await new Promise((resolve) => setTimeout(resolve, 30000));
  }
}

async function download(url, date) {
  const file = path.join(RAW_DIR, path.basename(url));
  await mkdir(RAW_DIR, { recursive: true });
  if (existsSync(file) && (await stat(file)).mtime >= date) {
    log(`Yerel dosya guncel: ${path.basename(file)}`);
    return file;
  }

  log(`Indiriliyor: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geofabrik HTTP ${res.status}`);
  const partial = file + '.part';
  await pipeline(Readable.fromWeb(res.body), createWriteStream(partial));

  const expected = await remoteMd5(url);
  if (expected) {
    const actual = await md5(partial);
    if (expected !== actual) {
      await unlink(partial);
      throw new Error(`MD5 uyusmuyor: ${actual} != ${expected}`);
    }
  } else {
    const length = Number(res.headers.get('content-length'));
    if (!length || (await stat(partial)).size !== length) {
      await unlink(partial);
      throw new Error('MD5 yok ve indirilen boyut beklenenle ayni degil');
    }
    log('MD5 yayinlanmamis, dosya boyutu dogrulandi');
  }
  await rename(partial, file);
  log('Indirme tamam');
  return file;
}

// --- PBF okuma (https://wiki.openstreetmap.org/wiki/PBF_Format) ---

async function* blocks(file) {
  const fh = await open(file, 'r');
  const read = async (length, position) => {
    const buf = Buffer.allocUnsafe(length);
    await fh.read(buf, 0, length, position);
    return buf;
  };
  try {
    const { size } = await fh.stat();
    let pos = 0;
    while (pos < size) {
      const headerLen = (await read(4, pos)).readUInt32BE(0);
      const header = new PbfReader(await read(headerLen, pos + 4)).readFields((tag, h, pbf) => {
        if (tag === 1) h.type = pbf.readString();
        else if (tag === 3) h.size = pbf.readVarint();      }, {});
      const blob = await read(header.size, pos + 4 + headerLen);
      pos += 4 + headerLen + header.size;
      if (header.type === 'OSMData') yield unpack(blob);
    }
  } finally {
    await fh.close();
  }
}

function unpack(blob) {
  const { raw, zlib } = new PbfReader(blob).readFields((tag, b, pbf) => {
    if (tag === 1) b.raw = pbf.readBytes();
    else if (tag === 3) b.zlib = pbf.readBytes();  }, {});
  if (!raw && !zlib) throw new Error('Desteklenmeyen PBF sikistirmasi');
  return new PbfReader(raw ?? inflateSync(zlib)).readFields((tag, b, pbf) => {
    if (tag === 1) b.strings = readStrings(pbf);
    else if (tag === 2) b.groups.push(pbf.readBytes());
    else if (tag === 17) b.granularity = pbf.readVarint();
    else if (tag === 19) b.latOffset = pbf.readVarint(true);
    else if (tag === 20) b.lonOffset = pbf.readVarint(true);  }, { strings: [], groups: [], granularity: 100, latOffset: 0, lonOffset: 0 });
}

function readStrings(pbf) {
  const strings = [];
  const end = pbf.readVarint() + pbf.pos;
  const decoder = new TextDecoder();
  while (pbf.pos < end) {
    const val = pbf.readVarint();
    if (val >> 3 === 1) strings.push(decoder.decode(pbf.readBytes()));
    else pbf.skip(val);
  }
  return strings;
}

// group: { dense?, way?, relation? } geri cagirimlari. Istenmeyen tur hic cozulmez.
function eachEntity(block, handlers) {
  for (const raw of block.groups) {
    new PbfReader(raw).readFields((tag, _, pbf) => {
      if (tag === 2 && handlers.dense) readDense(pbf.readBytes(), block, handlers.dense);
      else if (tag === 3 && handlers.way) handlers.way(readWay(pbf.readBytes(), block));
      else if (tag === 4 && handlers.relation) handlers.relation(readRelation(pbf.readBytes(), block));    });
  }
}

const delta = (values) => {
  for (let i = 1; i < values.length; i++) values[i] += values[i - 1];
  return values;
};

function readDense(bytes, block, fn) {
  const d = new PbfReader(bytes).readFields((tag, o, pbf) => {
    if (tag === 1) o.ids = pbf.readPackedSVarint();
    else if (tag === 8) o.lats = pbf.readPackedSVarint();
    else if (tag === 9) o.lons = pbf.readPackedSVarint();
    else if (tag === 10) o.kv = pbf.readPackedVarint();  }, { kv: [] });
  delta(d.ids); delta(d.lats); delta(d.lons);
  const { granularity: g, latOffset, lonOffset, strings } = block;
  let k = 0;
  for (let i = 0; i < d.ids.length; i++) {
    let tags = null;
    while (k < d.kv.length && d.kv[k] !== 0) {
      (tags ??= {})[strings[d.kv[k]]] = strings[d.kv[k + 1]];
      k += 2;
    }
    k++;
    fn(d.ids[i], (latOffset + g * d.lats[i]) / 1e9, (lonOffset + g * d.lons[i]) / 1e9, tags);
  }
}

function zipTags(keys, vals, strings) {
  const tags = {};
  keys.forEach((key, i) => { tags[strings[key]] = strings[vals[i]]; });
  return tags;
}

function readWay(bytes, block) {
  const w = new PbfReader(bytes).readFields((tag, o, pbf) => {
    if (tag === 1) o.id = pbf.readVarint(true);
    else if (tag === 2) o.keys = pbf.readPackedVarint();
    else if (tag === 3) o.vals = pbf.readPackedVarint();
    else if (tag === 8) o.refs = delta(pbf.readPackedSVarint());  }, { keys: [], vals: [], refs: [] });
  return { id: w.id, refs: w.refs, tags: zipTags(w.keys, w.vals, block.strings) };
}

function readRelation(bytes, block) {
  const r = new PbfReader(bytes).readFields((tag, o, pbf) => {
    if (tag === 1) o.id = pbf.readVarint(true);
    else if (tag === 2) o.keys = pbf.readPackedVarint();
    else if (tag === 3) o.vals = pbf.readPackedVarint();
    else if (tag === 9) o.members = delta(pbf.readPackedSVarint());
    else if (tag === 10) o.types = pbf.readPackedVarint();  }, { keys: [], vals: [], members: [], types: [] });
  return { id: r.id, tags: zipTags(r.keys, r.vals, block.strings), wayIds: r.members.filter((_, i) => r.types[i] === 1) };
}

// --- Cikarim ---

// Node'lar dosyada yollardan once gelir; bu yuzden uc gecis gerekir:
// etiketler ve iliskiler -> iliski uye yollari -> gereken dugum koordinatlari
async function extract(file) {
  const nodes = [];
  const ways = new Map(); // id -> { tags, refs }
  const relations = [];
  const cycleWays = [];

  await forEachBlock(file, 'gecis 1/3', {
    dense(id, lat, lon, tags) {
      if (tags && isPoi(tags, 'node')) nodes.push({ type: 'node', id, lat, lon, tags });
    },
    way(w) {
      if (isPoi(w.tags, 'way')) ways.set(w.id, { tags: w.tags, refs: w.refs });
      const kind = cycleKind(w.tags);
      if (kind) cycleWays.push({ id: w.id, kind, refs: Float64Array.from(w.refs) });
    },
    relation(r) {
      if (isPoi(r.tags, 'relation') && r.wayIds.length) relations.push(r);
    },
  });
  log(`Eslesen: ${nodes.length} dugum, ${ways.size} yol, ${relations.length} iliski, ${cycleWays.length} bisiklet yolu`);

  const wanted = new Set(relations.flatMap((r) => r.wayIds));
  const memberRefs = new Map();
  await forEachBlock(file, 'gecis 2/3', {
    way(w) { if (wanted.has(w.id)) memberRefs.set(w.id, w.refs); },
  });

  // Buyuk ulkelerde Map/Set bellege sigmaz: sirali dizi ve ikili arama kullanilir.
  // Dosyadaki dugumler kimlige gore sirali oldugu icin tek gecis yeter.
  const need = sortedUnique([
    ...[...ways.values()].map((w) => w.refs),
    ...memberRefs.values(),
    ...cycleWays.map((w) => w.refs),
  ]);
  const lats = new Int32Array(need.length).fill(NO_COORD);
  const lons = new Int32Array(need.length);
  let cursor = 0;
  await forEachBlock(file, 'gecis 3/3', {
    dense(id, lat, lon) {
      while (cursor < need.length && need[cursor] < id) cursor++;
      if (need[cursor] === id) {
        lats[cursor] = Math.round(lat * 1e7);
        lons[cursor] = Math.round(lon * 1e7);
      }
    },
  });
  const coordOf = (ref) => {
    const i = indexOf(need, ref);
    return i < 0 || lats[i] === NO_COORD ? null : [lats[i] / 1e7, lons[i] / 1e7];
  };

  // Overpass "out center" ile ayni: sinir kutusunun merkezi
  const center = (refs) => {
    let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
    for (const ref of refs) {
      const c = coordOf(ref);
      if (!c) continue; // dosya sinirinda kesilmis yol
      south = Math.min(south, c[0]); north = Math.max(north, c[0]);
      west = Math.min(west, c[1]); east = Math.max(east, c[1]);
    }
    return south === Infinity ? null : { lat: (south + north) / 2, lon: (west + east) / 2 };
  };

  const items = nodes.map(normalize);
  for (const [id, w] of ways) items.push(normalize({ type: 'way', id, tags: w.tags, center: center(w.refs) }));
  for (const r of relations) {
    items.push(normalize({ type: 'relation', id: r.id, tags: r.tags, center: center(r.wayIds.flatMap((w) => memberRefs.get(w) ?? [])) }));
  }

  const paths = [];
  for (const way of chainWays(cycleWays)) {
    const points = simplify(Array.from(way.refs, coordOf).filter(Boolean));
    if (points.length < 2) continue;
    const middle = points[Math.floor(points.length / 2)];
    paths.push({
      id: way.id, kind: way.kind, lat: middle[0], lon: middle[1],
      km: pathLengthKm(points), coords: encodePolyline(points),
    });
  }
  return { items: items.filter(Boolean), paths };
}

const NO_COORD = -2147483648;

function sortedUnique(lists) {
  const total = lists.reduce((sum, list) => sum + list.length, 0);
  const all = new Float64Array(total);
  let offset = 0;
  for (const list of lists) {
    all.set(list, offset);
    offset += list.length;
  }
  all.sort();
  let size = 0;
  for (let i = 0; i < total; i++) {
    if (i === 0 || all[i] !== all[i - 1]) all[size++] = all[i];
  }
  return all.subarray(0, size);
}

function indexOf(sorted, value) {
  let low = 0;
  let high = sorted.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle] === value) return middle;
    if (sorted[middle] < value) low = middle + 1;
    else high = middle - 1;
  }
  return -1;
}

async function forEachBlock(file, label, handlers) {
  const started = Date.now();
  let count = 0;
  for await (const block of blocks(file)) {
    eachEntity(block, handlers);
    if (++count % 2000 === 0) log(`${label}: ${count} blok`);
  }
  log(`${label} bitti: ${count} blok, ${Math.round((Date.now() - started) / 1000)} sn`);
}

// --- Ana akis ---

async function importRegion(store, region, { force, keepRaw }) {
  const url = region.urls.pbf;
  const date = await remoteDate(url);
  if (!force && store.regionById(region.id)?.dataDate === date.toISOString()) {
    log(`${region.id}: veri zaten guncel`);
    return;
  }

  const file = await download(url, date);
  const { items, paths } = await extract(file);
  if (!items.length) throw new Error('Hic nokta cikmadi; mevcut veri korunuyor');

  const saved = store.replaceRegion({
    id: region.id, name: region.name, countries: region.countries, dataDate: date.toISOString(),
  }, items, paths);
  if (!keepRaw) await unlink(file);

  const byCat = {};
  for (const p of items) byCat[p.cat] = (byCat[p.cat] ?? 0) + 1;
  const km = Math.round(paths.reduce((sum, p) => sum + p.km, 0));
  log(`${region.id}: ${saved} nokta, ${paths.length} bisiklet yolu (${km} km) yazildi ${JSON.stringify(byCat)}`);
}

const args = process.argv.slice(2);
const [shard, shards] = (args.find((a) => a.startsWith('--shard='))?.slice(8).split('/') ?? [0, 1]).map(Number);
const targets = args.includes('--configured')
  ? configured.map((r) => r.id).filter((_, i) => i % shards === shard)
  : args.filter((a) => !a.startsWith('--'));
const options = { force: args.includes('--force'), keepRaw: args.includes('--keep-raw') };
if (!targets.length) {
  console.error('Kullanim: node scripts/import-osm.mjs <ulke-kodu|geofabrik-id>... [--force] [--keep-raw]');
  process.exit(1);
}

const catalog = await loadCatalog();
const store = openStore();
const failed = [];
// Sirayla: Geofabrik'e paralel indirme yapilmaz, bir ulkenin hatasi digerlerini durdurmaz
for (const target of targets) {
  try {
    await importRegion(store, resolveRegion(catalog, target), options);
  } catch (err) {
    failed.push(target);
    log(`HATA ${target}: ${err.message}`);
  }
}
store.close();
if (failed.length) {
  log(`Basarisiz: ${failed.join(', ')}`);
  process.exitCode = 1;
}
