import { randomUUID } from 'node:crypto';
import { toInput, totalOf, type Order, type OrderInput, type OrderStatus } from './model.js';

export interface StoreOptions {
  now?: () => Date;
  newId?: () => string;
}

export interface ListFilter {
  status?: OrderStatus;
  customer?: string;
}

/**
 * In-memory persistence. Swap it for a database without touching the HTTP
 * layer: the routes only call these five methods.
 */
export class OrderStore {
  private readonly orders = new Map<string, Order>();
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(options: StoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    // Random, non-sequential IDs: clients cannot guess or count other orders.
    this.newId = options.newId ?? (() => `ord_${randomUUID().replaceAll('-', '').slice(0, 20)}`);
  }

  list(filter: ListFilter = {}): Order[] {
    return [...this.orders.values()].filter(
      (o) =>
        (filter.status === undefined || o.status === filter.status) &&
        (filter.customer === undefined || o.customer === filter.customer),
    );
  }

  get(id: string): Order | undefined {
    return this.orders.get(id);
  }

  create(input: OrderInput): Order {
    const at = this.now().toISOString();
    const order: Order = {
      id: this.newId(),
      ...input,
      totalCents: totalOf(input.items),
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    this.orders.set(order.id, order);
    return order;
  }

  replace(id: string, input: OrderInput): Order | undefined {
    const current = this.orders.get(id);
    if (!current) return undefined;
    // Re-sending the same state changes nothing, not even updatedAt, so a
    // retried PUT returns the same ETag as the first one.
    if (JSON.stringify(toInput(current)) === JSON.stringify(input)) return current;
    const next: Order = {
      id,
      ...input,
      totalCents: totalOf(input.items),
      createdAt: current.createdAt,
      updatedAt: this.now().toISOString(),
      version: current.version + 1,
    };
    this.orders.set(id, next);
    return next;
  }

  delete(id: string): boolean {
    return this.orders.delete(id);
  }
}

/** Four fixed orders so a fresh server has something to page through. */
export function seedStore(store: OrderStore): OrderStore {
  const samples: OrderInput[] = [
    { customer: 'alice', status: 'pending', items: [{ sku: 'BOOK-001', quantity: 2, unitPriceCents: 1500 }] },
    { customer: 'bob', status: 'pending', items: [{ sku: 'MUG-042', quantity: 1, unitPriceCents: 899 }] },
    { customer: 'alice', status: 'pending', items: [{ sku: 'PEN-007', quantity: 10, unitPriceCents: 120 }] },
    { customer: 'carol', status: 'pending', items: [{ sku: 'LAMP-310', quantity: 1, unitPriceCents: 4999 }] },
  ];
  for (const sample of samples) store.create(sample);
  return store;
}
