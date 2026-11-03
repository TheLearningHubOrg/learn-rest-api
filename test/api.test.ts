import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { json, sampleOrder, startServer, type TestServer } from './helpers.js';

let srv: TestServer;
before(async () => {
  srv = await startServer();
});
after(async () => {
  await srv.close();
});

const url = (path: string): string => srv.base + path;

async function create(body: unknown = sampleOrder, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url('/api/v1/orders'), { method: 'POST', ...json(body, headers) });
}

describe('discovery and health', () => {
  it('GET /health answers 200 and is never cached', async () => {
    const res = await fetch(url('/health'));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), { status: 'ok' });
  });

  it('GET / links to the collection', async () => {
    const body = (await (await fetch(url('/'))).json()) as { _links: Record<string, { href: string }> };
    assert.equal(body._links.orders?.href, '/api/v1/orders');
  });

  it('echoes a safe X-Request-Id and generates one otherwise', async () => {
    const echoed = await fetch(url('/health'), { headers: { 'X-Request-Id': 'abc-123' } });
    assert.equal(echoed.headers.get('x-request-id'), 'abc-123');
    const generated = await fetch(url('/health'), { headers: { 'X-Request-Id': 'bad id with spaces' } });
    assert.match(generated.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/);
  });
});

describe('method semantics', () => {
  it('unknown path is a 404 problem', async () => {
    const res = await fetch(url('/nope'));
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('content-type'), 'application/problem+json');
    const problem = (await res.json()) as { status: number; instance: string };
    assert.equal(problem.status, 404);
    assert.equal(problem.instance, '/nope');
  });

  it('known path with an unsupported method is 405 with Allow', async () => {
    const res = await fetch(url('/api/v1/orders'), { method: 'DELETE' });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'GET, POST, HEAD, OPTIONS');
  });

  it('OPTIONS lists the allowed methods with 204', async () => {
    const res = await fetch(url('/api/v1/orders/anything'), { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('allow'), 'GET, PUT, PATCH, DELETE, HEAD, OPTIONS');
  });

  it('HEAD returns GET headers without a body', async () => {
    const get = await fetch(url('/api/v1/orders'));
    const head = await fetch(url('/api/v1/orders'), { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), get.headers.get('content-length'));
    assert.equal(await head.text(), '');
  });
});

describe('creating orders', () => {
  it('POST returns 201, Location, ETag and the new representation', async () => {
    const res = await create();
    assert.equal(res.status, 201);
    const location = res.headers.get('location');
    assert.match(location ?? '', /^\/api\/v1\/orders\/ord_[0-9a-f]{20}$/);
    assert.ok(res.headers.get('etag'));
    const order = (await res.json()) as { id: string; status: string; totalCents: number; version?: number };
    assert.equal(order.status, 'pending');
    assert.equal(order.totalCents, 2500);
    assert.equal(order.version, undefined, 'internal fields stay private');

    const fetched = await fetch(url(location!));
    assert.equal(fetched.status, 200);
    assert.equal(fetched.headers.get('etag'), res.headers.get('etag'));
  });

  it('wrong Content-Type is 415', async () => {
    const res = await fetch(url('/api/v1/orders'), { method: 'POST', body: 'customer=dana' });
    assert.equal(res.status, 415);
  });

  it('broken JSON is 400', async () => {
    const res = await fetch(url('/api/v1/orders'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"customer":',
    });
    assert.equal(res.status, 400);
  });

  it('valid JSON that breaks the rules is 422 with every field error', async () => {
    const res = await create({ customer: '', items: [], totalCents: 5 });
    assert.equal(res.status, 422);
    const problem = (await res.json()) as { errors: { name: string }[] };
    assert.deepEqual(problem.errors.map((e) => e.name).sort(), ['customer', 'items', 'totalCents']);
  });

  it('oversized bodies are 413', async () => {
    const res = await create({ ...sampleOrder, note: 'x'.repeat(70_000) });
    assert.equal(res.status, 413);
  });
});

describe('idempotency keys', () => {
  it('replays the first response for a retried POST', async () => {
    const before = srv.store.list().length;
    const first = await create(sampleOrder, { 'Idempotency-Key': 'key-1' });
    const retry = await create(sampleOrder, { 'Idempotency-Key': 'key-1' });
    assert.equal(first.status, 201);
    assert.equal(retry.status, 201);
    assert.equal(retry.headers.get('idempotent-replayed'), 'true');
    assert.equal(retry.headers.get('location'), first.headers.get('location'));
    assert.equal(srv.store.list().length, before + 1, 'only one order was created');
  });

  it('rejects the same key with a different body', async () => {
    await create(sampleOrder, { 'Idempotency-Key': 'key-2' });
    const res = await create({ ...sampleOrder, customer: 'eve' }, { 'Idempotency-Key': 'key-2' });
    assert.equal(res.status, 422);
  });
});

