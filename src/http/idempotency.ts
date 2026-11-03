import { createHash } from 'node:crypto';

/**
 * Stored outcome of a POST that carried an Idempotency-Key header.
 * Replaying it lets a client retry after a timeout without creating a
 * second order. (Header semantics follow the IETF httpapi
 * Idempotency-Key draft.)
 */
export interface StoredResponse {
  fingerprint: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  expiresAt: number;
}

export function fingerprint(method: string, path: string, rawBody: string): string {
  return createHash('sha256').update(`${method} ${path}\n${rawBody}`).digest('hex');
}

/**
 * Single-process store. Node runs each request's synchronous section to
 * completion, so "look up, create, save" cannot interleave here. With several
 * instances behind a load balancer you need a shared store and an atomic
 * claim (for example Redis SET key value NX PX ttl) instead.
 */
export class IdempotencyStore {
  private readonly entries = new Map<string, StoredResponse>();
  private readonly ttlMs: number;
  private readonly clock: () => number;

  constructor(ttlMs = 24 * 60 * 60 * 1000, clock: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.clock = clock;
  }

  get(key: string): StoredResponse | undefined {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt <= this.clock()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  save(key: string, entry: Omit<StoredResponse, 'expiresAt'>): void {
    this.entries.set(key, { ...entry, expiresAt: this.clock() + this.ttlMs });
  }
}
