export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function haversine(aLat, aLon, bLat, bLon) {
  const rad = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * rad) / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(((bLon - aLon) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export function serial() {
  let tail = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => {});
    return run;
  };
}

export function memo(limit) {
  const map = new Map();
  return {
    get: (k) => map.get(k),
    set(k, v) {
      if (map.size >= limit) map.delete(map.keys().next().value);
      map.set(k, v);
    },
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Query string sadece bu makinenin gunlugune bile yazilmaz: icinde kullanici konumu var
export function log(event, fields = {}) {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));
}
