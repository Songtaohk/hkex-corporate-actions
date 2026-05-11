import JSZip from "jszip";
import type { DividendEvent, SourceStatus } from "@/lib/types";
import { decodeHtml } from "@/lib/utils/html";

const SECURITIES_LIST_URL =
  "https://www.hkex.com.hk/eng/services/trading/securities/securitieslists/ListOfSecurities.xlsx";

export interface SecurityProfile {
  stockCode: string;
  name: string;
  category: string;
  subCategory: string;
  isin: string;
}

export type SecuritiesLookup = Map<string, SecurityProfile>;

export async function fetchSecuritiesList(sourceStatus: SourceStatus[]) {
  try {
    const response = await fetch(SECURITIES_LIST_URL, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; HKEX Corporate Actions Dashboard)",
        accept:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const lookup = await parseSecuritiesWorkbook(await response.arrayBuffer());
    sourceStatus.push({
      name: "HKEX 證券名單",
      url: SECURITIES_LIST_URL,
      ok: true,
      message: `已成功讀取 ${lookup.size} 個證券代號；用於分紅內地主營業務篩選。`,
    });
    return lookup;
  } catch (error) {
    sourceStatus.push({
      name: "HKEX 證券名單",
      url: SECURITIES_LIST_URL,
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "證券名單讀取失敗，分紅篩選只使用名稱規則。",
    });
    return new Map<string, SecurityProfile>();
  }
}

export async function parseSecuritiesWorkbook(
  bytes: ArrayBuffer,
): Promise<SecuritiesLookup> {
  const zip = await JSZip.loadAsync(bytes);
  const workbookXml = await zip.file("xl/workbook.xml")?.async("text");
  const workbookRelsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("text");
  const sheetPath = resolveFirstSheetPath(workbookXml, workbookRelsXml);
  const sheetXml = await zip.file(sheetPath)?.async("text");
  if (!sheetXml) throw new Error("Workbook sheet not found");

  const sharedStringsXml = await zip.file("xl/sharedStrings.xml")?.async("text");
  const sharedStrings = sharedStringsXml
    ? parseSharedStrings(sharedStringsXml)
    : [];
  const rows = parseSheetRows(sheetXml, sharedStrings);
  const headerRow = rows.find((row) =>
    Object.values(row).some((value) => /stock\s+code/i.test(value)),
  );
  if (!headerRow) throw new Error("Securities list header not found");

  const columns = {
    stockCode: findColumn(headerRow, /stock\s+code/i),
    name: findColumn(headerRow, /name\s+of\s+securities/i),
    category: findColumn(headerRow, /^category$/i),
    subCategory: findColumn(headerRow, /sub-?category/i),
    isin: findColumn(headerRow, /^isin$/i),
  };

  if (!columns.stockCode || !columns.name) {
    throw new Error("Securities list columns not found");
  }

  const lookup: SecuritiesLookup = new Map();
  for (const row of rows) {
    const stockCode = normalizeStockCode(row[columns.stockCode]);
    const name = normalizeCell(row[columns.name]);
    if (!stockCode || !name || /stock\s+code/i.test(stockCode)) continue;

    const profile: SecurityProfile = {
      stockCode,
      name,
      category: normalizeCell(row[columns.category ?? ""]),
      subCategory: normalizeCell(row[columns.subCategory ?? ""]),
      isin: normalizeCell(row[columns.isin ?? ""]),
    };
    lookup.set(stockCode, profile);
  }

  return lookup;
}

export function filterMainlandBusinessDividends(
  dividends: DividendEvent[],
  securities: SecuritiesLookup,
) {
  return dividends.flatMap((dividend) => {
    const result = classifyMainlandBusiness(dividend, securities);
    if (!result.include) return [];
    return {
      ...dividend,
      notes: Array.from(new Set([...dividend.notes, result.note])),
    };
  });
}

export function classifyMainlandBusiness(
  dividend: Pick<DividendEvent, "companyName" | "stockCode">,
  securities: SecuritiesLookup,
): { include: boolean; note: string } {
  const profile = findSecurityProfile(dividend.stockCode, securities);
  const combinedName = `${dividend.companyName} ${profile?.name ?? ""}`;

  if (isFundOrNonCompany(combinedName, profile)) {
    return { include: false, note: "非上市公司股息項目" };
  }

  if (profile?.isin.toUpperCase().startsWith("CNE")) {
    return { include: true, note: "中國內地主營業務：按官方 ISIN 判定" };
  }

  if (hasMainlandBusinessNameSignal(combinedName)) {
    return { include: true, note: "中國內地主營業務：按公司名稱規則判定" };
  }

  return { include: false, note: "未能判定為中國內地主營業務" };
}

function resolveFirstSheetPath(workbookXml?: string, workbookRelsXml?: string) {
  if (!workbookXml || !workbookRelsXml) return "xl/worksheets/sheet1.xml";

  const firstSheetId = workbookXml.match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
  if (!firstSheetId) return "xl/worksheets/sheet1.xml";

  const relRegex = /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = relRegex.exec(workbookRelsXml))) {
    if (match[1] === firstSheetId) {
      const target = match[2].replace(/^\//, "");
      return target.startsWith("xl/") ? target : `xl/${target}`;
    }
  }
  return "xl/worksheets/sheet1.xml";
}

function parseSharedStrings(xml: string) {
  const strings: string[] = [];
  const siRegex = /<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g;
  let match: RegExpExecArray | null;
  while ((match = siRegex.exec(xml))) {
    strings.push(extractTextNodes(match[1]));
  }
  return strings;
}

