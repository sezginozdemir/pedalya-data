// Rota saglayicisi. BROUTER_URL degisince kendi sunucumuza gecer.
import { HttpError, memo } from '../lib.mjs';

export function createRouter({ url, userAgent }) {
  const cache = memo(500);

  return {
    async route(from, to, profile) {
      const lonlats = `${from.lon.toFixed(5)},${from.lat.toFixed(5)}|${to.lon.toFixed(5)},${to.lat.toFixed(5)}`;
      const key = lonlats + profile;
      if (cache.get(key)) return cache.get(key);

      const params = new URLSearchParams({ lonlats, profile, alternativeidx: '0', format: 'geojson' });
      const res = await fetch(`${url}/brouter?${params}`, {
        headers: { 'User-Agent': userAgent },
        signal: AbortSignal.timeout(30000),
      });
      const text = await res.text();
      if (!text.startsWith('{')) throw new HttpError(422, 'Bu iki nokta arasinda bisiklet rotasi bulunamadi');
      const feature = JSON.parse(text).features[0];
      const route = {
        geometry: feature.geometry,
        distanceM: Number(feature.properties['track-length']),
        timeS: Number(feature.properties['total-time']),
        ascendM: Number(feature.properties['filtered ascend']),
      };
      cache.set(key, route);
      return route;
    },
  };
}
