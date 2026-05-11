import type { DividendEvent, IpoEvent, PlacementEvent } from "@/lib/types";
import { absoluteUrl, extractLinks, htmlToText } from "@/lib/utils/html";
import { isWithinWindow, pickDateNear, toIsoDate } from "@/lib/utils/date";

const datePattern =
  "((?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\\s*)?(?:\\d{1,2}\\s+[A-Za-z]{3,9}|[A-Za-z]{3,9}\\s+\\d{1,2},?)\\s+20\\d{2}|20\\d{2}[-/.]\\d{1,2}[-/.]\\d{1,2})";

export function parseIpoRows(html: string, sourceUrl: string): IpoEvent[] {
  const rows: IpoEvent[] = [];
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(html))) {
    const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cells.length < 2) continue;

    const stockCode = htmlToText(cells[0][1]).match(/\d{4,5}/)?.[0];
    const companyName = htmlToText(cells[1][1]).replace(/\s+/g, " ").trim();
    if (!stockCode || !companyName) continue;

    const links = extractLinks(rowMatch[1], sourceUrl)
      .map((link) => link.href)
      .filter((href) => href.toLowerCase().endsWith(".pdf"));

    rows.push({
      id: `ipo-${stockCode}`,
      kind: "ipo",
      companyName,
      stockCode,
      expectedListingDate: null,
      expectedFundLockupPeriod: null,
      expectedSubscriptionMultiple: null,
      expectedHearingDate: null,
      expectedFundraisingSize: null,
      sourceUrl: links[1] || links[0] || sourceUrl,
      lastUpdated: new Date().toISOString(),
      notes: ["官方頁面資料", "部分欄位未公布"],
    });
  }

  return rows;
}

interface HkexAppDocument {
  d?: string;
  nF?: string;
  nS1?: string;
  nS2?: string;
  u1?: string;
  u2?: string;
}

interface HkexAppApplicant {
  id?: string | number;
  d?: string;
  a?: string;
  st?: string;
  w?: string;
  ls?: HkexAppDocument[];
  ps?: HkexAppDocument[];
  hasPhip?: boolean;
}

interface HkexAppJson {
  app?: HkexAppApplicant[];
  uDate?: string;
}

export function parseApplicationProofJson(
  payload: HkexAppJson,
  sourceUrl: string,
  boardLabel: string,
): IpoEvent[] {
  const appDocumentBaseUrl = "https://www1.hkexnews.hk/app/";

  return (payload.app ?? [])
    .filter((item) => item.a)
    .map((item) => {
      const latestDocuments = item.ls ?? [];
      const latestProof = latestDocuments.find((document) =>
        /PHIP|Application Proof/i.test(`${document.nF ?? ""} ${document.nS1 ?? ""}`),
      );
      const sourceDocument = latestProof?.u1 || item.w || sourceUrl;
      const status = item.hasPhip ? "PHIP 已刊發" : "申請版本已刊發";
      const latestPosting = item.d ? `最新刊發日期 ${item.d}` : "最新刊發日期未公布";

      return {
        id: `ipo-application-${boardLabel}-${item.id ?? item.a}`,
        kind: "ipo",
        companyName: item.a ?? "未公布",
        stockCode: item.st ?? "未編配",
        expectedListingDate: null,
        expectedFundLockupPeriod: null,
        expectedSubscriptionMultiple: null,
        expectedHearingDate: null,
        expectedFundraisingSize: null,
        sourceUrl: absoluteUrl(sourceDocument, appDocumentBaseUrl),
        lastUpdated: new Date().toISOString(),
        notes: [
          `${boardLabel} Active 申請`,
          status,
          latestPosting,
          "預計上市時間未公布",
          "募集資金凍結時間未公布",
          "募集倍數未公布",
          "募集規模未公布",
        ],
      } satisfies IpoEvent;
    });
}

export function parseProgressReportSummary(html: string, boardLabel: string) {
  const text = htmlToText(html);
  const asAt = text.match(/\(as at ([^)]+)\)/i)?.[1];
  const pendingListing =
    text.match(/Approved by the Listing Committee pending listing\s+(\d+)/i)?.[1] ??
    text.match(/已獲上市委員會批准，待上市\s+(\d+)/)?.[1];
  const underProcessing =
    text.match(/Under processing\s+(\d+)/i)?.[1] ??
    text.match(/處理中\s+(\d+)/)?.[1];

  const parts = [`${boardLabel} 進展報告已讀取`];
  if (asAt) parts.push(`截至 ${asAt}`);
  if (pendingListing) parts.push(`已獲批准待上市 ${pendingListing}`);
  if (underProcessing) parts.push(`處理中 ${underProcessing}`);
  return parts.join("；");
}

