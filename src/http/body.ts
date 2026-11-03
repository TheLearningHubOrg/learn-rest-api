import type { IncomingMessage } from 'node:http';
import { HttpError } from './problem.js';

export interface ReadOptions {
  /** Media types this endpoint accepts, e.g. ['application/json']. */
  accept: string[];
  /** Largest body we are willing to buffer. */
  maxBytes?: number;
  /** PATCH endpoints advertise their patch formats in Accept-Patch (RFC 5789). */
  isPatch?: boolean;
}

export interface ParsedBody {
  raw: string;
  value: unknown;
}

/** The media type without parameters: "application/json; charset=utf-8" -> "application/json". */
export function mediaType(header: string | undefined): string {
  return (header ?? '').split(';')[0]!.trim().toLowerCase();
}

/**
 * Reads and parses a JSON request body, mapping each failure to the status
 * code HTTP defines for it:
 *   wrong Content-Type -> 415, too large -> 413, unparseable -> 400.
 * Semantic validation (422) is the caller's job.
 */
export async function readJson(req: IncomingMessage, options: ReadOptions): Promise<ParsedBody> {
  const maxBytes = options.maxBytes ?? 64 * 1024;
  const type = mediaType(req.headers['content-type']);

  if (!options.accept.includes(type)) {
    throw new HttpError(
      415,
      'unsupported-media-type',
      'Unsupported Media Type',
      `Send the body as ${options.accept.join(' or ')}; received "${type || 'no Content-Type'}".`,
      options.isPatch ? { headers: { 'Accept-Patch': options.accept.join(', ') } } : {},
    );
  }

  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > maxBytes) throw tooLarge(maxBytes);

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > maxBytes) throw tooLarge(maxBytes);
    chunks.push(buf);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return { raw, value: JSON.parse(raw) as unknown };
  } catch {
    throw new HttpError(400, 'malformed-json', 'Malformed JSON', 'The request body is not valid JSON.');
  }
}

function tooLarge(maxBytes: number): HttpError {
  return new HttpError(413, 'content-too-large', 'Content Too Large', `Request bodies are limited to ${maxBytes} bytes.`);
}
