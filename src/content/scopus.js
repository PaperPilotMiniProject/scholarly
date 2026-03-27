/// <reference types="chrome" />

import { getScopusEnabled } from "../utils/storage";
import { getScopusRankingByDoi } from "../utils/csvParser";

const DOI_REGEX = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i;

function delay(ms) {
	return new Promise((res) => setTimeout(res, ms));
}

function clearBadges() {
	document
		.querySelectorAll(
			".scholarly-badge, .scholarly-badge-container",
		)
		.forEach((el) => el.remove());
}

function badgeStyle(color) {
	return `
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		background: ${color};
		color: #fff;
		border-radius: 999px;
		font-weight: 700;
		font-size: 13px;
		box-shadow: 0 2px 4px rgba(0,0,0,0.12);
		line-height: 1.2;
		letter-spacing: 0.1px;
	`;
}

function extractDoiFromText(text) {
	if (!text) return null;
	const match = String(text).match(DOI_REGEX);
	return match ? match[0].replace(/[.,;\])]+$/, "") : null;
}

function findDoiInContainer(container) {
	if (!container) return null;

	const doiAnchor = container.querySelector('a[href*="doi.org/"]');
	if (doiAnchor) {
		const direct = extractDoiFromText(doiAnchor.href) || extractDoiFromText(doiAnchor.textContent);
		if (direct) return direct;
	}

	// Look for text nodes that contain DOI patterns
	const textContent = container.textContent || "";
	const textMatch = extractDoiFromText(textContent);
	if (textMatch) return textMatch;

	return null;
}

function findTitleElement(container) {
	if (!container) return null;
	return (
		container.querySelector("[data-test='result-title']") ||
		container.querySelector(".ddmDocTitle") ||
		container.querySelector("h2 a, h3 a") ||
		container.querySelector("h2, h3") ||
		container.querySelector("a")

	);
}
async function getDoiFromTitle(title) {
  try {
    const res = await fetch(
      `https://api.crossref.org/works?query.title=${encodeURIComponent(title)}&rows=1`
    );
    const data = await res.json();
    return data?.message?.items?.[0]?.DOI || null;
  } catch (e) {
    console.error("Crossref error", e);
    return null;
  }
}
// Collect article cards across both Scopus search pages and author profile pages.
function collectArticles() {
	const articles = [];
	const seenTitles = new Set();

	const sources = [
		// Standard search/table listing
		{ containerSelector: "tr[class*='TableItems-module']", titleSelector: "h3 a span span" },
		// Author profile: document list items often expose the title element directly
		{ containerSelector: "[data-testid='document-title'], a[data-testid='document-title']" },
		// Author profile (results list items)
		{ containerSelector: "[data-testid='results-list-item']", titleSelector: "span[class*='Typography-module']" },
		// Generic fallbacks used across some Scopus views
		{ containerSelector: "[data-test='result-title']" },
		{ containerSelector: "a[href*='/record/display.uri']" },
	];

	const findContainer = (el) =>
		el.closest(
			"tr[class*='TableItems-module'], li, article, .result-item, .listRow, .SearchItem-module, .DocumentItem-module, .ddmDocTitle"
		) || el;

	sources.forEach(({ containerSelector, titleSelector }) => {
		document.querySelectorAll(containerSelector).forEach((node) => {
			const titleEl = titleSelector ? node.querySelector(titleSelector) : node;
			if (!titleEl) return;

			const title = titleEl.textContent?.trim();
			if (!title || seenTitles.has(title)) return;
			seenTitles.add(title);

			const container = findContainer(titleEl);

			articles.push({
				title,
				container,
				titleEl: titleEl.closest("h3") || titleEl,
			});
		});
	});

	console.log("Articles found:", articles.length);

	return articles;
}
async function annotateArticle(article, scopusRanking) {
	if (!scopusRanking || !article.titleEl) return;

	// Avoid duplicating badges on the same result row
	if (article.container.querySelector(".scholarly-badge-container")) return;

	const container = document.createElement("div");
	container.className = "scholarly-badge-container";
	container.style.cssText = `
		margin-top: 8px;
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		align-items: center;
	`;

	const sjr = document.createElement("span");
	sjr.textContent = `${scopusRanking.sjr ?? "-"} SJR`;
	sjr.style.cssText = badgeStyle("#3b5fde");

	const snip = document.createElement("span");
	snip.textContent = `${scopusRanking.snip ?? "-"} SNIP`;
	snip.style.cssText = badgeStyle("#e8751a");

	const cite = document.createElement("span");
	cite.textContent = `${scopusRanking.citeScore ?? "-"} CiteScore`;
	cite.style.cssText = badgeStyle("#0f9d58");

	container.append(sjr, snip, cite);

	// Insert directly under the title block (<h3> in provided HTML structure)
	const titleBlock = article.titleEl.closest("h3") || article.titleEl;
	titleBlock.insertAdjacentElement("afterend", container);
}

