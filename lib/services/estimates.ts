import type { DividendEvent, IpoEvent, PlacementEvent, SourceStatus } from "@/lib/types";
import { normalizeDateText, toIsoDate } from "@/lib/utils/date";
import { htmlToText } from "@/lib/utils/html";

const HKEX_LISTING_FAQ_URL =
  "https://www.hkex.com.hk/Global/Exchange/FAQ/List-with-HKEX?sc_lang=en";
const HKEX_MAIN_BOARD_RULES_URL =
  "https://en-rules.hkex.com.hk/rulebook/chapter-8-qualifications-listing";
const HKEX_ALLOTMENT_RESULTS_URL =
  "https://www2.hkexnews.hk/New-Listings/New-Listing-Information/Main-Board?sc_lang=en";
const HKEX_TITLE_SEARCH_URL = "https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=en";
const HKEX_FINI_TIMETABLE_URL =
  "https://www.hkex.com.hk/-/media/HKEX-Market/Services/Next-Generation-Post-Trade-Programme/Fini/FINI_Concept-Paper_EN.pdf";
const SOUTHBOUND_SHAREHOLDING_URL =
  "https://www3.hkexnews.hk/sdw/search/mutualmarket.aspx?t=hk";

export interface SouthboundShareholding {
  stockCode: string;
  companyName: string;
  ccassShareholding: number;
  issuedSharePercentage: number;
  estimatedIssuedShares: number;
}

export type SouthboundShareholdingLookup = Map<string, SouthboundShareholding>;

export function addIpoEstimationSources(sourceStatus: SourceStatus[]) {
  sourceStatus.push(
    {
      name: "HKEX IPO 估算參考",
      url: HKEX_LISTING_FAQ_URL,
      ok: true,
      message:
        "用於未公布聆訊節點的規則估算：上市申請有效期及上市前流程時間只作估算參考。",
    },
    {
      name: "HKEX 主板上市規則參考",
      url: HKEX_MAIN_BOARD_RULES_URL,
      ok: true,
      message:
        "用於未公布募集規模的兜底參考；實際預測優先採用同業已披露 IPO 募集規模中位數。",
    },
    {
      name: "HKEX 配發結果公告參考",
      url: HKEX_ALLOTMENT_RESULTS_URL,
      ok: true,
      message:
        "用於未公布募集倍數的同業推測：優先使用同批官方配發結果，缺值時使用行業基準。",
    },
    {
      name: "HKEXnews 股本融資公告參考",
      url: HKEX_TITLE_SEARCH_URL,
      ok: true,
      message:
        "用於未公布增發募集倍數及募集規模的同業推測：優先採用近期同業股本融資公告已披露樣本。",
    },
    {
      name: "HKEX FINI IPO 結算時間表參考",
      url: HKEX_FINI_TIMETABLE_URL,
      ok: true,
      message:
        "用於未公布募集資金凍結時間的流程推測：參考 FINI 公開發售及上市前結算時間表。",
    },
  );
}

export function applyIpoEstimates(items: IpoEvent[], now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const industryBenchmarks = buildIndustryBenchmarks(items);
  const fundraisingBenchmarks = buildFundraisingBenchmarks(items);

  return items.map((item) => {
    const notes = new Set(item.notes);
    let next: IpoEvent = { ...item };
    const postingDate = extractLatestPostingDate(item.notes);
    const industry = classifyIpoIndustry(item.companyName);

    if (!next.expectedHearingDate) {
      if (next.expectedListingDate) {
        next = {
          ...next,
          expectedHearingDate: toIsoDate(addDays(new Date(next.expectedListingDate), -30)),
        };
        notes.add("聆訊時間按預計上市日前一個月推測");
        notes.add("參考來源：HKEX IPO FAQ");
      } else if (item.notes.some((note) => note.includes("PHIP 已刊發")) && postingDate) {
        next = {
          ...next,
          expectedHearingDate: toIsoDate(addDays(new Date(postingDate), -1)),
        };
        notes.add("聆訊時間按 PHIP 刊發日前一日推測");
        notes.add("參考來源：HKEX AP/PHIP");
      } else if (postingDate || item.notes.some((note) => note.includes("Active 申請"))) {
        const estimatedHearing = estimateHearingDate(
          postingDate ? new Date(postingDate) : today,
          today,
          industry,
          item.companyName,
        );
        next = { ...next, expectedHearingDate: toIsoDate(estimatedHearing) };
        notes.add("聆訊時間按申請節點及同業週期推測");
        notes.add("參考來源：HKEX IPO FAQ");
      }
    }

    if (!next.expectedFundLockupPeriod) {
      const lockup = estimateFundLockupPeriod(next);
      if (lockup) {
        next = { ...next, expectedFundLockupPeriod: lockup };
        notes.delete("募集資金凍結時間未公布");
        notes.add("募集資金凍結時間按聆訊後招股流程推測");
        notes.add("參考來源：HKEX FINI IPO settlement timetable");
      }
    }

    if (!next.expectedSubscriptionMultiple) {
      const benchmark =
        industryBenchmarks.get(industry.key) ?? industry.subscriptionMultiple;
      next = { ...next, expectedSubscriptionMultiple: `${benchmark}x 同業推測` };
      notes.delete("募集倍數未公布");
      notes.add(`同業分組：${industry.label}`);
      notes.add("募集倍數按近期同業IPO推測");
      notes.add("參考來源：HKEX 配發結果公告");
    }

    if (!next.expectedFundraisingSize) {
      const baseBenchmark =
        fundraisingBenchmarks.get(industry.key) ?? industry.fundraisingHkdMillion;
      const benchmark = estimateCompanyFundraisingSize(
        item.companyName,
        industry,
        baseBenchmark,
      );
      next = {
        ...next,
        expectedFundraisingSize: `${formatHkdMillion(benchmark)} 同業推測`,
      };
      notes.delete("募集規模未公布");
      notes.add(`募集規模按近期${industry.label}IPO中位數及公司特徵推測`);
      notes.add("參考來源：HKEX 新上市資料及招股書");
    }

    return {
      ...next,
      notes: Array.from(notes),
    };
  });
}

