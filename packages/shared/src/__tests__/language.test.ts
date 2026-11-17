import { describe, expect, it } from 'vitest';

import { DEFAULT_LANGUAGE, languageRank, normalizeLanguage, pickByLanguage } from '../language.js';

describe('normalizeLanguage', () => {
  it('lower-cases valid tags and defaults the rest', () => {
    expect(normalizeLanguage('sv-SE')).toBe('sv-se');
    expect(normalizeLanguage(undefined)).toBe(DEFAULT_LANGUAGE);
    expect(normalizeLanguage('')).toBe(DEFAULT_LANGUAGE);
    expect(normalizeLanguage('not a tag')).toBe(DEFAULT_LANGUAGE);
  });
});

describe('pickByLanguage', () => {
  const literals = [
    { value: 'Compte', language: 'fr' },
    { value: 'Account', language: 'en' },
    { value: 'Konto', language: 'sv-SE' },
    { value: 'Acct' }
  ];

  it('prefers exact tag, then primary subtag, then untagged, then English', () => {
    expect(pickByLanguage(literals, 'sv-se')?.value).toBe('Konto');
    expect(pickByLanguage(literals, 'sv')?.value).toBe('Konto');
    expect(pickByLanguage(literals, 'de')?.value).toBe('Acct');
    expect(pickByLanguage(literals.filter((item) => item.language), 'de')?.value).toBe('Account');
    expect(pickByLanguage([], 'en')).toBeUndefined();
  });

  it('ranks the default language ahead of other foreign tags', () => {
    expect(languageRank('en-US', 'de')).toBeLessThan(languageRank('fr', 'de'));
  });
});