export function enrichIpoFromText(item: IpoEvent, text: string): IpoEvent {
  const expectedListingDate = pickDateNear(text, [
    new RegExp(`commence trading[\\s\\S]{0,260}?${datePattern}`, "i"),
    new RegExp(`dealings in (?:the )?(?:shares|h shares)[\\s\\S]{0,300}?${datePattern}`, "i"),
    new RegExp(`expected listing date[\\s\\S]{0,180}?${datePattern}`, "i"),
    new RegExp(`listing date[\\s\\S]{0,120}?${datePattern}`, "i"),
  ]);

  const offerStart = pickDateNear(text, [
    new RegExp(`application lists[\\s\\S]{0,220}?open[\\s\\S]{0,260}?${datePattern}`, "i"),
    new RegExp(`public offer[\\s\\S]{0,220}?commence[\\s\\S]{0,260}?${datePattern}`, "i"),
  ]);
  const refundDate = pickDateNear(text, [
    new RegExp(`refund[\\s\\S]{0,220}?${datePattern}`, "i"),
    new RegExp(`despatch[\\s\\S]{0,180}?refund[\\s\\S]{0,180}?${datePattern}`, "i"),
  ]);

  const multipleMatch = text.match(
    /(?:over-subscribed|oversubscribed|subscription)[^.]{0,140}?approximately\s+([\d,.]+)\s+times/i,
  );
  const fundsMatch = text.match(
    /(?:net proceeds|gross proceeds|funds raised|raise)[^.]{0,180}?((?:HK\$|HKD|RMB|US\$|USD)\s?[\d,.]+\s?(?:million|billion|m|bn)?)/i,
  );

  const hearingDate = pickDateNear(text, [
    new RegExp(`hearing date[\\s\\S]{0,180}?${datePattern}`, "i"),
    new RegExp(`listing hearing[\\s\\S]{0,180}?${datePattern}`, "i"),
  ]);

  const notes = new Set(item.notes);
  if (expectedListingDate) notes.delete("部分欄位未公布");
  if (offerStart && (refundDate || expectedListingDate)) notes.add("募集資金凍結時間按規則估算");
  if (fundsMatch) notes.delete("部分欄位未公布");
  if (multipleMatch && !/over-subscribed|oversubscribed/i.test(multipleMatch[0])) {
    notes.add("募集倍數按規則估算");
  }

  return {
    ...item,
    expectedListingDate: expectedListingDate ?? item.expectedListingDate,
    expectedFundLockupPeriod:
      offerStart && (refundDate || expectedListingDate)
        ? `${offerStart} 至 ${refundDate || expectedListingDate}`
        : item.expectedFundLockupPeriod,
    expectedSubscriptionMultiple: multipleMatch
      ? `${multipleMatch[1].replace(/,/g, "")}x`
      : item.expectedSubscriptionMultiple,
    expectedHearingDate:
      hearingDate && hearingDate !== expectedListingDate
        ? hearingDate
        : item.expectedHearingDate,
    expectedFundraisingSize: fundsMatch
      ? fundsMatch[1].replace(/\s+/g, " ")
      : item.expectedFundraisingSize,
    notes: Array.from(notes),
  };
}

export function parseDividendEvents(
  html: string,
  sourceUrl: string,
  start: Date,
  end: Date,
): DividendEvent[] {
  const events: DividendEvent[] = [];
  for (const entry of parseDoeEntries(html)) {
    const blockText = entry.blockText;
    if (isPlacementEntitlement(blockText)) {
      continue;
    }

    const perShareMatches = [
      ...blockText.matchAll(
        /((?:FINAL|INTERIM|SPECIAL|MONTHLY|QUARTERLY)?\s*(?:DIVIDEND|DISTRIBUTION)[^。.;]*?(?:HKD|RMB|USD|US\$|HK\$)\s*[\d.]+[^。.;]*?PER SHARE)/gi,
      ),
    ];
    const fullDateMatches = [...blockText.matchAll(/\b(\d{2}\/\d{2}\/20\d{2})\b/g)];
    const shortDateMatches =
      fullDateMatches.length > 0
        ? []
        : [...blockText.matchAll(/\b(\d{2}\/\d{2})(?!\/)\b/g)];
    const normalizedDates = [...fullDateMatches, ...shortDateMatches]
      .map((match) => normalizeDoeDate(match[1], entry.reportYear))
      .filter((value): value is string => Boolean(value));
    const expectedDividendDate =
      normalizedDates.find((value) => isWithinWindow(value, start, end)) ||
      normalizedDates[0] ||
      null;

    if (!expectedDividendDate || !isWithinWindow(expectedDividendDate, start, end)) {
      continue;
    }

    const dividendPerShare =
      blockText.match(/((?:HKD|RMB|USD|US\$|HK\$)\s*[\d.]+)\s+PER SHARE/i)?.[1] ||
      null;

    const notes = ["官方分紅及權益表"];
    if (!blockText.match(/total/i)) notes.push("分紅總規模未公布");
    if (perShareMatches.length > 1) notes.push("同一公司有多項分紅");

    events.push({
      id: `dividend-${entry.stockCode}-${expectedDividendDate}-${events.length}`,
      kind: "dividend",
      companyName: entry.companyName,
      stockCode: entry.stockCode,
      expectedDividendDate,
      expectedTotalDividendAmount: null,
      dividendPerShare,
      sourceUrl,
      lastUpdated: new Date().toISOString(),
      notes,
    });
  }

  return events;
}

