import type {
  DashboardResponse,
  DividendEvent,
  IpoEvent,
  PlacementEvent,
  SourceStatus,
} from "@/lib/types";
import { getFutureWindow, isWithinWindow, toIsoDate } from "@/lib/utils/date";
import { extractLinks } from "@/lib/utils/html";
import {
  enrichIpoFromText,
  enrichPlacementFromText,
  parseApplicationProofJson,
  parseDividendEvents,
  parseIpoRows,
  parsePlacementEntitlements,
  parsePlacementAnnouncements,
  parseProgressReportSummary,
} from "./parsers";
import { extractPdfTextFromUrl } from "./pdf";
import {
  fetchSecuritiesList,
  filterMainlandBusinessDividends,
} from "./securities";
import {
  addIpoEstimationSources,
  applyIpoEstimates,
  applyPlacementEstimates,
  estimateDividendTotals,
  fetchSouthboundShareholding,
  type IssuedSharesEstimate,
  type SouthboundShareholdingLookup,
} from "./estimates";

const IPO_URL =
  "https://www2.hkexnews.hk/New-Listings/New-Listing-Information/Main-Board?sc_lang=en";
const IPO_GEM_URL =
  "https://www2.hkexnews.hk/New-Listings/New-Listing-Information/GEM?sc_lang=en";
const DIVIDEND_URL = "https://www3.hkexnews.hk/reports/doe/eent.htm";
const DIVIDEND_GEM_URL = "https://www3.hkexnews.hk/reports/doe/eentgem.htm";
const TITLE_SEARCH_URL = "https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=en";
const STOCK_PREFIX_URL = "https://www1.hkexnews.hk/search/prefix.do";
const ACTIVE_STOCK_JSON_URL =
  "https://www1.hkexnews.hk/ncms/script/eds/activestock_sehk_e.json";
const AP_JSON_BASE = "https://www1.hkexnews.hk/ncms/json/eds/";
const AP_ACTIVE_MAIN_URL = `${AP_JSON_BASE}appactive_app_sehk_e.json`;
const AP_ACTIVE_PHIP_MAIN_URL = `${AP_JSON_BASE}appactive_appphip_sehk_e.json`;
const AP_ACTIVE_GEM_URL = `${AP_JSON_BASE}appactive_app_gem_e.json`;
const AP_ACTIVE_PHIP_GEM_URL = `${AP_JSON_BASE}appactive_appphip_gem_e.json`;
const PROGRESS_MAIN_URL =
  "https://www2.hkexnews.hk/New-Listings/Progress-Report-for-New-Listing-Applications/Main-Board?sc_lang=en";
const PROGRESS_GEM_URL =
  "https://www2.hkexnews.hk/New-Listings/Progress-Report-for-New-Listing-Applications/GEM?sc_lang=en";
const HKMA_API_CATALOGUE =
  "https://api.hkma.gov.hk/public/market-data-and-statistics/monthly-statistical-bulletin";

const CACHE_TTL_MS = 5 * 60 * 1000;

let dashboardCache:
  | {
      expiresAt: number;
      data: DashboardResponse;
    }
  | undefined;

