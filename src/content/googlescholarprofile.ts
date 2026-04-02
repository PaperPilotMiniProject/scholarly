import { getScopusRankingByDoi, getScopusAbstractByDoi } from "../../src/utils/csvParser";

type ProfileArticleData = {
  title: string;
  authors: string;
  journal: string;
  year: string;
  link: string;
  doi: string | null;
  citations: number;
  badgeContainer: HTMLElement;
  correspondingAuthor?: boolean;
  correspondingAffiliation?: string;
};

// ─── Author Position Helpers ──────────────────────────────────────────────────

/** Returns the profile owner's display name from the Scholar DOM. */
function getScholarProfileOwnerName(): string | null {
  const el = document.querySelector("#gsc_prf_in") as HTMLElement | null;
  const text = el?.innerText?.trim();
  return text && text.length > 1 ? text : null;
}

/** Normalises a name for comparison. */
function normalizeAuthorName(name: string): string {
  return name.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Returns the 0-based position of ownerName in a comma-separated authors string,
 * or null if not found. Handles truncated lists ending with "...".
 */
function findAuthorPosition(ownerName: string, authorsStr: string): number | null {
  if (!ownerName || !authorsStr) return null;
  const parts = authorsStr.split(",").map((s) => s.trim()).filter(Boolean);
  const normOwner = normalizeAuthorName(ownerName);
  const ownerParts = normOwner.split(" ");
  const ownerLast = ownerParts[ownerParts.length - 1];

  for (let i = 0; i < parts.length; i++) {
    const norm = normalizeAuthorName(parts[i]);
    if (norm === normOwner) return i;
    // Last-name + first-initial match
    const cParts = norm.split(" ");
    const cLast = cParts[cParts.length - 1];
    if (cLast === ownerLast && ownerParts.length >= 2 && cParts.length >= 2) {
      if (ownerParts[0][0] === cParts[0][0]) return i;
    }
    // Single-initial last-name match (e.g. "J Smith" vs "John Smith")
    if (cLast === ownerLast && (ownerParts.length === 1 || cParts.length === 1)) return i;
  }
  return null;
}

/** Returns badge label and colour for a 0-based author position. */
function authorPositionBadgeStyle(
  position: number,
  total: number,
  truncated: boolean,
): { label: string; color: string } {
  const isLast = !truncated && total >= 2 && position === total - 1;
  if (position === 0) return { label: "First Author", color: "#c0392b" };
  if (isLast) return { label: "Last Author", color: "#7d3c98" };
  if (position === 1) return { label: "Second Author", color: "#2980b9" };
  const ord = (n: number): string => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] ?? s[v] ?? s[0] ?? "th");
  };
  return { label: `${ord(position + 1)} Author`, color: "#546e7a" };
}

/** Creates a small badge span. */
function makePositionBadge(label: string, color: string, tooltip: string): HTMLElement {
  const badge = document.createElement("span");
  badge.className = "scholarly-badge";
  badge.title = tooltip;
  badge.style.cssText = `
    display:inline-block;
    margin-left:6px;
    padding:2px 7px;
    background:${color};
    color:#fff;
    font-size:11px;
    font-weight:bold;
    border-radius:3px;
    white-space:nowrap;
    cursor:default;
    font-family:system-ui,sans-serif;
    vertical-align:middle;
  `;
  badge.textContent = label;
  return badge;
}

const POSITION_PANEL_ID = "scholarly-gs-position-panel";

