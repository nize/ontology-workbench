declare module 'node:fs/promises' {
  export function readFile(path: string | URL, options: { encoding: string } | string): Promise<string>;
}

declare module 'node:buffer' {
  export class Buffer {
    static from(value: string, encoding?: string): Buffer;
    toString(encoding?: string): string;
  }
}

declare const process: {
  env: Record<string, string | undefined>;
};

declare module 'vitest' {
  export const describe: (...args: any[]) => void;
  export const it: (...args: any[]) => void;
  export const beforeAll: (...args: any[]) => void;
  export const beforeEach: (...args: any[]) => void;
  export const expect: any;
}
