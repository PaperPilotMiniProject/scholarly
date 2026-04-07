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

function normalizeAuthorName(name: string): string {
  return name.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Returns the 0-based position of ownerName in a comma-separated authors string.
 * Handles: "P Kumar" matching "Pawan Kumar", "Kumar P" matching "Pawan Kumar", etc.
 */
function findAuthorPosition(ownerName: string, authorsStr: string): number | null {
  if (!ownerName || !authorsStr) return null;
  const parts = authorsStr.split(",").map((s) => s.trim()).filter(Boolean);
  const normOwner = normalizeAuthorName(ownerName);
  const ownerTokens = normOwner.split(" ");
  const ownerLast = ownerTokens[ownerTokens.length - 1];
  const ownerFirst = ownerTokens[0] || "";
  const ownerFirstInitial = ownerFirst[0] || "";

  for (let i = 0; i < parts.length; i++) {
    // Skip "..." entries
    if (parts[i] === "..." || parts[i] === "…") continue;
    const norm = normalizeAuthorName(parts[i]);
    const cTokens = norm.split(" ");
    
    // Exact match
    if (norm === normOwner) return i;
    
    // Check if last names match (required for all fuzzy matches)
    const hasLastName = cTokens.some(t => t === ownerLast);
    if (!hasLastName) continue;
    
    // "P Kumar" matches "Pawan Kumar" — initial + last name
    const otherTokens = cTokens.filter(t => t !== ownerLast);
    if (otherTokens.length > 0) {
      const otherFirst = otherTokens[0];
      // Single initial match: "p" matches "pawan"
      if (otherFirst.length === 1 && otherFirst === ownerFirstInitial) return i;
      // Full first name match or prefix: "pawan" vs "pawan" or "pa" vs "pawan"
      if (otherFirst.length > 1 && (ownerFirst.startsWith(otherFirst) || otherFirst.startsWith(ownerFirst))) return i;
    }
    
    // Just last name alone: "Kumar" matches "Pawan Kumar"
    if (cTokens.length === 1 && cTokens[0] === ownerLast) return i;
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
  if (position === 0) return { label: "1st Author", color: "#c0392b" };
  if (isLast) return { label: "Last Author", color: "#7d3c98" };
  if (position === 1) return { label: "2nd Author", color: "#2980b9" };
  if (position === 2) return { label: "3rd Author", color: "#2c3e50" };
  return { label: `${position + 1}th Author`, color: "#546e7a" };
}

const POSITION_PANEL_ID = "scholarly-gs-position-panel";

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
      📊 Scholarly &mdash; Author Positions
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;">
      ${counts.first > 0 ? pill("1st Author", counts.first, "#c0392b") : ""}
      ${counts.second > 0 ? pill("2nd Author", counts.second, "#2980b9") : ""}
      ${counts.last > 0 ? pill("Last Author", counts.last, "#7d3c98") : ""}
      ${counts.other > 0 ? pill("Other", counts.other, "#546e7a") : ""}
    </div>
    <div style="margin-top:8px;font-size:10px;color:#aaa;">Powered by Scholarly</div>
  `;
  anchor.insertAdjacentElement("beforebegin", panel);
}

export function clearProfileBadges(): void {
  document.querySelectorAll(".scholarly-badge").forEach((el) => el.remove());
  document.querySelectorAll(".scholarly-badge-anchor").forEach((el) => el.remove());
  document.querySelectorAll(".scholarly-interactive-container").forEach((el) => el.remove());
  document.querySelectorAll(".scholarly-profile-affiliation").forEach((el) => el.remove());
  document.querySelectorAll(".scholarly-interactive-bubble").forEach((el) => el.remove());
  document.querySelectorAll(".scholarly-static-pill").forEach((el) => el.remove());
  document.querySelectorAll(".scholarly-q-tag").forEach((el) => el.remove());
  document.querySelectorAll(".scholarly-pos-circle").forEach((el) => el.remove());
  document.getElementById(POSITION_PANEL_ID)?.remove();
}

function injectScholarlyStyles() {
  // Always replace styles to ensure they are up-to-date
  document.getElementById("scholarly-styles")?.remove();
  const style = document.createElement("style");
  style.id = "scholarly-styles";
  style.textContent = `
    .scholarly-interactive-container {
      display: inline-flex !important;
      align-items: center !important;
      gap: 6px !important;
      margin-left: 12px !important;
      vertical-align: middle !important;
      font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
      position: relative !important;
    }
    /* When any bubble inside is hovered, elevate the ENTIRE container above all siblings */
    .scholarly-interactive-container:has(.scholarly-interactive-bubble:hover) {
      z-index: 99999 !important;
    }
    .scholarly-interactive-bubble {
      position: relative !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      background: #ffffff !important;
      border: 1px solid #e1e4e8 !important;
      border-radius: 50% !important;
      width: 24px !important;
      height: 24px !important;
      cursor: help !important;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06) !important;
      flex-shrink: 0 !important;
    }
    .scholarly-interactive-bubble:hover {
      border-color: #1a73e8 !important;
      box-shadow: 0 4px 12px rgba(26, 115, 232, 0.15) !important;
      transform: translateY(-1px) !important;
      z-index: 99999 !important;
    }
    .scholarly-badge-circle {
      width: 100% !important;
      height: 100% !important;
      border-radius: 50% !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-size: 10px !important;
      font-weight: 800 !important;
    }
    .scholarly-static-pill {
      display: inline-flex !important;
      align-items: center !important;
      height: 22px !important;
      padding: 0 8px !important;
      background: #ffffff !important;
      border: 1px solid #e1e4e8 !important;
      border-radius: 6px !important;
      font-size: 11px !important;
      font-weight: 700 !important;
      color: #202124 !important;
      white-space: nowrap !important;
      box-shadow: 0 1px 2px rgba(0,0,0,0.04) !important;
    }
    .scholarly-q-tag {
      font-size: 10px !important;
      font-weight: 800 !important;
      padding: 2px 8px !important;
      border-radius: 6px !important;
      text-transform: uppercase !important;
      box-shadow: 0 1px 2px rgba(0,0,0,0.05) !important;
      height: 22px !important;
      display: inline-flex !important;
      align-items: center !important;
    }
    .scholarly-pos-circle {
      width: 24px !important;
      height: 24px !important;
      border-radius: 50% !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-size: 9px !important;
      font-weight: 800 !important;
      color: #fff !important;
      box-shadow: 0 1px 3px rgba(0,0,0,0.2) !important;
      flex-shrink: 0 !important;
    }
    .scholarly-bubble-popover {
      position: absolute !important;
      top: 32px !important;
      left: 50% !important;
      transform: translateX(-50%) translateY(-10px) !important;
      background-color: #ffffff !important;
      border: 1px solid #bbb !important;
      border-radius: 12px !important;
      padding: 16px !important;
      box-shadow: 0 12px 40px rgba(0,0,0,0.3) !important;
      z-index: 99999 !important;
      opacity: 0 !important;
      visibility: hidden !important;
      transition: opacity 0.2s ease, visibility 0.2s ease, transform 0.2s ease !important;
      min-width: 300px !important;
      max-width: 450px !important;
      pointer-events: none !important;
      isolation: isolate !important;
    }
    .scholarly-interactive-bubble:hover > .scholarly-bubble-popover {
      opacity: 1 !important;
      visibility: visible !important;
      transform: translateX(-50%) translateY(0) !important;
      pointer-events: auto !important;
    }
    .scholarly-bubble-popover::before {
      content: '' !important;
      position: absolute !important;
      top: -6px !important;
      left: 50% !important;
      transform: translateX(-50%) rotate(45deg) !important;
      width: 10px !important;
      height: 10px !important;
      background: #ffffff !important;
      border-top: 1px solid #bbb !important;
      border-left: 1px solid #bbb !important;
      z-index: 1 !important;
    }
    .scholarly-popover-row {
      display: flex !important;
      justify-content: space-between !important;
      gap: 12px !important;
      margin-bottom: 8px !important;
      background: transparent !important;
    }
    .scholarly-popover-row:last-child {
      margin-bottom: 0 !important;
    }
    .scholarly-profile-affiliation-container {
      display: flex !important;
      flex-direction: row !important;
      align-items: center !important;
      margin-top: 6px !important;
      margin-bottom: 10px !important;
      gap: 12px !important;
      position: relative !important;
      z-index: 100 !important;
    }
    #gsc_prf, #gsc_prf_w, #gsc_prf_i, #gsc_prf_pbl, #gsc_prf_c {
      overflow: visible !important;
    }
    .scholarly-profile-affiliation {
      font-size: 13px !important;
      color: #5f6368 !important;
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
      font-family: inherit !important;
    }
    .scholarly-aff-all-btn {
      color: #1a73e8 !important;
      font-size: 11px !important;
      cursor: pointer !important;
      text-decoration: none !important;
      font-weight: 600 !important;
      display: inline-flex !important;
      align-items: center !important;
      border: 1px solid #dadce0 !important;
      border-radius: 16px !important;
      padding: 4px 10px !important;
      transition: all 0.2s ease !important;
      background: #fff !important;
    }
    .scholarly-aff-all-btn:hover {
      background: #f8f9fa !important;
      border-color: #1a73e8 !important;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important;
    }
    .scholarly-aff-window {
      position: absolute !important;
      background: #ffffff !important;
      border: 1px solid #dadce0 !important;
      border-radius: 10px !important;
      padding: 0 !important;
      box-shadow: 0 12px 48px rgba(0,0,0,0.2) !important;
      z-index: 2147483647 !important;
      width: 380px !important;
      display: none;
      opacity: 0;
      transform: scale(0.95);
      transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
      overflow: hidden !important;
      font-family: system-ui, -apple-system, sans-serif !important;
      top: 100% !important;
      left: 0 !important;
      margin-top: 8px !important;
    }
    .scholarly-aff-window.show {
      display: block !important;
      opacity: 1 !important;
      transform: scale(1) !important;
    }
    .scholarly-aff-header {
      background: #f8f9fa !important;
      padding: 10px 14px !important;
      border-bottom: 1px solid #eee !important;
      cursor: grab !important;
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      user-select: none !important;
    }
    .scholarly-aff-header:active {
      cursor: grabbing !important;
    }
    .scholarly-aff-title {
      font-weight: 700 !important;
      font-size: 12px !important;
      color: #202124 !important;
      letter-spacing: 0.2px !important;
    }
    .scholarly-aff-close {
      cursor: pointer !important;
      color: #5f6368 !important;
      font-size: 18px !important;
      line-height: 1 !important;
      padding: 4px !important;
      border-radius: 4px !important;
      transition: background 0.2s !important;
    }
    .scholarly-aff-close:hover {
      background: #e8eaed !important;
      color: #202124 !important;
    }
    .scholarly-aff-content {
      max-height: 350px !important;
      overflow-y: auto !important;
      padding: 8px 14px 14px !important;
    }
    .scholarly-aff-item {
      display: flex !important;
      gap: 12px !important;
      padding: 10px 0 !important;
      border-bottom: 1px solid #f1f3f4 !important;
    }
    .scholarly-aff-item:last-child {
      border-bottom: none !important;
    }
    .scholarly-aff-year {
      font-weight: 700 !important;
      color: #1a73e8 !important;
      font-size: 11px !important;
      min-width: 34px !important;
      padding-top: 1px !important;
    }
    .scholarly-aff-name {
      font-size: 12px !important;
      color: #444 !important;
      line-height: 1.5 !important;
      flex: 1 !important;
    }
  `;
  document.head.appendChild(style);
  document.getElementById(POSITION_PANEL_ID)?.remove();
}

function extractDoi(link: string): string | null {
  const match = link.match(/\b(10\.\d{4,}\/\S+)/);
  if (!match) return null;
  return match[1].replace(/[.,;)\]]+$/, "");
}

function parseDoiFromHtml(html: string): string | null {
  const labeled = html.match(/DOI[^\n\r<]*?(10\.\d{4,}\/[A-Za-z0-9._;()/:+-]+)/i);
  if (labeled?.[1]) return labeled[1].replace(/[.,;)\]]+$/, "");
  const generic = html.match(/\b(10\.\d{4,}\/[A-Za-z0-9._;()/:+-]+)\b/i);
  if (generic?.[1]) return generic[1].replace(/[.,;)\]]+$/, "");
  return null;
}

async function fetchDoiFromCitationPage(link: string): Promise<string | null> {
  try {
    const url = new URL(link, window.location.origin).toString();
    const response = await fetch(url, { method: "GET", credentials: "include" });
    if (!response.ok) return null;
    const html = await response.text();
    return parseDoiFromHtml(html);
  } catch { return null; }
}

async function resolveProfileArticleDoi(link: string): Promise<string | null> {
  const direct = extractDoi(link);
  if (direct) return direct;
  return fetchDoiFromCitationPage(link);
}

function normalizeText(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[-.,]/g, " ").replace(/\s+/g, " ").trim();
}

function isNameMatch(profileName: string, correspondenceName: string): boolean {
  const pName = normalizeText(profileName);
  const cName = normalizeText(correspondenceName);
  if (!pName || !cName) return false;
  const pTokens = pName.split(" ").filter((t) => t.length > 0);
  const cTokens = cName.split(" ").filter((t) => t.length > 0);
  if (pName === cName) return true;
  const match = (source: string[], target: string[]) => source.every((st) => st.length === 1 ? target.some((tt) => tt.startsWith(st)) : target.some((tt) => tt === st || tt.startsWith(st) || st.startsWith(tt)));
  return match(pTokens, cTokens) || match(cTokens, pTokens);
}

function scoreCrossrefCandidate(articleTitle: string, articleYear: string, candidate: any): number {
  let score = Number(candidate?.score || 0);
  const candidateTitle = Array.isArray(candidate?.title) ? candidate.title[0] || "" : candidate?.title || "";
  if (candidateTitle && normalizeText(candidateTitle).includes(normalizeText(articleTitle))) score += 50;
  const yearParts = candidate?.issued?.["date-parts"] || candidate?.published?.["date-parts"] || [];
  const candidateYear = String(yearParts?.[0]?.[0] || "");
  if (articleYear && candidateYear && articleYear === candidateYear) score += 20;
  return score;
}

async function fetchDoiFromCrossref(title: string, authors: string, journal: string, year: string): Promise<string | null> {
  try {
    const queryParts = [title, authors, journal, year].filter(Boolean);
    if (queryParts.length === 0) return null;
    const params = new URLSearchParams({ "query.bibliographic": queryParts.join(" "), rows: "5", select: "DOI,title,issued,published,score", mailto: "scholarly-extension@example.com" });
    const response = await fetch(`https://api.crossref.org/works?${params.toString()}`, { method: "GET" });
    if (!response.ok) return null;
    const data = await response.json();
    const items: any[] = data?.message?.items || [];
    if (!items.length) return null;
    const best = items.map((item) => ({ item, score: scoreCrossrefCandidate(title, year, item) })).sort((a, b) => b.score - a.score)[0]?.item;
    return best?.DOI?.replace(/[.,;)\]]+$/, "") || null;
  } catch { return null; }
}

