/**
 * authClient.ts — ORCID token management module
 *
 * Extracted from orcidApiClient.ts into its own module so that:
 *   - Token logic can be tested independently
 *   - Background service worker can pre-fetch tokens on install
 *   - Future: support member API tokens (user-authenticated) alongside
 *     the read-public token, without tangling both flows in one file
 *
 * Two token tiers supported:
 *   1. READ-PUBLIC  — client_credentials flow, no user login needed
 *                     used for all read operations on public ORCID records
 *   2. READ-LIMITED — authorization_code flow (future), requires user to
 *                     grant access, needed for private/limited-visibility works
 */

/// <reference types="chrome" />

// ─── Configuration ────────────────────────────────────────────────────────────

const ORCID_TOKEN_URL = "https://orcid.org/oauth/token";
const ORCID_SANDBOX_TOKEN_URL = "https://sandbox.orcid.org/oauth/token";

// Replace with your registered ORCID developer app credentials.
// Register at: https://orcid.org/developer-tools
// Store in .env and inject at build time — never hardcode real values here.

const ORCID_CLIENT_ID =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_ORCID_CLIENT_ID) ||
  "APP-XXXXXXXXXXXXXXXX";

const ORCID_CLIENT_SECRET =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_ORCID_CLIENT_SECRET) ||
  "12345678-1234-1234-1234-123456789012";
  

// ─── Storage Keys ─────────────────────────────────────────────────────────────
// These are just dictionary key names for chrome.storage.local — not secrets.

const KEYS = {
  readPublicToken: "orcid_read_public_token",
  readPublicExpiry: "orcid_token_expiry",
  // Reserved for future user-authenticated flow
  readLimitedToken: "orcid_read_limited_token",
  readLimitedExpiry: "orcid_read_limited_expiry",
  readLimitedOrcidId: "orcid_authenticated_user_id",
} as const;

// Buffer in ms to subtract from expiry — renew the token 60s before it expires
// so we never make an API call with a token that expires mid-request.
const EXPIRY_BUFFER_MS = 60_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export type TokenTier = "read-public" | "read-limited";

export interface StoredToken {
  accessToken: string;
  expiresAt: number; // Unix timestamp in ms
  scope: string;
}

export interface OrcidTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds
  scope: string;
  orcid?: string;     // present in read-limited flow — the user's ORCID iD
  name?: string;      // display name of the authenticated user
}

// ─── Storage Helpers ──────────────────────────────────────────────────────────

/**
 * Reads a stored token from chrome.storage.local.
 * Returns null if not present or already expired.
 */
async function readStoredToken(tier: TokenTier): Promise<StoredToken | null> {
  const tokenKey =
    tier === "read-public" ? KEYS.readPublicToken : KEYS.readLimitedToken;
  const expiryKey =
    tier === "read-public" ? KEYS.readPublicExpiry : KEYS.readLimitedExpiry;

  const stored = await chrome.storage.local.get([tokenKey, expiryKey]);

  const accessToken = stored[tokenKey] as string | undefined;
  const expiresAt = stored[expiryKey] as number | undefined;

  if (!accessToken || !expiresAt) return null;

  // Treat as expired if within the buffer window
  if (Date.now() >= expiresAt - EXPIRY_BUFFER_MS) {
    console.log(`[OrcidAuth] Cached ${tier} token expired or about to expire`);
    return null;
  }

  return { accessToken, expiresAt, scope: tier };
}

/**
 * Persists a token response to chrome.storage.local.
 */
async function writeStoredToken(
  tier: TokenTier,
  response: OrcidTokenResponse,
): Promise<StoredToken> {
  const tokenKey =
    tier === "read-public" ? KEYS.readPublicToken : KEYS.readLimitedToken;
  const expiryKey =
    tier === "read-public" ? KEYS.readPublicExpiry : KEYS.readLimitedExpiry;

  const expiresAt = Date.now() + response.expires_in * 1000;

  const update: Record<string, unknown> = {
    [tokenKey]: response.access_token,
    [expiryKey]: expiresAt,
  };

  // For read-limited flow, also cache the authenticated user's ORCID iD
  if (tier === "read-limited" && response.orcid) {
    update[KEYS.readLimitedOrcidId] = response.orcid;
  }

  await chrome.storage.local.set(update);

  console.log(
    `[OrcidAuth] Stored ${tier} token, expires at ${new Date(expiresAt).toISOString()}`,
  );

  return {
    accessToken: response.access_token,
    expiresAt,
    scope: response.scope,
  };
}