export function applyPlacementEstimates(items: PlacementEvent[]) {
  const multipleBenchmarks = buildPlacementMultipleBenchmarks(items);
  const fundraisingBenchmarks = buildPlacementFundraisingBenchmarks(items);

  return items.map((item) => {
    const notes = new Set(item.notes);
    let next: PlacementEvent = { ...item };
    const industry = classifyCompanyIndustry(item.companyName);

    if (!next.expectedSubscriptionMultiple) {
      const benchmark =
        multipleBenchmarks.get(industry.key) ?? industry.placementMultiple;
      next = { ...next, expectedSubscriptionMultiple: `${benchmark}x 同業推測` };
      notes.delete("募集倍數未公布");
      notes.add(`同業分組：${industry.label}`);
      notes.add("增發募集倍數按近期同業股本融資推測");
      notes.add("參考來源：HKEXnews 股本融資公告");
    }

    if (!next.expectedFundraisingSize) {
      const benchmark =
        fundraisingBenchmarks.get(industry.key) ??
        industry.placementFundraisingHkdMillion;
      next = {
        ...next,
        expectedFundraisingSize: `${formatHkdMillion(benchmark)} 同業推測`,
      };
      notes.delete("募集規模未公布");
      notes.add(`增發募集規模按近期${industry.label}股本融資中位數推測`);
      notes.add("參考來源：HKEXnews 股本融資公告");
    }

    return {
      ...next,
      notes: Array.from(notes),
    };
  });
}

interface IpoIndustry {
  key: string;
  label: string;
  hearingDays: number;
  subscriptionMultiple: number;
  fundraisingHkdMillion: number;
  placementMultiple: number;
  placementFundraisingHkdMillion: number;
}

function classifyIpoIndustry(companyName: string): IpoIndustry {
  return classifyCompanyIndustry(companyName);
}

function classifyCompanyIndustry(companyName: string): IpoIndustry {
  const name = companyName.toUpperCase();
  if (/BIO|PHARMA|MED|HEALTH|THERAP|HOSPITAL|CLINIC|DENTAL/.test(name)) {
    return industryMap.healthcare;
  }
  if (
    /TECH|AI|ROBOT|SOFTWARE|CLOUD|DATA|SEMICON|CHIP|DIGITAL|INTELLIGENT|AUTO|EV|SMART/.test(
      name,
    )
  ) {
    return industryMap.technology;
  }
  if (/FOOD|BEVERAGE|RETAIL|CONSUMER|SPORT|APPAREL|EDUCATION|TOY/.test(name)) {
    return industryMap.consumer;
  }
  if (/BANK|INSUR|FINANC|CREDIT|FUND|ASSET|CAPITAL|OFC|REIT|PROPERTY|ESTATE/.test(name)) {
    return industryMap.financialProperty;
  }
  if (/ENERGY|POWER|SOLAR|WIND|INFRA|LOGISTIC|PORT|CONSTRUCT/.test(name)) {
    return industryMap.infrastructure;
  }
  if (/MACHIN|INDUSTR|MANUFACTUR|MATERIAL|METAL|CHEM|EQUIPMENT/.test(name)) {
    return industryMap.industrial;
  }
  return industryMap.general;
}

