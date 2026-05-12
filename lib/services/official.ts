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
} from "./estimates";

const IPO_URL =
  "https://www2.hkexnews.hk/New-Listings/New-Listing-Information/Main-Board?sc_lang=en";
const IPO_GEM_URL =
  "https://www2.hkexnews.hk/New-Listings/New-Listing-Information/GEM?sc_lang=en";
const DIVIDEND_URL = "https://www3.hkexnews.hk/reports/doe/eent.htm";
const DIVIDEND_GEM_URL = "https://www3.hkexnews.hk/reports/doe/eentgem.htm";
const TITLE_SEARCH_URL = "https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=en";
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
  const dividends = dedupeDividendCounters(
    estimateDividendTotals(
      filterMainlandBusinessDividends(allDividends, securities),
      southboundShareholding,
    ),
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
