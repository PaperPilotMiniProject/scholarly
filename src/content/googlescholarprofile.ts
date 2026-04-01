import { getScopusRankingByDoi } from "../../src/utils/csvParser";

type ProfileArticleData = {
  title: string;
  authors: string;
  journal: string;
  year: string;
  link: string;
  doi: string | null;
  citations: number;
  badgeContainer: HTMLElement;
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
  const isLast = !truncated && total > 2 && position === total - 1;
  if (position === 0) return { label: "\uD83E\uDD47 1st Author", color: "#c0392b" };
  if (position === 1) return { label: "\uD83E\uDD48 2nd Author", color: "#2980b9" };
  if (isLast) return { label: "\u21A9 Last Author", color: "#7d3c98" };
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
  document
    .querySelectorAll(".scholarly-badge-anchor")
    .forEach((el) => el.remove());
  document.getElementById(POSITION_PANEL_ID)?.remove();
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
  return text.toLowerCase().replace(/\s+/g, " ").trim();
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
  console.log("[Scholarly][Profile] Starting profile scrape...");

  // Detect profile owner name for author position tracking
  const ownerName = getScholarProfileOwnerName();
  console.log(`[Scholarly][Profile] Profile owner: ${ownerName ?? "unknown"}`);

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

      let badgeAnchor = titleCell.querySelector(
        ".scholarly-badge-anchor",
      ) as HTMLElement | null;
      if (!badgeAnchor) {
        badgeAnchor = document.createElement("span");
        badgeAnchor.className = "scholarly-badge-anchor";
        badgeAnchor.style.cssText = "display:inline-flex;flex-wrap:wrap;";
        titleLink.insertAdjacentElement("afterend", badgeAnchor);
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
        badgeContainer: badgeAnchor,
      });

      // Inject author position badge immediately (no DOI needed)
      if (ownerName && authors) {
        const authorList = authors.split(",").map((s) => s.trim()).filter(Boolean);
        const truncated = authors.trimEnd().endsWith("...");
        const pos = findAuthorPosition(ownerName, authors);
        if (pos !== null) {
          const { label, color } = authorPositionBadgeStyle(pos, authorList.length, truncated);
          badgeAnchor.appendChild(
            makePositionBadge(label, color, `Position ${pos + 1} of ${authorList.length} listed authors`),
          );
        }
      }

      console.log(
        `[Scholarly][Profile] Article [${index}] DOI: ${doi || "No DOI found"} | ${title.substring(0, 60)}`,
      );
    } catch (error) {
      console.error(`[Scholarly][Profile] Error parsing row ${index}:`, error);
    }
  });

  // Compute and render author position summary panel
  if (ownerName) {
    const counts = { first: 0, second: 0, last: 0, other: 0 };
    articles.forEach((a) => {
      const authorList = a.authors.split(",").map((s) => s.trim()).filter(Boolean);
      const truncated = a.authors.trimEnd().endsWith("...");
      const pos = findAuthorPosition(ownerName, a.authors);
      if (pos === null) return;
      if (pos === 0) { counts.first += 1; return; }
      if (pos === 1) { counts.second += 1; return; }
      if (!truncated && authorList.length > 2 && pos === authorList.length - 1) {
        counts.last += 1; return;
      }
      counts.other += 1;
    });
    injectPositionPanel(counts);
  }

  if (articles.length === 0) {
    console.log("[Scholarly][Profile] No profile articles found to process.");
    return;
  }

  // Profile links are usually Scholar internal links. Resolve DOI by fetching
  // each citation page and extracting DOI from the page HTML when needed.
  await runWithConcurrency(articles, 4, async (article, index) => {
    if (!shouldContinue()) {
      return;
    }

    if (article.doi) {
      return;
    }

    const resolvedDoi = await resolveProfileArticleDoiWithCrossref(article);
    article.doi = resolvedDoi;

    console.log(
      `[Scholarly][Profile] Resolved DOI [${index}]: ${resolvedDoi || "No DOI found"} | ${article.title.substring(0, 60)}`,
    );
  });

  const scopusResults = await Promise.all(
    articles.map((article) =>
      article.doi ? getScopusRankingByDoi(article.doi) : Promise.resolve(null),
    ),
  );

  if (!shouldContinue()) {
    return;
  }

  articles.forEach((article, index) => {
    if (!shouldContinue()) {
      return;
    }

    const scopusRanking = scopusResults[index];
    if (!scopusRanking) {
      return;
    }

    const sjrBadge = document.createElement("span");
    sjrBadge.className = "scholarly-badge";
    sjrBadge.style.cssText =
      "margin-left:8px;padding:2px 6px;background:#1976d2;color:#fff;font-size:11px;border-radius:3px;font-weight:bold;";
    
    let sjrText = `SJR ${Number(scopusRanking.sjr || 0).toFixed(3)}`;
    if (scopusRanking.sjrBestQuartile) {
      sjrText += ` (${scopusRanking.sjrBestQuartile})`;
    } else if (scopusRanking.sjrYear) {
      sjrText += ` (${scopusRanking.sjrYear})`;
    }
    sjrBadge.textContent = sjrText;
    article.badgeContainer.appendChild(sjrBadge);

    // Add H-Index badge if available
    if (scopusRanking.hIndex) {
      const hIndexBadge = document.createElement("span");
      hIndexBadge.className = "scholarly-badge";
      hIndexBadge.style.cssText =
        "margin-left:4px;padding:2px 6px;background:#3f51b5;color:#fff;font-size:11px;border-radius:3px;font-weight:bold;";
      hIndexBadge.textContent = `H-Index ${scopusRanking.hIndex}`;
      article.badgeContainer.appendChild(hIndexBadge);
    }


    if (typeof scopusRanking.snip === "number") {
      const snipBadge = document.createElement("span");
      snipBadge.className = "scholarly-badge";
      snipBadge.style.cssText =
        "margin-left:4px;padding:2px 6px;background:#8e24aa;color:#fff;font-size:11px;border-radius:3px;font-weight:bold;";
      snipBadge.textContent = `SNIP ${scopusRanking.snip.toFixed(3)} (${scopusRanking.snipYear || "-"})`;
      article.badgeContainer.appendChild(snipBadge);
    }

    if (scopusRanking.citeScore) {
      const citeScoreBadge = document.createElement("span");
      citeScoreBadge.className = "scholarly-badge";
      citeScoreBadge.style.cssText =
        "margin-left:4px;padding:2px 6px;background:#4caf50;color:#fff;font-size:11px;border-radius:3px;font-weight:bold;";
      citeScoreBadge.textContent = `CiteScore ${scopusRanking.citeScore.toFixed(2)} (${scopusRanking.citeScoreYear})`;
      article.badgeContainer.appendChild(citeScoreBadge);
    }

    if (article.citations) {
      const citeBadge = document.createElement("span");
      citeBadge.className = "scholarly-badge";
      citeBadge.style.cssText =
        "margin-left:4px;padding:2px 6px;background:#ff9800;color:#fff;font-size:11px;border-radius:3px;font-weight:bold;";
      citeBadge.textContent = `Cited by ${article.citations}`;
      article.badgeContainer.appendChild(citeBadge);
    }
  });

  const withRanking = scopusResults.filter((result) => Boolean(result)).length;
  console.log(
    `[Scholarly][Profile] Done: ${articles.length} articles, ${withRanking} with Scopus rankings`,
  );
}