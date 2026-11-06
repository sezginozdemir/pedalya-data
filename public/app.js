import * as maplibregl from './vendor/maplibre-gl.mjs';

const $ = (id) => document.getElementById(id);

const CATS = {
  shop: { label: 'Bisikletçi', one: 'Bisiklet dükkânı', color: '#c2410c' },
  repair: { label: 'Tamir istasyonu', one: 'Tamir istasyonu', color: '#7c3aed' },
  rental: { label: 'Kiralama', one: 'Bisiklet kiralama', color: '#0369a1' },
  park: { label: 'Park', one: 'Park', color: '#15803d' },
  water: { label: 'Su', one: 'İçme suyu', color: '#0891b2' },
};
const ISO = 'AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW'.split(' ');
const STORE_KEY = 'pedalya.settings';
const EMPTY_ROUTE = { type: 'FeatureCollection', features: [] };

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

function loadSettings() {
  const fallback = { country: 'TR', place: null, radius: 5, profile: 'trekking', off: [] };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(STORE_KEY)) };
  } catch {
    return fallback;
  }
}
const settings = loadSettings();
function saveSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch { /* gizli pencere */ }
}

async function api(path, params) {
  const res = await fetch(path + '?' + new URLSearchParams(params));
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Sunucu hatası');
  return body;
}

function setStatus(node, text, isError = false) {
  node.textContent = text;
  node.classList.toggle('error', isError);
}

