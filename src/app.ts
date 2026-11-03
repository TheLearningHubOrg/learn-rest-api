import { randomUUID } from 'node:crypto';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { IdempotencyStore } from './http/idempotency.js';
import { HttpError, sendProblem } from './http/problem.js';
import { sendEmpty, sendJson } from './http/respond.js';
import { Router } from './http/router.js';
import { ORDERS, registerOrderRoutes } from './orders/routes.js';
import { OrderStore } from './orders/store.js';

export interface AppOptions {
  store?: OrderStore;
  idempotency?: IdempotencyStore;
}

const REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

export function createApp(options: AppOptions = {}): RequestListener {
  const store = options.store ?? new OrderStore();
  const idempotency = options.idempotency ?? new IdempotencyStore();
  const router = new Router();

  // Liveness probe for Docker HEALTHCHECK, Kubernetes and the CI smoke test.
  router.on('GET', '/health', ({ res }) => {
    sendJson(res, 200, { status: 'ok' }, { 'Cache-Control': 'no-store' });
  });

  // The entry point: a client that knows only "/" can discover everything else.
  router.on('GET', '/', ({ res }) => {
    sendJson(res, 200, {
      name: 'learn-rest-api orders service',
      _links: {
        self: { href: '/' },
        orders: { href: ORDERS },
        order: { href: `${ORDERS}/{id}`, templated: true },
        health: { href: '/health' },
      },
    });
  });

  registerOrderRoutes(router, store, idempotency);

  return (req: IncomingMessage, res: ServerResponse) => {
    void handle(router, req, res);
  };
}

async function handle(router: Router, req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Never build URLs from the Host header; it is client-controlled.
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = (req.method ?? 'GET').toUpperCase();

  const incomingId = req.headers['x-request-id'];
  const requestId = typeof incomingId === 'string' && REQUEST_ID.test(incomingId) ? incomingId : randomUUID();
  res.setHeader('X-Request-Id', requestId);

  try {
    const match = router.match(method, url.pathname);
    switch (match.kind) {
      case 'found':
        await match.handler({ req, res, url, params: match.params });
        return;
      case 'options':
        sendEmpty(res, 204, { Allow: match.allow.join(', ') });
        return;
      case 'method-not-allowed':
        throw new HttpError(405, 'method-not-allowed', 'Method Not Allowed', `${method} is not supported on ${url.pathname}.`, {
          headers: { Allow: match.allow.join(', ') },
        });
      case 'not-found':
        throw new HttpError(404, 'not-found', 'Not Found', `Nothing lives at ${url.pathname}.`);
    }
  } catch (err) {
    if (res.headersSent) {
      res.destroy(err as Error);
      return;
    }
    if (err instanceof HttpError) {
      sendProblem(res, err.toProblem(url.pathname), err.headers);
      return;
    }
    // Log the real cause with the request ID; tell the client nothing internal.
    console.error(`[${requestId}] ${method} ${url.pathname} failed`, err);
    sendProblem(res, {
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: `Something went wrong on our side. Quote request id ${requestId} if you contact support.`,
      instance: url.pathname,
    });
  }
}
