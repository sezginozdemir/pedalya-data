// Ice aktarilmamis ulkeler icin nokta verisi: once OpenFreeMap tile'lari, arka planda Overpass.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader as Protobuf } from 'pbf';
import { HttpError, log, serial } from '../lib.mjs';
import { POI_QUERY, normalize } from '../poi.mjs';

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const PLACES_TTL = 7 * 24 * 3600 * 1000;
const GRID = 0.02; // ~2 km; yakin kullanicilar ayni onbellek kaydini paylasir
const TILE_ZOOM = 14; // OpenFreeMap'in tum POI'leri tasidigi en yuksek seviye
const TILE_CATS = { bicycle: 'shop', bicycle_repair_station: 'repair', bicycle_rental: 'rental', park: 'park', drinking_water: 'water' };
const MAX_TILES = 400;
const TILE_CONCURRENCY = 8;
const ENRICH_RETRY = 10 * 60 * 1000;

function tileRange({ south, west, north, east }) {
  const n = 2 ** TILE_ZOOM;
  const tx = (lon) => Math.floor(((lon + 180) / 360) * n);
  const ty = (lat) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  };
  const cx = tx((west + east) / 2);
  const cy = ty((south + north) / 2);
  const tiles = [];
  for (let x = tx(west); x <= tx(east); x++) {
    for (let y = ty(north); y <= ty(south); y++) tiles.push({ x, y, d: (x - cx) ** 2 + (y - cy) ** 2 });
  }
  return tiles.sort((a, b) => a.d - b.d).slice(0, MAX_TILES); // kutuplara yakin yerlerde sayi patlar
}

function tilePoi(feature, x, y) {
  const cat = TILE_CATS[feature.properties.subclass];
  if (!cat || feature.type !== 1) return null;
  const [[p]] = feature.loadGeometry();
  if (p.x < 0 || p.y < 0 || p.x >= feature.extent || p.y >= feature.extent) return null; // tampon bolgesi, komsu tile'da var
  const [lon, lat] = feature.toGeoJSON(x, y, TILE_ZOOM).geometry.coordinates;
  const name = feature.properties['name:tr'] ?? feature.properties.name ?? null;
  if (cat === 'park' && !name) return null; // isimsiz yesil alanlar listeyi bogar
  return {
    id: `tile/${lat.toFixed(5)},${lon.toFixed(5)}`,
    cat, name, lat, lon,
    phone: null, website: null, hours: null, address: null, repair: false, rental: false, pump: false,
  };
}

export function createFallback({ cacheDir, userAgent }) {
  const overpassQueue = serial(); // Overpass IP basina eszamanli slot sinirlar
  const enriching = new Map();
  const inflight = new Map();
  let tileTemplate = null;

  async function readCache(file) {
    try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
  }

  async function writeCache(file, entry) {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, JSON.stringify(entry));
  }

  async function overpass(query) {
    let last;
    for (const url of OVERPASS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'User-Agent': userAgent, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(45000),
        });
        if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        last = err;
        log('overpass_failed', { message: err.message });
      }
    }
    throw last;
  }

  async function tileUrl() {
    if (tileTemplate && Date.now() - tileTemplate.ts < 24 * 3600 * 1000) return tileTemplate.url;
    const res = await fetch('https://tiles.openfreemap.org/planet', {
      headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error('tilejson HTTP ' + res.status);
    tileTemplate = { url: (await res.json()).tiles[0], ts: Date.now() };
    return tileTemplate.url;
  }

  async function fetchTile(template, { x, y }) {
    const url = template.replace('{z}', TILE_ZOOM).replace('{x}', x).replace('{y}', y);
    const res = await fetch(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(15000) });
    if (res.status === 404 || res.status === 204) return [];
    if (!res.ok) throw new Error('tile HTTP ' + res.status);
    const layer = new VectorTile(new Protobuf(new Uint8Array(await res.arrayBuffer()))).layers.poi;
    const items = [];
    for (let i = 0; i < (layer?.length ?? 0); i++) {
      const poi = tilePoi(layer.feature(i), x, y);
      if (poi) items.push(poi);
    }
    return items;
  }

  async function tilePlaces(bounds) {
    const template = await tileUrl();
    const queue = tileRange(bounds);
    const total = queue.length;
    const items = [];
    let failed = 0;
    await Promise.all(Array.from({ length: TILE_CONCURRENCY }, async () => {
      for (let tile = queue.shift(); tile; tile = queue.shift()) {
        try { items.push(...await fetchTile(template, tile)); } catch { failed++; }
      }
    }));
    if (failed === total) throw new Error('harita verisi alinamadi');
    const seen = new Set();
    return items.filter((p) => (seen.has(p.id) ? false : seen.add(p.id)));
  }

  function enrich(key, bounds) {
    if (Date.now() - (enriching.get(key) ?? 0) < ENRICH_RETRY) return;
    enriching.set(key, Date.now());
    const bbox = [bounds.south, bounds.west, bounds.north, bounds.east].map((n) => n.toFixed(4)).join(',');
    overpassQueue(async () => {
      const json = await overpass(`[out:json][timeout:40][bbox:${bbox}];(${POI_QUERY});out center tags;`);
      const seen = new Set();
      const items = json.elements.map(normalize).filter((p) => {
        if (!p || seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });
      await writeCache(path.join(cacheDir, key + '.json'), { ts: Date.now(), items });
    }).catch((err) => log('enrich_failed', { message: err.message }));
  }

  return {
    async places(lat, lon, radius) {
      const cLat = Math.round(lat / GRID) * GRID;
      const cLon = Math.round(lon / GRID) * GRID;
      const key = createHash('sha1').update([cLat.toFixed(2), cLon.toFixed(2), radius].join('|')).digest('hex');

      // Kutu, gercek merkez izgara hucresinde nereye duserse dussun yaricapi kapsar
      const pad = radius + 2;
      const dLat = pad / 111;
      const dLon = pad / (111 * Math.max(Math.cos((cLat * Math.PI) / 180), 0.1));
      const bounds = { south: cLat - dLat, west: cLon - dLon, north: cLat + dLat, east: cLon + dLon };

      const rich = await readCache(path.join(cacheDir, key + '.json'));
      if (rich && Date.now() - rich.ts < PLACES_TTL) return { ...rich, source: 'overpass' };
      enrich(key, bounds);
      if (rich) return { ...rich, source: 'overpass' }; // eski ayrintili veri tazelenene kadar gecerli

      const tileFile = path.join(cacheDir, key + '.tiles.json');
      const cached = await readCache(tileFile);
      if (cached && Date.now() - cached.ts < PLACES_TTL) return { ...cached, source: 'tiles' };
      if (inflight.has(key)) return inflight.get(key);

      const job = tilePlaces(bounds).then(async (items) => {
        const entry = { ts: Date.now(), items };
        await writeCache(tileFile, entry);
        return { ...entry, source: 'tiles' };
      }).catch((err) => {
        if (cached) return { ...cached, source: 'tiles' };
        throw new HttpError(503, 'Nokta verisi su an alinamiyor: ' + err.message);
      }).finally(() => inflight.delete(key));

      inflight.set(key, job);
      return job;
    },
  };
}