function parseSheetRows(xml: string, sharedStrings: string[]) {
  const rows: Array<Record<string, string>> = [];
  const rowRegex = /<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(xml))) {
    const row: Record<string, string> = {};
    const cellRegex =
      /<(?:\w+:)?c\b[^>]*r="([A-Z]+)\d+"[^>]*(?:t="([^"]+)")?[^>]*>([\s\S]*?)<\/(?:\w+:)?c>/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
      const column = cellMatch[1];
      const type = cellMatch[2];
      const raw = cellMatch[3];
      const value = cellValue(raw, type, sharedStrings);
      if (value) row[column] = value;
    }
    if (Object.keys(row).length > 0) rows.push(row);
  }

  return rows;
}

function cellValue(raw: string, type: string | undefined, sharedStrings: string[]) {
  if (type === "inlineStr") return normalizeCell(extractTextNodes(raw));
  const value = raw.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
  if (value === undefined) return "";
  if (type === "s") return normalizeCell(sharedStrings[Number(value)] ?? "");
  return normalizeCell(value);
}

function extractTextNodes(xml: string) {
  return [...xml.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)]
    .map((match) => decodeXml(match[1]))
    .join("");
}

function findColumn(row: Record<string, string>, pattern: RegExp) {
  return Object.entries(row).find(([, value]) => pattern.test(value))?.[0] ?? null;
}

function findSecurityProfile(stockCode: string, securities: SecuritiesLookup) {
  const normalized = normalizeStockCode(stockCode);
  if (!normalized) return undefined;

  const direct = securities.get(normalized);
  if (direct) return direct;

  if (/^8\d{4}$/.test(normalized)) {
    return securities.get(normalized.slice(1));
  }

  return undefined;
}

function isFundOrNonCompany(name: string, profile?: SecurityProfile) {
  const categoryText = `${profile?.category ?? ""} ${profile?.subCategory ?? ""}`;
  if (
    /exchange\s+traded|debt|structured|warrant|cbbc|fund|unit\s+trust|investment\s+trust|stapled|reit/i.test(
      categoryText,
    )
  ) {
    return true;
  }

  return /\b(ETF|ETP|FUND|TRUST|REIT|BOND|NOTE|WARRANT|CALL|PUT|CBBC|TRACKER|ISHARES|CSOP|PREMIA|GLOBAL\s+X|GX|SPDR|GOLD|SILVER|BITCOIN|ETHER)\b/i.test(
    name,
  );
}

function hasMainlandBusinessNameSignal(name: string) {
  return mainlandBusinessPatterns.some((pattern) => pattern.test(name));
}

function normalizeStockCode(value: string | undefined) {
  const match = normalizeCell(value).match(/\d{1,5}/);
  if (!match) return "";
  return String(Number(match[0]));
}

function normalizeCell(value: string | undefined) {
  return decodeHtml(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXml(value: string) {
  return decodeHtml(
    value.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    ),
  );
}

const mainlandBusinessPatterns = [
  /\bCHINA\b/i,
  /\bPRC\b/i,
  /\bMAINLAND\b/i,
  /\bBEIJING\b/i,
  /\bSHANGHAI\b/i,
  /\bSHENZHEN\b/i,
  /\bGUANGDONG\b/i,
  /\bGUANGZHOU\b/i,
  /\bZHEJIANG\b/i,
  /\bJIANGSU\b/i,
  /\bFUJIAN\b/i,
  /\bSHANDONG\b/i,
  /\bSICHUAN\b/i,
  /\bCHONGQING\b/i,
  /\bTIANJIN\b/i,
  /\bHAINAN\b/i,
  /\bHENAN\b/i,
  /\bHUBEI\b/i,
  /\bHUNAN\b/i,
  /\bHEBEI\b/i,
  /\bANHUI\b/i,
  /\bJIANGXI\b/i,
  /\bLIAONING\b/i,
  /\bYUNNAN\b/i,
  /\bGUIZHOU\b/i,
  /\bSHAANXI\b/i,
  /\bQINGDAO\b/i,
  /\bXI'?AN\b/i,
  /\bWUXI\b/i,
  /\bNINGBO\b/i,
  /\bSUZHOU\b/i,
  /\bHANGZHOU\b/i,
  /\bNANTONG\b/i,
  /\bXIAMEN\b/i,
  /\bPING\s+AN\b/i,
  /\bICBC\b/i,
  /\bCCB\b/i,
  /\bABC\b/i,
  /\bBOC\b/i,
  /\bCM\s+BANK\b/i,
  /\bCMB\b/i,
  /\bCITIC\b/i,
  /\bCNOOC\b/i,
  /\bCNPC\b/i,
  /\bSINOPEC\b/i,
  /\bCHALCO\b/i,
  /\bBYD\b/i,
  /\bGEELY\b/i,
  /\bGREAT\s+WALL\s+MOTOR\b/i,
  /\bTENCENT\b/i,
  /\bMEITUAN\b/i,
  /\bALIBABA\b/i,
  /\bBABA\b/i,
  /\bJD\b/i,
  /\bBAIDU\b/i,
  /\bXIAOMI\b/i,
  /\bKUAISHOU\b/i,
  /\bNETEASE\b/i,
  /\bTRIP\.COM\b/i,
  /\bHAIDILAO\b/i,
  /\bANTA\b/i,
  /\bLI\s+NING\b/i,
  /\bPOP\s+MART\b/i,
  /\bLI\s+AUTO\b/i,
  /\bXPENG\b/i,
  /\bNIO\b/i,
  /\bSUNNY\s+OPTICAL\b/i,
  /\bAAC\s+TECH\b/i,
  /\bSMIC\b/i,
  /\bHUA\s+HONG\b/i,
  /\bLENOVO\b/i,
  /\bZTE\b/i,
  /\bCHINA\s+RES\b/i,
  /\bCR\s+/i,
];
