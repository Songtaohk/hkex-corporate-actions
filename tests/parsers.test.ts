import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { buildExcelWorkbook } from "@/lib/services/excel";
import {
  applyIpoEstimates,
  applyPlacementEstimates,
  estimateDividendTotals,
  parseSouthboundShareholding,
} from "@/lib/services/estimates";
import {
  enrichIpoFromText,
  parseApplicationProofJson,
  parseDividendEvents,
  parseIpoRows,
  parsePlacementEntitlements,
} from "@/lib/services/parsers";
import {
  classifyMainlandBusiness,
  filterMainlandBusinessDividends,
} from "@/lib/services/securities";
import type { DashboardResponse } from "@/lib/types";

test("parses HKEX new listing rows and enriches IPO fields from PDF text", () => {
  const html = `
    <table><tbody>
      <tr>
        <td>6871</td>
        <td>Robotphoenix Intelligent Technology Co., Ltd.<br /></td>
        <td><a href="https://example.test/announcement.pdf">Download</a></td>
        <td><a href="https://example.test/prospectus.pdf">Download</a></td>
      </tr>
    </tbody></table>
  `;
  const [row] = parseIpoRows(html, "https://example.test/main");
  const enriched = enrichIpoFromText(
    row,
    "Dealings in the Shares on the Stock Exchange are expected to commence on 15 May 2026. Application lists will open on 8 May 2026. Refund cheques will be despatched on 14 May 2026. Net proceeds are expected to be HK$500 million.",
  );

  assert.equal(enriched.companyName, "Robotphoenix Intelligent Technology Co., Ltd.");
  assert.equal(enriched.stockCode, "6871");
  assert.equal(enriched.expectedListingDate, "2026-05-15");
  assert.equal(enriched.expectedFundLockupPeriod, "2026-05-08 至 2026-05-14");
  assert.equal(enriched.expectedFundraisingSize, "HK$500 million");
  assert.ok(enriched.notes.includes("募集資金凍結時間按規則估算"));
});

test("computes IPO fundraising size from offer shares and offer price", () => {
  const row = {
    id: "ipo-1511",
    kind: "ipo" as const,
    companyName: "UISEE Technologies (Beijing) Co., Ltd.",
    stockCode: "1511",
    expectedListingDate: null,
    expectedFundLockupPeriod: null,
    expectedSubscriptionMultiple: null,
    expectedHearingDate: null,
    expectedFundraisingSize: null,
    sourceUrl: "https://example.test/uisee.pdf",
    lastUpdated: "2026-05-12T00:00:00.000Z",
    notes: ["官方頁面資料", "部分欄位未公布"],
  };

  const enriched = enrichIpoFromText(
    row,
    "The Global Offering comprises a total of 14,461,200 Offer Shares. The Offer Price has been determined at HK$60.30 per H Share. Net proceeds are expected to be RMB1,735 million.",
  );

  assert.equal(enriched.expectedFundraisingSize, "HK$872 million");
  assert.ok(enriched.notes.includes("募集規模按發售股數及發售價計算"));
});

test("parses active Application Proof JSON into IPO pipeline rows", () => {
  const rows = parseApplicationProofJson(
    {
      app: [
        {
          id: 108526,
          d: "10/05/2026",
          a: "DIGIWIN CO., LTD.",
          ls: [
            {
              d: "10/05/2026",
              nS1: "OC Announcement - Appointment",
              u1: "sehk/2026/108526/documents/sehk26051000272.pdf",
            },
            {
              d: "10/05/2026",
              nF: "Application Proof (1st submission)",
              nS1: "Full Version",
              nS2: "Multi-Files",
              u1: "sehk/2026/108526/documents/sehk26051000200.pdf",
              u2: "sehk/2026/108526/2026051000195.htm",
            },
          ],
          hasPhip: false,
        },
      ],
      uDate: "10/05/2026",
    },
    "https://www1.hkexnews.hk/ncms/json/eds/appactive_app_sehk_e.json",
    "主板",
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].companyName, "DIGIWIN CO., LTD.");
  assert.equal(rows[0].stockCode, "未編配");
  assert.equal(rows[0].expectedListingDate, null);
  assert.match(
    rows[0].sourceUrl,
    /^https:\/\/www1\.hkexnews\.hk\/app\/sehk\/2026\/108526\/documents\/sehk26051000200\.pdf$/,
  );
  assert.ok(rows[0].notes.includes("主板 Active 申請"));
  assert.ok(rows[0].notes.includes("申請版本已刊發"));
});

