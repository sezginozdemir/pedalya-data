# Pedalya API v1

Web ve mobil uygulama nokta, arama ve rota için bu API'yi kullanır; bu sağlayıcılar değişse bile uygulama güncellemesi gerekmez. Tek istisna harita görselleridir: tile'lar istemciye doğrudan OpenFreeMap'ten gelir.

Tüm yanıtlar JSON'dur. Hata biçimi: `{ "error": "mesaj" }`.

| Kod | Anlamı |
|---|---|
| 400 | Geçersiz parametre |
| 422 | Rota bulunamadı |
| 429 | Dakikalık kullanım sınırı aşıldı (arama 10, rota 30, diğerleri 120) |
| 503 / 502 | Veri veya dış servis geçici olarak yanıt vermiyor |

## `GET /api/v1/health`

Sağlık kontrolü; kullanım sınırına takılmaz.

```json
{ "status": "ok", "version": "0.1.0", "regions": 8 }
```

## `GET /api/v1/regions`

Tam verisi olan bölgeler. Uygulama ülke seçicisini bununla doldurur.

```json
{ "items": [{ "id": "turkey", "name": "Turkey", "countries": ["TR"], "dataDate": "2026-11-05T16:17:02.000Z", "poiCount": 14154 }] }
```

## `GET /api/v1/geocode`

Şehir veya semt arar. Anlık otomatik tamamlama için kullanılamaz; kullanıcı aramayı gönderince çağrılır.

| Parametre | Zorunlu | Açıklama |
|---|---|---|
| `q` | Evet | En az 2 karakter |
| `country` | Evet | İki harfli ülke kodu |

```json
{ "items": [{ "name": "Kadıköy", "label": "Kadıköy, İstanbul, Türkiye", "lat": 40.99, "lon": 29.02 }] }
```

## `GET /api/v1/places`

Çevredeki noktalar, yakından uzağa sıralı.

| Parametre | Zorunlu | Açıklama |
|---|---|---|
| `lat`, `lon` | Evet | Merkez |
| `radius` | Evet | 3, 5, 10 veya 15 (km) |
| `country` | Hayır | İki harfli ülke kodu; tam veri kullanımını belirler |

`source` alanı verinin nereden geldiğini söyler: `local` tam veri, `tiles` temel veri (ayrıntılar eksik), `overpass` önbellekteki ayrıntılı veri.

```json
{
  "source": "local",
  "updatedAt": 1793898422000,
  "items": [{
    "id": "node/123", "cat": "shop", "name": "Bisiklet Gezgini",
    "lat": 40.99, "lon": 29.05, "km": 2.2,
    "phone": "+90 216 000 00 00", "website": "https://ornek.com",
    "hours": "We-Su 11:00-19:00", "address": "Çamtepe Sokak 5",
    "repair": true, "rental": false, "pump": false
  }]
}
```

`cat` değerleri: `shop`, `repair`, `rental`, `park`, `water`.

## `GET /api/v1/route`

Bisiklet rotası.

| Parametre | Zorunlu | Açıklama |
|---|---|---|
| `from`, `to` | Evet | `enlem,boylam`; aralarında en fazla 300 km |
| `profile` | Hayır | `trekking` (varsayılan), `safety`, `fastbike` |

```json
{ "geometry": { "type": "LineString", "coordinates": [[29.03, 40.99, 12.0]] }, "distanceM": 4845, "timeS": 878, "ascendM": 20 }
```

## `POST /api/v1/reports`

Hatalı bilgi bildirimi. Dakikada 5 istek, en fazla 8 KB. Başarılıysa 201 döner. Metinler onaylanmadan gösterilmez ve IP adresi saklanmaz.

```json
{ "placeId": "node/4063659811", "placeName": "Bike Id", "name": "Brompton Junction Torino", "phone": null, "hours": null, "closed": false, "note": null }
```

```json
{ "id": 1, "status": "pending" }
```

`placeId` zorunludur; `name`, `phone`, `hours`, `note` veya `closed: true` değerlerinden en az biri gerekir. Yönetim sunucuda yapılır: `npm run reports -- list`, `approve <id>`, `reject <id>`.

## Mobil öncesi eksikler

- Sayfalama ve kategori filtresi
- Hesap gerektiren adresler için token tabanlı kimlik doğrulama
- Adım adım yön tarifi