export async function getDashboardData(forceRefresh = false) {
  if (!forceRefresh && dashboardCache && dashboardCache.expiresAt > Date.now()) {
    return dashboardCache.data;
  }

  const { start, end } = getFutureWindow();
  const sourceStatus: SourceStatus[] = [];

  const [
    ipoHtml,
    ipoGemHtml,
    apActiveMain,
    apActivePhipMain,
    apActiveGem,
    apActivePhipGem,
    progressMainHtml,
    progressGemHtml,
    dividendHtml,
    dividendGemHtml,
    placementHtml,
    securities,
    southboundShareholding,
  ] = await Promise.all([
    fetchSource(IPO_URL, "HKEXnews 新上市資料", sourceStatus),
    fetchSource(IPO_GEM_URL, "HKEXnews GEM 新上市資料", sourceStatus),
    fetchJsonSource(AP_ACTIVE_MAIN_URL, "HKEXnews 主板 Application Proof Active", sourceStatus),
    fetchJsonSource(
      AP_ACTIVE_PHIP_MAIN_URL,
      "HKEXnews 主板 PHIP Active",
      sourceStatus,
    ),
    fetchJsonSource(AP_ACTIVE_GEM_URL, "HKEXnews GEM Application Proof Active", sourceStatus),
    fetchJsonSource(AP_ACTIVE_PHIP_GEM_URL, "HKEXnews GEM PHIP Active", sourceStatus),
    fetchSource(PROGRESS_MAIN_URL, "HKEX 主板上市申請進展報告", sourceStatus),
    fetchSource(PROGRESS_GEM_URL, "HKEX GEM 上市申請進展報告", sourceStatus),
    fetchSource(DIVIDEND_URL, "HKEXnews 分紅及其他權益", sourceStatus),
    fetchSource(DIVIDEND_GEM_URL, "HKEXnews GEM 分紅及其他權益", sourceStatus),
    fetchSource(TITLE_SEARCH_URL, "HKEXnews 公告搜尋", sourceStatus),
    fetchSecuritiesList(sourceStatus),
    fetchSouthboundShareholding(sourceStatus),
  ]);

  sourceStatus.push({
    name: "香港金管局公開 API",
    url: HKMA_API_CATALOGUE,
    ok: true,
    message: "已保留為官方來源；未發現可直接補足港股股本事項的結構化接口。",
  });
  addIpoEstimationSources(sourceStatus);

  if (progressMainHtml) {
    sourceStatus.push({
      name: "HKEX 主板上市申請進展摘要",
      url: PROGRESS_MAIN_URL,
      ok: true,
      message: parseProgressReportSummary(progressMainHtml, "主板"),
    });
  }

  if (progressGemHtml) {
    sourceStatus.push({
      name: "HKEX GEM 上市申請進展摘要",
      url: PROGRESS_GEM_URL,
      ok: true,
      message: parseProgressReportSummary(progressGemHtml, "GEM"),
    });
  }

  const confirmedIpo = [
    ...(ipoHtml
      ? await enrichIpoEvents(parseIpoRows(ipoHtml, IPO_URL), start, end)
      : []),
    ...(ipoGemHtml
      ? await enrichIpoEvents(parseIpoRows(ipoGemHtml, IPO_GEM_URL), start, end)
      : []),
  ];

  const pipelineIpo = [
    ...(apActiveMain
      ? parseApplicationProofJson(apActiveMain, AP_ACTIVE_MAIN_URL, "主板")
      : []),
    ...(apActivePhipMain
      ? parseApplicationProofJson(apActivePhipMain, AP_ACTIVE_PHIP_MAIN_URL, "主板")
      : []),
    ...(apActiveGem
      ? parseApplicationProofJson(apActiveGem, AP_ACTIVE_GEM_URL, "GEM")
      : []),
    ...(apActivePhipGem
      ? parseApplicationProofJson(apActivePhipGem, AP_ACTIVE_PHIP_GEM_URL, "GEM")
      : []),
  ];

  const ipo = applyIpoEstimates(dedupeIpo([...confirmedIpo, ...pipelineIpo]));

  const allDividends = [
    ...(dividendHtml
      ? parseDividendEvents(dividendHtml, DIVIDEND_URL, start, end)
      : []),
    ...(dividendGemHtml
      ? parseDividendEvents(dividendGemHtml, DIVIDEND_GEM_URL, start, end)
      : []),
  ];
  const mainlandDividends = filterMainlandBusinessDividends(
    allDividends,
    securities,
  );
  const dividends = await enrichDividendTotalsFromOfficialSources(
    mainlandDividends,
    sourceStatus,
    southboundShareholding,
  );

  const entitlementPlacements = [
    ...(dividendHtml
      ? parsePlacementEntitlements(dividendHtml, DIVIDEND_URL, start, end)
      : []),
    ...(dividendGemHtml
      ? parsePlacementEntitlements(dividendGemHtml, DIVIDEND_GEM_URL, start, end)
      : []),
  ];

  const searchPlacements = placementHtml
    ? await enrichPlacementEvents(
        parsePlacementAnnouncements(placementHtml, TITLE_SEARCH_URL, start, end),
        start,
        end,
      )
    : [];

  const placements = applyPlacementEstimates(
    dedupePlacements([...entitlementPlacements, ...searchPlacements]),
  );

  const data: DashboardResponse = {
    generatedAt: new Date().toISOString(),
    rangeStart: toIsoDate(start),
    rangeEnd: toIsoDate(end),
    sourceStatus,
    ipo: ipo.filter((item) => isWithinWindow(item.expectedListingDate, start, end)),
    placements: placements.filter((item) =>
      isWithinWindow(item.expectedNewSharesListingDate, start, end),
    ),
    dividends,
  };

  dashboardCache = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    data,
  };

  return data;
}

