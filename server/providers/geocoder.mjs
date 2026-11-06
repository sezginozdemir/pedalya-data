// Sehir arama saglayicisi. NOMINATIM_URL degisince kendi sunucumuza gecer.
import { HttpError, memo, serial, sleep } from '../lib.mjs';

export function createGeocoder({ url, userAgent, delayMs }) {
  const cache = memo(500);
  const queue = serial();

  return {
    async search(text, country) {
      const key = country + '|' + text.toLocaleLowerCase('tr');
      if (cache.get(key)) return cache.get(key);

      const params = new URLSearchParams({ q: text, countrycodes: country, format: 'jsonv2', limit: '6', 'accept-language': 'tr' });
      const rows = await queue(async () => {
        const res = await fetch(`${url}/search?${params}`, {
          headers: { 'User-Agent': userAgent },
          signal: AbortSignal.timeout(10000),
        });
        await sleep(delayMs);
        if (!res.ok) throw new HttpError(503, 'Konum arama su an calismiyor');
        return res.json();
      });
      const items = rows.map((r) => ({
        name: r.name || r.display_name.split(',')[0], label: r.display_name, lat: Number(r.lat), lon: Number(r.lon),
      }));
      cache.set(key, items);
      return items;
    },
  };
}
