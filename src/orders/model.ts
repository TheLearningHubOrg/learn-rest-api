import type { InvalidParam } from '../http/problem.js';

export const ORDER_STATUSES = ['pending', 'paid', 'shipped', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface LineItem {
  sku: string;
  quantity: number;
  unitPriceCents: number;
}

/** The fields a client may write. Everything else on Order is server-owned. */
export interface OrderInput {
  customer: string;
  items: LineItem[];
  status: OrderStatus;
  note?: string;
}

export interface Order extends OrderInput {
  id: string;
  totalCents: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export const WRITABLE_FIELDS = ['customer', 'items', 'status', 'note'] as const;
export const READABLE_FIELDS = ['id', 'customer', 'items', 'status', 'note', 'totalCents', 'createdAt', 'updatedAt'] as const;

/**
 * Which status changes are legal. A request that is well-formed but asks for
 * an impossible transition (shipped -> pending) is a 409 Conflict with the
 * resource's current state, not a 422 validation error.
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

const SKU = /^[A-Z0-9-]{3,32}$/;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

export type Validated = { ok: true; value: OrderInput } | { ok: false; errors: InvalidParam[] };

/**
 * Validates a complete client representation (POST and PUT bodies, and the
 * result of applying a merge patch). It collects every problem instead of
 * stopping at the first, so a client can fix a form in one round trip.
 */
export function validateOrderInput(body: unknown, options: { creating: boolean }): Validated {
  const errors: InvalidParam[] = [];
  if (!isRecord(body)) {
    return { ok: false, errors: [{ name: '', reason: 'must be a JSON object' }] };
  }

  for (const key of Object.keys(body)) {
    if (!(WRITABLE_FIELDS as readonly string[]).includes(key)) {
      const readOnly = (READABLE_FIELDS as readonly string[]).includes(key) || key === 'version';
      errors.push({ name: key, reason: readOnly ? 'is read-only' : 'is not a known field' });
    }
  }

  const { customer, items, status, note } = body;
  if (typeof customer !== 'string' || customer.trim().length === 0 || customer.length > 100) {
    errors.push({ name: 'customer', reason: 'must be a non-empty string of at most 100 characters' });
  }

  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    errors.push({ name: 'items', reason: 'must be an array of 1 to 50 line items' });
  } else {
    items.forEach((item: unknown, i) => {
      if (!isRecord(item)) {
        errors.push({ name: `items[${i}]`, reason: 'must be an object' });
        return;
      }
      if (typeof item.sku !== 'string' || !SKU.test(item.sku)) {
        errors.push({ name: `items[${i}].sku`, reason: 'must match ^[A-Z0-9-]{3,32}$' });
      }
      if (!isInt(item.quantity, 1, 1000)) {
        errors.push({ name: `items[${i}].quantity`, reason: 'must be an integer from 1 to 1000' });
      }
      if (!isInt(item.unitPriceCents, 0, 10_000_000)) {
        errors.push({ name: `items[${i}].unitPriceCents`, reason: 'must be an integer number of cents from 0 to 10000000' });
      }
    });
  }

  if (status !== undefined && !(ORDER_STATUSES as readonly unknown[]).includes(status)) {
    errors.push({ name: 'status', reason: `must be one of ${ORDER_STATUSES.join(', ')}` });
  } else if (options.creating && status !== undefined && status !== 'pending') {
    errors.push({ name: 'status', reason: 'new orders start as pending' });
  } else if (!options.creating && status === undefined) {
    errors.push({ name: 'status', reason: 'is required when replacing an order' });
  }

  if (note !== undefined && (typeof note !== 'string' || note.length > 500)) {
    errors.push({ name: 'note', reason: 'must be a string of at most 500 characters' });
  }

  if (errors.length > 0) return { ok: false, errors };

  const value: OrderInput = {
    customer: (customer as string).trim(),
    items: (items as LineItem[]).map(({ sku, quantity, unitPriceCents }) => ({ sku, quantity, unitPriceCents })),
    status: (status as OrderStatus | undefined) ?? 'pending',
  };
  if (note !== undefined) value.note = note as string;
  return { ok: true, value };
}

/** The writable view of an order, used as the target of a merge patch. */
export function toInput(order: Order): OrderInput {
  const input: OrderInput = { customer: order.customer, items: order.items, status: order.status };
  if (order.note !== undefined) input.note = order.note;
  return input;
}

/**
 * JSON Merge Patch (RFC 7396). Objects merge recursively, null deletes a
 * member, and anything else (including arrays) replaces the target value.
 */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isRecord(patch)) return patch;
  const result: Record<string, unknown> = isRecord(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = mergePatch(result[key], value);
  }
  return result;
}

export function totalOf(items: LineItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
}