export async function enrichDividendTotalsFromOfficialSources(
  dividends: DividendEvent[],
  sourceStatus: SourceStatus[],
  southboundShareholding?: SouthboundShareholdingLookup,
) {
  const shareholding =
    southboundShareholding ?? (await fetchSouthboundShareholding(sourceStatus));
  const dividendsWithSouthboundTotals = estimateDividendTotals(
    dividends,
    shareholding,
  );
  const issuedSharesResult = await fetchIssuedSharesForDividends(
    dividendsWithSouthboundTotals,
    sourceStatus,
  );
  const dividendsWithDisclosureNotes = addIssuedSharesDiagnostics(
    dividendsWithSouthboundTotals,
    issuedSharesResult.diagnostics,
  );
  return dedupeDividendCounters(
    estimateDividendTotals(
      dividendsWithDisclosureNotes,
      shareholding,
      issuedSharesResult.lookup,
    ),
  );
}

async function fetchSource(
  url: string,
  name: string,
  sourceStatus: SourceStatus[],
) {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; HKEX Corporate Actions Dashboard)",
        accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    sourceStatus.push({ name, url, ok: true, message: "已成功讀取官方頁面。" });
    return await response.text();
  } catch (error) {
    sourceStatus.push({
      name,
      url,
      ok: false,
      message: error instanceof Error ? error.message : "讀取失敗",
    });
    return null;
  }
}

async function fetchJsonSource(
  url: string,
  name: string,
  sourceStatus: SourceStatus[],
) {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; HKEX Corporate Actions Dashboard)",
        accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    sourceStatus.push({ name, url, ok: true, message: "已成功讀取官方 JSON。" });
    return await response.json();
  } catch (error) {
    sourceStatus.push({
      name,
      url,
      ok: false,
      message: error instanceof Error ? error.message : "讀取失敗",
    });
    return null;
  }
}

async function enrichIpoEvents(items: IpoEvent[], start: Date, end: Date) {
  const limited = items.slice(0, 18);
  const enriched: IpoEvent[] = [];

  for (const item of limited) {
    const candidatePdfUrls = await getPdfCandidates(item.sourceUrl);
    let current = item;
    for (const url of candidatePdfUrls.slice(0, 2)) {
      try {
        const text = await extractPdfTextFromUrl(url, 80);
        current = enrichIpoFromText({ ...current, sourceUrl: url }, text);
      } catch {
        current = {
          ...current,
          notes: Array.from(new Set([...current.notes, "PDF 文字未能抽取"])),
        };
      }
    }
    if (isWithinWindow(current.expectedListingDate, start, end)) {
      enriched.push(current);
    }
  }

  return enriched;
}

async function enrichPlacementEvents(
  items: PlacementEvent[],
  start: Date,
  end: Date,
) {
  const enriched: PlacementEvent[] = [];

  for (const item of items.slice(0, 12)) {
    let current = item;
    if (item.sourceUrl.toLowerCase().endsWith(".pdf")) {
      try {
        const text = await extractPdfTextFromUrl(item.sourceUrl, 10);
        current = enrichPlacementFromText(item, text);
      } catch {
        current = {
          ...current,
          notes: Array.from(new Set([...current.notes, "PDF 文字未能抽取"])),
        };
      }
    }
    if (isWithinWindow(current.expectedNewSharesListingDate, start, end)) {
      enriched.push(current);
    }
  }

  return enriched;
}

async function getPdfCandidates(seedUrl: string) {
  if (seedUrl.toLowerCase().endsWith(".pdf")) return [seedUrl];
  try {
    const html = await fetch(seedUrl, {
      headers: { "user-agent": "Mozilla/5.0" },
      cache: "no-store",
    }).then((response) => response.text());
    return extractLinks(html, seedUrl)
      .map((link) => link.href)
      .filter((href) => href.toLowerCase().endsWith(".pdf"));
  } catch {
    return [];
  }
}

