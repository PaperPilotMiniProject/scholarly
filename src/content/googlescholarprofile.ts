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

export function clearProfileBadges(): void {
  document.querySelectorAll(".scholarly-badge").forEach((el) => el.remove());
  document
    .querySelectorAll(".scholarly-badge-anchor")
    .forEach((el) => el.remove());
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

      console.log(
        `[Scholarly][Profile] Article [${index}] DOI: ${doi || "No DOI found"} | ${title.substring(0, 60)}`,
      );
    } catch (error) {
      console.error(`[Scholarly][Profile] Error parsing row ${index}:`, error);
    }
  });

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
    sjrBadge.textContent = `SJR ${Number(scopusRanking.sjr || 0).toFixed(3)} (${scopusRanking.sjrYear || "-"})`;
    article.badgeContainer.appendChild(sjrBadge);

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
