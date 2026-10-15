import http from 'node:http';
import { REST_STAGES, getCompletedCount, getProgressPercentage } from '../roadmap.mjs';

export function encodeCursor(id, timestamp) {
  return Buffer.from(JSON.stringify({ id, timestamp })).toString('base64');
}

export function decodeCursor(cursorStr) {
  try {
    return JSON.parse(Buffer.from(cursorStr, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

export function createProblemDetails(status, title, detail, instance) {
  return {
    type: 'https://api.example.com/errors/' + title.toLowerCase().replace(/\s+/g, '-'),
    title,
    status,
    detail,
    instance,
    timestamp: new Date().toISOString()
  };
}

export function createRestServer() {
  const idempotencyStore = new Map();
  const sampleOrders = [
    { id: 'ord-101', customer: 'Alice', amount: 150.00, timestamp: 1741340001 },
    { id: 'ord-102', customer: 'Bob', amount: 320.50, timestamp: 1741340002 },
    { id: 'ord-103', customer: 'Charlie', amount: 89.99, timestamp: 1741340003 },
    { id: 'ord-104', customer: 'Diana', amount: 499.00, timestamp: 1741340004 }
  ];

  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const method = req.method;

    const sendJson = (statusCode, data, extraHeaders = {}) => {
      res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        ...extraHeaders
      });
      res.end(JSON.stringify(data, null, 2));
    };

    const sendProblem = (status, title, detail) => {
      res.writeHead(status, { 'Content-Type': 'application/problem+json' });
      res.end(JSON.stringify(createProblemDetails(status, title, detail, pathname), null, 2));
    };

    // 1. Root HATEOAS Discovery
    if (pathname === '/' && method === 'GET') {
      return sendJson(200, {
        title: 'The Learning Hub RESTful Architecture API',
        version: 'v1',
        maturityLevel: 'Richardson Maturity Model Level 3 (HATEOAS)',
        _links: {
          self: { href: '/' },
          roadmap: { href: '/api/v1/roadmap' },
          orders: { href: '/api/v1/orders' }
        }
      });
    }

    // 2. Roadmap Resource
    if (pathname === '/api/v1/roadmap' && method === 'GET') {
      return sendJson(200, {
        totalStages: REST_STAGES.length,
        completedStages: getCompletedCount(),
        completionPercentage: getProgressPercentage(),
        stages: REST_STAGES,
        _links: {
          self: { href: '/api/v1/roadmap' },
          root: { href: '/' }
        }
      });
    }

    // 3. Keyset Cursor Paginated Orders
    if (pathname === '/api/v1/orders' && method === 'GET') {
      const limit = parseInt(parsedUrl.searchParams.get('limit') || '2', 10);
      const cursorParam = parsedUrl.searchParams.get('cursor');

      let startIndex = 0;
      if (cursorParam) {
        const decoded = decodeCursor(cursorParam);
        if (decoded) {
          startIndex = sampleOrders.findIndex(o => o.id === decoded.id) + 1;
        }
      }

      const paged = sampleOrders.slice(startIndex, startIndex + limit);
      const nextItem = paged[paged.length - 1];
      const hasMore = startIndex + limit < sampleOrders.length;
      const nextCursor = hasMore && nextItem ? encodeCursor(nextItem.id, nextItem.timestamp) : null;

      return sendJson(200, {
        data: paged,
        pagination: {
          limit,
          hasMore,
          nextCursor
        },
        _links: {
          self: { href: req.url },
          ...(hasMore ? { next: { href: `/api/v1/orders?limit=${limit}&cursor=${nextCursor}` } } : {})
        }
      });
    }

    // 4. Create Order with Idempotency-Key
    if (pathname === '/api/v1/orders' && method === 'POST') {
      const idempotencyKey = req.headers['idempotency-key'];

      if (!idempotencyKey) {
        return sendProblem(400, 'Bad Request', 'Idempotency-Key header is required for payment mutation.');
      }

      if (idempotencyStore.has(idempotencyKey)) {
        const cached = idempotencyStore.get(idempotencyKey);
        return sendJson(cached.status, cached.data, {
          'X-Cache-Lookup': 'HIT',
          'Idempotency-Key': idempotencyKey
        });
      }

      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = body ? JSON.parse(body) : {};
          const newOrder = {
            id: `ord-${sampleOrders.length + 101}`,
            customer: payload.customer || 'Anonymous',
            amount: payload.amount || 99.00,
            timestamp: Math.floor(Date.now() / 1000)
          };
          sampleOrders.push(newOrder);

          const responseData = {
            message: 'Order placed successfully',
            order: newOrder,
            _links: {
              self: { href: `/api/v1/orders/${newOrder.id}` },
              allOrders: { href: '/api/v1/orders' }
            }
          };

          // Cache for idempotency
          idempotencyStore.set(idempotencyKey, { status: 201, data: responseData });

          return sendJson(201, responseData, {
            'X-Cache-Lookup': 'MISS',
            'Idempotency-Key': idempotencyKey
          });
        } catch {
          return sendProblem(422, 'Unprocessable Entity', 'Malformed JSON payload received.');
        }
      });
      return;
    }

    // Fallback 404
    return sendProblem(404, 'Not Found', `The requested route '${pathname}' was not found.`);
  });

  return server;
}