/** Injects or refreshes the AUTHOR POSITIONS summary panel above the paper list. */
function injectPositionPanel(
  counts: { first: number; second: number; last: number; other: number },
): void {
  document.getElementById(POSITION_PANEL_ID)?.remove();
  const total = counts.first + counts.second + counts.last + counts.other;
  if (total === 0) return;

  const anchor =
    document.querySelector("#gsc_a_b") ??
    document.querySelector(".gsc_a_b") ??
    document.querySelector("#gsc_prf_pbl");
  if (!anchor) return;

  const pill = (label: string, value: number, color: string): string =>
    `<div style="display:inline-flex;flex-direction:column;align-items:center;
      background:${color};color:#fff;border-radius:6px;
      padding:6px 14px;margin-right:8px;min-width:64px;">
      <span style="font-size:16px;font-weight:bold;">${value}</span>
      <span style="font-size:10px;opacity:0.9;margin-top:2px;">${label}</span>
    </div>`;

  const panel = document.createElement("div");
  panel.id = POSITION_PANEL_ID;
  panel.style.cssText = `
    background:#f8f9fa;
    border:1px solid #dee2e6;
    border-radius:8px;
    padding:14px 18px;
    margin-bottom:14px;
    font-family:system-ui,sans-serif;
    font-size:13px;
    color:#333;
  `;
  panel.innerHTML = `
    <div style="font-weight:600;font-size:13px;color:#111;margin-bottom:10px;">
      \uD83D\uDCCA Scholarly &mdash; Author Positions
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;">
      ${counts.first > 0 ? pill("First Author", counts.first, "#c0392b") : ""}
      ${counts.second > 0 ? pill("Second Author", counts.second, "#2980b9") : ""}
      ${counts.last > 0 ? pill("Last Author", counts.last, "#7d3c98") : ""}
      ${counts.other > 0 ? pill("Other", counts.other, "#546e7a") : ""}
    </div>
    <div style="margin-top:8px;font-size:10px;color:#aaa;">Powered by Scholarly</div>
  `;
  anchor.insertAdjacentElement("beforebegin", panel);
}

export function clearProfileBadges(): void {
  document.querySelectorAll(".scholarly-badge").forEach((el) => el.remove());
  document
    .querySelectorAll(".scholarly-badge-anchor")
    .forEach((el) => el.remove());
  document
    .querySelectorAll(".scholarly-interactive-container")
    .forEach((el) => el.remove());
  document
    .querySelectorAll(".scholarly-profile-affiliation")
    .forEach((el) => el.remove());
}

function injectScholarlyStyles() {
  if (document.getElementById("scholarly-styles")) return;
  const style = document.createElement("style");
  style.id = "scholarly-styles";
  style.textContent = `
    .scholarly-interactive-container {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      margin-left: 12px;
      vertical-align: middle;
      font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }
    .scholarly-interactive-bubble {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #ffffff;
      border: 1px solid #e0e0e0;
      border-radius: 50%;
      height: 28px;
      width: 28px;
      cursor: help;
      transition: all 0.2s ease;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }
    .scholarly-interactive-bubble:hover {
      border-color: #bdbdbd;
      box-shadow: 0 2px 5px rgba(0,0,0,0.15);
      background: #fdfdfd;
    }
    .scholarly-bubble-icon {
      font-weight: 700;
      font-size: 11px;
      color: #5f6368;
      pointer-events: none;
    }
    .scholarly-bubble-popover {
      position: absolute;
      top: 34px;
      left: 50%;
      transform: translateX(-50%) translateY(-10px);
      background: #ffffff;
      border: 1px solid #dcdcdc;
      border-radius: 8px;
      padding: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
      z-index: 10000;
      opacity: 0;
      visibility: hidden;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      min-width: 200px;
      max-width: 450px;
      pointer-events: none;
    }
    .scholarly-interactive-bubble:hover .scholarly-bubble-popover {
      opacity: 1;
      visibility: visible;
      transform: translateX(-50%) translateY(0);
      pointer-events: auto;
    }
    /* Arrow for popover */
    .scholarly-bubble-popover::before {
      content: '';
      position: absolute;
      top: -6px;
      left: 50%;
      transform: translateX(-50%) rotate(45deg);
      width: 10px;
      height: 10px;
      background: #ffffff;
      border-top: 1px solid #dcdcdc;
      border-left: 1px solid #dcdcdc;
    }
    .scholarly-mini-badge {
      padding: 4px 8px;
      background: #f1f3f4;
      color: #3c4043;
      border-radius: 4px;
      font-weight: 600;
      font-size: 11px;
      margin: 2px;
      display: inline-block;
      border: 1px solid #e0e0e0;
    }
    .scholarly-popover-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 8px;
    }
    .scholarly-popover-row:last-child {
      margin-bottom: 0;
    }
  `;
  document.head.appendChild(style);
  document.getElementById(POSITION_PANEL_ID)?.remove();
}