async function fetchIssuedSharesForDividends(
  dividends: DividendEvent[],
  sourceStatus: SourceStatus[],
) {
  const lookup = new Map<string, IssuedSharesEstimate>();
  const diagnostics = new Map<string, string>();
  const missing = Array.from(
    new Map(
      dividends
        .filter((item) => !item.expectedTotalDividendAmount && item.dividendPerShare)
        .map((item) => [normalizeDisclosureStockCode(item.stockCode), item]),
    ).values(),
  );

  let checked = 0;
  for (const dividend of missing) {
    const stockCode = normalizeDisclosureStockCode(dividend.stockCode);
    const result = await getIssuedSharesDocumentCandidates(stockCode);
    checked += 1;

    if (!result.stockId) {
      diagnostics.set(stockCode, "股本公告查詢：未能在HKEXnews匹配股票代號");
      continue;
    }

    if (result.candidates.length === 0) {
      diagnostics.set(
        stockCode,
        "股本公告查詢：未找到月報、翌日披露、分紅公告、年報或中報PDF",
      );
      continue;
    }

    let hadPdfTextFailure = false;
    for (const candidate of result.candidates.slice(0, 8)) {
      try {
        const text = await extractPdfTextFromUrl(candidate.href, candidate.firstPages);
        const issuedShares = parseIssuedSharesFromDisclosureText(text, candidate.source);
        if (!issuedShares) continue;

        lookup.set(stockCode, {
          stockCode,
          issuedShares,
          source: candidate.source,
          sourceUrl: candidate.href,
        });
        diagnostics.delete(stockCode);
        break;
      } catch {
        hadPdfTextFailure = true;
      }
    }

    if (!lookup.has(stockCode)) {
      diagnostics.set(
        stockCode,
        hadPdfTextFailure
          ? "股本公告查詢：PDF文字未能抽取"
          : "股本公告查詢：未能從月報、翌日披露、分紅公告、年報或中報抽取已發行股數",
      );
    }
  }

  const reasonCounts = Array.from(diagnostics.values()).reduce(
    (counts, reason) => counts.set(reason, (counts.get(reason) ?? 0) + 1),
    new Map<string, number>(),
  );
  const reasonSummary = Array.from(reasonCounts)
    .map(([reason, count]) => reason + " " + count + " 項")
    .join("；");

  sourceStatus.push({
    name: "HKEXnews 股本補充資料",
    url: TITLE_SEARCH_URL,
    ok: true,
    message:
      "已為 " +
      checked +
      " 項缺少分紅總規模的分紅檢查股本資料；補足 " +
      lookup.size +
      " 項已發行股數" +
      (reasonSummary ? "；" + reasonSummary : "。"),
  });

  return { lookup, diagnostics };
}

async function getIssuedSharesDocumentCandidates(stockCode: string) {
  const stockId = await fetchHkexStockId(stockCode);
  if (!stockId) return { stockId: null, candidates: [] };

  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setFullYear(fromDate.getFullYear() - 2);
  const params = new URLSearchParams({
    lang: "en",
    market: "SEHK",
    stockId,
    documentType: "-1",
    category: "0",
    sortByOptions: "DateTime",
    sortDir: "0",
    fromDate: formatSearchDate(fromDate),
    toDate: formatSearchDate(today),
  });
  const searchUrl = "https://www1.hkexnews.hk/search/titlesearch.xhtml?" + params.toString();

  try {
    const html = await fetch(searchUrl, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; HKEX Corporate Actions Dashboard)",
        accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
    }).then((response) => (response.ok ? response.text() : ""));

    const candidates = extractLinks(html, searchUrl)
      .map((link) => classifyIssuedSharesCandidate(link))
      .filter((item): item is IssuedSharesDocumentCandidate => Boolean(item))
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 16);

    return { stockId, candidates };
  } catch {
    return { stockId, candidates: [] };
  }
}

type IssuedSharesDocumentCandidate = Pick<IssuedSharesEstimate, "source"> & {
  href: string;
  priority: number;
  firstPages: number;
};

function classifyIssuedSharesCandidate(link: { href: string; label: string; context: string }) {
  if (!link.href.toLowerCase().endsWith(".pdf")) return null;

  const title = link.label + " " + link.context;
  if (/next day disclosure/i.test(title)) {
    return makeIssuedSharesCandidate(link.href, "next_day_disclosure", 1, 8);
  }
  if (/monthly return|return of equity issuer|movements in securities/i.test(title)) {
    return makeIssuedSharesCandidate(link.href, "monthly_return", 2, 8);
  }
  if (/dividend|distribution|closure of register|book closure|payment date|record date/i.test(title)) {
    return makeIssuedSharesCandidate(link.href, "dividend_announcement", 3, 12);
  }
  if (/interim report|half-year report|half year report/i.test(title)) {
    return makeIssuedSharesCandidate(link.href, "interim_report", 4, 24);
  }
  if (/annual report|financial statements/i.test(title)) {
    return makeIssuedSharesCandidate(link.href, "annual_report", 5, 32);
  }

  return null;
}

