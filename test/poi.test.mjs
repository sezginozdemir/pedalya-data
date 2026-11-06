import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPoi, normalize } from '../server/poi.mjs';

test('sadece bisiklet noktalari secilir', () => {
  assert.ok(isPoi({ shop: 'bicycle' }, 'node'));
  assert.ok(isPoi({ 'service:bicycle:repair': 'yes', shop: 'sports' }, 'way'));
  assert.ok(isPoi({ leisure: 'park', name: 'Park' }, 'relation'));
  assert.ok(!isPoi({ leisure: 'park' }, 'way')); // Isimsiz park alinmaz
  assert.ok(!isPoi({ amenity: 'drinking_water' }, 'way')); // Su sadece nokta olarak alinir
  assert.ok(!isPoi({ shop: 'bakery' }, 'node'));
});

test('kapandigi isaretli yerler alinmaz', () => {
  assert.ok(!isPoi({ shop: 'bicycle', disused: 'yes' }, 'node'));
  assert.ok(!isPoi({ shop: 'bicycle', abandoned: 'yes' }, 'node'));
  assert.ok(!isPoi({ shop: 'bicycle', opening_hours: 'off' }, 'node'));
  assert.ok(!isPoi({ 'disused:shop': 'bicycle' }, 'node'));
  assert.ok(isPoi({ shop: 'bicycle', opening_hours: 'Mo-Fr 09:00-18:00' }, 'node'));
});

test('etiketler uygulama noktasina donusur', () => {
  const p = normalize({
    type: 'node', id: 7, lat: 41, lon: 29,
    tags: { shop: 'bicycle', name: 'Pedal', 'contact:phone': '+90', 'addr:street': 'Cadde', 'addr:housenumber': '5', 'service:bicycle:repair': 'yes' },
  });
  assert.equal(p.id, 'node/7');
  assert.equal(p.cat, 'shop');
  assert.equal(p.phone, '+90');
  assert.equal(p.address, 'Cadde 5');
  assert.equal(p.repair, true);
});

test('konumsuz kayit atilir', () => {
  assert.equal(normalize({ type: 'way', id: 1, tags: { shop: 'bicycle' } }), null);
});
