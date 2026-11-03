import { readJson } from '../http/body.js';
import { etagFor, ifMatchHolds, ifNoneMatchHits } from '../http/etag.js';
import { fingerprint, type IdempotencyStore } from '../http/idempotency.js';
import { decodeCursor, keysetPage, type Direction } from '../http/pagination.js';
import { HttpError, validationError, type InvalidParam } from '../http/problem.js';
import { sendEmpty, sendJson, sendJsonText } from '../http/respond.js';
import type { Context, Router } from '../http/router.js';
import {
  ORDER_STATUSES,
  READABLE_FIELDS,
  canTransition,
  mergePatch,
  toInput,
  validateOrderInput,
  type Order,
  type OrderInput,
  type OrderStatus,
} from './model.js';
import type { OrderStore } from './store.js';

export const ORDERS = '/api/v1/orders';
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

type Representation = Record<string, unknown>;

/** The public representation: no internal version counter, plus links. */
export function represent(order: Order): Representation {
  const { version: _version, ...visible } = order;
  return {
    ...visible,
    _links: {
      self: { href: `${ORDERS}/${encodeURIComponent(order.id)}` },
      collection: { href: ORDERS },
    },
  };
}

/** The ETag of the full representation, the one If-Match is checked against. */
export function entityTag(order: Order): string {
  return etagFor(JSON.stringify(represent(order)));
}

function parseFields(url: URL, errors: InvalidParam[]): string[] | null {
  const raw = url.searchParams.get('fields');
  if (raw === null) return null;
  const fields = raw.split(',').map((f) => f.trim()).filter(Boolean);
  const unknown = fields.filter((f) => !(READABLE_FIELDS as readonly string[]).includes(f));
  if (unknown.length > 0 || fields.length === 0) {
    errors.push({ name: 'fields', reason: `choose from ${READABLE_FIELDS.join(', ')}` });
    return null;
  }
  return fields.includes('id') ? fields : ['id', ...fields];
}

function project(rep: Representation, fields: string[] | null): Representation {
  if (!fields) return rep;
  const out: Representation = {};
  for (const field of fields) if (field in rep) out[field] = rep[field];
  out._links = rep._links;
  return out;
}

function invalidQuery(errors: InvalidParam[]): HttpError {
  return new HttpError(400, 'invalid-query', 'Invalid query parameters', 'Fix the listed query parameters and retry.', {
    extensions: { errors },
  });
}

function findOrThrow(store: OrderStore, id: string): Order {
  const order = store.get(id);
  if (!order) {
    throw new HttpError(404, 'not-found', 'Not Found', `No order with id "${id}".`);
  }
  return order;
}

function checkIfMatch(ctx: Context, order: Order): void {
  if (!ifMatchHolds(ctx.req.headers['if-match'], entityTag(order))) {
    throw new HttpError(
      412,
      'precondition-failed',
      'Precondition Failed',
      'The order changed since you read it. GET it again, reapply your change, and resend with the new ETag.',
    );
  }
}

function checkTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new HttpError(409, 'invalid-transition', 'Conflict', `An order that is ${from} cannot become ${to}.`, {
      extensions: { currentStatus: from },
    });
  }
}

function validated(body: unknown, creating: boolean): OrderInput {
  const result = validateOrderInput(body, { creating });
  if (!result.ok) throw validationError(result.errors);
  return result.value;
}

function sendOrder(ctx: Context, status: number, order: Order, extra: Record<string, string> = {}): string {
  const text = JSON.stringify(represent(order));
  sendJsonText(ctx.res, status, text, { ETag: etagFor(text), 'Cache-Control': 'private, no-cache', ...extra });
  return text;
}

