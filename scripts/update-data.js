import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildExcelWorkbook } from "../lib/services/excel";
import { getDashboardData } from "../lib/services/official";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(rootDir, "public/data");
const jsonPath = resolve(dataDir, "latest.json");
const xlsxPath = resolve(dataDir, "latest.xlsx");

await mkdir(dataDir, { recursive: true });

const fetchedData = await getDashboardData(true);
const data = await annotateRefreshStatus(fetchedData);
const workbook = await buildExcelWorkbook(data);

await writeFile(jsonPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
await writeFile(xlsxPath, workbook);

console.log(`Updated ${jsonPath}`);
console.log(`Updated ${xlsxPath}`);
console.log(
  `Rows: IPO ${data.ipo.length}, placements ${data.placements.length}, dividends ${data.dividends.length}`,
);

async function annotateRefreshStatus(data) {
  const rowCount = data.ipo.length + data.placements.length + data.dividends.length;
  const existingData = await readExistingData();
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
