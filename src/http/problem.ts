import type { ServerResponse } from 'node:http';

/**
 * Problem Details for HTTP APIs (RFC 9457, which obsoletes RFC 7807).
 * Every error this server returns uses this shape and the
 * application/problem+json media type.
 */
export interface InvalidParam {
  name: string;
  reason: string;
}

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  [extension: string]: unknown;
}

/** Base URI for problem types. Override it with PROBLEM_BASE_URL in production. */
export const PROBLEM_BASE = process.env.PROBLEM_BASE_URL ?? 'https://api.example.com/problems/';

/**
 * Throw an HttpError anywhere in a handler. The app's error boundary turns it
 * into a problem+json response, so handlers never format errors themselves.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly extensions: Record<string, unknown>;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    slug: string,
    title: string,
    detail: string,
    options: { extensions?: Record<string, unknown>; headers?: Record<string, string> } = {},
  ) {
    super(detail);
    this.status = status;
    this.type = PROBLEM_BASE + slug;
    this.title = title;
    this.extensions = options.extensions ?? {};
    this.headers = options.headers ?? {};
  }

  toProblem(instance: string): ProblemBody {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      detail: this.message,
      instance,
      ...this.extensions,
    };
  }
}

/** 422 with one entry per failing field, the shape most API clients expect. */
export function validationError(errors: InvalidParam[]): HttpError {
  return new HttpError(422, 'validation-error', 'Your request is not valid', 'One or more fields failed validation.', {
    extensions: { errors },
  });
}

export function sendProblem(res: ServerResponse, problem: ProblemBody, headers: Record<string, string> = {}): void {
  const body = JSON.stringify(problem);
  res.writeHead(problem.status, {
    ...headers,
    'Content-Type': 'application/problem+json',
    'Content-Length': Buffer.byteLength(body),
    // Errors describe one moment in time; never let a cache reuse them.
    'Cache-Control': 'no-store',
  });
  res.end(body);
}
