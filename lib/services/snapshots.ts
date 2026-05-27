import type { DashboardResponse, DividendEvent } from "@/lib/types";

const PRESERVED_DIVIDEND_NOTE = "官方分紅表已移除，沿用前次快照至派息日";

export function mergePreviouslyKnownFutureDividends(
  nextData: DashboardResponse,
  previousData: DashboardResponse | null,
): DashboardResponse {
  if (!previousData?.dividends.length) return nextData;

  const nextExactKeys = new Set(nextData.dividends.map(dividendExactKey));
  const nextSupersedeKeys = new Set(nextData.dividends.map(dividendSupersedeKey));
  const preserved = previousData.dividends
    .filter((item) => {
      if (!item.expectedDividendDate) return false;
      if (item.expectedDividendDate < nextData.rangeStart) return false;
      if (item.expectedDividendDate > nextData.rangeEnd) return false;
      if (nextExactKeys.has(dividendExactKey(item))) return false;
      if (nextSupersedeKeys.has(dividendSupersedeKey(item))) return false;
      return true;
    })
    .map((item) => ({
      ...item,
      notes: Array.from(new Set([...item.notes, PRESERVED_DIVIDEND_NOTE])),
    }));

  if (preserved.length === 0) return nextData;

  return {
    ...nextData,
    sourceStatus: [
      ...nextData.sourceStatus,
      {
        name: "前次分紅快照保留",
        url: "public/data/latest.json",
        ok: true,
        message: `已保留 ${preserved.length} 項已知未來派息事項，避免官方權益表過戶後移除造成資料消失。`,
      },
    ],
    dividends: [...nextData.dividends, ...preserved].sort(compareDividends),
  };
}

function compareDividends(a: DividendEvent, b: DividendEvent) {
  return (
    compareText(a.expectedDividendDate, b.expectedDividendDate) ||
    compareText(a.companyName, b.companyName) ||
    compareText(normalizeDividendCounterCode(a.stockCode), normalizeDividendCounterCode(b.stockCode))
  );
}

function compareText(a: string | null, b: string | null) {
  return (a ?? "9999-12-31").localeCompare(b ?? "9999-12-31");
}

function dividendExactKey(item: DividendEvent) {
  return [
    normalizeDividendCounterCode(item.stockCode),
    item.expectedDividendDate ?? "na",
    normalizeDividendPerShareKey(item.dividendPerShare),
  ].join("|");
}

function dividendSupersedeKey(item: DividendEvent) {
  return [
    normalizeDividendCounterCode(item.stockCode),
    normalizeDividendPerShareKey(item.dividendPerShare),
  ].join("|");
}

function normalizeDividendCounterCode(stockCode: string) {
  const code = stockCode.trim().replace(/^0+/, "");
  if (/^8\d{4}$/.test(code)) return code.slice(1).replace(/^0+/, "") || "0";
  return code || stockCode.trim();
}

function normalizeDividendPerShareKey(value: string | null) {
  return (value ?? "na").replace(/\s+/g, "").toUpperCase();
}
