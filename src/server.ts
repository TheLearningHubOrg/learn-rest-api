import { createServer } from 'node:http';
import { createApp } from './app.js';
import { OrderStore, seedStore } from './orders/store.js';

const port = Number(process.env.PORT ?? 8080);
// 0.0.0.0, not localhost: inside a container, localhost is unreachable from outside.
const host = process.env.HOST ?? '0.0.0.0';

const server = createServer(createApp({ store: seedStore(new OrderStore()) }));

server.listen(port, host, () => {
  console.log(`orders API listening on http://${host}:${port}`);
});

// Docker and Kubernetes send SIGTERM; finish in-flight requests, then exit.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
  });
}