async function scrapeScopus(shouldContinue) {
	if (!shouldContinue()) return;

	console.log("[Scholarly][Scopus] Starting scrape...");

	const articles = collectArticles();
console.log(`[Scholarly][Scopus] Found ${articles.length} articles`);

	if (!articles.length) {
		console.info(
			"[Scholarly][Scopus] No DOIs found on this page. Try opening search results or an article list.",
		);
		return;
	}

	for (const [index, article] of articles.entries()) {
		if (!shouldContinue()) break;

		// Be polite to remote APIs; space requests.
		await delay(1000);

		// Prefer an in-page DOI if available; fall back to CrossRef lookup by title
		let doi = findDoiInContainer(article.container);
		if (!doi) {
			doi = await getDoiFromTitle(article.title);
		}

		if (!doi) {
			console.warn(`[Scholarly][Scopus] ✗ No DOI found for title: ${article.title}`);
			continue;
		}

		console.log(`[Scholarly][Scopus] → DOI: ${doi} | Title: ${article.title.slice(0, 120)}`);

		const ranking = await getScopusRankingByDoi(doi);
		if (ranking) {
			console.log(
				`[Scholarly][Scopus] ✓ SJR ${ranking.sjr ?? "-"} (${ranking.sjrYear ?? "-"}) | SNIP ${ranking.snip ?? "-"} (${ranking.snipYear ?? "-"}) | Title ${ranking.title} | ISSN ${(ranking.issns || []).join(", ")}`,
			);
			await annotateArticle(article, ranking);
		} else {
			console.warn(
				`No Scopus ranking for ${doi}`
			);
		}
	}
}

export function init() {
	if (!/\.scopus\.com$/i.test(window.location.hostname)) return;

	console.log(
		`[Scholarly][Scopus] Content script active on ${window.location.pathname}`,
	);

	let runGeneration = 0;
	const nextGeneration = () => {
		runGeneration += 1;
		return runGeneration;
	};

	const maybeScrape = async (enabled) => {
		if (!enabled) {
			console.log("[Scholarly][Scopus] Disabled by toggle; clearing badges");
			clearBadges();
			nextGeneration();
			return;
		}

		const currentGeneration = nextGeneration();
		const shouldContinue = () => currentGeneration === runGeneration;

		let scrapeTimeout;
		const triggerScrape = () => {
			clearTimeout(scrapeTimeout);
			scrapeTimeout = setTimeout(() => {
				if (!shouldContinue()) return;
				scrapeScopus(shouldContinue);
			}, 3000);
		};

		const observer = new MutationObserver(() => {
			console.log("[Scholarly][Scopus] DOM changed, scheduling scrape...");
			triggerScrape();
		});

		observer.observe(document.body, {
			childList: true,
			subtree: true,
		});

		triggerScrape();
	};

	getScopusEnabled()
		.then((enabled) => {
			console.log(`[Scholarly][Scopus] Initial enabled state: ${enabled}`);
			return maybeScrape(enabled);
		})
		.catch((err) => {
			console.error("[Scholarly][Scopus] Failed to read toggle state", err);
			maybeScrape(true);
		});

	if (chrome && chrome.runtime) {
		chrome.runtime.onMessage.addListener((message) => {
			if (message?.type === "TOGGLE_SCOPUS_CHANGED") {
				maybeScrape(Boolean(message.enabled));
			}
		});
	}
}

export { clearBadges as clearScopusBadges };
