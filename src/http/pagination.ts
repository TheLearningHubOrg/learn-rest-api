/**
 * Keyset (cursor) pagination over a (createdAt, id) sort key.
 *
 * The in-memory version below does what this SQL does against an index on
 * (created_at, id):
 *
 *   SELECT * FROM orders
 *   WHERE (created_at, id) > ($1, $2)
 *   ORDER BY created_at, id
 *   LIMIT $3 + 1;          -- one extra row tells us whether a next page exists
 */
export interface SortKey {
  createdAt: string;
  id: string;
}

export type Direction = 'asc' | 'desc';

/** Cursors are opaque to clients: base64url of a small JSON array. */
export function encodeCursor(key: SortKey): string {
  return Buffer.from(JSON.stringify([key.createdAt, key.id])).toString('base64url');
}

export function decodeCursor(cursor: string): SortKey | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === 'string')) {
      return { createdAt: value[0] as string, id: value[1] as string };
    }
  } catch {
    // fall through
  }
  return null;
}

export function compareKeys(a: SortKey, b: SortKey): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export function keysetPage<T extends SortKey>(
  rows: Iterable<T>,
  options: { limit: number; after?: SortKey | null; direction?: Direction },
): Page<T> {
  const sign = options.direction === 'desc' ? -1 : 1;
  const after = options.after ?? null;
  const sorted = [...rows].sort((a, b) => sign * compareKeys(a, b));
  const remaining = after ? sorted.filter((row) => sign * compareKeys(row, after) > 0) : sorted;
  const items = remaining.slice(0, options.limit);
  const last = items[items.length - 1];
  const nextCursor = remaining.length > options.limit && last ? encodeCursor(last) : null;
  return { items, nextCursor };
}
