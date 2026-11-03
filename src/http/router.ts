import type { IncomingMessage, ServerResponse } from 'node:http';

export type Params = Record<string, string>;

export interface Context {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Params;
}

export type Handler = (ctx: Context) => void | Promise<void>;

interface Route {
  template: string;
  pattern: RegExp;
  keys: string[];
  handlers: Map<string, Handler>;
}

export type Match =
  | { kind: 'found'; handler: Handler; params: Params; allow: string[] }
  | { kind: 'method-not-allowed'; allow: string[] }
  | { kind: 'options'; allow: string[] }
  | { kind: 'not-found' };

function compile(template: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = template
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  // An optional trailing slash, so /orders and /orders/ name the same resource.
  return { pattern: new RegExp(`^${source}/?$`), keys };
}

/**
 * A deliberately small router. It knows the one thing a REST server must get
 * right: the difference between "no such resource" (404) and "this resource
 * exists but does not support that method" (405 + Allow).
 */
export class Router {
  private readonly routes: Route[] = [];

  on(method: string, template: string, handler: Handler): this {
    let route = this.routes.find((r) => r.template === template);
    if (!route) {
      route = { template, ...compile(template), handlers: new Map() };
      this.routes.push(route);
    }
    route.handlers.set(method.toUpperCase(), handler);
    return this;
  }

  match(method: string, pathname: string): Match {
    for (const route of this.routes) {
      const m = route.pattern.exec(pathname);
      if (!m) continue;

      const allow = allowedMethods(route);
      const params: Params = {};
      try {
        route.keys.forEach((key, i) => {
          params[key] = decodeURIComponent(m[i + 1] ?? '');
        });
      } catch {
        return { kind: 'not-found' }; // malformed percent-encoding
      }

      // HEAD is GET without a body; Node drops the body for HEAD responses.
      const handler = route.handlers.get(method) ?? (method === 'HEAD' ? route.handlers.get('GET') : undefined);
      if (handler) return { kind: 'found', handler, params, allow };
      if (method === 'OPTIONS') return { kind: 'options', allow };
      return { kind: 'method-not-allowed', allow };
    }
    return { kind: 'not-found' };
  }
}

function allowedMethods(route: Route): string[] {
  const methods = new Set(route.handlers.keys());
  if (methods.has('GET')) methods.add('HEAD');
  methods.add('OPTIONS');
  return [...methods];
}
