// tests/rest.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

test('REST API HTTP Method Invariants', async (t) => {
  await t.test('verifies Safe and Idempotent classification matrix', () => {
    const methodMatrix = {
      GET: { safe: true, idempotent: true },
      HEAD: { safe: true, idempotent: true },
      OPTIONS: { safe: true, idempotent: true },
      POST: { safe: false, idempotent: false },
      PUT: { safe: false, idempotent: true },
      PATCH: { safe: false, idempotent: false },
      DELETE: { safe: false, idempotent: true }
    };

    assert.equal(methodMatrix.GET.safe, true);
    assert.equal(methodMatrix.GET.idempotent, true);
    assert.equal(methodMatrix.POST.idempotent, false);
    assert.equal(methodMatrix.PUT.idempotent, true);
    assert.equal(methodMatrix.DELETE.idempotent, true);
  });

  await t.test('simulates RFC 7807 problem details structure validation', () => {
    function createProblemDetails(status, title, detail, instance) {
      return {
        type: 'https://api.example.com/errors/validation',
        title,
        status,
        detail,
        instance,
        timestamp: new Date().toISOString()
      };
    }

    const problem = createProblemDetails(422, 'Unprocessable Entity', 'Email format is invalid.', '/api/v1/users');
    assert.equal(problem.status, 422);
    assert.equal(problem.title, 'Unprocessable Entity');
    assert.ok(problem.timestamp);
  });
});

test('Keyset Cursor Pagination Simulation', async (t) => {
  await t.test('encodes and decodes base64 cursors accurately', () => {
    function encodeCursor(id, timestamp) {
      return Buffer.from(JSON.stringify({ id, timestamp })).toString('base64');
    }

    function decodeCursor(cursorStr) {
      return JSON.parse(Buffer.from(cursorStr, 'base64').toString('utf8'));
    }

    const cursor = encodeCursor('item-42', 1741340000);
    const decoded = decodeCursor(cursor);

    assert.equal(decoded.id, 'item-42');
    assert.equal(decoded.timestamp, 1741340000);
  });
});