async function resolveProfileArticleDoiWithCrossref(article: ProfileArticleData): Promise<string | null> {
  if (article.doi) return article.doi;
  const fromCrossref = await fetchDoiFromCrossref(article.title, article.authors, article.journal, article.year);
  return fromCrossref || resolveProfileArticleDoi(article.link);
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, limit) }, () => runWorker()));
}

function sleep(ms: number): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, ms)); }

async function waitForProfileRows(maxAttempts = 8, delayMs = 400): Promise<NodeListOf<Element>> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rows = document.querySelectorAll(".gsc_a_tr");
    if (rows.length > 0) return rows;
    await sleep(delayMs);
  }
  return document.querySelectorAll(".gsc_a_tr");
}

export function isGoogleScholarProfilePage(): boolean {
  return /\/citations/.test(window.location.pathname) && /user=/.test(window.location.search);
}

export async function scrapeGoogleScholarProfile(options?: { shouldContinue?: () => boolean }): Promise<void> {
  const shouldContinue = options?.shouldContinue ?? (() => true);
  if (!shouldContinue()) return;
  clearProfileBadges();
  injectScholarlyStyles();
  const profileNameEl = document.getElementById("gsc_prf_in");
  const profileName = profileNameEl ? profileNameEl.innerText.trim() : "";
  console.log("[Scholarly] Profile owner name:", profileName);
  const rows = await waitForProfileRows();
  if (!shouldContinue()) return;
  const articles: ProfileArticleData[] = [];
  rows.forEach((row) => {
    try {
      const titleCell = row.querySelector(".gsc_a_t") as HTMLElement | null;
      if (!titleCell) return;
      const titleLink = titleCell.querySelector("a") as HTMLAnchorElement | null;
      if (!titleLink) return;
      let interactiveContainer = titleCell.querySelector(".scholarly-interactive-container") as HTMLElement | null;
      if (!interactiveContainer) {
        interactiveContainer = document.createElement("span");
        interactiveContainer.className = "scholarly-interactive-container";
        titleLink.insertAdjacentElement("afterend", interactiveContainer);
      }
      const title = titleLink.innerText.trim();
      const grayTexts = titleCell.querySelectorAll(".gs_gray");
      const authors = grayTexts.length > 0 ? (grayTexts[0] as HTMLElement).innerText.trim() : "";
      const sourceText = grayTexts.length > 1 ? (grayTexts[1] as HTMLElement).innerText.trim() : "";
      const journal = (sourceText.split(" - ")[0] || "").trim();
      let year = "";
      const yearCell = row.querySelector(".gsc_a_y") as HTMLElement | null;
      if (yearCell) {
        const yearMatch = yearCell.innerText.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) year = yearMatch[0];
      }
      articles.push({ title, authors, journal, year, link: titleLink.href, doi: extractDoi(titleLink.href), citations: 0, badgeContainer: interactiveContainer });
    } catch (e) { console.error(e); }
  });

  // Pre-compute author positions for panel
  if (profileName) {
    const counts = { first: 0, second: 0, last: 0, other: 0 };
    articles.forEach((a) => {
      const pos = findAuthorPosition(profileName, a.authors);
      if (pos === null) return;
      const authorList = a.authors.split(",").map(s => s.trim()).filter(Boolean);
      if (pos === 0) counts.first++;
      else if (!a.authors.trimEnd().endsWith("...") && authorList.length >= 2 && pos === authorList.length - 1) counts.last++;
      else if (pos === 1) counts.second++;
      else counts.other++;
    });
    injectPositionPanel(counts);
  }

  // Resolve DOIs
  await runWithConcurrency(articles, 4, async (article) => {
    if (shouldContinue()) article.doi = await resolveProfileArticleDoiWithCrossref(article);
  });

  // Fetch rankings and abstracts
  const scopusResults: any[] = new Array(articles.length).fill(null);
  const abstractResults: any[] = new Array(articles.length).fill(null);
  await runWithConcurrency(articles, 2, async (article, index) => {
    if (!shouldContinue() || !article.doi) return;
    scopusResults[index] = await getScopusRankingByDoi(article.doi);
    abstractResults[index] = await getScopusAbstractByDoi(article.doi);
  });

  if (!shouldContinue()) return;

  // Extract all profile affiliations
  const affiliationsMap = new Map<string, number>();
  abstractResults.forEach((res, index) => {
    if (!res) return;
    const articleYear = parseInt(articles[index].year) || 0;
    let authorGroups = res.authorGroup;
    if (authorGroups) {
      if (!Array.isArray(authorGroups)) authorGroups = [authorGroups];
      for (const group of authorGroups) {
        let authors = group.author;
        if (!authors) continue;
        if (!Array.isArray(authors)) authors = [authors];
        const match = authors.find((a: any) => {
          let n = a?.["ce:indexed-name"] || a?.["preferred-name"]?.["ce:indexed-name"];
          if (!n && a?.["ce:given-name"] && a?.["ce:surname"]) n = `${a["ce:given-name"]} ${a["ce:surname"]}`;
          return n && isNameMatch(profileName, n);
        });
        if (match && group.affiliation) {
          let affs = Array.isArray(group.affiliation) ? group.affiliation : [group.affiliation];
          for (const sAff of affs) {
            let text = sAff?.["ce:source-text"] || sAff?.["ce:text"] || sAff?.["afdispname"] || "";
            if (text) {
              const currentYear = affiliationsMap.get(text) || 0;
              if (articleYear > currentYear) {
                affiliationsMap.set(text, articleYear);
              }
            }
          }
        }
      }
    }
  });

  const sortedAffiliations = Array.from(affiliationsMap.entries())
    .map(([text, year]) => ({ text, year }))
    .sort((a, b) => b.year - a.year);

  if (sortedAffiliations.length > 0 && shouldContinue()) {
    const nameEl = document.getElementById("gsc_prf_in");
    if (nameEl?.parentElement) {
      const container = document.createElement("div");
      container.className = "scholarly-profile-affiliation-container";
      
      const latest = sortedAffiliations[0];
      const otherAffsHtml = sortedAffiliations.map(a => `
        <div class="scholarly-aff-item">
          <span class="scholarly-aff-year">${a.year || "N/A"}</span>
          <span class="scholarly-aff-name">${a.text}</span>
        </div>
      `).join("");

      container.innerHTML = `
        <div class="scholarly-profile-affiliation">
          <span style="font-size:16px;">🏛️</span>
          <span>${latest.text} ${latest.year ? `(${latest.year})` : ""}</span>
          ${sortedAffiliations.length > 1 ? `
            <a class="scholarly-aff-all-btn" id="scholarly-show-all-affs">
              View History (${sortedAffiliations.length}) ▾
            </a>
          ` : ""}
        </div>
        <div class="scholarly-aff-window" id="scholarly-aff-window">
          <div class="scholarly-aff-header" id="scholarly-aff-handle">
            <span class="scholarly-aff-title">AFFILIATION HISTORY</span>
            <span class="scholarly-aff-close" id="scholarly-aff-close">&times;</span>
          </div>
          <div class="scholarly-aff-content">
            ${otherAffsHtml}
          </div>
        </div>
      `;

      nameEl.insertAdjacentElement("afterend", container);

      const btn = container.querySelector("#scholarly-show-all-affs") as HTMLElement;
      const window = container.querySelector("#scholarly-aff-window") as HTMLElement;
      const closeBtn = container.querySelector("#scholarly-aff-close") as HTMLElement;
      const handle = container.querySelector("#scholarly-aff-handle") as HTMLElement;

      if (btn && window) {
        btn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const isShowing = window.classList.contains("show");
          if (isShowing) {
            window.classList.remove("show");
          } else {
            // Reset to default position if not dragged before
            if (!window.dataset.dragged) {
              window.style.left = "0";
              window.style.top = "100%";
            }
            window.classList.add("show");
          }
        };

        if (closeBtn) {
          closeBtn.onclick = (e) => {
            e.stopPropagation();
            window.classList.remove("show");
          };
        }

        // Draggable Logic
        let isDragging = false;
        let startX: number, startY: number, initialLeft: number, initialTop: number;

        handle.onmousedown = (e) => {
          isDragging = true;
          startX = e.clientX;
          startY = e.clientY;
          
          const style = getComputedStyle(window);
          initialLeft = parseInt(style.left) || 0;
          initialTop = parseInt(style.top) || 0;
          
          handle.style.cursor = "grabbing";
          window.dataset.dragged = "true";
          e.preventDefault();
          e.stopPropagation();
        };

        document.addEventListener("mousemove", (e) => {
          if (!isDragging) return;
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;
          window.style.transition = "none"; 
          window.style.left = `${initialLeft + dx}px`;
          window.style.top = `${initialTop + dy}px`;
        });

        document.addEventListener("mouseup", () => {
          if (isDragging) {
            isDragging = false;
            handle.style.cursor = "grab";
            window.style.transition = ""; 
          }
        });
      }
    }
  }

  // ── Inject per-article badges ───────────────────────────────────────────
  articles.forEach((article, index) => {
    if (!shouldContinue()) return;
    
    const ranking = scopusResults[index];
    const abstract = abstractResults[index];
    const correspondence = abstract?.correspondence || (abstract?.authorGroup ? { person: (Array.isArray(abstract.authorGroup) ? abstract.authorGroup[0] : abstract.authorGroup).author } : null);

    // Clear container to prevent duplication on re-run
    article.badgeContainer.innerHTML = "";

    // 1. CA Badge (Interactive — hover shows correspondence details)
    if (correspondence) {
      const caBubble = document.createElement("div");
      caBubble.className = "scholarly-interactive-bubble";
      
      let isMatched = false;
      const correspondenceList = Array.isArray(correspondence) ? correspondence : [correspondence];
      
      let authorsHtml = "";
      correspondenceList.forEach((item, idx) => {
        let n = item.person?.["ce:indexed-name"] || `${item.person?.["ce:given-name"] || ""} ${item.person?.["ce:surname"] || ""}`.trim();
        if (!n) n = "Unknown Author";
        if (isNameMatch(profileName, n)) isMatched = true;

        let aff = item.affiliation?.["ce:source-text"] || item.affiliation?.["afdispname"] || "";
        authorsHtml += `
          <div style="margin-bottom:8px;">
            <div style="font-weight:700; color:#1a73e8; font-size:12px;">${n}</div>
            ${aff ? `<div style="font-size:11px; color:#5f6368; line-height:1.2;">${aff}</div>` : ""}
          </div>
        `;
        if (idx < correspondenceList.length - 1) authorsHtml += '<hr style="border:0; border-top:1px solid #eee; margin:8px 0;">';
      });

      const caBg = isMatched ? "#fef7e0" : "#f1f3f4";
      const caCol = isMatched ? "#e37400" : "#5f6368";
      const caBor = isMatched ? "1px solid #fbd663" : "1px solid #e1e4e8";

      caBubble.innerHTML = `
        <div class="scholarly-badge-circle" style="background:${caBg}; color:${caCol}; border:${caBor};">CA</div>
        <div class="scholarly-bubble-popover">
          <div style="font-size:13px; font-weight:700; color:#202124; margin-bottom:12px; border-bottom:1px solid #e8eaed; padding-bottom:8px;">Corresponding Author</div>
          ${authorsHtml}
        </div>
      `;
      article.badgeContainer.appendChild(caBubble);
    }

    // 2. JR Badge (Interactive — hover shows journal details)
    if (ranking) {
      const jrBubble = document.createElement("div");
      jrBubble.className = "scholarly-interactive-bubble";

      const sjr = Number(ranking.sjr || 0);
      const q = ranking.sjrBestQuartile || "";
      const snip = Number(ranking.snip || 0);
      const rows = [
        ["Journal", ranking.title || "-"],
        ["Publisher", ranking.publisher || "-"],
        ["SJR", `${sjr.toFixed(3)} (${q || "-"})`],
        ["SNIP", snip > 0 ? snip.toFixed(3) : "-"],
        ["CiteScore", Number(ranking.citeScore || 0).toFixed(2)]
      ];
      const popHtml = rows.map(([l, v]) => `
        <div class="scholarly-popover-row">
          <span style="font-weight:600; color:#5f6368; font-size:12px;">${l}</span>
          <span style="color:#202124; font-size:12px; text-align:right;">${v}</span>
        </div>
      `).join("");

      jrBubble.innerHTML = `
        <div class="scholarly-badge-circle" style="background:#f1f3f4; color:#5f6368; border:1px solid #e1e4e8;">JR</div>
        <div class="scholarly-bubble-popover">
          <div style="font-size:13px; font-weight:700; color:#1a73e8; margin-bottom:12px; border-bottom:1px solid #e8eaed; padding-bottom:8px;">Journal Ranking Details</div>
          ${popHtml}
          <div style="margin-top:10px; padding-top:8px; border-top:1px solid #e8eaed; font-size:10px; color:#70757a; text-align:center;">Powered by Scopus</div>
        </div>
      `;
      article.badgeContainer.appendChild(jrBubble);

      // 3. SJR Pill (Static — no hover)
      let sjrColor = "#202124";
      if (sjr > 4) sjrColor = "#1a73e8"; else if (sjr > 1) sjrColor = "#188038";
      const sjrPill = document.createElement("span");
      sjrPill.className = "scholarly-static-pill";
      sjrPill.style.color = sjrColor;
      sjrPill.textContent = `SJR ${sjr.toFixed(3)}`;
      article.badgeContainer.appendChild(sjrPill);

      // 4. Quartile Tag (Static — no hover)
      if (q) {
        let qBg = "#f1f3f4", qCol = "#5f6368";
        if (q === "Q1") { qBg = "#e6f4ea"; qCol = "#137333"; }
        else if (q === "Q2") { qBg = "#fef7e0"; qCol = "#b06000"; }
        else if (q === "Q3") { qBg = "#feefe3"; qCol = "#b06000"; }
        else if (q === "Q4") { qBg = "#fce8e6"; qCol = "#a50e0e"; }
        
        const qTag = document.createElement("span");
        qTag.className = "scholarly-q-tag";
        qTag.style.background = qBg;
        qTag.style.color = qCol;
        qTag.textContent = q;
        article.badgeContainer.appendChild(qTag);
      }
    }

    // 5. Author Position Circle (Static — no hover)
    if (profileName) {
      const pos = findAuthorPosition(profileName, article.authors);
      console.log(`[Scholarly] Author position for "${profileName}" in "${article.authors}": ${pos}`);
      if (pos !== null) {
        const authorList = article.authors.split(",").map(s => s.trim()).filter(Boolean);
        const { label, color } = authorPositionBadgeStyle(pos, authorList.length, article.authors.trimEnd().endsWith("..."));
        const posCircle = document.createElement("span");
        posCircle.className = "scholarly-pos-circle";
        posCircle.style.cssText = `display:inline-flex !important; align-items:center !important; justify-content:center !important; width:24px !important; height:24px !important; border-radius:50% !important; font-size:9px !important; font-weight:800 !important; color:#fff !important; background:${color} !important; box-shadow:0 1px 3px rgba(0,0,0,0.2) !important; flex-shrink:0 !important;`;
        posCircle.title = label;
        posCircle.textContent = pos === 0 ? "1st" : pos === 1 ? "2nd" : pos === 2 ? "3rd" : `${pos + 1}th`;
        article.badgeContainer.appendChild(posCircle);
      }
    }
  });
}