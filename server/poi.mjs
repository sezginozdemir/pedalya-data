// OSM etiketlerinden uygulama noktasina donusum. Overpass ve PBF ice aktarimi ortak kullanir.

export const POI_QUERY = `nwr["shop"="bicycle"];nwr["service:bicycle:repair"="yes"];nwr["amenity"="bicycle_repair_station"];nwr["amenity"="bicycle_rental"];nwr["leisure"="park"]["name"];node["amenity"="drinking_water"];`;

// Kapandigi OSM'de isaretlenmis yerler. disused:shop gibi etiketler zaten eslesmez.
function isDefunct(t) {
  return t.disused === 'yes' || t.abandoned === 'yes' || t.closed === 'yes' ||
    t.demolished === 'yes' || /^(off|closed)$/i.test(t.opening_hours ?? '');
}

// POI_QUERY ile ayni kural
export function isPoi(t, type) {
  if (isDefunct(t)) return false;
  return t.shop === 'bicycle' ||
    t['service:bicycle:repair'] === 'yes' ||
    t.amenity === 'bicycle_repair_station' ||
    t.amenity === 'bicycle_rental' ||
    (t.leisure === 'park' && !!t.name) ||
    (t.amenity === 'drinking_water' && type === 'node');
}

function categorize(t) {
  if (t.amenity === 'bicycle_repair_station') return 'repair';
  if (t.amenity === 'bicycle_rental') return 'rental';
  if (t.amenity === 'drinking_water') return 'water';
  if (t.leisure === 'park') return 'park';
  return 'shop';
}

export function normalize(e) {
  const t = e.tags ?? {};
  const lat = e.lat ?? e.center?.lat;
  const lon = e.lon ?? e.center?.lon;
  if (lat == null || lon == null) return null;
  const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
  return {
    id: `${e.type}/${e.id}`,
    cat: categorize(t),
    name: t.name ?? t.brand ?? t.operator ?? null,
    lat, lon,
    phone: t.phone ?? t['contact:phone'] ?? null,
    website: t.website ?? t['contact:website'] ?? null,
    hours: t.opening_hours ?? null,
    address: [street, t['addr:district'] ?? t['addr:suburb'], t['addr:city']].filter(Boolean).join(', ') || null,
    repair: t['service:bicycle:repair'] === 'yes',
    rental: t['service:bicycle:rental'] === 'yes',
    pump: t['service:bicycle:pump'] === 'yes' || t.pump === 'yes',
  };
}
