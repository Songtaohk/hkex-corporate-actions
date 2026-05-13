import ExcelJS from "exceljs";
import type { DashboardResponse, DividendEvent, IpoEvent, PlacementEvent } from "@/lib/types";

const notDisclosed = "Not disclosed";

export async function buildExcelWorkbook(data: DashboardResponse): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "HKEX Corporate Actions Dashboard";
  workbook.created = new Date(data.generatedAt);

  appendSheet(workbook, "IPO", data.ipo.map(mapIpoRow));
  appendSheet(workbook, "Placements", data.placements.map(mapPlacementRow));
  appendSheet(workbook, "China Dividends", data.dividends.map(mapDividendRow));

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

function appendSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  rows: Array<Record<string, string>>,
) {
  const worksheet = workbook.addWorksheet(name);
  const headers = Object.keys(rows[0] || fallbackColumns(name));
  worksheet.columns = headers.map((header) => ({
    header,
    key: header,
    width: Math.min(Math.max(header.length + 4, 16), 42),
  }));
  rows.forEach((row) => worksheet.addRow(row));
  worksheet.getRow(1).font = { bold: true };
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
}

function fallbackColumns(name: string) {
  if (name === "IPO") return mapIpoRow(emptyIpo);
  if (name === "Placements") return mapPlacementRow(emptyPlacement);
  return mapDividendRow(emptyDividend);
}

function mapIpoRow(item: IpoEvent) {
  return {
    "Company Name": item.companyName,
    "Stock Code": toEnglishValue(item.stockCode),
    "Expected Listing Date": item.expectedListingDate || notDisclosed,
    "Expected Fund Lock-up Period": item.expectedFundLockupPeriod || notDisclosed,
    "Expected Subscription Multiple":
      item.expectedSubscriptionMultiple || notDisclosed,
    "Expected Hearing Date": item.expectedHearingDate || notDisclosed,
    "Expected Fundraising Size": item.expectedFundraisingSize || notDisclosed,
    "Source URL": item.sourceUrl,
    "Last Updated": item.lastUpdated,
    Notes: toEnglishNotes(item.notes),
  };
}

function mapPlacementRow(item: PlacementEvent) {
  return {
    "Company Name": item.companyName,
    "Stock Code": toEnglishValue(item.stockCode),
    "Expected Listing Date for New Shares":
      item.expectedNewSharesListingDate || notDisclosed,
    "Expected Fund Lock-up Period": item.expectedFundLockupPeriod || notDisclosed,
    "Expected Subscription Multiple":
      item.expectedSubscriptionMultiple || notDisclosed,
    "Expected Fundraising Size": item.expectedFundraisingSize || notDisclosed,
    "Source URL": item.sourceUrl,
    "Last Updated": item.lastUpdated,
    Notes: toEnglishNotes(item.notes),
  };
}

function mapDividendRow(item: DividendEvent) {
  return {
    "Company Name": item.companyName,
    "Stock Code": toEnglishValue(item.stockCode),
    "Expected Payment Date": item.expectedDividendDate || notDisclosed,
    "Expected Total Dividend Amount":
      item.expectedTotalDividendAmount || notDisclosed,
    "Dividend per Share": item.dividendPerShare || notDisclosed,
    "Source URL": item.sourceUrl,
    "Last Updated": item.lastUpdated,
    Notes: toEnglishNotes(item.notes),
  };
}