export function parsePlacementEntitlements(
  html: string,
  sourceUrl: string,
  start: Date,
  end: Date,
): PlacementEvent[] {
  const placements: PlacementEvent[] = [];

  for (const entry of parseDoeEntries(html)) {
    if (!isPlacementEntitlement(entry.blockText)) {
      continue;
    }

    const fullDateMatches = [...entry.blockText.matchAll(/\b(\d{2}\/\d{2}\/20\d{2})\b/g)];
    const shortDateMatches =
      fullDateMatches.length > 0
        ? []
        : [...entry.blockText.matchAll(/\b(\d{2}\/\d{2})(?!\/)\b/g)];
    const dates = [...fullDateMatches, ...shortDateMatches]
      .map((match) => normalizeDoeDate(match[1], entry.reportYear))
      .filter((value): value is string => Boolean(value));

    const lastDate = dates.at(-1) ?? null;
    const expectedNewSharesListingDate =
      lastDate && isWithinWindow(lastDate, start, end) ? lastDate : null;
    const lockup = estimatePlacementEntitlementLockup(
      dates,
      expectedNewSharesListingDate,
    );
    const offerPrice =
      entry.blockText.match(
        /AT\s+((?:HKD|RMB|USD|US\$|HK\$)\s*[\d.]+)\s+PER\s+(?:RIGHTS\s+)?SHARE/i,
      )?.[1] ?? null;
    const notes = ["官方分紅及權益表", "股本融資事項"];

    if (!lastDate) notes.push("預計增發上市時間未公布");
    if (lastDate) notes.push("預計增發上市時間按規則估算");
    if (!offerPrice) {
      notes.push("募集規模未公布");
    } else {
      notes.push(`已披露認購價 ${offerPrice}`);
      notes.push("募集規模未公布");
    }
    if (lockup.note) notes.push(lockup.note);
    notes.push("募集倍數未公布");

    placements.push({
      id: `placement-${entry.stockCode}-${placements.length}`,
      kind: "placement",
      companyName: entry.companyName,
      stockCode: entry.stockCode,
      expectedNewSharesListingDate,
      expectedFundLockupPeriod: lockup.period,
      expectedSubscriptionMultiple: null,
      expectedFundraisingSize: null,
      sourceUrl,
      lastUpdated: new Date().toISOString(),
      notes,
    });
  }

  return placements.filter((item) =>
    isWithinWindow(item.expectedNewSharesListingDate, start, end),
  );
}

function estimatePlacementEntitlementLockup(
  dates: string[],
  listingDate: string | null,
) {
  if (!listingDate) return { period: null, note: null };

  const listingTime = new Date(listingDate).getTime();
  const nearbyStart = dates
    .filter((date) => date !== listingDate)
    .map((date) => ({ date, daysBefore: daysBetween(date, listingDate) }))
    .filter(({ daysBefore }) => daysBefore > 0 && daysBefore <= 21)
    .sort((a, b) => a.daysBefore - b.daysBefore)[0]?.date;

  if (nearbyStart) {
    return {
      period: `${nearbyStart} 至 ${listingDate}`,
      note: "募集資金凍結時間按規則估算",
    };
  }

  if (!Number.isFinite(listingTime)) return { period: null, note: null };

  return {
    period: `${addBusinessDays(listingDate, -4)} 至 ${listingDate}`,
    note: "募集資金凍結時間按上市日前工作日推測",
  };
}

