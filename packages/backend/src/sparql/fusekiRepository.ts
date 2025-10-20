import { Buffer } from 'node:buffer';
import { HttpGraphStore } from './httpGraphStore.js';

export interface FusekiRepositoryOptions {
  endpoint: string;
  timeoutMs?: number;
  basicAuth?: string;
  headers?: Record<string, string>;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export class FusekiRepository extends HttpGraphStore {
  constructor(options: FusekiRepositoryOptions) {
    const base = stripTrailingSlash(options.endpoint);
    const headers = { ...options.headers };
    if (options.basicAuth) {
      headers.Authorization = `Basic ${Buffer.from(options.basicAuth).toString('base64')}`;
    }
    super({
      driver: 'fuseki',
      queryUrl: `${base}/query`,
      updateUrl: `${base}/update`,
      constructUrl: `${base}/query`,
      headers,
      timeoutMs: options.timeoutMs
    });
  }
}