test("adds IPO forecasts when AP or PHIP fields are not disclosed", () => {
  const [row] = parseApplicationProofJson(
    {
      app: [
        {
          id: 108526,
          d: "10/05/2026",
          a: "DIGIWIN CO., LTD.",
          ls: [
            {
              nF: "Application Proof (1st submission)",
              u1: "sehk/2026/108526/documents/sehk26051000200.pdf",
            },
          ],
          hasPhip: false,
        },
      ],
    },
    "https://www1.hkexnews.hk/ncms/json/eds/appactive_app_sehk_e.json",
    "主板",
  );

  const [estimated] = applyIpoEstimates([row], new Date("2026-05-11T00:00:00Z"));

  assert.equal(estimated.expectedHearingDate, "2026-09-07");
  assert.equal(estimated.expectedFundLockupPeriod, "2026-09-10 至 2026-09-15");
  assert.equal(estimated.expectedSubscriptionMultiple, "25x 同業推測");
  assert.match(estimated.expectedFundraisingSize ?? "", /^HK\$\d+(?:\.\d+)? million 同業推測$/);
  assert.ok(estimated.notes.includes("參考來源：HKEX IPO FAQ"));
  assert.ok(estimated.notes.includes("募集資金凍結時間按聆訊後招股流程推測"));
  assert.ok(estimated.notes.includes("募集倍數按近期同業IPO推測"));
  assert.ok(estimated.notes.includes("募集規模按近期綜合行業IPO中位數及公司特徵推測"));
  assert.ok(estimated.notes.includes("參考來源：HKEX 新上市資料及招股書"));
});

test("parses dividend rows within the future window", () => {
  const html = `
    <html><body>
      Date : 07/05/2026
      <br />Stock Short Name
      <br />AAC TECH
      <br />(2018)
      <br />FINAL DIVIDEND
      <br />HKD0.35 PER SHARE
      <br />(Y.E. 31/12/2025)
      <br />26/05 28/05/2026 - 01/06/2026
    </body></html>
  `;

  const rows = parseDividendEvents(
    html,
    "https://www3.hkexnews.hk/reports/doe/eent.htm",
    new Date("2026-05-10T00:00:00Z"),
    new Date("2026-08-10T23:59:59Z"),
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].companyName, "AAC TECH");
  assert.equal(rows[0].stockCode, "2018");
  assert.equal(rows[0].expectedDividendDate, "2026-06-11");
  assert.equal(rows[0].dividendPerShare, "HKD0.35");
  assert.ok(rows[0].notes.includes("派息日按記錄日後8個工作日推算"));
});

test("normalizes dividend amounts declared per 10 shares", () => {
  const html = `
    <html><body>
      Date : 12/05/2026
      <br />OMNIVISION
      <br />(501)
      <br />FINAL DIVIDEND
      <br />RMB1.25 PER 10 SHARES
      <br />(Y.E. 31/12/2025)
      <br />14/05 18/05/2026 - 19/05/2026
    </body></html>
  `;

  const rows = parseDividendEvents(
    html,
    "https://www3.hkexnews.hk/reports/doe/eent.htm",
    new Date("2026-05-10T00:00:00Z"),
    new Date("2026-08-10T23:59:59Z"),
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].companyName, "OMNIVISION");
  assert.equal(rows[0].dividendPerShare, "RMB0.125");
});


