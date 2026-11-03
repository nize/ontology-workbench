import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const configPath = require.resolve('../../next.config.js');
const { PLACEHOLDER, normalizeBasePath, applyBasePath, fixRoutesManifest } = require('../../base-path.js');

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

  it('rejects an invalid BASE_PATH at build time', () => {
    expect(() => loadConfig('/ow/')).toThrow(/BASE_PATH must start with/);
  });
});

describe('normalizeBasePath', () => {
  it.each([
    [undefined, ''],
    ['', ''],
    ['/', ''],
    ['/ow', '/ow'],
    ['/tools/ow', '/tools/ow'],
  ])('accepts %j as %j', (value, expected) => {
    expect(normalizeBasePath(value)).toBe(expected);
  });

  it.each(['ow', '/ow/', '//ow', '/o w', '/ow?x=1'])('rejects %j', (value) => {
    expect(() => normalizeBasePath(value)).toThrow(/BASE_PATH must start with/);
  });

  it('builds the image with a placeholder it accepts itself', () => {
    expect(normalizeBasePath(PLACEHOLDER)).toBe(PLACEHOLDER);
  });
});

describe('applyBasePath', () => {
  const built = `<link href="${PLACEHOLDER}/_next/static/a.css"/><script>r.p="${PLACEHOLDER}/_next/"</script>`;

  it('replaces every occurrence with the prefix', () => {
    expect(applyBasePath(built, '/ow')).toBe(
      '<link href="/ow/_next/static/a.css"/><script>r.p="/ow/_next/"</script>'
    );
  });

  it('removes the placeholder when serving from the root', () => {
    expect(applyBasePath(built, '')).toBe(
      '<link href="/_next/static/a.css"/><script>r.p="/_next/"</script>'
    );
  });
});

describe('fixRoutesManifest', () => {
  // The redirects Next generates for a base path, after applyBasePath.
  const manifestFor = (basePath: string) => ({
    basePath,
    redirects: [
      { source: `${basePath}/`, destination: basePath, basePath: false, internal: true, statusCode: 308 },
      { source: '/:path+/', destination: '/:path+', internal: true, statusCode: 308 },
    ],
  });

  it('drops the base path redirect that would turn / into an empty path', () => {
    const fixed = fixRoutesManifest(manifestFor(''), '');
    expect(fixed.redirects).toEqual([manifestFor('').redirects[1]]);
  });

  it('keeps the redirects when serving under a prefix', () => {
    expect(fixRoutesManifest(manifestFor('/ow'), '/ow')).toEqual(manifestFor('/ow'));
  });
});
