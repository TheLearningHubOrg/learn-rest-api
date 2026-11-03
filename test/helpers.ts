import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, type AppOptions } from '../src/app.js';
import { OrderStore, seedStore } from '../src/orders/store.js';

export interface TestServer {
  base: string;
  store: OrderStore;
  close: () => Promise<void>;
}

/** Starts the real HTTP server on a random free port; tests talk to it with fetch. */
export async function startServer(options: AppOptions = {}): Promise<TestServer> {
  const store = options.store ?? seedStore(new OrderStore());
  const server: Server = createServer(createApp({ ...options, store }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    store,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export const sampleOrder = {
  customer: 'dana',
  items: [{ sku: 'BOOK-001', quantity: 1, unitPriceCents: 2500 }],
};

export function json(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return { headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) };
}
