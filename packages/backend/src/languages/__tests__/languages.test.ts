import 'reflect-metadata';

import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LanguagesModule } from '../languages.module.js';
import { LanguagesService } from '../languages.service.js';
import { SearchModule } from '../../search/search.module.js';
import { SearchService } from '../../search/search.service.js';
import { TypesModule } from '../../types/types.module.js';
import { TypesService } from '../../types/types.service.js';
import { EntitiesModule } from '../../entities/entities.module.js';
import { EntitiesService } from '../../entities/entities.service.js';
import { GraphStoreModule } from '../../sparql/graphStore.module.js';
import { OxigraphLocalRepository } from '../../sparql/oxigraphLocalRepository.js';

const WORKSPACE_IRI = 'http://acme.example/workspaces/lang-test';

const TURTLE = `
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .

<urn:test:Account> a owl:Class ;
  rdfs:label "Account"@en , "Konto"@sv , "Compte"@fr ;
  skos:definition "A financial account."@en , "Ett finansiellt konto."@sv .
<urn:test:Loan> a owl:Class ;
  rdfs:subClassOf <urn:test:Account> ;
  rdfs:label "Loan"@en-GB , "Lån"@sv-SE .
<urn:test:Fee> a owl:Class ;
  rdfs:subClassOf <urn:test:Account> ;
  rdfs:label "Fee" , "Avgift"@sv .
<urn:test:Rate> a owl:Class ;
  rdfs:subClassOf <urn:test:Account> ;
  rdfs:label "Taux"@fr , "Rate"@en .
<urn:test:Account> <urn:test:code> "ignored"@de .
`;

describe('preferred language', () => {
  let testingModule: TestingModule;

  beforeEach(async () => {
    testingModule = await Test.createTestingModule({
      imports: [
        GraphStoreModule.forRootAsync({
          isGlobal: true,
          useFactory: async () => {
            const repository = new OxigraphLocalRepository();
            repository.loadTurtle(TURTLE, WORKSPACE_IRI);
            return repository;
          }
        }),
        LanguagesModule,
        SearchModule,
        TypesModule,
        EntitiesModule
      ]
    }).compile();
  });

  afterEach(async () => {
    await testingModule?.close();
  });

  it('lists label and definition languages, most used first, ignoring other literals', async () => {
    const response = await testingModule.get(LanguagesService).getLanguages(WORKSPACE_IRI);
    expect(response.default).toBe('en');
    expect(response.languages.map((item) => item.tag)).toEqual(['en', 'sv', 'fr', 'en-gb', 'sv-se']);
    expect(response.languages.find((item) => item.tag === 'sv')?.count).toBe(3);
  });

  it('always offers the default language even when the content has none', async () => {
    const repository = new OxigraphLocalRepository();
    repository.loadTurtle('<urn:test:X> <http://www.w3.org/2000/01/rdf-schema#label> "X"@sv .', WORKSPACE_IRI);
    const moduleRef = await Test.createTestingModule({
      imports: [GraphStoreModule.forRootAsync({ isGlobal: true, useFactory: async () => repository }), LanguagesModule]
    }).compile();
    const response = await moduleRef.get(LanguagesService).getLanguages(WORKSPACE_IRI);
    expect(response.languages).toEqual([
      { tag: 'sv', count: 1 },
      { tag: 'en', count: 0 }
    ]);
    await moduleRef.close();
  });

  it('labels the type tree in the preferred language, falling back sensibly', async () => {
    const types = testingModule.get(TypesService);
    const [svRoot] = await types.getTypeTree(undefined, 2, WORKSPACE_IRI, 'sv');
    expect(svRoot.label).toBe('Konto');
    // sv-SE matches sv by primary subtag; an untagged label beats a foreign one; English is the last resort.
    expect(svRoot.children.map((child) => child.label)).toEqual(['Avgift', 'Lån', 'Rate']);

    const [enRoot] = await types.getTypeTree(undefined, 2, WORKSPACE_IRI);
    expect(enRoot.label).toBe('Account');
    expect(enRoot.children.map((child) => child.label)).toEqual(['Fee', 'Loan', 'Rate']);
  });

  it('returns search labels and comments in the preferred language', async () => {
    const search = testingModule.get(SearchService);
    const sv = await search.search('konto', { workspace: WORKSPACE_IRI, lang: 'sv' });
    expect(sv.hits[0]).toMatchObject({ iri: 'urn:test:Account', label: 'Konto', comment: 'Ett finansiellt konto.' });

    const en = await search.search('account', { workspace: WORKSPACE_IRI });
    expect(en.hits[0]).toMatchObject({ iri: 'urn:test:Account', label: 'Account', comment: 'A financial account.' });
  });

  it('picks the entity comment in the preferred language', async () => {
    const entities = testingModule.get(EntitiesService);
    const details = await entities.getEntityDetails('urn:test:Account', WORKSPACE_IRI, 'sv');
    expect(details.comment).toMatchObject({ value: 'Ett finansiellt konto.', language: 'sv' });
    expect(details.labels).toHaveLength(3);
  });
});
