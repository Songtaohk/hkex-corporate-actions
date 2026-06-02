import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildExcelWorkbook } from "../lib/services/excel";
import {
  enrichDividendTotalsFromOfficialSources,
  getDashboardData,
} from "../lib/services/official";
import { mergePreviouslyKnownFutureDividends } from "../lib/services/snapshots";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(rootDir, "public/data");
const jsonPath = resolve(dataDir, "latest.json");
const xlsxPath = resolve(dataDir, "latest.xlsx");

await mkdir(dataDir, { recursive: true });

const existingData = await readExistingData();
const fetchedData = await getDashboardData(true);
const mergedData = mergePreviouslyKnownFutureDividends(fetchedData, existingData);
const enrichedData = await enrichPreservedDividendTotals(mergedData);
const cleanedData = cleanResolvedDividendDiagnostics(enrichedData);
const data = annotateRefreshStatus(cleanedData, existingData);
const workbook = await buildExcelWorkbook(data);

await writeFile(jsonPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
await writeFile(xlsxPath, workbook);

console.log(`Updated ${jsonPath}`);
console.log(`Updated ${xlsxPath}`);
console.log(
  `Rows: IPO ${data.ipo.length}, placements ${data.placements.length}, dividends ${data.dividends.length}`,
);

function annotateRefreshStatus(data, existingData) {
  const rowCount = data.ipo.length + data.placements.length + data.dividends.length;
  const existingRowCount = existingData
    ? existingData.ipo.length + existingData.placements.length + existingData.dividends.length
    : 0;

  if (rowCount === 0 && existingRowCount > 0) {
    console.warn(
      `Official sources returned 0 rows; preserved existing static rows and refreshed metadata for ${existingRowCount} rows.`,
    );

    return {
      ...existingData,
      generatedAt: data.generatedAt,
      refreshStatus: "preserved",
      sourceStatus: data.sourceStatus,
    };
  }

  if (existingData && rowCount > 0 && hasSameRows(data, existingData)) {
    return {
      ...data,
      refreshStatus: "unchanged",
    };
  }

  return {
    ...data,
    refreshStatus: "updated",
  };
}

function hasSameRows(nextData, previousData) {
  return stableRowsJson(nextData) === stableRowsJson(previousData);
}

function stableRowsJson(data) {
  return JSON.stringify({
    ipo: data.ipo.map(normalizeAction),
    placements: data.placements.map(normalizeAction),
    dividends: data.dividends.map(normalizeAction),
  });
}

function normalizeAction(item) {
  const rest = { ...item };
  delete rest.lastUpdated;
  return rest;
}
async function readExistingData() {
  try {
    return JSON.parse(await readFile(jsonPath, "utf8"));
  } catch {
    return null;
  }
}

async function enrichPreservedDividendTotals(data) {
  const preservedNeedingEstimate = data.dividends.filter(
    (item) =>
      !item.expectedTotalDividendAmount &&
      item.dividendPerShare &&
      item.notes.includes("官方分紅表已移除，沿用前次快照至派息日"),
  );

  if (preservedNeedingEstimate.length === 0) return data;

  const enrichedPreserved = await enrichDividendTotalsFromOfficialSources(
    preservedNeedingEstimate,
    data.sourceStatus,
  );
  const enrichedById = new Map(enrichedPreserved.map((item) => [item.id, item]));

  return {
    ...data,
    dividends: data.dividends.map((item) => enrichedById.get(item.id) ?? item),
  };
}

function cleanResolvedDividendDiagnostics(data) {
  return {
    ...data,
    dividends: data.dividends.map((item) => {
      if (
        !item.expectedTotalDividendAmount ||
        !item.notes.some((note) => note.startsWith("股本公告查詢："))
      ) {
        return item;
      }

      return {
        ...item,
        notes: item.notes.filter((note) => !note.startsWith("股本公告查詢：")),
      };
    }),
  };
}
