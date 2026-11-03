import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { etagFor, ifMatchHolds, ifNoneMatchHits } from '../src/http/etag.js';
import { decodeCursor, encodeCursor, keysetPage, type SortKey } from '../src/http/pagination.js';
import { Router } from '../src/http/router.js';
import { canTransition, mergePatch, validateOrderInput } from '../src/orders/model.js';

describe('entity tags', () => {
  const tag = etagFor('{"a":1}');

  it('are quoted and stable for identical bytes', () => {
    assert.match(tag, /^"[A-Za-z0-9_-]+"$/);
    assert.equal(etagFor('{"a":1}'), tag);
    assert.notEqual(etagFor('{"a":2}'), tag);
  });

  it('If-None-Match uses weak comparison and accepts lists and *', () => {
    assert.equal(ifNoneMatchHits(`W/${tag}`, tag), true);
    assert.equal(ifNoneMatchHits(`"other", ${tag}`, tag), true);
    assert.equal(ifNoneMatchHits('*', tag), true);
    assert.equal(ifNoneMatchHits('"other"', tag), false);
    assert.equal(ifNoneMatchHits(undefined, tag), false);
  });

  it('If-Match uses strong comparison', () => {
    assert.equal(ifMatchHolds(tag, tag), true);
    assert.equal(ifMatchHolds(`W/${tag}`, tag), false);
    assert.equal(ifMatchHolds('*', tag), true);
    assert.equal(ifMatchHolds('*', undefined), false);
    assert.equal(ifMatchHolds(undefined, tag), true);
  });
});

describe('keyset pagination', () => {
  const rows = [
    { id: 'b', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'a', createdAt: '2026-01-01T00:00:00.000Z' }, // same timestamp: id breaks the tie
    { id: 'c', createdAt: '2026-01-02T00:00:00.000Z' },
  ];

  it('round-trips cursors and rejects garbage', () => {
    const key = { createdAt: '2026-01-01T00:00:00.000Z', id: 'x' };
    assert.deepEqual(decodeCursor(encodeCursor(key)), key);
    assert.equal(decodeCursor('not-a-cursor'), null);
    assert.equal(decodeCursor(Buffer.from('{"id":1}').toString('base64url')), null);
  });

  it('walks every row exactly once in both directions', () => {
    for (const direction of ['asc', 'desc'] as const) {
      const seen: string[] = [];
      let after: SortKey | null = null;
      for (;;) {
        const page = keysetPage(rows, { limit: 2, after, direction });
        seen.push(...page.items.map((r) => r.id));
        if (!page.nextCursor) break;
        after = decodeCursor(page.nextCursor);
      }
      assert.deepEqual(seen, direction === 'asc' ? ['a', 'b', 'c'] : ['c', 'b', 'a']);
    }
  });
});

describe('router', () => {
  const router = new Router().on('GET', '/things/:id', () => {}).on('DELETE', '/things/:id', () => {});

  it('extracts and decodes path parameters', () => {
    const m = router.match('GET', '/things/a%20b');
    assert.equal(m.kind, 'found');
    if (m.kind === 'found') assert.equal(m.params.id, 'a b');
  });

  it('separates 404 from 405 and lists allowed methods', () => {
    assert.equal(router.match('GET', '/nothing').kind, 'not-found');
    const m = router.match('PUT', '/things/1');
    assert.equal(m.kind, 'method-not-allowed');
    if (m.kind === 'method-not-allowed') assert.deepEqual(m.allow.sort(), ['DELETE', 'GET', 'HEAD', 'OPTIONS']);
  });

  it('serves HEAD with the GET handler', () => {
    assert.equal(router.match('HEAD', '/things/1').kind, 'found');
  });
});

describe('order model', () => {
  it('collects every validation error at once', () => {
    const result = validateOrderInput({ customer: '', items: [{ sku: 'x', quantity: 0 }], id: 'ord_1' }, { creating: true });
    assert.equal(result.ok, false);
    if (!result.ok) {
      const names = result.errors.map((e) => e.name).sort();
      assert.deepEqual(names, ['customer', 'id', 'items[0].quantity', 'items[0].sku', 'items[0].unitPriceCents']);
    }
  });

  it('applies JSON Merge Patch rules', () => {
    assert.deepEqual(mergePatch({ a: 1, b: { c: 2, d: 3 } }, { b: { c: null, e: 4 }, f: [1] }), {
      a: 1,
      b: { d: 3, e: 4 },
      f: [1],
    });
    assert.deepEqual(mergePatch({ list: [1, 2] }, { list: [3] }), { list: [3] }); // arrays replace
  });

  it('enforces the status state machine', () => {
    assert.equal(canTransition('pending', 'paid'), true);
    assert.equal(canTransition('paid', 'shipped'), true);
    assert.equal(canTransition('shipped', 'pending'), false);
    assert.equal(canTransition('cancelled', 'paid'), false);
  });
});
