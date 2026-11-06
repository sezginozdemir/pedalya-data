# Pedalya veri hattı

OpenStreetMap verisinden bisikletliler için ülke paketleri üretir: dükkân, tamir, kiralama, park, su noktaları ve bisiklet yolları.

- `scripts/import-osm.mjs`: Geofabrik dosyalarını indirir ve noktaları çıkarır.
- `scripts/build-packs.mjs`: Her bölge için bir SQLite paketi üretir.
- `.github/workflows/packs.yml`: Ayda bir tüm paketleri yeniler ve [`packs` sürümüne](../../releases/tag/packs) yükler.

Ülke listesi `config/regions.json`, onaylı veri düzeltmeleri `config/corrections.json` dosyasındadır.

## Lisans

Veri © OpenStreetMap katkıcıları, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) ile lisanslıdır. Ayrıntı: [DATA_LICENSE.md](DATA_LICENSE.md).
