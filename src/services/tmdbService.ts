export interface TmdbCastMember {
  name: string;
  character?: string;
  profileUrl?: string;
}

export interface TmdbMetadata {
  tmdbId?: number | string;
  title: string;
  originalTitle?: string;
  tagline?: string;
  overview?: string;
  posterUrl?: string;
  backdropUrl?: string;
  rating?: number;
  voteCount?: number;
  releaseDate?: string;
  year?: string;
  genres?: string[];
  genre?: string;
  director?: string;
  cast?: string;
  castList?: TmdbCastMember[];
  duration?: string;
  trailerYoutubeKey?: string;
  language?: string;
}

// In-memory LRU-style cache for fast repeated views
const tmdbCache = new Map<string, { data: TmdbMetadata; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours

/**
 * Detects the user's device / browser language (e.g., "fr-FR", "es-ES", "de-DE", "ar-SA", "en-US")
 */
export function getUserDeviceLanguage(): string {
  if (typeof navigator !== 'undefined') {
    if (navigator.language) {
      return navigator.language;
    }
    if (navigator.languages && navigator.languages.length > 0) {
      return navigator.languages[0];
    }
  }
  return 'en-US';
}

/**
 * Common languages supported for TMDB display
 */
export const SUPPORTED_METADATA_LANGUAGES = [
  { code: 'auto', name: 'Device Language (Auto)' },
  { code: 'en-US', name: 'English (US)' },
  { code: 'fr-FR', name: 'Français (France)' },
  { code: 'es-ES', name: 'Español (España)' },
  { code: 'es-MX', name: 'Español (Latinoamérica)' },
  { code: 'de-DE', name: 'Deutsch' },
  { code: 'it-IT', name: 'Italiano' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'pt-PT', name: 'Português (Portugal)' },
  { code: 'ar-SA', name: 'العربية (Arabic)' },
  { code: 'tr-TR', name: 'Türkçe' },
  { code: 'ru-RU', name: 'Русский' },
  { code: 'nl-NL', name: 'Nederlands' },
  { code: 'pl-PL', name: 'Polski' },
  { code: 'zh-CN', name: '中文 (Simplified)' },
  { code: 'ja-JP', name: '日本語' },
];

/**
 * Resolves the effective language tag for TMDB API queries
 */
export function resolveEffectiveLanguage(userPreferredLang?: string): string {
  if (!userPreferredLang || userPreferredLang === 'auto') {
    return getUserDeviceLanguage();
  }
  return userPreferredLang;
}

/**
 * Fetches enriched TMDB details by Title, Type, and Year in the user's device language
 */
export async function fetchTmdbDetails(
  title: string,
  type: 'movie' | 'tv' = 'movie',
  year?: string,
  apiKey?: string,
  language?: string
): Promise<TmdbMetadata | null> {
  const targetLang = resolveEffectiveLanguage(language);
  const cacheKey = `search:${type}:${title.toLowerCase().trim()}:${year || ''}:${targetLang}`;

  const cached = tmdbCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const params = new URLSearchParams({
      query: title,
      type: type === 'tv' ? 'tv' : 'movie',
      language: targetLang,
    });
    if (year) params.set('year', year);
    if (apiKey) params.set('apiKey', apiKey);

    const res = await fetch(`/api/tmdb/search?${params.toString()}`);
    if (!res.ok) return null;

    const data = await res.json();
    if (data && data.found) {
      tmdbCache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    }
  } catch (err) {
    console.warn('[TMDB Service] Fetch error:', err);
  }

  return null;
}

/**
 * Fetches enriched TMDB details by TMDB ID in the user's device language
 */
export async function fetchTmdbById(
  tmdbId: number | string,
  type: 'movie' | 'tv' = 'movie',
  apiKey?: string,
  language?: string
): Promise<TmdbMetadata | null> {
  if (!tmdbId) return null;
  const targetLang = resolveEffectiveLanguage(language);
  const cacheKey = `id:${type}:${tmdbId}:${targetLang}`;

  const cached = tmdbCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const params = new URLSearchParams({
      id: String(tmdbId),
      type: type === 'tv' ? 'tv' : 'movie',
      language: targetLang,
    });
    if (apiKey) params.set('apiKey', apiKey);

    const res = await fetch(`/api/tmdb/details?${params.toString()}`);
    if (!res.ok) return null;

    const data = await res.json();
    if (data && data.found) {
      tmdbCache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    }
  } catch (err) {
    console.warn('[TMDB Service] Fetch ID error:', err);
  }

  return null;
}