function makeIssuedSharesCandidate(
  href: string,
  source: IssuedSharesEstimate["source"],
  priority: number,
  firstPages: number,
): IssuedSharesDocumentCandidate {
  return { href, source, priority, firstPages };
}

function addIssuedSharesDiagnostics(
  dividends: DividendEvent[],
  diagnostics: Map<string, string>,
) {
  if (diagnostics.size === 0) return dividends;

  return dividends.map((dividend) => {
    if (dividend.expectedTotalDividendAmount || !dividend.dividendPerShare) {
      return dividend;
    }

    const reason = diagnostics.get(normalizeDisclosureStockCode(dividend.stockCode));
    if (!reason) return dividend;

    return {
      ...dividend,
      notes: Array.from(new Set([...dividend.notes, reason])),
    };
  });
}

async function fetchHkexStockId(stockCode: string) {
  const params = new URLSearchParams({
    callback: "callback",
    lang: "EN",
    market: "SEHK",
    type: "A",
    name: stockCode.padStart(5, "0"),
  });

  try {
    const text = await fetch(STOCK_PREFIX_URL + "?" + params.toString(), {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; HKEX Corporate Actions Dashboard)",
        accept: "application/javascript,text/plain,*/*",
      },
      cache: "no-store",
    }).then((response) => (response.ok ? response.text() : ""));
    return (
      parseStockIdFromPrefixResponse(text, stockCode) ??
      (await fetchActiveStockId(stockCode))
    );
  } catch {
    return fetchActiveStockId(stockCode);
  }
}

let activeStockIdLookupPromise: Promise<Map<string, string>> | null = null;

async function fetchActiveStockId(stockCode: string) {
  const lookup = await getActiveStockIdLookup();
  return lookup.get(stockCode.padStart(5, "0")) ?? null;
}

async function getActiveStockIdLookup() {
  activeStockIdLookupPromise ??= fetch(ACTIVE_STOCK_JSON_URL, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; HKEX Corporate Actions Dashboard)",
      accept: "application/json,*/*",
    },
    cache: "no-store",
  })
    .then((response) => (response.ok ? response.json() : []))
    .then((rows: Array<{ i?: number | string; c?: string }>) => {
      const lookup = new Map<string, string>();
      for (const row of rows) {
        if (row.i === undefined || !row.c) continue;
        lookup.set(row.c, String(row.i));
      }
      return lookup;
    })
    .catch(() => new Map<string, string>());

  return activeStockIdLookupPromise;
}

function parseStockIdFromPrefixResponse(text: string, stockCode: string) {
  const normalizedCode = stockCode.padStart(5, "0");
  const objectMatches = text.match(/\{[^{}]*(?:stockId|id|code)[^{}]*\}/gi) ?? [];

  for (const objectText of objectMatches) {
    if (!objectText.includes(normalizedCode) && !objectText.includes(String(Number(stockCode)))) {
      continue;
    }
    const stockId =
      objectText.match(/"stockId"\s*:\s*"?([^",}]+)"?/i)?.[1] ??
      objectText.match(/"id"\s*:\s*"?([^",}]+)"?/i)?.[1];
    if (stockId) return stockId;
  }

  const loose = text.match(/"stockId"\s*:\s*"?([^",}]+)"?/i)?.[1];
  return loose ?? null;
}

function parseIssuedSharesFromDisclosureText(
  text: string,
  source: IssuedSharesEstimate["source"],
) {
  const normalized = text.replace(/\s+/g, " ");
  const preferredPatterns = [
    /Balance at close of (?:the )?month[^\d]{0,220}([\d,]{7,})/i,
    /Total number of issued shares[^\d]{0,260}([\d,]{7,})/i,
    /Number of issued shares[^\d]{0,260}([\d,]{7,})/i,
    /Immediately after[^\d]{0,260}([\d,]{7,})/i,
    /Shares in issue[^\d]{0,260}([\d,]{7,})/i,
    /Issued share capital[^\d]{0,260}([\d,]{7,})/i,
  ];

  for (const pattern of preferredPatterns) {
    const value = parseShareCount(pattern.exec(normalized)?.[1]);
    if (value) return value;
  }

  if (source === "annual_report" || source === "interim_report") {
    const reportValue = parseIssuedSharesFromReportText(normalized);
    if (reportValue) return reportValue;
  }

  const relevantBlocks = normalized.match(
    /(?:issued shares|shares in issue|share capital|balance at close|monthly return|next day disclosure)[\s\S]{0,1000}/gi,
  ) ?? [];
  const candidates = relevantBlocks
    .flatMap((block) => [...block.matchAll(/\b([\d,]{7,})\b/g)])
    .map((match) => parseShareCount(match[1]))
    .filter((value): value is number => Boolean(value));

  return candidates.sort((a, b) => b - a)[0] ?? null;
}

