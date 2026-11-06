// OSM yollarindan bisiklet agini cikarir. Harita tile'i olmadan, telefondaki paketten cizilir.

const SIDE_KEYS = ['cycleway', 'cycleway:both', 'cycleway:left', 'cycleway:right'];
const SIMPLIFY_DEGREES = 0.00004; // Yaklasik 4 m; ekranda fark edilmez, paket belirgin kuculur

// 'path': trafikten ayri bisiklet yolu, 'lane': yol uzerindeki serit
export function cycleKind(t) {
  if (!t.highway || t.access === 'no' || t.access === 'private' || t.bicycle === 'no') return null;
  if (t.highway === 'cycleway' || t.bicycle_road === 'yes' || t.cyclestreet === 'yes') return 'path';
  if (t.bicycle === 'designated' && ['path', 'footway', 'track', 'bridleway', 'pedestrian'].includes(t.highway)) return 'path';
  for (const key of SIDE_KEYS) {
    if (t[key] === 'track') return 'path';
    if (t[key] === 'lane') return 'lane';
  }
  return null;
}

// Uc uca eklenen ayni turdeki yollari birlestirir. OSM'de yollar kisa parcalardir;
// telefon binlerce parcayi cizemez, birlesince satir sayisi ve paket boyutu duser.
export function chainWays(ways, maxRefs = 400) {
  const byEnd = new Map();
  const addEnd = (node, index) => {
    const list = byEnd.get(node);
    if (list) list.push(index);
    else byEnd.set(node, [index]);
  };
  ways.forEach((way, index) => {
    addEnd(way.refs[0], index);
    addEnd(way.refs[way.refs.length - 1], index);
  });

  const used = new Uint8Array(ways.length);
  const next = (node, kind) => (byEnd.get(node) ?? []).find((i) => !used[i] && ways[i].kind === kind);
  const chains = [];

  ways.forEach((start, index) => {
    if (used[index]) return;
    used[index] = 1;
    const parts = [start.refs];
    let size = start.refs.length;

    let tail = start.refs[start.refs.length - 1];
    for (let i = next(tail, start.kind); i !== undefined && size < maxRefs; i = next(tail, start.kind)) {
      used[i] = 1;
      const refs = ways[i].refs[0] === tail ? ways[i].refs : ways[i].refs.slice().reverse();
      parts.push(refs.subarray(1));
      size += refs.length - 1;
      tail = refs[refs.length - 1];
    }

    let head = start.refs[0];
    for (let i = next(head, start.kind); i !== undefined && size < maxRefs; i = next(head, start.kind)) {
      used[i] = 1;
      const refs = ways[i].refs[ways[i].refs.length - 1] === head ? ways[i].refs : ways[i].refs.slice().reverse();
      parts.unshift(refs.subarray(0, refs.length - 1));
      size += refs.length - 1;
      head = refs[0];
    }

    const merged = new Float64Array(size);
    let offset = 0;
    for (const part of parts) {
      merged.set(part, offset);
      offset += part.length;
    }
    chains.push({ id: start.id, kind: start.kind, refs: merged });
  });
  return chains;
}

function offset(point, start, end) {
  const [x, y] = point;
  const [x1, y1] = start;
  const dx = end[0] - x1;
  const dy = end[1] - y1;
  const length = dx * dx + dy * dy;
  if (!length) return Math.hypot(x - x1, y - y1);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / length));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

// Douglas-Peucker: seklini bozmayan noktalari birakir
export function simplify(points, tolerance = SIMPLIFY_DEGREES) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let worst = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const distance = offset(points[i], points[first], points[last]);
      if (distance > worst) {
        worst = distance;
        index = i;
      }
    }
    if (worst > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function encodeNumber(value) {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

// Google polyline bicimi: kisa metin, JS'te kolay cozulur
export function encodePolyline(points) {
  let lastLat = 0;
  let lastLon = 0;
  let out = '';
  for (const [lat, lon] of points) {
    const a = Math.round(lat * 1e5);
    const b = Math.round(lon * 1e5);
    out += encodeNumber(a - lastLat) + encodeNumber(b - lastLon);
    lastLat = a;
    lastLon = b;
  }
  return out;
}

export function pathLengthKm(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const rad = Math.PI / 180;
    const dLat = (points[i][0] - points[i - 1][0]) * rad;
    const dLon = (points[i][1] - points[i - 1][1]) * rad * Math.cos(points[i][0] * rad);
    total += 6371 * Math.hypot(dLat, dLon);
  }
  return total;
}