test("ignores accounting period dates when estimating dividend payment date", () => {
  const html = `
    <html><body>
      Date : 18/05/2026
      <br />TENCENT
      <br />(700)
      <br />FINAL DIVIDEND
      <br />HKD5.30 PER SHARE
      <br />(Y.E. 31/12/2025)
      <br />15/05 19/05/2026 - 20/05/2026
      <br />NIL INTERIM (SEMI-ANNUAL) DIVIDEND
      <br />(FOR THE THREE MONTHS ENDED 31/03/2026)
      <br />(Y.E. 31/12/2026)
      <br />NO B/C DATE
    </body></html>
  `;

  const rows = parseDividendEvents(
    html,
    "https://www3.hkexnews.hk/reports/doe/eent.htm",
    new Date("2026-05-18T00:00:00Z"),
    new Date("2026-08-18T23:59:59Z"),
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].companyName, "TENCENT");
  assert.equal(rows[0].expectedDividendDate, "2026-06-01");
  assert.equal(rows[0].dividendPerShare, "HKD5.3");
});

test("estimates dividend payment date from record date when payable date is absent", () => {
  const html = `
    <html><body>
      Date : 11/05/2026
      <br />TENCENT
      <br />(700)
      <br />FINAL DIVIDEND
      <br />HKD5.30 PER SHARE
      <br />(Y.E. 31/12/2025)
      <br />15/05 19/05/2026 - 20/05/2026
    </body></html>
  `;

  const rows = parseDividendEvents(
    html,
    "https://www3.hkexnews.hk/reports/doe/eent.htm",
    new Date("2026-05-10T00:00:00Z"),
    new Date("2026-08-10T23:59:59Z"),
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].companyName, "TENCENT");
  assert.equal(rows[0].expectedDividendDate, "2026-06-01");
  assert.ok(rows[0].notes.includes("派息日按記錄日後8個工作日推算"));
});

test("filters dividend rows to Mainland China principal business companies", () => {
  const securities = new Map([
    [
      "2018",
      {
        stockCode: "2018",
        name: "AAC TECHNOLOGIES HOLDINGS INC.",
        category: "Equity",
        subCategory: "Equity",
        isin: "KYG2953R1149",
      },
    ],
    [
      "3988",
      {
        stockCode: "3988",
        name: "BANK OF CHINA LIMITED",
        category: "Equity",
        subCategory: "Equity",
        isin: "CNE1000001Z5",
      },
    ],
    [
      "2800",
      {
        stockCode: "2800",
        name: "TRACKER FUND OF HONG KONG",
        category: "Exchange Traded Products",
        subCategory: "ETF",
        isin: "HK2828013055",
      },
    ],
  ]);

  assert.deepEqual(
    classifyMainlandBusiness(
      { companyName: "BANK OF CHINA", stockCode: "3988" },
      securities,
    ),
    {
      include: true,
      note: "中國內地主營業務：按官方 ISIN 判定",
    },
  );

  const filtered = filterMainlandBusinessDividends(
    [
      {
        id: "dividend-1",
        kind: "dividend",
        companyName: "BANK OF CHINA",
        stockCode: "3988",
        expectedDividendDate: "2026-06-01",
        expectedTotalDividendAmount: null,
        dividendPerShare: "RMB0.30",
        sourceUrl: "https://example.test",
        lastUpdated: "2026-05-10T00:00:00.000Z",
        notes: ["官方分紅及權益表"],
      },
      {
        id: "dividend-2",
        kind: "dividend",
        companyName: "TRACKER FUND",
        stockCode: "2800",
        expectedDividendDate: "2026-06-01",
        expectedTotalDividendAmount: null,
        dividendPerShare: "HKD0.10",
        sourceUrl: "https://example.test",
        lastUpdated: "2026-05-10T00:00:00.000Z",
        notes: ["官方分紅及權益表"],
      },
    ],
    securities,
  );

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].stockCode, "3988");
  assert.ok(filtered[0].notes.includes("中國內地主營業務：按官方 ISIN 判定"));
});