function parseIssuedSharesFromReportText(text: string) {
  const reportPatterns = [
    /issued and fully paid[\s\S]{0,500}?([\d,]{7,})\s+(?:ordinary\s+)?shares/i,
    /([\d,]{7,})\s+(?:ordinary\s+)?shares[\s\S]{0,120}?(?:in issue|issued and fully paid)/i,
    /share capital[\s\S]{0,1000}?([\d,]{7,})\s+(?:ordinary\s+)?shares/i,
    /total issued shares[\s\S]{0,300}?([\d,]{7,})/i,
  ];

  for (const pattern of reportPatterns) {
    const value = parseShareCount(pattern.exec(text)?.[1]);
    if (value) return value;
  }

  return null;
}

function parseShareCount(value: string | undefined) {
  if (!value) return null;
  const count = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(count) || count < 1_000_000 || count > 10_000_000_000_000) {
    return null;
  }
  return count;
}

function normalizeDisclosureStockCode(value: string) {
  const normalized = String(Number(value.match(/\d{1,5}/)?.[0] ?? value));
  if (/^8\d{4}$/.test(normalized)) return String(Number(normalized.slice(1)));
  return normalized;
}

function formatSearchDate(date: Date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return day + "/" + month + "/" + date.getFullYear();
}

function dedupeDividendCounters(items: DividendEvent[]) {
  const byKey = new Map<string, DividendEvent>();

  for (const item of items) {
    const key = [
      normalizeDividendCounterCode(item.stockCode),
      item.expectedDividendDate ?? "na",
      normalizeDividendPerShareKey(item.dividendPerShare),
    ].join("|");
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, item);
      continue;
    }

    const preferred = preferPrimaryDividendCounter(existing, item);
    byKey.set(key, {
      ...preferred,
      expectedTotalDividendAmount:
        preferred.expectedTotalDividendAmount ||
        existing.expectedTotalDividendAmount ||
        item.expectedTotalDividendAmount,
      notes: Array.from(
        new Set([
          ...preferred.notes,
          "已合併人民幣櫃台重複項",
        ]),
      ),
    });
  }

  return Array.from(byKey.values());
}

function preferPrimaryDividendCounter(a: DividendEvent, b: DividendEvent) {
  const score = (item: DividendEvent) =>
    (isRmbCounter(item) ? 0 : 10) + (item.expectedTotalDividendAmount ? 1 : 0);
  return score(b) > score(a) ? b : a;
}

function isRmbCounter(item: DividendEvent) {
  return /^8\d{4}$/.test(item.stockCode) || /-R$/i.test(item.companyName) || /-WR$/i.test(item.companyName);
}

function normalizeDividendCounterCode(stockCode: string) {
  if (/^8\d{4}$/.test(stockCode)) return String(Number(stockCode.slice(1)));
  return String(Number(stockCode.match(/\d{1,5}/)?.[0] ?? stockCode));
}

function normalizeDividendPerShareKey(value: string | null) {
  return (value ?? "na").toUpperCase().replace(/\s+/g, "");
}

function dedupePlacements(items: PlacementEvent[]) {
  const byKey = new Map<string, PlacementEvent>();
  for (const item of items) {
    const key = `${item.stockCode}-${item.expectedNewSharesListingDate ?? "na"}-${item.sourceUrl}`;
    if (!byKey.has(key)) {
      byKey.set(key, item);
    }
  }
  return Array.from(byKey.values());
}

function dedupeIpo(items: IpoEvent[]) {
  const byKey = new Map<string, IpoEvent>();
  for (const item of items) {
    const stockOrName = item.stockCode !== "未編配" ? item.stockCode : item.companyName;
    const key = stockOrName.toLowerCase().replace(/\s+/g, " ").trim();
    const existing = byKey.get(key);
    if (!existing || existing.expectedListingDate === null) {
      byKey.set(key, item);
    }
  }
  return Array.from(byKey.values());
}
