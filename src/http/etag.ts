import { createHash } from 'node:crypto';

/**
 * A strong entity tag: a hash of the exact bytes we are about to send.
 * Two responses get the same ETag only when their bodies are byte-identical.
 */
export function etagFor(body: string): string {
  return `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;
}

function parseList(header: string): string[] {
  return header
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

const opaque = (tag: string): string => (tag.startsWith('W/') ? tag.slice(2) : tag);

/**
 * If-None-Match uses the WEAK comparison (RFC 9110, section 13.1.2):
 * W/"x" and "x" are equivalent. A match means "the client already has it",
 * so a GET answers 304 Not Modified.
 */
export function ifNoneMatchHits(header: string | undefined, current: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return parseList(header).some((tag) => opaque(tag) === opaque(current));
}

/**
 * If-Match uses the STRONG comparison (RFC 9110, section 13.1.1): weak tags
 * never match. A miss means "someone changed it since you read it", so a
 * write answers 412 Precondition Failed.
 */
export function ifMatchHolds(header: string | undefined, current: string | undefined): boolean {
  if (header === undefined) return true; // no precondition sent
  if (current === undefined) return false; // resource does not exist
  if (header.trim() === '*') return true;
  return parseList(header).some((tag) => !tag.startsWith('W/') && tag === current);
}