// ─── Token Fetchers ───────────────────────────────────────────────────────────

/**
 * Fetches a fresh read-public token via the client_credentials OAuth flow.
 * This is a machine-to-machine flow — no user interaction required.
 *
 * Token lifetime is typically 20 years for read-public, but we still
 * cache and check expiry correctly just in case.
 */
async function fetchReadPublicToken(
  useSandbox = false,
): Promise<OrcidTokenResponse> {
  const tokenUrl = useSandbox ? ORCID_SANDBOX_TOKEN_URL : ORCID_TOKEN_URL;

  const body = new URLSearchParams({
    client_id: ORCID_CLIENT_ID,
    client_secret: ORCID_CLIENT_SECRET,
    grant_type: "client_credentials",
    scope: "/read-public",
  });

  console.log("[OrcidAuth] Fetching new read-public token...");

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new OrcidAuthError(
      `Token fetch failed with status ${response.status}: ${errorText}`,
      response.status,
    );
  }

  const data: OrcidTokenResponse = await response.json();
  console.log("[OrcidAuth] Successfully fetched read-public token");
  return data;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns a valid read-public access token.
 *
 * Uses the cached token if still fresh, otherwise fetches a new one.
 * This is the function called by orcidApiClient.ts for every API request.
 *
 * @param useSandbox - set true during development to hit sandbox.orcid.org
 */
export async function getReadPublicToken(useSandbox = false): Promise<string> {
  // Try cache first
  const cached = await readStoredToken("read-public");
  if (cached) {
    return cached.accessToken;
  }

  // Cache miss or expired — fetch fresh
  const response = await fetchReadPublicToken(useSandbox);
  const stored = await writeStoredToken("read-public", response);
  return stored.accessToken;
}

/**
 * Clears all cached ORCID tokens from storage.
 * Useful for:
 *   - Logout / uninstall cleanup
 *   - Forcing a token refresh during debugging
 *   - Switching between sandbox and production
 */
export async function clearAllTokens(): Promise<void> {
  await chrome.storage.local.remove(Object.values(KEYS));
  console.log("[OrcidAuth] All cached tokens cleared");
}

/**
 * Checks whether a valid read-public token is currently cached.
 * Does NOT fetch a new one — use getReadPublicToken() for that.
 * Useful for status indicators in the popup UI.
 */
export async function hasValidReadPublicToken(): Promise<boolean> {
  const cached = await readStoredToken("read-public");
  return cached !== null;
}

/**
 * Returns the expiry timestamp of the cached read-public token,
 * or null if none is cached. Useful for showing "token expires in X"
 * in the extension popup/settings page.
 */
export async function getTokenExpiry(): Promise<Date | null> {
  const stored = await chrome.storage.local.get([KEYS.readPublicExpiry]);
  const expiry = stored[KEYS.readPublicExpiry] as number | undefined;
  return expiry ? new Date(expiry) : null;
}

/**
 * Pre-warms the token cache. Call this from background.ts on install
 * or on browser startup so the first profile scrape doesn't have to
 * wait for a token fetch.
 *
 * Usage in background.ts:
 *   chrome.runtime.onInstalled.addListener(() => prewarmToken());
 *   chrome.runtime.onStartup.addListener(() => prewarmToken());
 */
export async function prewarmToken(useSandbox = false): Promise<void> {
  try {
    await getReadPublicToken(useSandbox);
    console.log("[OrcidAuth] Token pre-warmed successfully");
  } catch (error) {
    // Non-fatal — the scraper will retry when it actually needs the token
    console.warn("[OrcidAuth] Token pre-warm failed:", error);
  }
}

// ─── Error Type ───────────────────────────────────────────────────────────────

/**
 * Typed error for ORCID auth failures.
 * Lets callers distinguish auth errors from network errors.
 */
export class OrcidAuthError extends Error {
  public readonly statusCode: number | null;

  constructor(message: string, statusCode: number | null = null) {
    super(message);
    this.name = "OrcidAuthError";
    this.statusCode = statusCode;
  }
}