import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiagramController } from '../diagram/diagram.controller.js';
import { DiagramService } from '../diagram/diagram.service.js';
import { EntitiesController } from '../entities/entities.controller.js';
import { EntitiesService } from '../entities/entities.service.js';

// IRIs are opaque identifiers: whatever the client sends must reach the
// services exactly as stored in the repository. These go through the real
// HTTP stack, because the bug they guard against was a second decode on top of
// the one Express already applies.
const IRIS: Array<[string, string]> = [
  ['a literal %2F', 'https://example.invalid/model/top-level%2Fcategory%2Fsub-category/entity-name'],
  ['other percent-encoded components', 'https://example.invalid/a%3Ab/c%23d/e%20f'],
  ['a lone percent sign', 'https://example.invalid/discount/100%'],
  ['a space', 'https://example.invalid/model/entity name'],
  ['a plus sign', 'https://example.invalid/model/a+b'],
  ['non-ASCII characters', 'https://example.invalid/modell/Åtgärd/日本'],
  ['a query string', 'https://example.invalid/model/entity?version=2&lang=sv'],
  ['a fragment', 'http://acme.example/ontology#Thing'],
];

describe('IRI transport through the HTTP API', () => {
  let app: INestApplication;
  let baseUrl: string;
  const entities = { getEntityDetails: vi.fn() };
  const diagrams = { getDiagram: vi.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [EntitiesController, DiagramController],
      providers: [
        { provide: EntitiesService, useValue: entities },
        { provide: DiagramService, useValue: diagrams },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    entities.getEntityDetails.mockReset().mockImplementation(async (iri: string) => ({ iri }));
    diagrams.getDiagram.mockReset().mockImplementation(async (center: string) => ({ center }));
  });

  // Encoded the way the frontend encodes it (src/hooks/use-entity.ts).
  it.each(IRIS)('passes an entity IRI with %s through unchanged', async (_label, iri) => {
    const response = await fetch(`${baseUrl}/entities/${encodeURIComponent(iri)}`);

    expect(response.status).toBe(200);
    expect(entities.getEntityDetails).toHaveBeenCalledWith(iri, process.env.DEFAULT_WORKSPACE);
  });

  // Encoded the way the frontend encodes it (src/hooks/use-diagram.ts).
  it.each(IRIS)('passes a diagram center with %s through unchanged', async (_label, iri) => {
    const params = new URLSearchParams({ center: iri, radius: '1' });
    const response = await fetch(`${baseUrl}/diagram?${params.toString()}`);

    expect(response.status).toBe(200);
    expect(diagrams.getDiagram).toHaveBeenCalledWith(iri, 1, process.env.DEFAULT_WORKSPACE);
  });

  it('still rejects a diagram request without a center', async () => {
    const response = await fetch(`${baseUrl}/diagram`);

    expect(response.status).toBe(400);
    expect(diagrams.getDiagram).not.toHaveBeenCalled();
  });
});
