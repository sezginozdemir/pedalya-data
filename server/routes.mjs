// API uclari: girdi dogrulama ve is kurallari. Veri erisimi disaridan verilir ki testlerde sahtesi kullanilabilsin.
import { HttpError, haversine } from './lib.mjs';

const RADII = [3, 5, 10, 15];
const PROFILES = new Set(['trekking', 'safety', 'fastbike']);
const MAX_ITEMS = 3000;
const MAX_ROUTE_KM = 300;

function coord(value, max, name) {
  const n = Number(value);
  if (value === null || value === '' || !Number.isFinite(n) || Math.abs(n) > max) {
    throw new HttpError(400, `Gecersiz ${name}`);
  }
  return n;
}

function latLon(value, name) {
  const [lat, lon] = String(value ?? '').split(',');
  return { lat: coord(lat, 90, name), lon: coord(lon ?? '', 180, name) };
}

function reportText(value, max, label) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > max) throw new HttpError(400, `Gecersiz ${label}`);
  return value.trim() || null;
}

export function createRoutes({ store, community, geocoder, router, fallback, version }) {
  // Ice aktarilmis ulke yerel depodan gelir; digerleri tile + Overpass yolunda kalir
  function localPlaces(country, lat, lon, radius) {
    const region = country && store.covering(country, lat, lon);
    if (!region) return null;
    const dLat = radius / 110;
    const dLon = radius / (110 * Math.max(Math.cos((lat * Math.PI) / 180), 0.1));
    const items = store.within({ south: lat - dLat, west: lon - dLon, north: lat + dLat, east: lon + dLon });
    return { items, ts: Date.parse(region.dataDate), source: 'local' };
  }

  return {
    get: {
      '/api/v1/health'() {
        return { status: 'ok', version, regions: store.regions().length };
      },

      '/api/v1/regions'() {
        return {
          items: store.regions().map(({ id, name, countries, dataDate, poiCount }) => ({ id, name, countries, dataDate, poiCount })),
        };
      },

      async '/api/v1/places'(q) {
        const lat = coord(q.get('lat'), 85, 'enlem');
        const lon = coord(q.get('lon'), 180, 'boylam');
        const radius = Number(q.get('radius'));
        if (!RADII.includes(radius)) throw new HttpError(400, 'Gecersiz yaricap');
        const country = q.get('country');
        if (country && !/^[A-Z]{2}$/.test(country)) throw new HttpError(400, 'Gecersiz ulke');

        const result = localPlaces(country, lat, lon, radius) ?? await fallback.places(lat, lon, radius);
        const items = community.apply(result.items)
          .map((p) => ({ ...p, km: haversine(lat, lon, p.lat, p.lon) }))
          .filter((p) => p.km <= radius)
          .sort((a, b) => a.km - b.km)
          .slice(0, MAX_ITEMS);
        return { items, updatedAt: result.ts, source: result.source };
      },

      async '/api/v1/geocode'(q) {
        const text = (q.get('q') ?? '').trim().slice(0, 120);
        const country = (q.get('country') ?? '').toLowerCase();
        if (text.length < 2) throw new HttpError(400, 'Arama cok kisa');
        if (!/^[a-z]{2}$/.test(country)) throw new HttpError(400, 'Gecersiz ulke');
        return { items: await geocoder.search(text, country) };
      },

      async '/api/v1/route'(q) {
        const from = latLon(q.get('from'), 'baslangic');
        const to = latLon(q.get('to'), 'varis');
        const profile = q.get('profile') ?? 'trekking';
        if (!PROFILES.has(profile)) throw new HttpError(400, 'Gecersiz profil');
        if (haversine(from.lat, from.lon, to.lat, to.lon) > MAX_ROUTE_KM) {
          throw new HttpError(400, `Rota en fazla ${MAX_ROUTE_KM} km olabilir`);
        }
        return router.route(from, to, profile);
      },
    },

    post: {
      // IP saklanmaz; metinler onaylanmadan hicbir kullaniciya gosterilmez
      '/api/v1/reports'(body) {
        const placeId = reportText(body.placeId, 60, 'nokta');
        if (!placeId || !/^(node|way|relation|tile)\/[\d.,-]+$/.test(placeId)) throw new HttpError(400, 'Gecersiz nokta');
        const report = {
          placeId,
          placeName: reportText(body.placeName, 120, 'nokta adi'),
          name: reportText(body.name, 120, 'isim'),
          phone: reportText(body.phone, 40, 'telefon'),
          hours: reportText(body.hours, 120, 'saat'),
          closed: body.closed === true,
          note: reportText(body.note, 500, 'not'),
        };
        if (report.phone && !/^[+\d\s()./-]+$/.test(report.phone)) throw new HttpError(400, 'Gecersiz telefon');
        if (!report.name && !report.phone && !report.hours && !report.closed && !report.note) {
          throw new HttpError(400, 'Bildirim bos');
        }
        return { id: community.addReport(report), status: 'pending' };
      },
    },
  };
}