function toEnglishNotes(notes: string[]) {
  const translated = notes.map((note) => {
    if (note.includes("已合併人民幣櫃台重複項")) {
      return "Duplicate RMB counter row merged";
    }
    if (note.includes("派息日按公告披露")) {
      return "Payment date disclosed by announcement";
    }
    if (note.includes("派息日按記錄日後8個工作日推算")) {
      return "Payment date estimated as 8 business days after record date";
    }
    if (note.includes("按每股分紅預測")) {
      return "Estimated from dividend per share";
    }
    if (note.includes("股份數參考")) {
      return "Issued shares referenced from HKEX Southbound shareholding percentage";
    }
    if (note.includes("參考來源：HKEX IPO FAQ")) return "Reference: HKEX IPO FAQ";
    if (note.includes("參考來源：HKEX AP/PHIP")) return "Reference: HKEX AP/PHIP";
    if (note.includes("參考來源：HKEX FINI")) {
      return "Reference: HKEX FINI IPO settlement timetable";
    }
    if (note.includes("參考來源：HKEX 配發結果公告")) {
      return "Reference: HKEX allotment results announcements";
    }
    if (note.includes("參考來源：HKEX Listing Rules Chapter 8")) {
      return "Reference: HKEX Listing Rules Chapter 8";
    }
    if (note.includes("募集倍數按基準情景")) {
      return "Subscription multiple estimated by base-case scenario";
    }
    if (note.includes("聆訊時間按")) return "Hearing date estimated by rule";
    if (note.includes("募集規模按主板最低公眾市值")) {
      return "Fundraising size estimated from Main Board public market value floor";
    }
    if (note.includes("募集規模按發售股數及發售價計算")) {
      return "Fundraising size calculated from offer shares and offer price";
    }
    if (note.includes("募集規模按近期")) {
      return "Fundraising size forecast from recent peer IPO median";
    }
    if (note.includes("參考來源：HKEX 新上市資料")) {
      return "Reference: HKEX new listing information and prospectuses";
    }
    if (note.includes("同業分組")) return note.replace("同業分組", "Peer group");
    if (note.includes("募集倍數按近期同業IPO推測")) {
      return "Subscription multiple forecast from recent peer IPOs";
    }
    if (note.includes("增發募集倍數按近期同業股本融資推測")) {
      return "Placement subscription multiple forecast from recent peer equity financing";
    }
    if (note.includes("增發募集規模按近期")) {
      return "Placement fundraising size forecast from recent peer equity financing median";
    }
    if (note.includes("參考來源：HKEXnews 股本融資公告")) {
      return "Reference: HKEXnews equity financing announcements";
    }
    if (note.includes("募集資金凍結時間按聆訊後招股流程推測")) {
      return "Fund lock-up period forecast from post-hearing IPO timetable";
    }
    if (note.includes("募集資金凍結時間按上市日前工作日推測")) {
      return "Fund lock-up period forecast from business days before listing";
    }
    if (note.includes("推測")) return "Forecast by assumption";
    if (note.includes("估算")) return "Estimated by rule";
    if (note.includes("未公布")) return "Not disclosed";
    if (note.includes("未編配")) return "Not assigned";
    if (note.includes("Active 申請")) return note.replace("申請", "active application");
    if (note.includes("PHIP 已刊發")) return "PHIP published";
    if (note.includes("申請版本已刊發")) return "Application Proof published";
    if (note.includes("最新刊發日期")) return note.replace("最新刊發日期", "Latest posting date");
    if (note.includes("PDF")) return "PDF text could not be extracted";
    if (note.includes("分紅及權益表")) return "Official HKEX dividend and entitlement table";
    if (note.includes("中國內地主營業務")) return "Mainland China principal business filter";
    if (note.includes("股本融資事項")) return "Equity fundraising event";
    if (note.includes("公告搜尋")) return "HKEXnews title search result";
    if (note.includes("官方頁面")) return "Official HKEX page";
    if (note.includes("已披露認購價")) return note.replace("已披露認購價", "Offer price disclosed");
    return note;
  });

  return Array.from(new Set(translated)).join("; ");
}

function toEnglishValue(value: string | null) {
  if (!value || value === "未公布") return notDisclosed;
  if (value === "未編配") return "Not assigned";
  return value;
}

const emptyIpo: IpoEvent = {
  id: "",
  kind: "ipo",
  companyName: "",
  stockCode: "",
  expectedListingDate: null,
  expectedFundLockupPeriod: null,
  expectedSubscriptionMultiple: null,
  expectedHearingDate: null,
  expectedFundraisingSize: null,
  sourceUrl: "",
  lastUpdated: "",
  notes: [],
};

const emptyPlacement: PlacementEvent = {
  id: "",
  kind: "placement",
  companyName: "",
  stockCode: "",
  expectedNewSharesListingDate: null,
  expectedFundLockupPeriod: null,
  expectedSubscriptionMultiple: null,
  expectedFundraisingSize: null,
  sourceUrl: "",
  lastUpdated: "",
  notes: [],
};

const emptyDividend: DividendEvent = {
  id: "",
  kind: "dividend",
  companyName: "",
  stockCode: "",
  expectedDividendDate: null,
  expectedTotalDividendAmount: null,
  dividendPerShare: null,
  sourceUrl: "",
  lastUpdated: "",
  notes: [],
};
