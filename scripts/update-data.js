import { mkdir, writeFile } from "node:fs/promises";
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
const workbook = await buildExcelWorkbook(data);

await writeFile(jsonPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
await writeFile(xlsxPath, workbook);

console.log(`Updated ${jsonPath}`);
console.log(`Updated ${xlsxPath}`);
console.log(
  `Rows: IPO ${data.ipo.length}, placements ${data.placements.length}, dividends ${data.dividends.length}`,
);
