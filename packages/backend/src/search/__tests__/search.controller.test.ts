import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SearchController } from '../search.controller.js';
import { SearchService } from '../search.service.js';

// Goes through the real HTTP stack so query-string parsing (repeated params,
// comma lists, IRIs with commas) is covered the way the frontend sends it.
describe('SearchController query parsing', () => {
  let app: INestApplication;
  let baseUrl: string;
  const search = { search: vi.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SearchController],
      providers: [{ provide: SearchService, useValue: search }]
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    search.search.mockReset().mockResolvedValue({ query: '', limit: 10, offset: 0, total: 0, hits: [] });
  });

  it('keeps the original single-type request working', async () => {
    await fetch(`${baseUrl}/search?q=loan&type=Class&limit=5`);

    expect(search.search).toHaveBeenCalledWith(
      'loan',
      expect.objectContaining({ types: ['class'], limit: 5, facets: false, deprecated: undefined })
    );
  });

  it('parses metadata filters from repeated and comma-separated params', async () => {
    const params = new URLSearchParams();
    params.set('q', 'account');
    params.set('type', 'class,property,bogus');
    params.append('definedBy', 'https://example.invalid/a,b/');
    params.append('definedBy', 'https://example.invalid/c/');
    params.append('namespace', 'http://acme.example/ontology#');
    params.append('propertyKind', 'object');
    params.append('propertyKind', 'datatype');
    params.append('instanceOf', 'http://acme.example/ontology#Person');
    params.set('deprecated', 'exclude');
    params.set('fields', 'label,alias');
    params.set('facets', 'true');

    const response = await fetch(`${baseUrl}/search?${params.toString()}`);

    expect(response.status).toBe(200);
    expect(search.search).toHaveBeenCalledWith('account', {
      limit: undefined,
      offset: undefined,
      workspace: process.env.DEFAULT_WORKSPACE,
      types: ['class', 'property'],
      definedBy: ['https://example.invalid/a,b/', 'https://example.invalid/c/'],
      namespaces: ['http://acme.example/ontology#'],
      propertyKinds: ['object', 'datatype'],
      instanceOf: ['http://acme.example/ontology#Person'],
      deprecated: 'exclude',
      fields: ['label', 'alias'],
      facets: true
    });
  });

  it('accepts more than twenty values for one IRI filter', async () => {
    const iris = Array.from({ length: 25 }, (_, index) => `https://example.invalid/module-${index}/`);
    const params = new URLSearchParams();
    iris.forEach((iri) => params.append('definedBy', iri));

    await fetch(`${baseUrl}/search?${params.toString()}`);

    expect(search.search).toHaveBeenCalledWith('', expect.objectContaining({ definedBy: iris }));
  });
});