test("estimates dividend totals from dividend per share and HKEX shareholding percentage", () => {
  const shareholdings = parseSouthboundShareholding(`
    <table><tbody><tr>
      <td class="col-stock-code"><div>Stock Code:</div><div>3988</div></td>
      <td class="col-stock-name"><div>Name:</div><div>BANK OF CHINA LIMITED</div></td>
      <td class="col-shareholding"><div>Shareholding in CCASS:</div><div>28,002,821,999</div></td>
      <td class="col-shareholding-percent"><div>% of the total number of Issued Shares/Units:</div><div>33.48%</div></td>
    </tr></tbody></table>
  `);

  const [estimated] = estimateDividendTotals(
    [
      {
        id: "dividend-1",
        kind: "dividend",
        companyName: "BANK OF CHINA",
        stockCode: "3988",
        expectedDividendDate: "2026-06-01",
        expectedTotalDividendAmount: null,
        dividendPerShare: "RMB0.30",
        sourceUrl: "https://example.test",
        lastUpdated: "2026-05-10T00:00:00.000Z",
        notes: ["官方分紅及權益表", "分紅總規模未公布"],
      },
    ],
    shareholdings,
  );

  assert.equal(estimated.expectedTotalDividendAmount, "RMB 25.09 billion");
  assert.ok(estimated.notes.includes("按每股分紅預測"));
  assert.ok(
    estimated.notes.includes("股份數參考：HKEX 港股通持股佔已發行股份比例"),
  );
  assert.ok(!estimated.notes.includes("分紅總規模未公布"));
});


test("estimates dividend totals from HKEXnews issued shares disclosure when southbound data is unavailable", () => {
  const [estimated] = estimateDividendTotals(
    [
      {
        id: "dividend-2",
        kind: "dividend",
        companyName: "TEST CHINA CO",
        stockCode: "1234",
        expectedDividendDate: "2026-06-01",
        expectedTotalDividendAmount: null,
        dividendPerShare: "RMB0.30",
        sourceUrl: "https://example.test",
        lastUpdated: "2026-05-10T00:00:00.000Z",
        notes: ["官方分紅及權益表", "分紅總規模未公布"],
      },
    ],
    new Map(),
    new Map([
      [
        "1234",
        {
          stockCode: "1234",
          issuedShares: 1_000_000_000,
          source: "monthly_return",
          sourceUrl: "https://example.test/monthly-return.pdf",
        },
      ],
    ]),
  );

  assert.equal(estimated.expectedTotalDividendAmount, "RMB 300.00 million");
  assert.ok(estimated.notes.includes("按每股分紅預測"));
  assert.ok(estimated.notes.includes("股份數參考：HKEXnews Monthly Return"));
  assert.ok(estimated.notes.includes("股本資料來源：https://example.test/monthly-return.pdf"));
  assert.ok(!estimated.notes.includes("分紅總規模未公布"));
});


test("estimates dividend totals from HKEXnews annual report share count fallback", () => {
  const [estimated] = estimateDividendTotals(
    [
      {
        id: "dividend-annual-report",
        kind: "dividend",
        companyName: "TEST CHINA CO",
        stockCode: "1234",
        expectedDividendDate: "2026-06-01",
        expectedTotalDividendAmount: null,
        dividendPerShare: "RMB0.30",
        sourceUrl: "https://example.test",
        lastUpdated: "2026-05-10T00:00:00.000Z",
        notes: ["官方分紅及權益表", "分紅總規模未公布"],
      },
    ],
    new Map(),
    new Map([
      [
        "1234",
        {
          stockCode: "1234",
          issuedShares: 2_000_000_000,
          source: "annual_report",
          sourceUrl: "https://example.test/annual-report.pdf",
        },
      ],
    ]),
  );

  assert.equal(estimated.expectedTotalDividendAmount, "RMB 600.00 million");
  assert.ok(estimated.notes.includes("股份數參考：HKEXnews 年報"));
  assert.ok(estimated.notes.includes("股本資料來源：https://example.test/annual-report.pdf"));
});