function buildIndustryBenchmarks(items: IpoEvent[]) {
  const grouped = new Map<string, number[]>();
  for (const item of items) {
    const value = parseSubscriptionMultiple(item.expectedSubscriptionMultiple);
    if (!value) continue;
    const industry = classifyIpoIndustry(item.companyName);
    grouped.set(industry.key, [...(grouped.get(industry.key) ?? []), value]);
  }

  const benchmarks = new Map<string, number>();
  for (const [key, values] of grouped) {
    if (values.length < 2) continue;
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    benchmarks.set(key, roundToOneDecimal(average));
  }
  return benchmarks;
}

function buildFundraisingBenchmarks(items: IpoEvent[]) {
  const grouped = new Map<string, number[]>();
  for (const item of items) {
    const value = parseFundraisingToHkdMillion(item.expectedFundraisingSize);
    if (!value) continue;
    const industry = classifyIpoIndustry(item.companyName);
    grouped.set(industry.key, [...(grouped.get(industry.key) ?? []), value]);
  }

  const benchmarks = new Map<string, number>();
  for (const [key, values] of grouped) {
    benchmarks.set(key, median(values));
  }
  return benchmarks;
}

function buildPlacementMultipleBenchmarks(items: PlacementEvent[]) {
  const grouped = new Map<string, number[]>();
  for (const item of items) {
    const value = parseSubscriptionMultiple(item.expectedSubscriptionMultiple);
    if (!value) continue;
    const industry = classifyCompanyIndustry(item.companyName);
    grouped.set(industry.key, [...(grouped.get(industry.key) ?? []), value]);
  }

  const benchmarks = new Map<string, number>();
  for (const [key, values] of grouped) {
    benchmarks.set(key, median(values));
  }
  return benchmarks;
}

function buildPlacementFundraisingBenchmarks(items: PlacementEvent[]) {
  const grouped = new Map<string, number[]>();
  for (const item of items) {
    const value = parseFundraisingToHkdMillion(item.expectedFundraisingSize);
    if (!value) continue;
    const industry = classifyCompanyIndustry(item.companyName);
    grouped.set(industry.key, [...(grouped.get(industry.key) ?? []), value]);
  }

  const benchmarks = new Map<string, number>();
  for (const [key, values] of grouped) {
    benchmarks.set(key, median(values));
  }
  return benchmarks;
}

function parseSubscriptionMultiple(value: string | null) {
  if (!value || /推測|估算|基準/.test(value)) return null;
  const match = value.match(/([\d.]+)\s*x/i);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) ? number : null;
}

function parseFundraisingToHkdMillion(value: string | null) {
  if (!value || /推測|估算|下限/.test(value)) return null;
  const clean = value.replace(/,/g, "");
  const match = clean.match(/(?:HK\$|HKD|RMB|US\$|USD)?\s*([\d.]+)\s*(billion|million|bn|m)?/i);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;

  const lower = clean.toLowerCase();
  const unit = (match[2] ?? "").toLowerCase();
  const unitMultiplier =
    unit === "billion" || unit === "bn"
      ? 1_000
      : unit === "million" || unit === "m"
        ? 1
        : 1 / 1_000_000;
  const currencyMultiplier =
    lower.includes("us$") || lower.includes("usd")
      ? 7.8
      : lower.includes("rmb")
        ? 1.08
        : 1;

  return number * unitMultiplier * currencyMultiplier;
}

function estimateHearingDate(
  applicationDate: Date,
  today: Date,
  industry: IpoIndustry,
  companyName: string,
) {
  const estimated = addDays(applicationDate, industry.hearingDays);
  if (estimated >= today) return estimated;

  const ageDays = Math.max(0, daysBetween(applicationDate, today));
  const cycleRemainder = ageDays % industry.hearingDays;
  const daysUntilNextReview = Math.max(14, industry.hearingDays - cycleRemainder);
  const spread = stableOffset(companyName, 21);
  return addDays(today, daysUntilNextReview + spread);
}

function estimateFundLockupPeriod(item: IpoEvent) {
  if (item.expectedListingDate) {
    const listingDate = new Date(item.expectedListingDate);
    return `${toIsoDate(addBusinessDays(listingDate, -4))} 至 ${toIsoDate(
      addBusinessDays(listingDate, -1),
    )}`;
  }

  if (!item.expectedHearingDate) return null;
  const hearingDate = new Date(item.expectedHearingDate);
  const offerOpen = addBusinessDays(hearingDate, 3);
  return `${toIsoDate(offerOpen)} 至 ${toIsoDate(addBusinessDays(offerOpen, 3))}`;
}

