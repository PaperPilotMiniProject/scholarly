import "../src/background/rankings";
import { fetchS2Stats } from "../src/services/semanticScholar";

const SCOPUS_API_KEY = import.meta.env.VITE_SCOPUS_API_KEY ?? "";
const SCOPUS_INST_TOKEN = import.meta.env.VITE_SCOPUS_INST_TOKEN ?? "";
// Fallback to hardcoded keys in case the .env file changes haven't been picked up by a dev server restart
const ORCID_CLIENT_ID = import.meta.env.VITE_ORCHID_CLIENT_ID || "APP-GBZCZMUMX86J3PEK";
const ORCID_CLIENT_SECRET = import.meta.env.VITE_ORCHID_CLIENT_SECRET || "7826f25a-54e8-48a6-b99a-ca0299b0df68";

export default defineBackground(() => {
  console.log("[Scholarly] Background service worker initialized");

  // Seed Scopus API key from build-time env vars into storage on first run.
  // This means users don't have to manually enter it in the popup.
  // If the user has already saved a key via the popup, keep theirs.
  chrome.storage.local.get(["scopusApiKey"], (items) => {
    if (!items.scopusApiKey && SCOPUS_API_KEY) {
      chrome.storage.local.set({
        scopusApiKey: SCOPUS_API_KEY,
        scopusInstToken: SCOPUS_INST_TOKEN,
      });
      console.log("[Scholarly] Seeded Scopus API key from build config");
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // Proxy ORCID API GET requests to avoid CORS from content script
    if (message.type === "ORCID_FETCH") {
      handleOrcidFetch(message.url, message.token)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    // Proxy ORCID OAuth token fetch — POST to orcid.org also blocked by CORS
    if (message.type === "ORCID_TOKEN_FETCH") {
      fetchOrcidToken()
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    // Proxy Semantic Scholar API requests to avoid CORS
    if (message.type === "SEMANTIC_SCHOLAR_FETCH") {
      fetchS2Stats(message.doi)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }
  });
});

async function handleOrcidFetch(url: string, token: string): Promise<any> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`ORCID API error: ${response.status}`);
  }

  return response.json();
}

async function fetchOrcidToken(): Promise<any> {
  const body = new URLSearchParams({
    client_id: ORCID_CLIENT_ID,
    client_secret: ORCID_CLIENT_SECRET,
    grant_type: "client_credentials",
    scope: "/read-public",
  });

  const response = await fetch("https://orcid.org/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`ORCID token fetch failed: ${response.status}`);
  }

  return response.json();
}