function buildRankingCard(ranking: any): HTMLElement {
  const card = document.createElement("div");
  card.className = "scholarly-card";
  card.style.cssText =
    "margin-top:8px;padding:10px 12px;border:1px solid #d0d7de;border-radius:8px;" +
    "box-shadow:0 6px 18px rgba(0,0,0,0.12);background:#fff;max-width:420px;font-size:12px;line-height:1.45;";

  const rows: Array<[string, string]> = [
    ["Journal", ranking.title || "-"],
    ["Publisher", ranking.publisher || "-"],
    ["ISSN", (ranking.issns || []).join(", ") || "-"],
    ["SJR", ranking.sjr ? `${Number(ranking.sjr).toFixed(3)} (${ranking.sjrYear || "-"})` : "-"],
    ["Quartile", ranking.sjrBestQuartile || "-"],
    ["SNIP", ranking.snip ? `${Number(ranking.snip).toFixed(3)} (${ranking.snipYear || "-"})` : "-"],
    ["CiteScore", ranking.citeScore ? `${Number(ranking.citeScore).toFixed(2)} (${ranking.citeScoreYear || "-"})` : "-"],
    ["Open Access", ranking.openAccess === "1" ? "Yes" : "No"],
  ];

  rows.forEach(([label, value]) => {
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;justify-content:space-between;gap:10px;margin-bottom:6px;";

    const left = document.createElement("span");
    left.style.cssText = "font-weight:600;color:#111827;";
    left.textContent = label;

    const right = document.createElement("span");
    right.style.cssText = "color:#1f2937;text-align:right;";
    right.textContent = value;

    row.append(left, right);
    card.appendChild(row);
  });

  return card;
}

function extractDoi(link: string): string | null {
  const match = link.match(/\b(10\.\d{4,}\/\S+)/);
  if (!match) return null;
  return match[1].replace(/[.,;)\]]+$/, "");
}

function parseDoiFromHtml(html: string): string | null {
  // Try a DOI-labeled field first
  const labeled = html.match(
    /DOI[^\n\r<]*?(10\.\d{4,}\/[A-Za-z0-9._;()/:+-]+)/i,
  );
  if (labeled?.[1]) {
    return labeled[1].replace(/[.,;)\]]+$/, "");
  }

  // Fallback: any DOI-like token in HTML content
  const generic = html.match(/\b(10\.\d{4,}\/[A-Za-z0-9._;()/:+-]+)\b/i);
  if (generic?.[1]) {
    return generic[1].replace(/[.,;)\]]+$/, "");
  }

  return null;
}

async function fetchDoiFromCitationPage(link: string): Promise<string | null> {
  try {
    const url = new URL(link, window.location.origin).toString();
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    return parseDoiFromHtml(html);
  } catch {
    return null;
  }
}

async function resolveProfileArticleDoi(link: string): Promise<string | null> {
  const direct = extractDoi(link);
  if (direct) return direct;

  return fetchDoiFromCitationPage(link);
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[-.,]/g, " ") // Replace hyphens/punctuation with space
    .replace(/\s+/g, " ")
    .trim();
}

function isNameMatch(profileName: string, correspondenceName: string): boolean {
  const pName = normalizeText(profileName);
  const cName = normalizeText(correspondenceName);

  if (!pName || !cName) return false;

  const pTokens = pName.split(" ").filter((t) => t.length > 0);
  const cTokens = cName.split(" ").filter((t) => t.length > 0);

  // Exact match after normalization
  if (pName === cName) return true;

  // Check if ALL profile tokens are present in correspondence name (shorter matches longer usually)
  // or vice-versa
  const match = (source: string[], target: string[]) => {
    return source.every((st) => {
      if (st.length === 1) {
        return target.some((tt) => tt.startsWith(st));
      }
      return target.some((tt) => tt === st || tt.startsWith(st) || st.startsWith(tt));
    });
  };

  const result = match(pTokens, cTokens) || match(cTokens, pTokens);

  if (result) {
    console.log(`[Scholarly][Match] ✓ SUCCESS: "${profileName}" matches "${correspondenceName}"`);
  } else {
    // We already log the attempt in the caller, but this is a final check
  }

  return result;
}

