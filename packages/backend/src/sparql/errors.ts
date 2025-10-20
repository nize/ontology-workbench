export class GraphStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphStoreError';
  }
}

export class GraphStoreTimeoutError extends GraphStoreError {
  constructor(readonly timeoutMs: number) {
    super(`SPARQL request timed out after ${timeoutMs}ms`);
    this.name = 'GraphStoreTimeoutError';
  }
}

export class GraphStoreHttpError extends GraphStoreError {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string
  ) {
    super(message);
    this.name = 'GraphStoreHttpError';
  }
}
