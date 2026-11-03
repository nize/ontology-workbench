import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const configPath = require.resolve('../../next.config.js');

// next.config.js reads BASE_PATH when it is loaded, so each case loads it fresh.
function loadConfig(basePath: string | undefined) {
  if (basePath === undefined) delete process.env.BASE_PATH;
  else process.env.BASE_PATH = basePath;
  delete require.cache[configPath];
  return require(configPath);
}

describe('next.config basePath', () => {
  afterEach(() => {
    delete process.env.BASE_PATH;
    delete require.cache[configPath];
  });

  it('serves from the root when BASE_PATH is unset', () => {
    const config = loadConfig(undefined);
    expect(config.basePath).toBe('');
    expect(config.env.NEXT_PUBLIC_BASE_PATH).toBe('');
  });

  it('uses BASE_PATH for routes and for the client API prefix', () => {
    const config = loadConfig('/ow');
    expect(config.basePath).toBe('/ow');
    expect(config.env.NEXT_PUBLIC_BASE_PATH).toBe('/ow');
  });

  it.each(['ow', '/ow/', '/', '/o w'])('rejects %j at build time', (value) => {
    expect(() => loadConfig(value)).toThrow(/BASE_PATH must start with/);
  });
});