test("parses rights issue entries from entitlement table into placements", () => {
  const html = `
    <html><body>
      Date : 07/05/2026
      <br />JISHENG GP HLDG
      <br />(8133)
      <br />RIGHTS ISSUE: 3 RIGHTS SHARES FOR
      <br />EVERY 1 ADJUSTED SHARE
      <br />AT HKD0.26 PER RIGHTS SHARE
      <br />05/06 09/06/2026 - 15/06/2026
    </body></html>
  `;

  const rows = parsePlacementEntitlements(
    html,
    "https://www3.hkexnews.hk/reports/doe/eentgem.htm",
    new Date("2026-05-10T00:00:00Z"),
    new Date("2026-08-10T23:59:59Z"),
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].companyName, "JISHENG GP HLDG");
  assert.equal(rows[0].stockCode, "8133");
  assert.equal(rows[0].expectedNewSharesListingDate, "2026-06-15");
  assert.equal(rows[0].expectedFundLockupPeriod, "2026-06-09 至 2026-06-15");
  assert.equal(rows[0].expectedFundraisingSize, null);
  assert.ok(rows[0].notes.includes("已披露認購價 HKD0.26"));
});

test("ignores old accounting dates when estimating placement fund lock-up", () => {
  const html = `
    <html><body>
      Date : 11/05/2026
      <br />CITIC BANK
      <br />(0998)
      <br />RIGHTS ISSUE: 1 RIGHTS SHARE FOR
      <br />EVERY 10 EXISTING SHARES
      <br />(Y.E. 31/12/2025)
      <br />26/05/2026
    </body></html>
  `;

  const rows = parsePlacementEntitlements(
    html,
    "https://www3.hkexnews.hk/reports/doe/eent.htm",
    new Date("2026-05-10T00:00:00Z"),
    new Date("2026-08-10T23:59:59Z"),
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].companyName, "CITIC BANK");
  assert.equal(rows[0].stockCode, "0998");
  assert.equal(rows[0].expectedNewSharesListingDate, "2026-05-26");
  assert.equal(rows[0].expectedFundLockupPeriod, "2026-05-20 至 2026-05-26");
  assert.ok(
    rows[0].notes.includes("募集資金凍結時間按上市日前工作日推測"),
  );
});

test("adds peer-based placement forecasts when multiple and fundraising size are not disclosed", () => {
  const [estimated] = applyPlacementEstimates([
    {
      id: "placement-1",
      kind: "placement",
      companyName: "Example Technology Limited",
      stockCode: "9999",
      expectedNewSharesListingDate: "2026-06-15",
      expectedFundLockupPeriod: "2026-06-10 至 2026-06-15",
      expectedSubscriptionMultiple: null,
      expectedFundraisingSize: null,
      sourceUrl: "https://example.test",
      lastUpdated: "2026-05-11T00:00:00.000Z",
      notes: ["公告搜尋結果", "募集倍數未公布", "募集規模未公布"],
    },
  ]);

  assert.equal(estimated.expectedSubscriptionMultiple, "3x 同業推測");
  assert.equal(estimated.expectedFundraisingSize, "HK$250 million 同業推測");
  assert.ok(estimated.notes.includes("同業分組：科技/智能製造"));
  assert.ok(estimated.notes.includes("增發募集倍數按近期同業股本融資推測"));
  assert.ok(
    estimated.notes.includes("增發募集規模按近期科技/智能製造股本融資中位數推測"),
  );
});

test("builds an English Excel workbook with required sheets", async () => {
  const data: DashboardResponse = {
    generatedAt: "2026-05-10T00:00:00.000Z",
    rangeStart: "2026-05-10",
    rangeEnd: "2026-08-10",
    sourceStatus: [],
    ipo: [
      {
        id: "ipo-1",
        kind: "ipo",
        companyName: "Example IPO",
        stockCode: "9999",
        expectedListingDate: "2026-06-01",
        expectedFundLockupPeriod: null,
        expectedSubscriptionMultiple: null,
        expectedHearingDate: null,
        expectedFundraisingSize: "HK$1 billion",
        sourceUrl: "https://example.test",
        lastUpdated: "2026-05-10T00:00:00.000Z",
        notes: ["募集資金凍結時間按規則估算"],
      },
    ],
    placements: [],
    dividends: [],
  };

  const bytes = await buildExcelWorkbook(data);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  assert.deepEqual(
    workbook.worksheets.map((sheet) => sheet.name),
    ["IPO", "Placements", "China Dividends"],
  );
  const sheet = workbook.getWorksheet("IPO");
  assert.equal(sheet?.getCell("A2").value, "Example IPO");
  assert.equal(sheet?.getCell("J2").value, "Estimated by rule");
});
