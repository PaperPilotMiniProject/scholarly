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

function buildRankingCard(scopusRanking) {
	const card = document.createElement("div");
	card.className = "scholarly-ranking-card";
	card.style.cssText = `
		margin-top: 8px;
		padding: 10px 12px;
		border: 1px solid #d0d7de;
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 6px 18px rgba(0,0,0,0.12);
		font-size: 12px;
		line-height: 1.45;
		min-width: 280px;
	`;

	const rows = [
		["Journal", scopusRanking.title || "-"],
		["Publisher", scopusRanking.publisher || "-"],
		["ISSN", (scopusRanking.issns || []).join(", ") || "-"],
		[
			"SJR",
			scopusRanking.sjr
				? `${Number(scopusRanking.sjr).toFixed(3)} (${scopusRanking.sjrYear || "-"})`
				: "-",
		],
		["Quartile", scopusRanking.sjrBestQuartile || "-"],
		[
			"SNIP",
			scopusRanking.snip
				? `${Number(scopusRanking.snip).toFixed(3)} (${scopusRanking.snipYear || "-"})`
				: "-",
		],
		[
			"CiteScore",
			scopusRanking.citeScore
				? `${Number(scopusRanking.citeScore).toFixed(2)} (${scopusRanking.citeScoreYear || "-"})`
				: "-",
		],
		[
			"Open Access",
			String(scopusRanking.openAccess ?? scopusRanking.openaccess ?? "0") === "1"
				? "Yes"
				: "No",
		],
	];

	rows.forEach(([label, value]) => {
		const row = document.createElement("div");
		row.style.cssText = "display:flex;justify-content:space-between;gap:10px;margin-bottom:6px;";

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
		const params = new URLSearchParams({
			"query.bibliographic": title,
			rows: "5",
			select: "DOI,title,score",
			mailto: "scholarly-extension@example.com",
		});
		const res = await fetch(
			`https://api.crossref.org/works?${params.toString()}`
		);
    const data = await res.json();
		const items = data?.message?.items || [];
		if (!items.length) return null;

		const normalize = (s) =>
			String(s || "")
				.toLowerCase()
				.replace(/[^a-z0-9\s]/g, " ")
				.replace(/\s+/g, " ")
				.trim();

		const titleNorm = normalize(title);
		const scored = items
			.map((item) => {
				const candidateTitle = Array.isArray(item?.title)
					? item.title[0] || ""
					: item?.title || "";
				const candidateNorm = normalize(candidateTitle);
				let score = Number(item?.score || 0);
				if (candidateNorm && titleNorm) {
					if (candidateNorm === titleNorm) score += 120;
					else if (candidateNorm.includes(titleNorm) || titleNorm.includes(candidateNorm)) score += 60;
				}
				return { doi: item?.DOI || null, score };
			})
			.filter((x) => x.doi)
			.sort((a, b) => b.score - a.score);

		return scored[0]?.doi || null;
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

	const isOpenAccess =
		String(scopusRanking.openAccess ?? scopusRanking.openaccess ?? "0") === "1";
	const oa = document.createElement("span");
	oa.textContent = isOpenAccess ? "Open Access: Yes" : "Open Access: No";
	oa.style.cssText = badgeStyle(isOpenAccess ? "#2e7d32" : "#6c757d");

	const cardToggle = document.createElement("button");
	cardToggle.type = "button";
	cardToggle.textContent = "Ranking card";
	cardToggle.className = "scholarly-badge";
	cardToggle.style.cssText =
		"display:inline-flex;align-items:center;padding:6px 12px;background:#ffffff;color:#0b7a75;border:1px solid #0b7a75;" +
		"border-radius:999px;font-weight:700;font-size:12px;cursor:pointer;";

	let cardEl = null;
	cardToggle.addEventListener("click", (evt) => {
		evt.preventDefault();
		evt.stopPropagation();
		if (cardEl && cardEl.isConnected) {
			cardEl.remove();
			cardEl = null;
			return;
		}
		cardEl = buildRankingCard(scopusRanking);
		container.appendChild(cardEl);
	});

	container.append(cardToggle, oa, sjr, snip, cite);

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
		const directDoi = findDoiInContainer(article.container);
		let doi = directDoi;
		if (!doi) {
			doi = await getDoiFromTitle(article.title);
		}

		if (!doi) {
			console.warn(`[Scholarly][Scopus] ✗ No DOI found for title: ${article.title}`);
			continue;
		}

		// If fallback DOI is reused for many titles, skip to avoid wrong repeated journal ranking.
		if (!directDoi) {
			const duplicateDoiCount = articles.filter((a) => {
				const txt = a?.container?.textContent || "";
				return txt.includes(doi);
			}).length;
			if (duplicateDoiCount > 1) {
				console.warn(
					`[Scholarly][Scopus] Skipping ambiguous DOI fallback ${doi} for title: ${article.title}`,
				);
				continue;
			}
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
