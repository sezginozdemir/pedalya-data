import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { createApp } from '../server/app.mjs';
import { openCommunity } from '../server/community.mjs';
import { config } from '../server/config.mjs';
import { createRoutes } from '../server/routes.mjs';
import { openStore } from '../server/store.mjs';

const dir = mkdtempSync(path.join(tmpdir(), 'pedalya-test-'));
const store = openStore(path.join(dir, 'places.db'));
const community = openCommunity(path.join(dir, 'community.db'));
const calls = { fallback: 0 };

const poi = (id, cat, name, lat, lon, extra = {}) => ({
  id, cat, name, lat, lon, phone: null, website: null, hours: null, address: null, repair: false, rental: false, pump: false, ...extra,
});

const routes = createRoutes({
  store,
  community,
  version: 'test',
  geocoder: { search: async () => [{ name: 'Kadikoy', label: 'Kadikoy', lat: 40.99, lon: 29.03 }] },
  router: {
    route: async (from) => {
      if (from.lat === 2) throw new TypeError('fetch failed'); // Dis servis kesintisi boyle gorunur
      return { geometry: { type: 'LineString', coordinates: [] }, distanceM: 1000, timeS: 200, ascendM: 5 };
    },
  },
  fallback: {
    places: async () => {
      calls.fallback++;
      return { items: [poi('tile/1,1', 'shop', 'Yedek', 52.5, 13.4)], ts: 1, source: 'tiles' };
    },
  },
});

const server = createApp({
  routes,
  config: { ...config, trustProxy: 'none', rateLimits: { '/api/v1/reports': 100, '/api/v1/geocode': 3, default: 1000 } },
});
let base;

before(async () => {
  store.replaceRegion({ id: 'turkey', name: 'Turkey', countries: ['TR'], dataDate: '2026-11-05T00:00:00.000Z' }, [
    poi('node/1', 'shop', 'Yakin', 40.99, 29.03),
    poi('node/2', 'shop', 'Uzak', 41.5, 29.5),
    poi('node/3', 'park', 'Kapanan', 40.991, 29.031),
  ]);
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => { server.close(resolve); });
  store.close();
  community.close();
  rmSync(dir, { recursive: true, force: true });
});

const get = (p, options) => fetch(base + p, options);
const report = (body) => fetch(`${base}/api/v1/reports`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body),
});

test('saglik kontrolu calisir', async () => {
  const res = await get('/api/v1/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok', version: 'test', regions: 1 });
});

test('bolgeler listelenir', async () => {
  const { items } = await (await get('/api/v1/regions')).json();
  assert.deepEqual(items[0].countries, ['TR']);
  assert.equal(items[0].poiCount, 3);
});

test('yerel noktalar yaricapa gore filtrelenir ve siralanir', async () => {
  const body = await (await get('/api/v1/places?lat=40.99&lon=29.03&radius=5&country=TR')).json();
  assert.equal(body.source, 'local');
  assert.deepEqual(body.items.map((p) => p.id), ['node/1', 'node/3']);
  assert.ok(body.items[0].km <= body.items[1].km);
});

test('ice aktarilmamis ulke yedek yola duser', async () => {
  const body = await (await get('/api/v1/places?lat=52.5&lon=13.4&radius=5&country=DE')).json();
  assert.equal(body.source, 'tiles');
  assert.equal(calls.fallback, 1);
});

test('secili ulke disindaki konum yedek yola duser', async () => {
  const body = await (await get('/api/v1/places?lat=52.5&lon=13.4&radius=5&country=TR')).json();
  assert.equal(body.source, 'tiles');
});

test('gecersiz nokta sorgulari reddedilir', async () => {
  for (const q of ['lat=99&lon=1&radius=5', 'lat=1&lon=1&radius=7', 'lat=abc&lon=1&radius=5', 'lat=1&lon=1&radius=5&country=tr1']) {
    assert.equal((await get(`/api/v1/places?${q}`)).status, 400, q);
  }
});

