import { Buffer } from 'node:buffer';
import { HttpGraphStore } from './httpGraphStore.js';

export interface GraphDBHttpRepositoryOptions {
  endpoint: string;
  timeoutMs?: number;
  basicAuth?: string;
  headers?: Record<string, string>;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export class GraphDBHttpRepository extends HttpGraphStore {
  constructor(options: GraphDBHttpRepositoryOptions) {
    const endpoint = stripTrailingSlash(options.endpoint);
    const headers = { ...options.headers };
    if (options.basicAuth) {
      headers.Authorization = `Basic ${Buffer.from(options.basicAuth).toString('base64')}`;
    }
    super({
      driver: 'graphdb',
      queryUrl: endpoint,
      updateUrl: `${endpoint}/statements`,
      headers,
      timeoutMs: options.timeoutMs
    });
  }
}