const formatKm = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace('.', ',')} km`);
function formatTime(s) {
  const min = Math.round(s / 60);
  return min < 60 ? `${min} dk` : `${Math.floor(min / 60)} sa ${min % 60} dk`;
}

// --- Harita ---

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/liberty',
  center: [32.85, 39.2],
  zoom: 5,
  attributionControl: { compact: true, customAttribution: 'Rota: <a href="https://brouter.de">BRouter</a>' },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

const pin = (kind) => el('div', { class: `pin ${kind}` });
const homeMarker = new maplibregl.Marker({ element: pin('home') });
const fromMarker = new maplibregl.Marker({ element: pin('from'), draggable: true });
const toMarker = new maplibregl.Marker({ element: pin('to'), draggable: true });
const popup = new maplibregl.Popup({ maxWidth: '280px', offset: 10 });

const mapReady = new Promise((resolve) => map.on('load', resolve));

mapReady.then(() => {
  const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
  map.addSource('radius', { type: 'geojson', data: EMPTY_ROUTE });
  map.addLayer({ id: 'radius-line', type: 'line', source: 'radius', paint: { 'line-color': '#1d4ed8', 'line-width': 1.5, 'line-dasharray': [3, 3], 'line-opacity': 0.6 } }, firstSymbol);
  // Bisiklet yollari haritanin kendi vektor verisinden gelir; ek istek gerektirmez
  map.addLayer({
    id: 'cycleways', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 11,
    filter: ['==', ['get', 'subclass'], 'cycleway'],
    paint: { 'line-color': '#0b6e4f', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 16, 4] },
  }, firstSymbol);
  map.addSource('route', { type: 'geojson', data: EMPTY_ROUTE });
  map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 8 } });
  map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#c2410c', 'line-width': 5 } });
  map.addSource('places', { type: 'geojson', data: EMPTY_ROUTE });
  map.addLayer({
    id: 'places', type: 'circle', source: 'places',
    paint: {
      'circle-color': ['match', ['get', 'cat'], ...Object.entries(CATS).flatMap(([k, c]) => [k, c.color]), '#666'],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 15, 8],
      'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5,
    },
  });
  map.on('click', 'places', (e) => {
    e.preventDefault();
    const item = places.find((p) => p.id === e.features[0].properties.id);
    if (item) showPlace(item);
  });
  map.on('mouseenter', 'places', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'places', () => { map.getCanvas().style.cursor = ''; });
  map.on('click', (e) => {
    if (e.defaultPrevented || $('viewRoute').hidden) return;
    const point = { lat: e.lngLat.lat, lon: e.lngLat.lng };
    if (pickFrom) {
      setPick(false);
      setStop('from', point, 'Haritadan seçildi');
    } else {
      setStop('to', point, 'Haritadan seçildi');
    }
  });
});

function circle(lat, lon, km) {
  const coords = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    coords.push([lon + (km * Math.sin(a)) / (111.32 * Math.cos((lat * Math.PI) / 180)), lat + (km * Math.cos(a)) / 110.57]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } };
}

// --- Yakindaki noktalar ---

let places = [];
let loadToken = 0;

function visible() {
  return places.filter((p) => !settings.off.includes(p.cat));
}

function renderFilters() {
  const counts = {};
  for (const p of places) counts[p.cat] = (counts[p.cat] ?? 0) + 1;
  $('filters').replaceChildren(...Object.entries(CATS).map(([key, cat]) => el('button', {
    class: 'filter', type: 'button', 'aria-pressed': String(!settings.off.includes(key)),
    onclick: () => {
      settings.off = settings.off.includes(key) ? settings.off.filter((k) => k !== key) : [...settings.off, key];
      saveSettings();
      render();
    },
  }, el('span', { class: 'dot', style: `--c:${cat.color}` }), cat.label, el('b', {}, String(counts[key] ?? 0)))));
}

function itemMeta(p) {
  const bits = p.name ? [CATS[p.cat].one] : [];
  if (p.repair && p.cat === 'shop') bits.push('tamir yapar');
  if (p.address) bits.push(p.address);
  return bits.join(' · ');
}

function renderList() {
  // Bisiklet noktalari once gelir; parklar kalabalik olup dukkanlari sinirin disina itmesin
  const rank = (p) => Object.keys(CATS).indexOf(p.cat) < 3 ? 0 : 1;
  const rows = [...visible()].sort((a, b) => rank(a) - rank(b) || a.km - b.km).slice(0, 150);
  $('list').replaceChildren(...rows.map((p) => el('li', {}, el('button', {
    class: 'item', type: 'button', onclick: () => showPlace(p),
  },
  el('span', { class: 'dot', style: `--c:${CATS[p.cat].color}` }),
  el('span', { class: 'item-name' }, placeName(p)),
  el('span', { class: 'item-km' }, formatKm(p.km)),
  el('span', { class: 'item-meta' }, itemMeta(p))))));
}

const placeName = (p) => p.name ?? CATS[p.cat].one;

function render() {
  renderFilters();
  renderList();
  mapReady.then(() => map.getSource('places').setData({
    type: 'FeatureCollection',
    features: visible().map((p) => ({ type: 'Feature', properties: { id: p.id, cat: p.cat }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })),
  }));
}

function safeUrl(value) {
  try {
    const url = new URL(/^https?:/i.test(value) ? value : 'https://' + value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function showPlace(p) {
  const tags = [p.repair && 'Tamir', p.rental && 'Kiralama', p.pump && 'Pompa'].filter(Boolean);
  const site = p.website ? safeUrl(p.website) : null;
  const phone = p.phone?.split(';')[0].trim();
  const content = el('div', { class: 'pop' },
    el('h3', {}, placeName(p)),
    el('p', { class: 'muted' }, `${CATS[p.cat].one} · ${formatKm(p.km)}`),
    tags.length ? el('div', { class: 'tags' }, ...tags.map((t) => el('span', { class: 'tag' }, t))) : null,
    p.address ? el('p', {}, p.address) : null,
    p.hours ? el('p', {}, 'Saatler: ' + p.hours) : null,
    phone ? el('p', {}, el('a', { href: 'tel:' + phone.replace(/[^+\d]/g, '') }, phone)) : null,
    site ? el('p', {}, el('a', { href: site, target: '_blank', rel: 'noopener noreferrer' }, 'Web sitesi')) : null,
    el('button', {
      class: 'btn', type: 'button',
      onclick: () => {
        popup.remove();
        selectTab('route');
        setStop('to', { lat: p.lat, lon: p.lon }, placeName(p));
      },
    }, 'Buraya rota çiz'));
  popup.setLngLat([p.lon, p.lat]).setDOMContent(content).addTo(map);
  map.easeTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 14) });
}

async function loadPlaces() {
  const { place, radius, country } = settings;
  if (!place) return;
  const token = ++loadToken;
  places = [];
  render();
  const status = $('status');
  setStatus(status, 'Yakındaki noktalar yükleniyor…');
  try {
    const data = await api('/api/v1/places', { lat: place.lat, lon: place.lon, radius, country });
    if (token !== loadToken) return;
    places = data.items;
    render();
    if (!places.length) setStatus(status, `${radius} km içinde kayıtlı nokta yok. Yarıçapı artırmayı dene.`);
    else setStatus(status, data.source === 'tiles' ? 'Telefon ve çalışma saati gibi ayrıntılar henüz hazır değil.' : '');
  } catch {
    if (token !== loadToken) return;
    setStatus(status, 'Noktalar yüklenemedi. ', true);
    status.append(el('button', { class: 'link', type: 'button', onclick: loadPlaces }, 'Tekrar dene'));
  }
}

function applyPlace() {
  const { place, radius, country } = settings;
  $('placeName').textContent = place?.name ?? 'Konum seç';
  if (!place) return;
  $('country').value = country;
  homeMarker.setLngLat([place.lon, place.lat]).addTo(map);
  mapReady.then(() => {
    const ring = circle(place.lat, place.lon, radius);
    map.getSource('radius').setData(ring);
    const lons = ring.geometry.coordinates.map((c) => c[0]);
    const lats = ring.geometry.coordinates.map((c) => c[1]);
    map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 24, duration: 600 });
  });
  if (!route.from) setStop('from', { lat: place.lat, lon: place.lon }, place.name);
  loadPlaces();
}

// --- Rota ---

const route = { from: null, to: null, data: null };
let pickFrom = false;
let routeToken = 0;

function setPick(on) {
  pickFrom = on;
  $('pickFrom').classList.toggle('active', on);
  $('pickFrom').textContent = on ? 'Haritaya dokun' : 'Haritadan seç';
}

function drawStops() {
  $('fromLabel').textContent = route.from?.label ?? '—';
  $('toLabel').textContent = route.to?.label ?? 'Haritaya dokun veya listeden seç';
  for (const [stop, marker] of [[route.from, fromMarker], [route.to, toMarker]]) {
    if (stop) marker.setLngLat([stop.lon, stop.lat]).addTo(map);
    else marker.remove();
  }
}

function setStop(which, point, label) {
  route[which] = { ...point, label };
  drawStops();
  computeRoute();
}

function clearRouteLine() {
  route.data = null;
  $('routeSummary').hidden = true;
  $('gpx').disabled = true;
  mapReady.then(() => map.getSource('route').setData(EMPTY_ROUTE));
}

async function computeRoute() {
  const token = ++routeToken;
  if (!route.from || !route.to) return clearRouteLine();
  setStatus($('routeStatus'), 'Rota hesaplanıyor…');
  try {
    const data = await api('/api/v1/route', {
      from: `${route.from.lat},${route.from.lon}`,
      to: `${route.to.lat},${route.to.lon}`,
      profile: settings.profile,
    });
    if (token !== routeToken) return;
    route.data = data;
    setStatus($('routeStatus'), '');
    $('sumDist').textContent = formatKm(data.distanceM / 1000);
    $('sumTime').textContent = formatTime(data.timeS);
    $('sumAsc').textContent = `${Math.round(data.ascendM)} m`;
    $('routeSummary').hidden = false;
    $('gpx').disabled = false;
    await mapReady;
    map.getSource('route').setData({ type: 'Feature', properties: {}, geometry: data.geometry });
    const bounds = new maplibregl.LngLatBounds();
    for (const c of data.geometry.coordinates) bounds.extend([c[0], c[1]]);
    map.fitBounds(bounds, { padding: 60, duration: 500 });
  } catch (err) {
    if (token !== routeToken) return;
    clearRouteLine();
    setStatus($('routeStatus'), err.message, true);
  }
}

function downloadGpx() {
  const pts = route.data.geometry.coordinates
    .map(([lon, lat, ele]) => `<trkpt lat="${lat}" lon="${lon}">${ele != null ? `<ele>${ele}</ele>` : ''}</trkpt>`).join('');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Pedalya" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Pedalya rotası</name><trkseg>${pts}</trkseg></trk></gpx>`;
  const link = el('a', { href: URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' })), download: 'pedalya-rota.gpx' });
  link.click();
  URL.revokeObjectURL(link.href);
}

function selectTab(name) {
  const isRoute = name === 'route';
  $('viewRoute').hidden = !isRoute;
  $('viewNearby').hidden = isRoute;
  $('tabRoute').setAttribute('aria-selected', String(isRoute));
  $('tabNearby').setAttribute('aria-selected', String(!isRoute));
  if (!isRoute) setPick(false);
}

// --- Ayarlar ---

let draftPlace = null;

function openSettings() {
  draftPlace = settings.place;
  $('country').value = settings.country;
  $('radius').value = String(settings.radius);
  $('placeQuery').value = '';
  $('placeResults').replaceChildren();
  setStatus($('settingsStatus'), settings.place ? `Şu anki konum: ${settings.place.name}` : '');
  $('settingsClose').hidden = !settings.place;
  $('settings').showModal();
}

function choosePlace(item, button) {
  draftPlace = { name: item.name, lat: item.lat, lon: item.lon };
  for (const b of $('placeResults').querySelectorAll('button')) b.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-pressed', 'true');
  setStatus($('settingsStatus'), `Seçilen konum: ${item.name}`);
}

async function searchPlace() {
  const q = $('placeQuery').value.trim();
  if (q.length < 2) return setStatus($('settingsStatus'), 'En az iki harf yaz.', true);
  setStatus($('settingsStatus'), 'Aranıyor…');
  $('placeResults').replaceChildren();
  try {
    const { items } = await api('/api/v1/geocode', { q, country: $('country').value });
    setStatus($('settingsStatus'), items.length ? 'Bir sonuç seç, sonra Kaydet\'e bas.' : 'Sonuç yok. Yazımı ya da ülkeyi kontrol et.', !items.length);
    $('placeResults').replaceChildren(...items.map((item) => {
      const button = el('button', { type: 'button', 'aria-pressed': 'false', onclick: () => choosePlace(item, button) },
        el('strong', {}, item.name), item.label);
      return el('li', {}, button);
    }));
  } catch (err) {
    setStatus($('settingsStatus'), err.message, true);
  }
}

function useGps() {
  if (!navigator.geolocation) return setStatus($('settingsStatus'), 'Tarayıcın konum desteği sunmuyor.', true);
  setStatus($('settingsStatus'), 'Konum alınıyor…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      draftPlace = { name: 'Konumum', lat: pos.coords.latitude, lon: pos.coords.longitude };
      setStatus($('settingsStatus'), 'Konumun alındı. Kaydet\'e bas.');
    },
    () => setStatus($('settingsStatus'), 'Konum alınamadı. Şehrini yazarak ara.', true),
    { timeout: 10000, maximumAge: 60000 },
  );
}