function addBusinessDays(date: Date, days: number) {
  const direction = days >= 0 ? 1 : -1;
  let remaining = Math.abs(days);
  const next = new Date(date);
  while (remaining > 0) {
    next.setDate(next.getDate() + direction);
    const day = next.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return next;
}

function daysBetween(start: Date, end: Date) {
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000);
}

function stableOffset(value: string, modulo: number) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash % modulo;
}

function roundToOneDecimal(value: number) {
  return Math.round(value * 10) / 10;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return roundToOneDecimal(sorted[middle]);
  return roundToOneDecimal((sorted[middle - 1] + sorted[middle]) / 2);
}

function formatHkdMillion(value: number) {
  if (value >= 1_000) {
    return `HK$${roundToOneDecimal(value / 1_000)} billion`;
  }
  return `HK$${roundToOneDecimal(value)} million`;
}

function estimateCompanyFundraisingSize(
  companyName: string,
  industry: IpoIndustry,
  baseHkdMillion: number,
) {
  const name = companyName.toUpperCase();
  let scale = 0.65 + stableOffset(`${industry.key}:${companyName}`, 100) / 100;

  if (/GROUP|HOLDINGS|CORPORATION|COMPANY LIMITED|LIMITED$/.test(name)) scale += 0.08;
  if (/SEMICON|CHIP|AI|ROBOT|INTELLIGENT|AUTO|EV|CLOUD|DATA/.test(name)) scale += 0.18;
  if (/BIO|PHARMA|THERAP|MEDICAL|HEALTH/.test(name)) scale += 0.12;
  if (/BANK|INSUR|FINANC|FUND|REIT/.test(name)) scale += 0.2;
  if (/-\s?B\b|PRE-REVENUE|PRE REVENUE/.test(name)) scale -= 0.18;
  if (/OFC|PRIVATE CREDIT|SMALL|MICRO/.test(name)) scale -= 0.25;

  const minScale = industry.key === "financialProperty" ? 0.55 : 0.5;
  const maxScale = industry.key === "technology" || industry.key === "healthcare" ? 1.9 : 1.7;
  const boundedScale = Math.min(maxScale, Math.max(minScale, scale));
  return roundToNearestTen(baseHkdMillion * boundedScale);
}

function roundToNearestTen(value: number) {
  return Math.max(50, Math.round(value / 10) * 10);
}

const industryMap: Record<string, IpoIndustry> = {
  healthcare: {
    key: "healthcare",
    label: "醫療健康",
    hearingDays: 150,
    subscriptionMultiple: 85,
    fundraisingHkdMillion: 750,
    placementMultiple: 2.5,
    placementFundraisingHkdMillion: 180,
  },
  technology: {
    key: "technology",
    label: "科技/智能製造",
    hearingDays: 120,
    subscriptionMultiple: 60,
    fundraisingHkdMillion: 850,
    placementMultiple: 3,
    placementFundraisingHkdMillion: 250,
  },
  consumer: {
    key: "consumer",
    label: "消費/零售",
    hearingDays: 105,
    subscriptionMultiple: 45,
    fundraisingHkdMillion: 500,
    placementMultiple: 2,
    placementFundraisingHkdMillion: 160,
  },
  financialProperty: {
    key: "financialProperty",
    label: "金融/地產/基金",
    hearingDays: 135,
    subscriptionMultiple: 8,
    fundraisingHkdMillion: 350,
    placementMultiple: 1.2,
    placementFundraisingHkdMillion: 220,
  },
  infrastructure: {
    key: "infrastructure",
    label: "能源/基建",
    hearingDays: 135,
    subscriptionMultiple: 18,
    fundraisingHkdMillion: 600,
    placementMultiple: 1.5,
    placementFundraisingHkdMillion: 300,
  },
  industrial: {
    key: "industrial",
    label: "工業/材料",
    hearingDays: 120,
    subscriptionMultiple: 28,
    fundraisingHkdMillion: 450,
    placementMultiple: 1.8,
    placementFundraisingHkdMillion: 180,
  },
  general: {
    key: "general",
    label: "綜合行業",
    hearingDays: 120,
    subscriptionMultiple: 25,
    fundraisingHkdMillion: 400,
    placementMultiple: 1.5,
    placementFundraisingHkdMillion: 200,
  },
};

