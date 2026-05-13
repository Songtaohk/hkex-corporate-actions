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

const data = await getDashboardData(true);
const rowCount = data.ipo.length + data.placements.length + data.dividends.length;

if (rowCount === 0) {
  const existingData = await readExistingData();
  const existingRowCount = existingData
    ? existingData.ipo.length + existingData.placements.length + existingData.dividends.length
    : 0;

  if (existingRowCount > 0) {
    console.warn(
      `Skipped update because official sources returned 0 rows; kept existing static data with ${existingRowCount} rows.`,
    );
    process.exit(0);
  }
}

const workbook = await buildExcelWorkbook(data);

await writeFile(jsonPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
await writeFile(xlsxPath, workbook);

console.log(`Updated ${jsonPath}`);
console.log(`Updated ${xlsxPath}`);
console.log(
  `Rows: IPO ${data.ipo.length}, placements ${data.placements.length}, dividends ${data.dividends.length}`,
);

async function readExistingData() {
  try {
    return JSON.parse(await readFile(jsonPath, "utf8"));
  } catch {
    return null;
  }
}