function scoreCrossrefCandidate(
  articleTitle: string,
  articleYear: string,
  candidate: any,
): number {
  let score = Number(candidate?.score || 0);

  const candidateTitle = Array.isArray(candidate?.title)
    ? candidate.title[0] || ""
    : candidate?.title || "";

  if (
    candidateTitle &&
    normalizeText(candidateTitle).includes(normalizeText(articleTitle))
  ) {
    score += 50;
  }

  const yearParts =
    candidate?.issued?.["date-parts"] ||
    candidate?.published?.["date-parts"] ||
    [];
  const candidateYear = String(yearParts?.[0]?.[0] || "");
  if (articleYear && candidateYear && articleYear === candidateYear) {
    score += 20;
  }

  return score;
}

async function fetchDoiFromCrossref(
  title: string,
  authors: string,
  journal: string,
  year: string,
): Promise<string | null> {
  try {
    const queryParts = [title, authors, journal, year].filter(Boolean);
    if (queryParts.length === 0) return null;

    const params = new URLSearchParams({
      "query.bibliographic": queryParts.join(" "),
      rows: "5",
      select: "DOI,title,issued,published,score",
      mailto: "scholarly-extension@example.com",
    });

    const response = await fetch(
      `https://api.crossref.org/works?${params.toString()}`,
      {
        method: "GET",
      },
    );

    if (!response.ok) return null;

    const data = await response.json();
    const items: any[] = data?.message?.items || [];
    if (!items.length) return null;

    const best = items
      .map((item) => ({
        item,
        score: scoreCrossrefCandidate(title, year, item),
      }))
      .sort((a, b) => b.score - a.score)[0]?.item;

    const doi = best?.DOI as string | undefined;
    if (!doi) return null;
    return doi.replace(/[.,;)\]]+$/, "");
  } catch {
    return null;
  }
}

async function resolveProfileArticleDoiWithCrossref(
  article: ProfileArticleData,
): Promise<string | null> {
  if (article.doi) return article.doi;

  const fromCrossref = await fetchDoiFromCrossref(
    article.title,
    article.authors,
    article.journal,
    article.year,
  );
  if (fromCrossref) return fromCrossref;

  return resolveProfileArticleDoi(article.link);
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      await worker(items[current], current);
    }
  }

  const threads = Array.from({ length: Math.max(1, limit) }, () => runWorker());
  await Promise.all(threads);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForProfileRows(
  maxAttempts = 8,
  delayMs = 400,
): Promise<NodeListOf<Element>> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const rows = document.querySelectorAll(".gsc_a_tr");
    if (rows.length > 0) {
      return rows;
    }
    await sleep(delayMs);
  }

  return document.querySelectorAll(".gsc_a_tr");
}

export function isGoogleScholarProfilePage(): boolean {
  return (
    /\/citations/.test(window.location.pathname) &&
    /user=/.test(window.location.search)
  );
}

