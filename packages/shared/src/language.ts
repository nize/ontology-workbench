/** Language used for labels and definitions when the client does not ask for one. */
export const DEFAULT_LANGUAGE = 'en';

const LANGUAGE_TAG = /^[a-z]{1,8}(-[a-z0-9]{1,8})*$/i;

/** A lower-cased BCP 47 tag, or the default language when `lang` is missing or malformed. */
export function normalizeLanguage(lang?: string | null): string {
  const trimmed = typeof lang === 'string' ? lang.trim() : '';
  return LANGUAGE_TAG.test(trimmed) ? trimmed.toLowerCase() : DEFAULT_LANGUAGE;
}

function primarySubtag(tag: string): string {
  return tag.split('-')[0]!;
}

/**
 * How well a literal's language tag fits the preferred language; lower is better.
 * Exact tag, then the same primary language (`en` ~ `en-GB`), then untagged literals,
 * then the default language as a fallback, then everything else.
 */
export function languageRank(tag: string | undefined, preferred: string): number {
  if (!tag) {
    return 2;
  }
  const normalized = tag.toLowerCase();
  if (normalized === preferred) {
    return 0;
  }
  if (primarySubtag(normalized) === primarySubtag(preferred)) {
    return 1;
  }
  if (primarySubtag(normalized) === DEFAULT_LANGUAGE) {
    return 3;
  }
  return 4;
}

type LanguageTagged = { value: string; language?: string };

/** Orders literals best-fitting first; ties break on value, then on tag, so the order is stable. */
export function compareByLanguage(preferred: string) {
  return (a: LanguageTagged, b: LanguageTagged): number => {
    const rankDiff = languageRank(a.language, preferred) - languageRank(b.language, preferred);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    const valueCompare = a.value.localeCompare(b.value, undefined, { sensitivity: 'base' });
    if (valueCompare !== 0) {
      return valueCompare;
    }
    return (a.language ?? '').localeCompare(b.language ?? '');
  };
}

/** The literal that best fits the preferred language, or `undefined` for an empty list. */
export function pickByLanguage<T extends LanguageTagged>(items: T[], preferred: string): T | undefined {
  if (items.length === 0) {
    return undefined;
  }
  return [...items].sort(compareByLanguage(preferred))[0];
}
