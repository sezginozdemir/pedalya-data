import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chainWays, cycleKind, encodePolyline, pathLengthKm, simplify } from '../server/cycle.mjs';

const way = (id, kind, ...refs) => ({ id, kind, refs: Float64Array.from(refs) });

test('uc uca yollar birlesir, yon farki sorun olmaz', () => {
  const chains = chainWays([way(1, 'path', 1, 2), way(2, 'path', 3, 2), way(3, 'path', 3, 4)]);
  assert.equal(chains.length, 1);
  assert.deepEqual([...chains[0].refs], [1, 2, 3, 4]);
});

test('farkli tur ve kopuk yollar birlesmez', () => {
  assert.equal(chainWays([way(1, 'path', 1, 2), way(2, 'lane', 2, 3)]).length, 2);
  assert.equal(chainWays([way(1, 'path', 1, 2), way(2, 'path', 3, 4)]).length, 2);
});

test('her yol tam bir kez kullanilir, kapali halka takilmaz', () => {
  const chains = chainWays([way(1, 'path', 1, 2), way(2, 'path', 2, 3), way(3, 'path', 3, 1)]);
  assert.equal(chains.length, 1);
  assert.deepEqual([...chains[0].refs], [1, 2, 3, 1]);
});

test('zincir uzunluk sinirini asmaz', () => {
  const ways = Array.from({ length: 20 }, (_, i) => way(i, 'path', i, i + 1));
  const chains = chainWays(ways, 5);
  assert.ok(chains.length > 1);
  assert.equal(chains.reduce((sum, c) => sum + c.refs.length - 1, 0), 20);
});

test('bisiklet yollari ayirt edilir', () => {
  assert.equal(cycleKind({ highway: 'cycleway' }), 'path');
  assert.equal(cycleKind({ highway: 'footway', bicycle: 'designated' }), 'path');
  assert.equal(cycleKind({ highway: 'residential', cyclestreet: 'yes' }), 'path');
  assert.equal(cycleKind({ highway: 'primary', cycleway: 'track' }), 'path');
  assert.equal(cycleKind({ highway: 'secondary', 'cycleway:right': 'lane' }), 'lane');
});

test('bisiklete kapali veya ilgisiz yollar alinmaz', () => {
  assert.equal(cycleKind({ highway: 'cycleway', access: 'private' }), null);
  assert.equal(cycleKind({ highway: 'residential' }), null);
  assert.equal(cycleKind({ highway: 'footway', bicycle: 'yes' }), null);
  assert.equal(cycleKind({ highway: 'primary', cycleway: 'no' }), null);
  assert.equal(cycleKind({ railway: 'rail', cycleway: 'lane' }), null);
});

test('polyline kodlamasi standarda uyar', () => {
  // Google'in belgelerindeki ornek
  const encoded = encodePolyline([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  assert.equal(encoded, '_p~iF~ps|U_ulLnnqC_mqNvxq`@');
});

test('sadelestirme seklini korur', () => {
  const straight = [[0, 0], [0, 0.001], [0, 0.002], [0, 0.003]];
  assert.deepEqual(simplify(straight), [[0, 0], [0, 0.003]]);
  const corner = [[0, 0], [0, 0.01], [0.01, 0.01]];
  assert.deepEqual(simplify(corner), corner);
});

test('uzunluk makul hesaplanir', () => {
  const km = pathLengthKm([[0, 0], [0, 1]]);
  assert.ok(km > 110 && km < 112, String(km));
});
