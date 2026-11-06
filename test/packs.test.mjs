import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeManifests, PACK_SCHEMA } from '../server/packs.mjs';

const pack = (id, version) => ({ id, version });

test('parcali paket listesi birlesir, basarisiz ulkenin eski paketi kalir', () => {
  const merged = mergeManifests(
    { schema: PACK_SCHEMA, packs: [pack('us', 'eski'), pack('it', 'eski')] },
    [{ schema: PACK_SCHEMA, packs: [pack('it', 'yeni')] }, { schema: PACK_SCHEMA, packs: [pack('at', 'yeni')] }],
  );
  assert.deepEqual(merged.packs, [pack('at', 'yeni'), pack('it', 'yeni'), pack('us', 'eski')]);
});

test('uyumsuz eski liste kullanilmaz', () => {
  assert.deepEqual(mergeManifests({ schema: PACK_SCHEMA - 1, packs: [pack('us', 'eski')] }, []).packs, []);
  assert.deepEqual(mergeManifests(null, []).packs, []);
});