test('rota dogrulanir', async () => {
  assert.equal((await get('/api/v1/route?from=1,1&to=1.01,1.01')).status, 200);
  assert.equal((await get('/api/v1/route?from=1,1&to=1.01,1.01&profile=x')).status, 400);
  assert.equal((await get('/api/v1/route?from=abc&to=1,1')).status, 400);
  assert.equal((await get('/api/v1/route?from=1,1&to=10,10')).status, 400);
});

test('dis servis kesintisi 502 doner, ic hata ayrintisi sizmaz', async () => {
  const res = await get('/api/v1/route?from=2,2&to=2.01,2.01');
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: 'Dis servis yanit vermedi' });
});

test('buyuk yanitlar sikistirilir', async () => {
  const res = await new Promise((resolve, reject) => {
    import('node:http').then(({ get: httpGet }) => {
      httpGet(`${base}/api/v1/geocode?q=aa&country=tr`, { headers: { 'Accept-Encoding': 'gzip' } }, resolve).on('error', reject);
    });
  });
  res.resume();
  assert.equal(res.headers['content-encoding'], undefined); // Kucuk yanit sikistirilmaz

  store.replaceRegion({ id: 'big', name: 'Big', countries: ['XX'], dataDate: '2026-11-05T00:00:00.000Z' },
    Array.from({ length: 50 }, (_, i) => poi(`node/${100 + i}`, 'shop', `Dukkan ${i}`, 10 + i / 1000, 10)));
  const raw = await new Promise((resolve, reject) => {
    import('node:http').then(({ get: httpGet }) => {
      httpGet(`${base}/api/v1/places?lat=10&lon=10&radius=15&country=XX`, { headers: { 'Accept-Encoding': 'gzip' } }, (r) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => resolve({ headers: r.headers, body: Buffer.concat(chunks) }));
      }).on('error', reject);
    });
  });
  assert.equal(raw.headers['content-encoding'], 'gzip');
  assert.equal(JSON.parse(gunzipSync(raw.body)).items.length, 50);
});

test('bildirim dogrulanir', async () => {
  assert.equal((await report({ placeId: 'node/1' })).status, 400);
  assert.equal((await report({ placeId: '../etc', name: 'x' })).status, 400);
  assert.equal((await report({ placeId: 'node/1', phone: '<script>' })).status, 400);
  assert.equal((await report('{bozuk')).status, 400);
  assert.equal((await report('[1]')).status, 400);
  assert.equal((await report({ placeId: 'node/1', note: 'x'.repeat(9000) })).status, 413);
  assert.equal((await report({ placeId: 'node/1', name: 'x'.repeat(121) })).status, 400);
});

test('bildirim onaylanana kadar gorunmez, sonra uygulanir', async () => {
  const created = await report({ placeId: 'node/1', placeName: 'Yakin', name: 'Yeni Isim' });
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const names = async () => (await (await get('/api/v1/places?lat=40.99&lon=29.03&radius=5&country=TR')).json()).items.map((p) => p.name);

  assert.ok((await names()).includes('Yakin'));
  community.approve(id);
  assert.ok((await names()).includes('Yeni Isim'));
});

test('kapandi onayi noktayi listeden cikarir', async () => {
  const { id } = await (await report({ placeId: 'node/3', closed: true })).json();
  community.approve(id);
  const { items } = await (await get('/api/v1/places?lat=40.99&lon=29.03&radius=5&country=TR')).json();
  assert.ok(!items.some((p) => p.id === 'node/3'));
});

test('duzeltmeler yeniden ice aktarimdan sonra korunur', async () => {
  store.replaceRegion({ id: 'turkey', name: 'Turkey', countries: ['TR'], dataDate: '2026-11-12T00:00:00.000Z' }, [
    poi('node/1', 'shop', 'Yakin', 40.99, 29.03),
  ]);
  const { items } = await (await get('/api/v1/places?lat=40.99&lon=29.03&radius=5&country=TR')).json();
  assert.equal(items[0].name, 'Yeni Isim');
});

test('kullanim siniri asilinca 429 doner', async () => {
  const statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await get('/api/v1/geocode?q=ab&country=tr')).status);
  assert.ok(statuses.at(-1) === 429, statuses.join());
});