export async function scrapeGoogleScholarProfile(options?: {
  shouldContinue?: () => boolean;
}): Promise<void> {
  const shouldContinue = options?.shouldContinue ?? (() => true);

  if (!shouldContinue()) {
    return;
  }

  clearProfileBadges();
  injectScholarlyStyles();
  console.log("[Scholarly][Profile] Starting profile scrape...");

  const profileNameEl = document.getElementById("gsc_prf_in");
  const profileName = profileNameEl ? profileNameEl.innerText.trim() : "";
  console.log(`[Scholarly][Profile] Profile Owner: ${profileName}`);

  const rows = await waitForProfileRows();
  if (!shouldContinue()) {
    return;
  }
  console.log(`[Scholarly][Profile] Found ${rows.length} profile rows`);

  const articles: ProfileArticleData[] = [];

  rows.forEach((row, index) => {
    try {
      const titleCell = row.querySelector(".gsc_a_t") as HTMLElement | null;
      if (!titleCell) return;

      const titleLink = titleCell.querySelector(
        "a",
      ) as HTMLAnchorElement | null;
      if (!titleLink) return;

      let interactiveContainer = titleCell.querySelector(
        ".scholarly-interactive-container",
      ) as HTMLElement | null;
      if (!interactiveContainer) {
        interactiveContainer = document.createElement("span");
        interactiveContainer.className = "scholarly-interactive-container";
        titleLink.insertAdjacentElement("afterend", interactiveContainer);
      }
      
      const title = titleLink.innerText.trim();
      if (!title) return;

      const link = titleLink.href || "";
      const doi = extractDoi(link);

      const grayTexts = titleCell.querySelectorAll(".gs_gray");
      const authors =
        grayTexts.length > 0
          ? (grayTexts[0] as HTMLElement).innerText.trim()
          : "";
      const sourceText =
        grayTexts.length > 1
          ? (grayTexts[1] as HTMLElement).innerText.trim()
          : "";
      const sourceParts = sourceText.split(" - ");
      const journal = (sourceParts[0] || "").trim();

      let year = "";
      const yearCell = row.querySelector(".gsc_a_y") as HTMLElement | null;
      if (yearCell) {
        const yearMatch = yearCell.innerText.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) {
          year = yearMatch[0];
        }
      }

      let citations = 0;
      const citationsCell = row.querySelector(".gsc_a_c") as HTMLElement | null;
      if (citationsCell) {
        const citText = citationsCell.innerText.trim();
        const citMatch = citText.match(/\d+/);
        if (citMatch) {
          citations = parseInt(citMatch[0], 10);
        }
      }

      articles.push({
        title,
        authors,
        journal,
        year,
        link,
        doi,
        citations,
        badgeContainer: interactiveContainer,
      });

      console.log(
        `[Scholarly][Profile] Article [${index}] DOI: ${doi || "No DOI found"} | ${title.substring(0, 60)}`,
      );
    } catch (error) {
      console.error(`[Scholarly][Profile] Error parsing row ${index}:`, error);
    }
  });

  // Compute and render author position summary panel
  if (profileName) {
    const counts = { first: 0, second: 0, last: 0, other: 0 };
    articles.forEach((a) => {
      const authorList = a.authors.split(",").map((s) => s.trim()).filter(Boolean);
      const truncated = a.authors.trimEnd().endsWith("...");
      const pos = findAuthorPosition(profileName, a.authors);
      if (pos === null) return;
      if (pos === 0) { counts.first += 1; return; }
      if (!truncated && authorList.length >= 2 && pos === authorList.length - 1) {
        counts.last += 1; return;
      }
      if (pos === 1) { counts.second += 1; return; }
      counts.other += 1;
    });
    injectPositionPanel(counts);
  }

  if (articles.length === 0) {
    console.log("[Scholarly][Profile] No profile articles found to process.");
    return;
  }

  // 1. Resolve DOIs where missing
  await runWithConcurrency(articles, 4, async (article, index) => {
    if (!shouldContinue() || article.doi) return;
    article.doi = await resolveProfileArticleDoiWithCrossref(article);
    console.log(`[Scholarly][Profile] Resolved DOI [${index}]: ${article.doi || "N/A"}`);
  });

  // 2. Fetch Scopus Rankings (Concurrently)
  const scopusResults: any[] = new Array(articles.length).fill(null);
  await runWithConcurrency(articles, 2, async (article, index) => {
    if (!shouldContinue() || !article.doi) return;
    scopusResults[index] = await getScopusRankingByDoi(article.doi);
  });

  // 3. Fetch Scopus Abstracts (Concurrently)
  const abstractResults: any[] = new Array(articles.length).fill(null);
  await runWithConcurrency(articles, 2, async (article, index) => {
    if (!shouldContinue() || !article.doi) return;
    abstractResults[index] = await getScopusAbstractByDoi(article.doi);
  });

  if (!shouldContinue()) {
    return;
  }

  // 3.5 Find profile owner affiliation from abstracts
  let profileAffiliation = "";
  for (const res of abstractResults) {
    if (!res) continue;
    
    let authorGroups = res.authorGroup;
    if (authorGroups) {
      if (!Array.isArray(authorGroups)) authorGroups = [authorGroups];
      
      for (const group of authorGroups) {
         let authors = group.author;
         if (!authors) continue;
         if (!Array.isArray(authors)) authors = [authors];
         
         const match = authors.find((a: any) => {
           let n = a?.["ce:indexed-name"] 
                || a?.["preferred-name"]?.["ce:indexed-name"]
                || Object.values(a || {}).find(v => typeof v === 'string' && isNameMatch(profileName, v as string));
           if (!n && a?.["ce:given-name"] && a?.["ce:surname"]) {
               n = `${a["ce:given-name"]} ${a["ce:surname"]}`;
           }
           return n && isNameMatch(profileName, n as string);
         });
         
         if (match) {
           let aff = group.affiliation;
           if (aff) {
              let affiliations = Array.isArray(aff) ? aff : [aff];
              for (const singleAff of affiliations) {
                  let affText = singleAff?.["ce:source-text"] || singleAff?.["ce:text"] || singleAff?.["afdispname"] || "";
                  if (!affText) {
                      const orgs = Array.isArray(singleAff.organization)
                        ? singleAff.organization.map((o: any) => o["$"] || o["ce:text"]).join(", ")
                        : singleAff.organization?.["$"] || singleAff.organization?.["ce:text"] || "";
                      const country = singleAff.country || singleAff["@country"] || "";
                      affText = [orgs, country].filter(Boolean).join(", ");
                  }
                  if (affText) {
                    profileAffiliation = affText;
                    break;
                  }
              }
           }
         }
      }
    } else if (res.correspondence) {
      const correspondenceList = Array.isArray(res.correspondence) ? res.correspondence : [res.correspondence];
      for (const item of correspondenceList) {
          const name = item.person?.["ce:indexed-name"];
          if (name && isNameMatch(profileName, name)) {
              let affText = item.affiliation?.["ce:source-text"] || "";
              if (!affText && item.affiliation) {
                  const orgs = Array.isArray(item.affiliation.organization)
                    ? item.affiliation.organization.map((o: any) => o["$"]).join(", ")
                    : item.affiliation.organization?.["$"] || "";
                  const country = item.affiliation.country || "";
                  affText = [orgs, country].filter(Boolean).join(", ");
              }
              if (affText && !profileAffiliation) profileAffiliation = affText;
          }
      }
    }
    if (profileAffiliation) break;
  }

  // Inject profileAffiliation under #gsc_prf_in
  if (profileAffiliation && shouldContinue()) {
    const nameEl = document.getElementById("gsc_prf_in");
    if (nameEl && nameEl.parentElement) {
      const affEl = document.createElement("div");
      affEl.className = "scholarly-profile-affiliation";
      affEl.style.fontSize = "14px";
      affEl.style.color = "#4d5156";
      affEl.style.marginTop = "8px";
      affEl.style.marginBottom = "8px";
      affEl.style.display = "flex";
      affEl.style.alignItems = "center";
      affEl.style.gap = "6px";
      affEl.innerHTML = `<span style="font-size:16px;">🏛️</span> <span>${profileAffiliation}</span>`;
      
      if (nameEl.nextSibling) {
          nameEl.parentNode?.insertBefore(affEl, nameEl.nextSibling);
      } else {
          nameEl.parentElement.appendChild(affEl);
      }
    }
  }

  articles.forEach((article, index) => {
    if (!shouldContinue()) {
      return;
    }

    // ── Author Position Badge ──────────────────────────────────────────────
    if (profileName) {
      const authorList = article.authors.split(",").map((s) => s.trim()).filter(Boolean);
      const truncated = article.authors.trimEnd().endsWith("...");
      const pos = findAuthorPosition(profileName, article.authors);
      if (pos !== null) {
        const { label, color } = authorPositionBadgeStyle(pos, authorList.length, truncated);
        const tooltip = `${profileName} is author #${pos + 1} on this paper`;
        const badge = makePositionBadge(label, color, tooltip);
        article.badgeContainer.appendChild(badge);
      }
    }

    const res = abstractResults[index];
    let correspondence = res?.correspondence;
    
    // Fallback if missing correspondence but has authorGroup
    if (!correspondence && res?.authorGroup) {
      let groups = Array.isArray(res.authorGroup) ? res.authorGroup : [res.authorGroup];
      let firstGroup = groups.length > 0 ? groups[0] : null;
      if (firstGroup) {
         let authors = firstGroup.author;
         let firstAuthor = Array.isArray(authors) ? authors[0] : authors;
         if (firstAuthor) {
            correspondence = {
               person: firstAuthor,
               affiliation: firstGroup.affiliation
            };
         }
      }
    }
    
    if (correspondence) {
      const correspondenceList = Array.isArray(correspondence)
        ? correspondence
        : [correspondence];

      const caBubble = document.createElement("div");
      caBubble.className = "scholarly-interactive-bubble";
      
      // Determine if any author matches the profile owner
      let isAnyMatched = false;
      correspondenceList.forEach(item => {
        let name = item.person?.["ce:indexed-name"] 
            || item.person?.["preferred-name"]?.["ce:indexed-name"] 
            || `${item.person?.["ce:given-name"] || ""} ${item.person?.["ce:surname"] || ""}`.trim();
        if (name && isNameMatch(profileName, name)) isAnyMatched = true;
      });

      // User asked for a distinct circle background if matched
      const iconBg = isAnyMatched ? "#fef7e0" : "#f1f3f4";
      const iconColor = isAnyMatched ? "#e37400" : "#5f6368";
      const iconBorder = isAnyMatched ? "1px solid #fbd663" : "none";

      let authorInfoHtml = "";
      correspondenceList.forEach((item, cIdx) => {
        let name = item.person?.["ce:indexed-name"] 
            || item.person?.["preferred-name"]?.["ce:indexed-name"] 
            || `${item.person?.["ce:given-name"] || ""} ${item.person?.["ce:surname"] || ""}`.trim()
            || "Unknown";
            
        const matched = name && isNameMatch(profileName, name);
        if (matched) {
            name = profileName;
        }
        
        let affText = item.affiliation?.["ce:source-text"] || item.affiliation?.["ce:text"] || item.affiliation?.["afdispname"] || "";
        if (!affText && item.affiliation) {
          const orgs = Array.isArray(item.affiliation.organization)
            ? item.affiliation.organization.map((o: any) => o["$"] || o["ce:text"] || o).filter((x: any) => typeof x === 'string').join(", ")
            : item.affiliation.organization?.["$"] || item.affiliation.organization?.["ce:text"] || "";
          const country = item.affiliation.country || item.affiliation?.["@country"] || "";
          affText = [orgs, typeof country === 'string' ? country : ""].filter(Boolean).join(", ");
        }

        authorInfoHtml += `
          <div class="scholarly-popover-row">
            <div style="font-size: 13px; ${matched ? "color:#e37400; font-weight:700;" : "color:#202124; font-weight:600;"}">${name}</div>
            ${affText ? `<div style="color: #5f6368; font-size: 11px; white-space: normal; line-height:1.4;">${affText}</div>` : ""}
          </div>
        `;
        if (cIdx < correspondenceList.length - 1) {
          authorInfoHtml += '<hr style="border:0; border-top:1px solid #eee; margin:8px 0;">';
        }
      });

      caBubble.innerHTML = `
        <div class="scholarly-bubble-icon" style="background:${iconBg}; color:${iconColor}; border:${iconBorder}; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center;">CA</div>
        <div class="scholarly-bubble-popover">
          <div style="font-size: 11px; color:#70757a; margin-bottom:8px; border-bottom:1px solid #f1f3f4; padding-bottom:4px;">Corresponding Author</div>
          ${authorInfoHtml}
        </div>
      `;
      article.badgeContainer.appendChild(caBubble);
    }

    const scopusRanking = scopusResults[index];
    if (scopusRanking) {
      const isOpenAccess =
        String(scopusRanking.openAccess ?? scopusRanking.openaccess ?? "0") === "1";

      const cardToggle = document.createElement("button");
      cardToggle.type = "button";
      cardToggle.textContent = "Ranking card";
      cardToggle.className = "scholarly-badge";
      cardToggle.style.cssText =
        "margin-left:6px;padding:4px 12px;background:#ffffff;color:#0b7a75;border:1px solid #0b7a75;" +
        "font-size:11px;border-radius:999px;font-weight:700;cursor:pointer;";

      let cardEl: HTMLElement | null = null;
      cardToggle.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        if (cardEl && cardEl.isConnected) {
          cardEl.remove();
          cardEl = null;
          return;
        }
        cardEl = buildRankingCard(scopusRanking);
        article.badgeContainer.appendChild(cardEl);
      });
      article.badgeContainer.appendChild(cardToggle);

      const openAccessBadge = document.createElement("span");
      openAccessBadge.className = "scholarly-badge";
      openAccessBadge.style.cssText =
        "margin-left:6px;padding:2px 6px;background:" +
        (isOpenAccess ? "#2e7d32" : "#6c757d") +
        ";color:#fff;font-size:11px;border-radius:3px;font-weight:bold;";
      openAccessBadge.textContent = isOpenAccess
        ? "Open Access: Yes"
        : "Open Access: No";
      article.badgeContainer.appendChild(openAccessBadge);

      const metricsBubble = document.createElement("div");
      metricsBubble.className = "scholarly-interactive-bubble";
      
      let metricsHtml = "";
      
      // SJR
      const sjrVal = Number(scopusRanking.sjr || 0).toFixed(3);
      const qVal = scopusRanking.sjrBestQuartile || "";
      metricsHtml += `<div class="scholarly-mini-badge" style="background:#e8f0fe; color:#1967d2; border-color:#d2e3fc;">SJR ${sjrVal} ${qVal ? `(${qVal})` : ""}</div>`;
      
      // H-Index
      if (scopusRanking.hIndex) {
        metricsHtml += `<div class="scholarly-mini-badge" style="background:#f3e5f5; color:#7b1fa2; border-color:#e1bee7;">H-Index ${scopusRanking.hIndex}</div>`;
      }
      
      // CiteScore
      if (scopusRanking.citeScore) {
        metricsHtml += `<div class="scholarly-mini-badge" style="background:#e8f5e9; color:#2e7d32; border-color:#c8e6c9;">CS ${scopusRanking.citeScore.toFixed(2)}</div>`;
      }

      // SNIP
      if (scopusRanking.snip) {
        metricsHtml += `<div class="scholarly-mini-badge" style="background:#fff3e0; color:#e65100; border-color:#ffe0b2;">SNIP ${scopusRanking.snip.toFixed(2)}</div>`;
      }

      metricsBubble.innerHTML = `
        <div class="scholarly-bubble-icon" style="background:#f1f3f4; color:#5f6368; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center;">📊</div>
        <div class="scholarly-bubble-popover" style="min-width: 250px;">
          <div style="font-size: 11px; color:#70757a; margin-bottom:8px; border-bottom:1px solid #f1f3f4; padding-bottom:4px;">Journal Rankings</div>
          <div style="display:flex; flex-wrap:wrap; gap:4px;">${metricsHtml}</div>
        </div>
      `;
      article.badgeContainer.appendChild(metricsBubble);
    }

  });

  const withRanking = scopusResults.filter((result) => Boolean(result)).length;
  console.log(
    `[Scholarly][Profile] Done: ${articles.length} articles, ${withRanking} with Scopus rankings`,
  );
}