export function parsePlacementAnnouncements(
  html: string,
  sourceUrl: string,
  start: Date,
  end: Date,
): PlacementEvent[] {
  const links = extractLinks(html, sourceUrl);
  const candidates = links.filter((link) =>
    /placing|subscription|rights issue|open offer|issue of shares|top-up/i.test(
      `${link.label} ${link.context}`,
    ),
  );

  return candidates.slice(0, 60).map((link, index) => {
    const context = `${link.context} ${link.label}`;
    const stockCode = context.match(/\b(\d{4,5})\b/)?.[1] || "未公布";
    const companyName =
      context
        .replace(/\s+/g, " ")
        .match(/(?:^|\s)([A-Z][A-Z0-9 &'().,-]{3,80})(?:\s+\(?\d{4,5}\)?)/)?.[1]
        ?.trim() || "未公布";
    const expectedNewSharesListingDate = pickDateNear(context, [
      new RegExp(`listing[^.]{0,160}?${datePattern}`, "i"),
      new RegExp(`dealings[^.]{0,160}?${datePattern}`, "i"),
    ]);

    return {
      id: `placement-${stockCode}-${index}`,
      kind: "placement",
      companyName,
      stockCode,
      expectedNewSharesListingDate: isWithinWindow(
        expectedNewSharesListingDate,
        start,
        end,
      )
        ? expectedNewSharesListingDate
        : null,
      expectedFundLockupPeriod: null,
      expectedSubscriptionMultiple: null,
      expectedFundraisingSize: null,
      sourceUrl: link.href || absoluteUrl("/", sourceUrl),
      lastUpdated: new Date().toISOString(),
      notes: ["公告搜尋結果", "部分欄位未公布"],
    } satisfies PlacementEvent;
  });
}

export function enrichPlacementFromText(item: PlacementEvent, text: string) {
  const listingDate = pickDateNear(text, [
    new RegExp(`listing of[\\s\\S]{0,220}?shares[\\s\\S]{0,220}?${datePattern}`, "i"),
    new RegExp(`dealings in[\\s\\S]{0,220}?shares[\\s\\S]{0,220}?${datePattern}`, "i"),
  ]);
  const paymentDate = pickDateNear(text, [
    new RegExp(`payment[\\s\\S]{0,220}?${datePattern}`, "i"),
    new RegExp(`completion[\\s\\S]{0,220}?${datePattern}`, "i"),
  ]);
  const fundraising = text.match(
    /(?:gross proceeds|net proceeds|raise)[^.]{0,180}?((?:HK\$|HKD|RMB|US\$|USD)\s?[\d,.]+\s?(?:million|billion|m|bn)?)/i,
  );
  const multiple = text.match(
    /(?:over-subscribed|oversubscribed|subscription)[^.]{0,140}?([\d,.]+)\s+times/i,
  );
  const notes = new Set(item.notes);

  if (paymentDate && listingDate) notes.add("募集資金凍結時間按規則估算");
  if (fundraising || listingDate) notes.delete("部分欄位未公布");

  return {
    ...item,
    expectedNewSharesListingDate: listingDate ?? item.expectedNewSharesListingDate,
    expectedFundLockupPeriod:
      paymentDate && listingDate ? `${paymentDate} 至 ${listingDate}` : null,
    expectedSubscriptionMultiple: multiple
      ? `${multiple[1].replace(/,/g, "")}x`
      : item.expectedSubscriptionMultiple,
    expectedFundraisingSize: fundraising
      ? fundraising[1].replace(/\s+/g, " ")
      : item.expectedFundraisingSize,
    notes: Array.from(notes),
  };
}

function normalizeDoeDate(value: string | undefined, reportYear: number) {
  if (!value) return null;
  if (/20\d{2}/.test(value)) {
    const [day, month, year] = value.split("/");
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const [day, month] = value.split("/");
  return `${reportYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function daysBetween(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000);
}

function addBusinessDays(value: string, delta: number) {
  const date = new Date(value);
  const direction = delta >= 0 ? 1 : -1;
  let remaining = Math.abs(delta);

  while (remaining > 0) {
    date.setDate(date.getDate() + direction);
    const weekday = date.getDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }

  return toIsoDate(date);
}

function parseDoeEntries(html: string) {
  const text = htmlToText(html);
  const reportYear =
    Number(text.match(/Date\s*:\s*\d{2}\/\d{2}\/(20\d{2})/i)?.[1]) ||
    new Date().getFullYear();
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const entries: Array<{
    companyName: string;
    stockCode: string;
    blockText: string;
    reportYear: number;
  }> = [];

  let i = 0;
  while (i < lines.length - 1) {
    const codeMatch = lines[i + 1].match(/^\((\d{1,5})\)$/);
    if (!codeMatch) {
      i += 1;
      continue;
    }

    const companyName = lines[i];
    const stockCode = codeMatch[1];
    i += 2;

    const block: string[] = [];
    while (i < lines.length && !lines[i + 1]?.match(/^\((\d{1,5})\)$/)) {
      block.push(lines[i]);
      i += 1;
    }

    entries.push({
      companyName,
      stockCode,
      blockText: block.join(" "),
      reportYear,
    });
  }

  return entries;
}

function isPlacementEntitlement(blockText: string) {
  return /RIGHTS ISSUE|OPEN OFFER|PREFERENTIAL/i.test(blockText);
}