function commitSettings() {
  if (!draftPlace) return setStatus($('settingsStatus'), 'Önce bir konum seç.', true);
  const moved = draftPlace !== settings.place;
  settings.place = draftPlace;
  settings.country = $('country').value;
  settings.radius = Number($('radius').value);
  saveSettings();
  $('settings').close();
  if (moved) {
    routeToken++;
    route.from = null;
    route.to = null;
    drawStops();
    clearRouteLine();
    setStatus($('routeStatus'), '');
  }
  applyPlace();
}

// --- Baslangic ---

const countryNames = new Intl.DisplayNames(['tr'], { type: 'region' });

function fillCountries(full) {
  const selected = $('country').value || settings.country;
  const options = (codes) => codes
    .map((code) => ({ code, name: countryNames.of(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
    .map((c) => el('option', { value: c.code }, c.name));
  const rest = ISO.filter((code) => !full.has(code));
  $('country').replaceChildren(...(full.size ? [
    el('optgroup', { label: 'Tam veri' }, ...options([...full])),
    el('optgroup', { label: 'Temel veri' }, ...options(rest)),
  ] : options(rest)));
  $('country').value = selected;
}

fillCountries(new Set());
api('/api/v1/regions', {})
  .then(({ items }) => fillCountries(new Set(items.flatMap((r) => r.countries).filter((c) => ISO.includes(c)))))
  .catch(() => { /* liste duz kalir, secim yine calisir */ });

$('openSettings').addEventListener('click', openSettings);
$('settingsClose').addEventListener('click', () => $('settings').close());
$('settingsSave').addEventListener('click', commitSettings);
$('placeSearch').addEventListener('click', searchPlace);
$('useGps').addEventListener('click', useGps);
$('settings').addEventListener('cancel', (e) => { if (!settings.place) e.preventDefault(); });
$('placeQuery').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    searchPlace();
  }
});
$('tabNearby').addEventListener('click', () => selectTab('nearby'));
$('tabRoute').addEventListener('click', () => selectTab('route'));
$('pickFrom').addEventListener('click', () => setPick(!pickFrom));
$('swap').addEventListener('click', () => {
  if (!route.from || !route.to) return;
  [route.from, route.to] = [route.to, route.from];
  drawStops();
  computeRoute();
});
$('profile').value = settings.profile;
$('profile').addEventListener('change', (e) => {
  settings.profile = e.target.value;
  saveSettings();
  computeRoute();
});
$('gpx').addEventListener('click', downloadGpx);
$('clearRoute').addEventListener('click', () => {
  route.to = null;
  routeToken++;
  drawStops();
  clearRouteLine();
  setStatus($('routeStatus'), '');
});
for (const [marker, which] of [[fromMarker, 'from'], [toMarker, 'to']]) {
  marker.on('dragend', () => {
    const { lat, lng } = marker.getLngLat();
    setStop(which, { lat, lon: lng }, 'Haritadan seçildi');
  });
}

renderFilters();
if (settings.place) applyPlace();
else openSettings();
