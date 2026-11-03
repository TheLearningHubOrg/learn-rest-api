import type { ServerResponse } from 'node:http';

/**
 * Sends an already-serialised JSON body. Serialising once and passing the
 * string around means the ETag we compute and the bytes we send can never
 * disagree.
 */
export function sendJsonText(
  res: ServerResponse,
  status: number,
  text: string,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
    ...headers,
  });
  res.end(text); // for HEAD requests Node keeps the headers and drops the body
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): string {
  const text = JSON.stringify(body);
  sendJsonText(res, status, text, headers);
  return text;
}

export function sendEmpty(res: ServerResponse, status: 204 | 304, headers: Record<string, string> = {}): void {
  res.writeHead(status, headers);
  res.end();
}