export function registerOrderRoutes(router: Router, store: OrderStore, idempotency: IdempotencyStore): void {
  // GET /api/v1/orders?status=&customer=&sort=&limit=&cursor=&fields=
  router.on('GET', ORDERS, ({ res, url }) => {
    const errors: InvalidParam[] = [];
    const q = url.searchParams;

    const limitRaw = q.get('limit');
    const limit = limitRaw === null ? DEFAULT_LIMIT : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      errors.push({ name: 'limit', reason: `must be an integer from 1 to ${MAX_LIMIT}` });
    }

    const status = q.get('status');
    if (status !== null && !(ORDER_STATUSES as readonly string[]).includes(status)) {
      errors.push({ name: 'status', reason: `must be one of ${ORDER_STATUSES.join(', ')}` });
    }

    const sort = q.get('sort') ?? 'createdAt';
    if (sort !== 'createdAt' && sort !== '-createdAt') {
      errors.push({ name: 'sort', reason: 'must be createdAt or -createdAt' });
    }
    const direction: Direction = sort.startsWith('-') ? 'desc' : 'asc';

    const cursorRaw = q.get('cursor');
    const after = cursorRaw === null ? null : decodeCursor(cursorRaw);
    if (cursorRaw !== null && after === null) {
      errors.push({ name: 'cursor', reason: 'is not a cursor this API issued; restart from the first page' });
    }

    const fields = parseFields(url, errors);
    if (errors.length > 0) throw invalidQuery(errors);

    const filter: { status?: OrderStatus; customer?: string } = {};
    if (status !== null) filter.status = status as OrderStatus;
    const customer = q.get('customer');
    if (customer !== null) filter.customer = customer;

    const page = keysetPage(store.list(filter), { limit, after, direction });

    const self = `${ORDERS}${url.search}`;
    const links: Record<string, { href: string }> = { self: { href: self } };
    const headers: Record<string, string> = { 'Cache-Control': 'private, no-cache' };
    if (page.nextCursor) {
      const nextQuery = new URLSearchParams(q);
      nextQuery.set('cursor', page.nextCursor);
      const next = `${ORDERS}?${nextQuery.toString()}`;
      links.next = { href: next };
      headers.Link = `<${next}>; rel="next"`;
    }

    sendJson(
      res,
      200,
      {
        data: page.items.map((o) => project(represent(o), fields)),
        page: { limit, nextCursor: page.nextCursor },
        _links: links,
      },
      headers,
    );
  });

  // POST /api/v1/orders   (optional Idempotency-Key header)
  router.on('POST', ORDERS, async ({ req, res }) => {
    const keyHeader = req.headers['idempotency-key'];
    if (Array.isArray(keyHeader) || (keyHeader !== undefined && (keyHeader.length === 0 || keyHeader.length > 255))) {
      throw new HttpError(400, 'invalid-idempotency-key', 'Invalid Idempotency-Key', 'Send one key of 1 to 255 characters.');
    }

    const body = await readJson(req, { accept: ['application/json'] });

    if (keyHeader !== undefined) {
      const prior = idempotency.get(keyHeader);
      if (prior) {
        if (prior.fingerprint !== fingerprint('POST', ORDERS, body.raw)) {
          throw new HttpError(
            422,
            'idempotency-key-reused',
            'Idempotency key reused',
            'This Idempotency-Key was already used with a different request body. Generate a new key per operation.',
          );
        }
        sendJsonText(res, prior.status, prior.body, { ...prior.headers, 'Idempotent-Replayed': 'true' });
        return;
      }
    }

    const order = store.create(validated(body.value, true));
    const location = `${ORDERS}/${encodeURIComponent(order.id)}`;
    const text = JSON.stringify(represent(order));
    const headers = { Location: location, ETag: etagFor(text), 'Cache-Control': 'no-store' };
    sendJsonText(res, 201, text, headers);

    if (keyHeader !== undefined) {
      idempotency.save(keyHeader, { fingerprint: fingerprint('POST', ORDERS, body.raw), status: 201, headers, body: text });
    }
  });

  // GET (and HEAD) /api/v1/orders/:id?fields=
  router.on('GET', `${ORDERS}/:id`, ({ req, res, url, params }) => {
    const errors: InvalidParam[] = [];
    const fields = parseFields(url, errors);
    if (errors.length > 0) throw invalidQuery(errors);

    const order = findOrThrow(store, params.id!);
    const text = JSON.stringify(project(represent(order), fields));
    const tag = etagFor(text);
    const headers = { ETag: tag, 'Cache-Control': 'private, no-cache' };

    if (ifNoneMatchHits(req.headers['if-none-match'], tag)) {
      sendEmpty(res, 304, headers);
      return;
    }
    sendJsonText(res, 200, text, headers);
  });

  // PUT /api/v1/orders/:id   full replacement of the writable fields
  router.on('PUT', `${ORDERS}/:id`, async (ctx) => {
    const order = findOrThrow(store, ctx.params.id!);
    checkIfMatch(ctx, order);
    const body = await readJson(ctx.req, { accept: ['application/json'] });
    const input = validated(body.value, false);
    checkTransition(order.status, input.status);
    sendOrder(ctx, 200, store.replace(order.id, input)!);
  });

  // PATCH /api/v1/orders/:id   JSON Merge Patch (RFC 7396)
  router.on('PATCH', `${ORDERS}/:id`, async (ctx) => {
    const order = findOrThrow(store, ctx.params.id!);
    checkIfMatch(ctx, order);
    const body = await readJson(ctx.req, { accept: ['application/merge-patch+json'], isPatch: true });
    const input = validated(mergePatch(toInput(order), body.value), false);
    checkTransition(order.status, input.status);
    sendOrder(ctx, 200, store.replace(order.id, input)!);
  });

  // DELETE /api/v1/orders/:id
  router.on('DELETE', `${ORDERS}/:id`, (ctx) => {
    const order = findOrThrow(store, ctx.params.id!);
    checkIfMatch(ctx, order);
    store.delete(order.id);
    sendEmpty(ctx.res, 204);
  });
}
