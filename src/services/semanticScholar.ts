/**
 * semanticScholar.ts
 *
 * Typed wrapper around the Semantic Scholar Graph API v1.
 * Free, no API key required.
 *
 * https://api.semanticscholar.org/graph/v1/paper/DOI:{doi}
 */

const S2_BASE = "https://api.semanticscholar.org/graph/v1/paper";
const S2_FIELDS = "citationCount,referenceCount,influentialCitationCount,isOpenAccess,publicationTypes";

export interface S2PaperStats {
  citationCount: number;
  referenceCount: number;
  influentialCitationCount: number;
  isOpenAccess: boolean;
  publicationTypes: string[] | null;
}

/**
 * Fetches per-paper stats from the Semantic Scholar API for a given DOI.
 * Returns null if the paper is not found or the request fails.
 *
 * MUST be called from the background service worker (to avoid CORS).
 * Content scripts should send SEMANTIC_SCHOLAR_FETCH message instead.
 */
export async function fetchS2Stats(doi: string): Promise<S2PaperStats | null> {
  const url = `${S2_BASE}/DOI:${encodeURIComponent(doi)}?fields=${S2_FIELDS}`;

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (response.status === 404) return null;

    if (!response.ok) {
      console.warn(`[S2] API error ${response.status} for DOI: ${doi}`);
      return null;
    }

    const data = await response.json();

    return {
      citationCount: data.citationCount ?? 0,
      referenceCount: data.referenceCount ?? 0,
      influentialCitationCount: data.influentialCitationCount ?? 0,
      isOpenAccess: data.isOpenAccess ?? false,
      publicationTypes: data.publicationTypes ?? null,
    };
  } catch (err: any) {
    console.warn(`[S2] Fetch error for DOI ${doi}:`, err?.message ?? err);
    return null;
  }
}