test('kaynak dosyalara ve bilinmeyen adreslere erisilemez', async () => {
  for (const p of ['/server/index.mjs', '/data/pedalya.db', '/package.json', '/api/yok', '/api/v1/yok']) {
    assert.equal((await get(p)).status, 404, p);
  }
  assert.equal((await get('/..%2f..%2fpackage.json')).status, 403);
  assert.equal((await get('/%E0%A4%A')).status, 400);
  assert.equal((await get('/api/v1/health', { method: 'DELETE' })).status, 405);
});

test('bozuk adres sunucuyu dusurmez', async () => {
  const net = await import('node:net');
  await new Promise((resolve) => {
    const socket = net.connect(server.address().port, '127.0.0.1', () => {
      socket.write('GET http://[bozuk HTTP/1.1\r\nHost: x\r\n\r\n');
    });
    socket.on('data', () => socket.destroy());
    socket.on('close', resolve);
    socket.on('error', resolve);
  });
  assert.equal((await get('/api/v1/health')).status, 200);
});

test('paketler uretilir ve sunulur, onayli duzeltme icindedir', async () => {
  const { buildPacks, PACK_SCHEMA } = await import('../server/packs.mjs');
  const { DatabaseSync } = await import('node:sqlite');
  const packsDir = path.join(dir, 'packs');
  const manifest = await buildPacks({ store, community, dir: packsDir });
  assert.equal(manifest.schema, PACK_SCHEMA);
  const pack = manifest.packs.find((p) => p.id === 'turkey');
  assert.equal(pack.poiCount, 1);
  assert.match(pack.version, /^[0-9a-f]{16}$/);
  assert.equal(pack.titles.tr, 'Türkiye');
  assert.equal(pack.titles.de, 'Türkei');
  assert.deepEqual(pack.counts, { shop: 1, repair: 0, rental: 0, park: 0, water: 0 });
  assert.deepEqual(pack.center, { lat: 40.99, lon: 29.03 });

  const app = createApp({ routes, config: { ...config, packsDir, trustProxy: 'none', rateLimits: { default: 100 } } });
  await new Promise((resolve) => { app.listen(0, '127.0.0.1', resolve); });
  const packBase = `http://127.0.0.1:${app.address().port}`;
  try {
    const served = await (await fetch(`${packBase}/packs/manifest.json`)).json();
    assert.equal(served.packs.length, manifest.packs.length);

    const file = await fetch(`${packBase}/packs/${pack.file}`);
    assert.equal(file.headers.get('content-encoding'), null); // Statik barindirmayla ayni davranis
    const dbFile = path.join(dir, 'indirilen.db');
    (await import('node:fs')).writeFileSync(dbFile, Buffer.from(await file.arrayBuffer()));
    const db = new DatabaseSync(dbFile, { readOnly: true });
    assert.equal(db.prepare('SELECT name FROM pois WHERE id = ?').get('node/1').name, 'Yeni Isim');
    db.close();

    for (const bad of ['../places.db', '..%2fplaces.db', 'yok.db', 'turkey.txt']) {
      assert.equal((await fetch(`${packBase}/packs/${bad}`)).status, 404, bad);
    }
  } finally {
    await new Promise((resolve) => { app.close(resolve); });
  }
});

test('dosyadaki duzeltmeler pakete islenir', async () => {
  const { applyCorrections } = await import('../server/packs.mjs');
  const items = [poi('node/1', 'shop', 'Eski', 1, 1), poi('node/2', 'shop', 'Kapanan', 1, 1), poi('node/3', 'shop', 'Ayni', 1, 1)];
  const result = applyCorrections(items, [{ id: 'node/1', name: 'Yeni' }, { id: 'node/2', closed: true }]);
  assert.deepEqual(result.map((p) => p.name), ['Yeni', 'Ayni']);
  assert.equal(applyCorrections([poi('node/9', 'shop', 'Kapali', 1, 1, { hours: 'off' })], []).length, 0);
});

test('guvenlik basliklari gelir', async () => {
  const res = await get('/');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
});