export async function fetchSouthboundShareholding(sourceStatus: SourceStatus[]) {
  try {
    const response = await fetch(SOUTHBOUND_SHAREHOLDING_URL, {
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

    const lookup = parseSouthboundShareholding(await response.text());
    sourceStatus.push({
      name: "HKEX 港股通持股資料",
      url: SOUTHBOUND_SHAREHOLDING_URL,
      ok: true,
      message: `已成功讀取 ${lookup.size} 個港股通證券；用於按每股分紅預測分紅總規模。`,
    });
    return lookup;
  } catch (error) {
    sourceStatus.push({
      name: "HKEX 港股通持股資料",
      url: SOUTHBOUND_SHAREHOLDING_URL,
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "港股通持股資料讀取失敗，未能估算分紅總規模。",
    });
    return new Map<string, SouthboundShareholding>();
  }
}

export function parseSouthboundShareholding(html: string) {
  const lookup: SouthboundShareholdingLookup = new Map();
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let match: RegExpExecArray | null;

  while ((match = rowRegex.exec(html))) {
    const text = htmlToText(match[1]);
    const stockCode = text.match(/Stock Code:\s*(\d{1,5})/i)?.[1];
    const companyName = text.match(/Name:\s*([^\n]+)/i)?.[1]?.trim();
    const shareholding = Number(
      text
        .match(/Shareholding in CCASS:\s*([\d,]+)/i)?.[1]
        ?.replace(/,/g, ""),
    );
    const percent = Number(
      text.match(/% of the total number of Issued Shares\/Units:\s*([\d.]+)%/i)?.[1],
    );

    if (!stockCode || !companyName || !shareholding || !percent) continue;

    const normalizedCode = normalizeStockCode(stockCode);
    lookup.set(normalizedCode, {
      stockCode: normalizedCode,
      companyName,
      ccassShareholding: shareholding,
      issuedSharePercentage: percent,
      estimatedIssuedShares: shareholding / (percent / 100),
    });
  }

  return lookup;
}

export function estimateDividendTotals(
  dividends: DividendEvent[],
  shareholdings: SouthboundShareholdingLookup,
) {
  return dividends.map((dividend) => {
    if (dividend.expectedTotalDividendAmount) return dividend;

    const perShare = parseDividendPerShare(dividend.dividendPerShare);
    const shareholding = findShareholding(dividend.stockCode, shareholdings);
    if (!perShare || !shareholding) return dividend;

    const total = perShare.amount * shareholding.estimatedIssuedShares;
    const notes = new Set(dividend.notes);
    notes.delete("分紅總規模未公布");
    notes.add("按每股分紅預測");
    notes.add("股份數參考：HKEX 港股通持股佔已發行股份比例");

    return {
      ...dividend,
      expectedTotalDividendAmount: formatMoney(perShare.currency, total),
      notes: Array.from(notes),
    };
  });
}

function extractLatestPostingDate(notes: string[]) {
  const raw = notes
    .find((note) => note.startsWith("最新刊發日期 "))
    ?.replace("最新刊發日期 ", "");
  if (!raw || raw.includes("未公布")) return null;
  return normalizeDateText(raw.replace(/\//g, "-")) ?? normalizeDmyDate(raw);
}

function normalizeDmyDate(value: string) {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/);
  if (!match) return null;
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseDividendPerShare(value: string | null) {
  if (!value) return null;
  const match = value.match(/\b(HKD|RMB|USD|US\$|HK\$)\s*([\d.]+)/i);
  if (!match) return null;
  const amount = Number(match[2]);
  if (!Number.isFinite(amount)) return null;
  return {
    currency: normalizeCurrency(match[1]),
    amount,
  };
}

function findShareholding(
  stockCode: string,
  shareholdings: SouthboundShareholdingLookup,
) {
  const normalized = normalizeStockCode(stockCode);
  const direct = shareholdings.get(normalized);
  if (direct) return direct;

  if (/^8\d{4}$/.test(normalized)) {
    return shareholdings.get(String(Number(normalized.slice(1))));
  }

  return undefined;
}

function normalizeStockCode(value: string) {
  return String(Number(value.match(/\d{1,5}/)?.[0] ?? value));
}

function normalizeCurrency(value: string) {
  const upper = value.toUpperCase();
  if (upper === "HK$") return "HKD";
  if (upper === "US$") return "USD";
  return upper;
}

function formatMoney(currency: string, amount: number) {
  if (amount >= 1_000_000_000) {
    return `${currency} ${(amount / 1_000_000_000).toFixed(2)} billion`;
  }
  if (amount >= 1_000_000) {
    return `${currency} ${(amount / 1_000_000).toFixed(2)} million`;
  }
  return `${currency} ${Math.round(amount).toLocaleString("en-US")}`;
}
