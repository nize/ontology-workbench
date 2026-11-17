import { Inject, Injectable } from '@nestjs/common';
import { DEFAULT_LANGUAGE, LanguageOption, LanguagesResponse } from '@acme/shared';

import { GraphStoreService } from '../sparql/graphStore.service.js';

// Only the annotations the UI shows as names and definitions count; language tags on
// arbitrary data literals are not choices a reader of the ontology would make.
const LANGUAGES_QUERY = `
  SELECT ?lang (COUNT(*) AS ?count)
  WHERE {
    {{graphStart}}
      VALUES ?predicate {
        <http://www.w3.org/2000/01/rdf-schema#label>
        <http://www.w3.org/2004/02/skos/core#prefLabel>
        <http://www.w3.org/2004/02/skos/core#altLabel>
        <http://www.w3.org/2000/01/rdf-schema#comment>
        <http://www.w3.org/2004/02/skos/core#definition>
      }
      ?entity ?predicate ?value .
      FILTER(isLiteral(?value) && lang(?value) != "")
      BIND(LCASE(lang(?value)) AS ?lang)
    {{graphEnd}}
  }
  GROUP BY ?lang
`;

@Injectable()
export class LanguagesService {
  private readonly cache = new Map<string, Promise<LanguagesResponse>>();

  constructor(@Inject(GraphStoreService) private readonly graphStore: GraphStoreService) {}

  invalidate(workspace?: string): void {
    if (workspace) {
      this.cache.delete(workspace);
      return;
    }
    this.cache.clear();
  }

  /** Language tags used on labels and definitions in the workspace, most used first. */
  async getLanguages(workspace?: string): Promise<LanguagesResponse> {
    const key = workspace ?? 'DEFAULT';
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }
    const promise = this.loadLanguages(workspace);
    this.cache.set(key, promise);
    try {
      return await promise;
    } catch (error) {
      this.cache.delete(key);
      throw error;
    }
  }

  private async loadLanguages(workspace?: string): Promise<LanguagesResponse> {
    const query = workspace
      ? LANGUAGES_QUERY.replace('{{graphStart}}', 'GRAPH {{workspace}} {').replace('{{graphEnd}}', '}')
      : LANGUAGES_QUERY.replace('{{graphStart}}', '').replace('{{graphEnd}}', '');
    const rows = await this.graphStore.select(query, {}, workspace);

    const counts = new Map<string, number>();
    for (const row of rows) {
      const tag = row.lang?.value?.trim().toLowerCase();
      if (!tag) {
        continue;
      }
      const count = row.count ? Number.parseInt(row.count.value, 10) : 0;
      counts.set(tag, (counts.get(tag) ?? 0) + (Number.isFinite(count) ? count : 0));
    }
    if (!counts.has(DEFAULT_LANGUAGE)) {
      counts.set(DEFAULT_LANGUAGE, 0);
    }

    const languages: LanguageOption[] = [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

    return { default: DEFAULT_LANGUAGE, languages };
  }
}