describe('listing with filters and cursor pagination', () => {
  it('walks all pages without duplicates and follows the Link header', async () => {
    const total = srv.store.list().length;
    const ids = new Set<string>();
    let next: string | null = '/api/v1/orders?limit=2';
    let pages = 0;
    while (next) {
      const res: Response = await fetch(url(next));
      assert.equal(res.status, 200);
      const body = (await res.json()) as { data: { id: string }[]; _links: { next?: { href: string } } };
      for (const o of body.data) {
        assert.ok(!ids.has(o.id), `duplicate ${o.id}`);
        ids.add(o.id);
      }
      const link = res.headers.get('link');
      next = body._links.next?.href ?? null;
      if (next) assert.equal(link, `<${next}>; rel="next"`);
      pages += 1;
    }
    assert.equal(ids.size, total);
    assert.equal(pages, Math.ceil(total / 2));
  });

  it('filters by status and customer', async () => {
    const res = await fetch(url('/api/v1/orders?customer=alice&status=pending'));
    const body = (await res.json()) as { data: { customer: string }[] };
    assert.equal(body.data.length, 2);
    assert.ok(body.data.every((o) => o.customer === 'alice'));
  });

  it('projects sparse fieldsets', async () => {
    const res = await fetch(url('/api/v1/orders?fields=status&limit=1'));
    const body = (await res.json()) as { data: Record<string, unknown>[] };
    assert.deepEqual(Object.keys(body.data[0]!).sort(), ['_links', 'id', 'status']);
  });

  it('rejects bad query parameters with 400 and names each one', async () => {
    const res = await fetch(url('/api/v1/orders?limit=0&status=lost&cursor=zzz&sort=price'));
    assert.equal(res.status, 400);
    const problem = (await res.json()) as { errors: { name: string }[] };
    assert.deepEqual(problem.errors.map((e) => e.name).sort(), ['cursor', 'limit', 'sort', 'status']);
  });
});

describe('conditional requests and updates', () => {
  async function fresh(): Promise<{ location: string; etag: string }> {
    const res = await create();
    return { location: res.headers.get('location')!, etag: res.headers.get('etag')! };
  }

  it('If-None-Match with the current ETag returns 304 and no body', async () => {
    const { location, etag } = await fresh();
    const res = await fetch(url(location), { headers: { 'If-None-Match': etag } });
    assert.equal(res.status, 304);
    assert.equal(res.headers.get('etag'), etag);
    assert.equal(await res.text(), '');
  });

  it('PUT replaces the writable fields and changes the ETag', async () => {
    const { location, etag } = await fresh();
    const res = await fetch(url(location), {
      method: 'PUT',
      ...json({ ...sampleOrder, status: 'paid', note: 'gift wrap' }, { 'If-Match': etag }),
    });
    assert.equal(res.status, 200);
    assert.notEqual(res.headers.get('etag'), etag);
    const order = (await res.json()) as { status: string; note: string };
    assert.equal(order.status, 'paid');
    assert.equal(order.note, 'gift wrap');
  });

  it('PUT is idempotent: repeating it leaves the same state and ETag', async () => {
    const { location } = await fresh();
    const put = (): Promise<Response> =>
      fetch(url(location), { method: 'PUT', ...json({ ...sampleOrder, status: 'paid' }) });
    const first = await put();
    const second = await put();
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(second.headers.get('etag'), first.headers.get('etag'));
  });

  it('a stale If-Match is 412 (lost update prevented)', async () => {
    const { location, etag } = await fresh();
    const first = await fetch(url(location), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/merge-patch+json', 'If-Match': etag },
      body: JSON.stringify({ note: 'first writer' }),
    });
    assert.equal(first.status, 200);
    const second = await fetch(url(location), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/merge-patch+json', 'If-Match': etag },
      body: JSON.stringify({ note: 'second writer' }),
    });
    assert.equal(second.status, 412);
  });

  it('PATCH needs merge-patch+json and null removes a field', async () => {
    const { location } = await fresh();
    const wrongType = await fetch(url(location), { method: 'PATCH', ...json({ note: 'x' }) });
    assert.equal(wrongType.status, 415);
    assert.equal(wrongType.headers.get('accept-patch'), 'application/merge-patch+json');

    const patch = (body: unknown): Promise<Response> =>
      fetch(url(location), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/merge-patch+json' },
        body: JSON.stringify(body),
      });
    await patch({ note: 'leave at door' });
    const cleared = (await (await patch({ note: null })).json()) as { note?: string };
    assert.equal(cleared.note, undefined);
  });

  it('an illegal status change is 409 Conflict', async () => {
    const { location } = await fresh();
    const patch = (status: string): Promise<Response> =>
      fetch(url(location), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/merge-patch+json' },
        body: JSON.stringify({ status }),
      });
    assert.equal((await patch('cancelled')).status, 200);
    const res = await patch('paid');
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { currentStatus: string }).currentStatus, 'cancelled');
  });

  it('DELETE is 204, then the resource is gone', async () => {
    const { location } = await fresh();
    assert.equal((await fetch(url(location), { method: 'DELETE' })).status, 204);
    assert.equal((await fetch(url(location), { method: 'DELETE' })).status, 404);
    assert.equal((await fetch(url(location))).status, 404);
  });
});
