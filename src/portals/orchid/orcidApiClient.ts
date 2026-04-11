/**
 * orcidApiClient.ts
 *
 * Typed wrappers around the ORCID Public API v3.0
 * Handles: read-public token management, works listing, work detail fetching,
 * and author search via expanded-search.
 *
 * No user login required — uses the client_credentials OAuth flow
 * to get a generic read-public token.
 */

// ─── Configuration ────────────────────────────────────────────────────────────

const ORCID_API_BASE = "https://pub.orcid.org/v3.0";
const ORCID_TOKEN_URL = "https://orcid.org/oauth/token";

/**
 * Function to make call from background script which runs forever and can make api call without cors error
 */
function sendMessageWithTimeout<T>(
  message: unknown,
  timeoutMs = 15000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`sendMessage timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );

    chrome.runtime.sendMessage(message as any, (response: any) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      resolve(response as T);
    });
  });
}


// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrcidTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

/**
 * A single work summary returned by the /works endpoint.
 * This is a lightweight object — no DOI yet, just metadata.
 * Use fetchWorkDetail() with the put-code to get the full record.
 */
export interface OrcidWorkSummary {
  putCode: number;
  title: string;
  type: string;       // e.g. "journal-article", "conference-paper"
  year: string | null;
  source: string;     // source app/client that added this work
}

/**
 * Full work detail returned by /work/{put-code}.
 * Includes the DOI and journal info.
 */
export interface OrcidWorkDetail {
  putCode: number;
  title: string;
  type: string;
  year: string | null;
  doi: string | null;
  journalTitle: string | null;
  url: string | null;
  contributors: OrcidContributor[];
  citations?: number | null;
}

export interface OrcidContributor {
  name: string;
  role: string | null;
  sequence: string | null; // "first" | "additional"
}

/**
 * Author result from the expanded-search endpoint.
 */
export interface OrcidAuthorResult {
  orcidId: string;
  givenNames: string;
  familyName: string;
  creditName: string | null;
  otherNames: string[];
  emails: string[];
  institutionNames: string[];
}

// ─── Token Management ─────────────────────────────────────────────────────────

/**
 * Fetches a fresh read-public token from ORCID using client_credentials flow.
 * Caches it in chrome.storage.local with an expiry timestamp.
 */
const TOKEN_STORAGE_KEY = "orcid_read_public_token";
const TOKEN_EXPIRY_KEY = "orcid_token_expiry";


/**
 * Fetches a fresh read-public token via the background service worker.
 * Direct fetch from content script is blocked by CORS on the OAuth endpoint.
 */
async function fetchReadPublicToken(): Promise<string> {
  const response = await sendMessageWithTimeout<any>(
    { type: "ORCID_TOKEN_FETCH" },
  );
  if (!response?.ok) {
    throw new Error(response?.error ?? "ORCID token fetch failed");
  }
  const data = response.data as OrcidTokenResponse;

  // Cache the token with an expiry timestamp
  const expiryMs = Date.now() + (data.expires_in - 60) * 1000;
  await chrome.storage.local.set({
    [TOKEN_STORAGE_KEY]: data.access_token,
    [TOKEN_EXPIRY_KEY]: expiryMs,
  });

  console.log("[OrcidClient] Fetched and cached new read-public token");
  return data.access_token;
}

/**
 * Returns a valid read-public token, using the cached one if still fresh.
 */
export async function getReadPublicToken(): Promise<string> {
  const stored = await chrome.storage.local.get([
    TOKEN_STORAGE_KEY,
    TOKEN_EXPIRY_KEY,
  ]);

  const token = stored[TOKEN_STORAGE_KEY] as string | undefined;
  const expiry = stored[TOKEN_EXPIRY_KEY] as number | undefined;

  if (token && expiry && Date.now() < expiry) {
    return token;
  }

  // Token missing or expired — fetch a fresh one via background
  return fetchReadPublicToken();
}

// ─── Core Fetch Helper ────────────────────────────────────────────────────────

/**
 * Makes an authenticated GET request to the ORCID Public API.
 * Proxied through the background service worker to avoid CORS issues —
 * content scripts run under the page's origin (orcid.org) and the API
 * blocks the Authorization header in preflight responses.
 */
async function orcidGet<T>(path: string): Promise<T | null> {
  const token = await getReadPublicToken();
  const url = `${ORCID_API_BASE}${path}`;

  const response = await sendMessageWithTimeout<any>(
    { type: "ORCID_FETCH", url, token },
  );
  if (!response?.ok) {
    // Treat 404-like errors as null (no result)
    if (response?.error?.includes("404")) return null;
    throw new Error(response?.error ?? "Unknown ORCID fetch error");
  }
  return response.data as T;
}

// ─── Works API ────────────────────────────────────────────────────────────────

/**
 * Fetches all work summaries for an ORCID profile.
 * Returns lightweight objects — call fetchWorkDetail() to get DOIs.
 *
 * @param orcidId - e.g. "0000-0001-2345-6789"
 */
export async function fetchWorkSummaries(
  orcidId: string,
): Promise<OrcidWorkSummary[]> {
  // The raw shape from the API
  interface RawWorksResponse {
    group?: Array<{
      "work-summary"?: Array<{
        "put-code": number;
        title?: { title?: { value?: string } };
        type?: string;
        "publication-date"?: { year?: { value?: string } };
        source?: { "source-name"?: { value?: string } };
      }>;
    }>;
  }

  const data = await orcidGet<RawWorksResponse>(`/${orcidId}/works`);
  if (!data?.group) return [];
  // console.log("Data", data)
  const summaries: OrcidWorkSummary[] = [];

  for (const group of data.group) {
    // Each group can have multiple versions of the same work from different sources.
    // We take the first summary in each group (preferred/most recent source).
    const first = group["work-summary"]?.[0];
    if (!first) continue;

    summaries.push({
      putCode: first["put-code"],
      title: first.title?.title?.value ?? "",
      type: first.type ?? "unknown",
      year: first["publication-date"]?.year?.value ?? null,
      source: first.source?.["source-name"]?.value ?? "unknown",
    });
  }

  console.log(
    `[OrcidClient] Fetched ${summaries.length} work summaries for ${orcidId}`,
  );

  // console.log("Summeries",summaries)
  return summaries;
}

/**
 * Fetches full detail for a single work, including DOI and contributors.
 *
 * @param orcidId  - e.g. "0000-0001-2345-6789"
 * @param putCode  - the put-code from OrcidWorkSummary
 */
export async function fetchWorkDetail(
  orcidId: string,
  putCode: number,
): Promise<OrcidWorkDetail | null> {
  interface RawWorkDetail {
    "put-code": number;
    title?: { title?: { value?: string } };
    type?: string;
    "publication-date"?: { year?: { value?: string } };
    "journal-title"?: { value?: string };
    url?: { value?: string };
    "external-ids"?: {
      "external-id"?: Array<{
        "external-id-type"?: string;
        "external-id-value"?: string;
      }>;
    };
    contributors?: {
      contributor?: Array<{
        "credit-name"?: { value?: string };
        "contributor-attributes"?: {
          "contributor-role"?: string;
          "contributor-sequence"?: string;
        };
      }>;
    };
  }

  const data = await orcidGet<RawWorkDetail>(`/${orcidId}/work/${putCode}`);
  if (!data) return null;

  // Extract DOI from external-ids list
  const externalIds = data["external-ids"]?.["external-id"] ?? [];
  const doiEntry = externalIds.find(
    (id) => id["external-id-type"]?.toLowerCase() === "doi",
  );
  const rawDoi = doiEntry?.["external-id-value"] ?? null;

  // Normalize: strip "https://doi.org/" prefix if present
  const doi = rawDoi
    ? rawDoi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim()
    : null;

  // Extract contributors
  const contributors: OrcidContributor[] =
    data.contributors?.contributor?.map((c) => ({
      name: c["credit-name"]?.value ?? "Unknown",
      role: c["contributor-attributes"]?.["contributor-role"] ?? null,
      sequence: c["contributor-attributes"]?.["contributor-sequence"] ?? null,
    })) ?? [];

  return {
    putCode: data["put-code"],
    title: data.title?.title?.value ?? "",
    type: data.type ?? "unknown",
    year: data["publication-date"]?.year?.value ?? null,
    doi,
    journalTitle: data["journal-title"]?.value ?? null,
    url: data.url?.value ?? null,
    contributors,
  };
}

// ─── Author Search ────────────────────────────────────────────────────────────

/**
 * Searches for authors by name using the expanded-search endpoint.
 * Useful for cross-portal linking — find an author's ORCID from their name.
 *
 * @param givenName   - first name
 * @param familyName  - last name
 * @param maxResults  - how many results to return (default 5)
 */
export async function searchAuthorsByName(
  givenName: string,
  familyName: string,
  maxResults = 5,
): Promise<OrcidAuthorResult[]> {
  interface RawExpandedSearch {
    "expanded-result"?: Array<{
      "orcid-id"?: string;
      "given-names"?: string;
      "family-names"?: string;
      "credit-name"?: string;
      "other-name"?: string[];
      email?: string[];
      "institution-name"?: string[];
    }>;
  }

  const query = `given-and-family-names:${encodeURIComponent(`${givenName} ${familyName}`)}`;
  const data = await orcidGet<RawExpandedSearch>(
    `/expanded-search/?q=${query}&rows=${maxResults}`,
  );

  if (!data?.["expanded-result"]) return [];

  return data["expanded-result"].map((r) => ({
    orcidId: r["orcid-id"] ?? "",
    givenNames: r["given-names"] ?? "",
    familyName: r["family-names"] ?? "",
    creditName: r["credit-name"] ?? null,
    otherNames: r["other-name"] ?? [],
    emails: r.email ?? [],
    institutionNames: r["institution-name"] ?? [],
  }));
}

/**
 * Convenience: extract the ORCID ID from an orcid.org profile URL.
 * e.g. "https://orcid.org/0000-0001-2345-6789" → "0000-0001-2345-6789"
 */
export function extractOrcidId(url: string): string | null {
  const match = url.match(/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/);
  return match?.[1] ?? null;
}