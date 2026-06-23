"use client";

import {
  AlertCircle,
  CalendarDays,
  Download,
  ExternalLink,
  Languages,
  RefreshCw,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import type {
  CorporateActionKind,
  DashboardResponse,
  DividendEvent,
  IpoEvent,
  PlacementEvent,
  UiCorporateAction,
} from "@/lib/types";

type IpoSortKey = "listingDate" | "hearingDate" | "fundraisingSize";
type PlacementSortKey = "listingDate" | "fundraisingSize";
type DividendSortKey = "dividendDate" | "totalAmount";
type Language = "zh" | "en";
type WeeklySummaryKind = CorporateActionKind;

type WeeklySummaryItem = {
  key: WeeklySummaryKind;
  totalUsd: number;
  eventCount: number;
  amountCount: number;
};

type WeeklySummary = {
  startDate: string;
  endDate: string;
  items: WeeklySummaryItem[];
  totalUsd: number;
};

type IpoTableLabels = {
  company: string;
  code: string;
  listingDate: string;
  lockup: string;
  multiple: string;
  hearing: string;
  fundraising: string;
  notes: string;
  source: string;
};

type PlacementTableLabels = {
  company: string;
  code: string;
  listingDate: string;
  lockup: string;
  multiple: string;
  fundraising: string;
  notes: string;
  source: string;
};

type DividendTableLabels = {
  company: string;
  code: string;
  paymentDate: string;
  totalAmount: string;
  perShare: string;
  notes: string;
  source: string;
};

type UiText = {
  pageLanguageLabel: string;
  zhButton: string;
  enButton: string;
  tabs: Record<CorporateActionKind, string>;
  ipoSortOptions: Array<{ key: IpoSortKey; label: string }>;
  placementSortOptions: Array<{ key: PlacementSortKey; label: string }>;
  dividendSortOptions: Array<{ key: DividendSortKey; label: string }>;
  officialKicker: string;
  title: string;
  subtitle: string;
  contact: string;
  refresh: string;
  refreshTitleRemote: string;
  refreshTitleStatic: string;
  downloadExcel: string;
  lastUpdated: string;
  refreshTime: string;
  summaryAria: string;
  weeklySummaryAria: string;
  weeklySummaryKicker: string;
  weeklySummaryTitle: string;
  weeklySummaryDescription: (startDate: string, endDate: string) => string;
  weeklyTotal: string;
  weeklyCount: (amountCount: number, eventCount: number) => string;
  searchPlaceholder: string;
  sort: string;
  futureThreeMonths: string;
  tableIntro: (visible: number, total: number, active: CorporateActionKind) => string;
  loading: string;
  empty: string;
  source: string;
  notDisclosed: string;
  refreshPending: string;
  refreshUpdated: string;
  refreshNoUpdate: string;
  refreshStillRunning: string;
  refreshStaticReloaded: string;
  refreshRateLimited: (date?: Date) => string;
  refreshRequestFailed: (status: number) => string;
  refreshSubmitFailed: string;
  loadFailed: string;
  ipoTable: IpoTableLabels;
  placementTable: PlacementTableLabels;
  dividendTable: DividendTableLabels;
};

const uiText: Record<Language, UiText> = {
  zh: {
    pageLanguageLabel: "語言",
    zhButton: "繁",
    enButton: "EN",
    tabs: { ipo: "IPO", placement: "增發", dividend: "中資分紅" },
    ipoSortOptions: [
      { key: "listingDate", label: "按預計上市時間" },
      { key: "hearingDate", label: "按聆訊時間" },
      { key: "fundraisingSize", label: "按募集規模由大到小" },
    ],
    placementSortOptions: [
      { key: "listingDate", label: "按上市時間" },
      { key: "fundraisingSize", label: "按募集規模由大到小" },
    ],
    dividendSortOptions: [
      { key: "dividendDate", label: "按派息日" },
      { key: "totalAmount", label: "按分紅總規模由大到小" },
    ],
    officialKicker: "官方公開資料 · 未來三個月",
    title: "香港上市公司事項查詢",
    subtitle:
      "讀取後台已生成的港交所 IPO、增發及中資分紅資料快照；IPO 包含已刊發招股書及仍在申請階段的 AP/PHIP 公司，中資分紅只顯示中國內地主營業務公司。",
    contact: "聯繫：",
    refresh: "刷新",
    refreshTitleRemote: "提交後台資料刷新",
    refreshTitleStatic: "重新讀取靜態資料",
    downloadExcel: "下載 Excel",
    lastUpdated: "最後更新",
    refreshTime: "刷新時間",
    summaryAria: "資料摘要",
    weeklySummaryAria: "未來一周美元規模匯總",
    weeklySummaryKicker: "未來一周 · 美元口徑",
    weeklySummaryTitle: "IPO、增發及中資分紅規模匯總",
    weeklySummaryDescription: (startDate, endDate) =>
      `${startDate} 至 ${endDate}，以香港日期計算；未公布金額不計入。換算假設：HKD 7.80/USD，RMB 7.20/USD。`,
    weeklyTotal: "合計",
    weeklyCount: (amountCount, eventCount) =>
      `${amountCount} 筆有金額 / ${eventCount} 筆事項`,
    searchPlaceholder: "搜尋公司名稱或代號",
    sort: "排序",
    futureThreeMonths: "未來三個月",
    tableIntro: (visible, total, active) =>
      "顯示 " +
      visible +
      " 筆；全部事項 " +
      total +
      " 筆。" +
      (active === "dividend" ? "中資分紅已按中國內地主營業務篩選。" : "") +
      "未公布及估算值會以標籤標示。",
    loading: "正在載入官方資料...",
    empty: "目前沒有符合條件的資料。",
    source: "來源",
    notDisclosed: "未公布",
    refreshPending: "已提交後台刷新，資料生成及發布通常需要數分鐘。同一 IP 12 小時內只能刷新一次。",
    refreshUpdated: "現在資料已更新，你在12小時之內無法再請求刷新資料。",
    refreshNoUpdate: "數據刷新失敗，或數據/估算沒有變化。本次不做更新。",
    refreshStillRunning: "已提交後台刷新，資料仍在生成或發布中；請稍後再重新載入資料。",
    refreshStaticReloaded: "已重新載入最新已發布資料。若需要重新抓取官方資料，請使用公開網站的後台刷新。",
    refreshRateLimited: (date) =>
      date
        ? "此 IP 於 12 小時內已刷新過。下次可刷新時間：" + formatMinute(date, "zh") + "。"
        : "此 IP 於 12 小時內已刷新過，請稍後再試。",
    refreshRequestFailed: (status) => "刷新請求失敗 " + status,
    refreshSubmitFailed: "無法提交刷新請求",
    loadFailed: "無法載入資料",
    ipoTable: {
      company: "公司名稱",
      code: "代號",
      listingDate: "預計上市時間",
      lockup: "募集資金凍結時間",
      multiple: "募集倍數",
      hearing: "聆訊時間",
      fundraising: "募集規模",
      notes: "備註",
      source: "來源",
    },
    placementTable: {
      company: "公司名稱",
      code: "代號",
      listingDate: "新股上市時間",
      lockup: "募集資金凍結時間",
      multiple: "募集倍數",
      fundraising: "募集規模",
      notes: "備註",
      source: "來源",
    },
    dividendTable: {
      company: "公司名稱",
      code: "代號",
      paymentDate: "預計派息日",
      totalAmount: "分紅總規模",
      perShare: "每股分紅",
      notes: "備註",
      source: "來源",
    },
  },
  en: {
    pageLanguageLabel: "Language",
    zhButton: "繁",
    enButton: "EN",
    tabs: { ipo: "IPO", placement: "Placements", dividend: "China Dividends" },
    ipoSortOptions: [
      { key: "listingDate", label: "Expected listing date" },
      { key: "hearingDate", label: "Hearing date" },
      { key: "fundraisingSize", label: "Fundraising size high to low" },
    ],
    placementSortOptions: [
      { key: "listingDate", label: "Listing date" },
      { key: "fundraisingSize", label: "Fundraising size high to low" },
    ],
    dividendSortOptions: [
      { key: "dividendDate", label: "Payment date" },
      { key: "totalAmount", label: "Total dividend amount high to low" },
    ],
    officialKicker: "Official public data · Next three months",
    title: "Hong Kong Listed Company Events",
    subtitle:
      "Reads the latest generated HKEX IPO, placement and China dividend snapshot. IPO includes published prospectuses and AP/PHIP applicants still in the pipeline. China dividends only show companies with Mainland China principal business.",
    contact: "Contact: ",
    refresh: "Refresh",
    refreshTitleRemote: "Submit background data refresh",
    refreshTitleStatic: "Reload static data",
    downloadExcel: "Download Excel",
    lastUpdated: "Last Updated",
    refreshTime: "Refresh Time",
    summaryAria: "Data summary",
    weeklySummaryAria: "Next-week USD size summary",
    weeklySummaryKicker: "Next 7 days · USD view",
    weeklySummaryTitle: "IPO, placement and China dividend size summary",
    weeklySummaryDescription: (startDate, endDate) =>
      `${startDate} to ${endDate}, based on Hong Kong dates. Undisclosed amounts are excluded. FX assumptions: HKD 7.80/USD, RMB 7.20/USD.`,
    weeklyTotal: "Total",
    weeklyCount: (amountCount, eventCount) =>
      `${amountCount} with amounts / ${eventCount} events`,
    searchPlaceholder: "Search company name or code",
    sort: "Sort",
    futureThreeMonths: "Next three months",
    tableIntro: (visible, total, active) =>
      "Showing " +
      visible +
      "; total events " +
      total +
      ". " +
      (active === "dividend"
        ? "China dividends are filtered by Mainland China principal business. "
        : "") +
      "Undisclosed and estimated values are shown with tags.",
    loading: "Loading official data...",
    empty: "No matching data.",
    source: "Source",
    notDisclosed: "Not disclosed",
    refreshPending: "Background refresh submitted. Data generation and publishing usually take a few minutes. The same IP can refresh once every 12 hours.",
    refreshUpdated: "Data is now updated. You cannot request another refresh within 12 hours.",
    refreshNoUpdate: "Data refresh failed, or data/estimates did not change. No update was made.",
    refreshStillRunning: "Background refresh was submitted and data is still generating or publishing. Please reload later.",
    refreshStaticReloaded: "Latest published data reloaded. To fetch official data again, use the public site's background refresh.",
    refreshRateLimited: (date) =>
      date
        ? "This IP has refreshed within the last 12 hours. Next refresh time: " + formatMinute(date, "en") + "."
        : "This IP has refreshed within the last 12 hours. Please try again later.",
    refreshRequestFailed: (status) => "Refresh request failed " + status,
    refreshSubmitFailed: "Unable to submit refresh request",
    loadFailed: "Unable to load data",
    ipoTable: {
      company: "Company Name",
      code: "Code",
      listingDate: "Expected Listing Date",
      lockup: "Fund Lock-up Period",
      multiple: "Subscription Multiple",
      hearing: "Hearing Date",
      fundraising: "Fundraising Size",
      notes: "Notes",
      source: "Source",
    },
    placementTable: {
      company: "Company Name",
      code: "Code",
      listingDate: "New Shares Listing Date",
      lockup: "Fund Lock-up Period",
      multiple: "Subscription Multiple",
      fundraising: "Fundraising Size",
      notes: "Notes",
      source: "Source",
    },
    dividendTable: {
      company: "Company Name",
      code: "Code",
      paymentDate: "Expected Payment Date",
      totalAmount: "Total Dividend Amount",
      perShare: "Dividend per Share",
      notes: "Notes",
      source: "Source",
    },
  },
};

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const refreshEndpoint = process.env.NEXT_PUBLIC_REFRESH_ENDPOINT || "";
const refreshPollIntervalMs = 10_000;
const refreshPollAttempts = 30;

function staticAssetPath(path: string) {
  return `${basePath}${path}`;
}

function formatMinute(value: Date, language: Language) {
  return value.toLocaleString(language === "en" ? "en-HK" : "zh-HK", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function toDateLabel(value: string | null, missingLabel: string) {
  return value || missingLabel;
}

function showValue(
  value: string | number | null | undefined,
  missingLabel: string,
) {
  if (value === null || value === undefined || value === "") return missingLabel;
  return String(value);
}

function hasEstimate(item: UiCorporateAction) {
  return item.notes.some((note) => note.includes("估算") || note.includes("推測"));
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchLatestSnapshot() {
  const response = await fetch(`${staticAssetPath("/data/latest.json")}?t=${Date.now()}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`靜態資料回應 ${response.status}`);
  }
  return (await response.json()) as DashboardResponse;
}

function isNewerSnapshot(nextGeneratedAt: string, previousGeneratedAt: string | null) {
  if (!previousGeneratedAt) return true;
  return new Date(nextGeneratedAt).getTime() > new Date(previousGeneratedAt).getTime();
}

function didRefreshProduceNoUpdate(snapshot: DashboardResponse) {
  return snapshot.refreshStatus === "preserved" || snapshot.refreshStatus === "unchanged";
}

export default function Home() {
  const [language, setLanguage] = useState<Language>("zh");
  const [active, setActive] = useState<CorporateActionKind>("ipo");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ipoSort, setIpoSort] = useState<IpoSortKey>("listingDate");
  const [placementSort, setPlacementSort] =
    useState<PlacementSortKey>("listingDate");
  const [dividendSort, setDividendSort] =
    useState<DividendSortKey>("dividendDate");

  const t = uiText[language];

  useEffect(() => {
    const storedLanguage = window.localStorage.getItem("hkex-dashboard-language");
    if (storedLanguage === "zh" || storedLanguage === "en") {
      setLanguage(storedLanguage);
    }
  }, []);

  const setPreferredLanguage = useCallback((nextLanguage: Language) => {
    setLanguage(nextLanguage);
    window.localStorage.setItem("hkex-dashboard-language", nextLanguage);
  }, []);

  const loadData = useCallback(async (force = false) => {
    setError(null);
    setRefreshing(force);
    setLoading((previous) => previous || !force);
    try {
      const json = await fetchLatestSnapshot();
      setData(json);
      setLastRefreshAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : t.loadFailed);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t.loadFailed]);

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  const waitForUpdatedData = useCallback(async (previousGeneratedAt: string | null) => {
    for (let attempt = 0; attempt < refreshPollAttempts; attempt += 1) {
      await wait(refreshPollIntervalMs);
      const latest = await fetchLatestSnapshot();
      setData(latest);
      setLastRefreshAt(new Date());

      if (isNewerSnapshot(latest.generatedAt, previousGeneratedAt)) {
        setRefreshMessage(
          didRefreshProduceNoUpdate(latest) ? t.refreshNoUpdate : t.refreshUpdated,
        );
        return;
      }
    }

    setRefreshMessage(
      t.refreshStillRunning,
    );
  }, [t.refreshNoUpdate, t.refreshStillRunning, t.refreshUpdated]);

  const handleRefresh = useCallback(async () => {
    setRefreshMessage(null);

    if (!refreshEndpoint) {
      await loadData(true);
      setRefreshMessage(t.refreshStaticReloaded);
      return;
    }

    const previousGeneratedAt = data?.generatedAt ?? null;
    setError(null);
    setRefreshing(true);
    try {
      const response = await fetch(refreshEndpoint, {
        method: "POST",
      });
      const result = (await response.json().catch(() => ({}))) as {
        message?: string;
        nextAllowedAt?: string;
      };

      if (response.status === 429) {
        setRefreshMessage(t.refreshRateLimited(result.nextAllowedAt ? new Date(result.nextAllowedAt) : undefined));
        await loadData(false);
        return;
      }

      if (!response.ok) {
        throw new Error(result.message || t.refreshRequestFailed(response.status));
      }

      setRefreshMessage(t.refreshPending);
      await waitForUpdatedData(previousGeneratedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.refreshSubmitFailed);
    } finally {
      setRefreshing(false);
    }
  }, [data?.generatedAt, loadData, t, waitForUpdatedData]);

  const rows = useMemo(() => {
    if (!data) return [];
    const source =
      active === "ipo"
        ? data.ipo
        : active === "placement"
          ? data.placements
          : data.dividends;
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = normalizedQuery
      ? source.filter((item) => {
          return [item.companyName, item.stockCode]
            .filter(Boolean)
            .some((value) => value.toLowerCase().includes(normalizedQuery));
        })
      : source;

    if (active === "ipo") {
      return sortIpoRows(filtered as IpoEvent[], ipoSort);
    }

    if (active === "dividend") {
      return sortDividendRows(filtered as DividendEvent[], dividendSort);
    }

    return sortPlacementRows(filtered as PlacementEvent[], placementSort);
  }, [active, data, dividendSort, ipoSort, placementSort, query]);

  const weeklySummary = useMemo(() => {
    if (!data) return null;
    return buildWeeklySummary(data);
  }, [data]);

  const totalCount = data
    ? data.ipo.length + data.placements.length + data.dividends.length
    : 0;

  return (
    <main className={styles.shell}>
      <section className={styles.header}>
        <div>
          <p className={styles.kicker}>{t.officialKicker}</p>
          <h1>{t.title}</h1>
          <p className={styles.subtitle}>{t.subtitle}</p>
        </div>
        <div className={styles.actions}>
          <div className={styles.contact}>
            {t.contact}
            <a href="mailto:songtaozhang@gmail.com">songtaozhang@gmail.com</a>
          </div>
          <div className={styles.languageToggle} aria-label={t.pageLanguageLabel}>
            <Languages size={16} />
            <button
              type="button"
              className={language === "zh" ? styles.activeLanguage : styles.languageButton}
              onClick={() => setPreferredLanguage("zh")}
              aria-pressed={language === "zh"}
            >
              {t.zhButton}
            </button>
            <button
              type="button"
              className={language === "en" ? styles.activeLanguage : styles.languageButton}
              onClick={() => setPreferredLanguage("en")}
              aria-pressed={language === "en"}
            >
              {t.enButton}
            </button>
          </div>
          <button
            className={styles.secondaryButton}
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            title={refreshEndpoint ? t.refreshTitleRemote : t.refreshTitleStatic}
          >
            <RefreshCw size={18} className={refreshing ? styles.spin : ""} />
            {t.refresh}
          </button>
          <a
            className={styles.primaryButton}
            href={staticAssetPath("/data/latest.xlsx")}
            download="hk-corp-actions-latest.xlsx"
          >
            <Download size={18} />
            {t.downloadExcel}
          </a>
        </div>
      </section>

      <section className={styles.summaryGrid} aria-label={t.summaryAria}>
        <SummaryCard label={t.tabs.ipo} value={data?.ipo.length ?? 0} />
        <SummaryCard label={t.tabs.placement} value={data?.placements.length ?? 0} />
        <SummaryCard label={t.tabs.dividend} value={data?.dividends.length ?? 0} />
        <SummaryCard
          label={t.lastUpdated}
          value={data ? formatMinute(new Date(data.generatedAt), language) : "--"}
        />
        <SummaryCard
          label={t.refreshTime}
          value={lastRefreshAt ? formatMinute(lastRefreshAt, language) : "--"}
        />
      </section>

      {weeklySummary ? (
        <WeeklySummaryPanel
          summary={weeklySummary}
          labels={t}
          language={language}
        />
      ) : null}

      <section className={styles.controls}>
        <div className={styles.tabs} role="tablist" aria-label={t.pageLanguageLabel === "Language" ? "Event type" : "事項類型"}>
          {Object.entries(t.tabs).map(([key, label]) => {
            const tab = { key: key as CorporateActionKind, label };
            return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={active === tab.key}
              className={active === tab.key ? styles.activeTab : styles.tab}
              onClick={() => setActive(tab.key)}
            >
              {tab.label}
            </button>
          );
          })}
        </div>
        <label className={styles.searchBox}>
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchPlaceholder}
          />
        </label>
      </section>

      {error ? (
        <div className={styles.notice} role="alert">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      ) : null}

      {refreshMessage ? (
        <div className={styles.notice} role="status">
          <RefreshCw size={20} />
          <span>{refreshMessage}</span>
        </div>
      ) : null}

      <section className={styles.tablePanel}>
        <div className={styles.tableHeader}>
          <div>
            <h2>{t.tabs[active]}</h2>
            <p>{t.tableIntro(rows.length, totalCount, active)}</p>
          </div>
          <div className={styles.tableHeaderActions}>
            {active === "ipo" ? (
              <SortSelect
                label={t.sort}
                value={ipoSort}
                options={t.ipoSortOptions}
                onChange={(value) => setIpoSort(value as IpoSortKey)}
              />
            ) : active === "placement" ? (
              <SortSelect
                label={t.sort}
                value={placementSort}
                options={t.placementSortOptions}
                onChange={(value) => setPlacementSort(value as PlacementSortKey)}
              />
            ) : active === "dividend" ? (
              <SortSelect
                label={t.sort}
                value={dividendSort}
                options={t.dividendSortOptions}
                onChange={(value) => setDividendSort(value as DividendSortKey)}
              />
            ) : null}
            <div className={styles.rangeBadge}>
              <CalendarDays size={16} />
              {t.futureThreeMonths}
            </div>
          </div>
        </div>

        {loading ? (
          <div className={styles.emptyState}>{t.loading}</div>
        ) : rows.length === 0 ? (
          <div className={styles.emptyState}>{t.empty}</div>
        ) : (
          <div className={styles.tableScroll}>
            {active === "ipo" ? (
              <IpoTable rows={rows as IpoEvent[]} labels={t.ipoTable} sourceLabel={t.source} missingLabel={t.notDisclosed} />
            ) : active === "placement" ? (
              <PlacementTable rows={rows as PlacementEvent[]} labels={t.placementTable} sourceLabel={t.source} missingLabel={t.notDisclosed} />
            ) : (
              <DividendTable rows={rows as DividendEvent[]} labels={t.dividendTable} sourceLabel={t.source} missingLabel={t.notDisclosed} />
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function SortSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ key: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <label className={styles.sortBox}>
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        aria-label={label}
      >
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SummaryCard({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string | number;
  wide?: boolean;
}) {
  return (
    <div className={`${styles.summaryCard} ${wide ? styles.wideCard : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function WeeklySummaryPanel({
  summary,
  labels,
  language,
}: {
  summary: WeeklySummary;
  labels: UiText;
  language: Language;
}) {
  return (
    <section className={styles.weeklySummary} aria-label={labels.weeklySummaryAria}>
      <div className={styles.weeklySummaryIntro}>
        <span>{labels.weeklySummaryKicker}</span>
        <h2>{labels.weeklySummaryTitle}</h2>
        <p>
          {labels.weeklySummaryDescription(
            formatDateKey(summary.startDate, language),
            formatDateKey(summary.endDate, language),
          )}
        </p>
      </div>
      <div className={styles.weeklySummaryCards}>
        <WeeklyAmountCard
          label={labels.weeklyTotal}
          value={summary.totalUsd}
          detail={labels.weeklyCount(
            summary.items.reduce((total, item) => total + item.amountCount, 0),
            summary.items.reduce((total, item) => total + item.eventCount, 0),
          )}
          language={language}
          emphasized
        />
        {summary.items.map((item) => (
          <WeeklyAmountCard
            key={item.key}
            label={labels.tabs[item.key]}
            value={item.totalUsd}
            detail={labels.weeklyCount(item.amountCount, item.eventCount)}
            language={language}
          />
        ))}
      </div>
    </section>
  );
}

function WeeklyAmountCard({
  label,
  value,
  detail,
  language,
  emphasized = false,
}: {
  label: string;
  value: number;
  detail: string;
  language: Language;
  emphasized?: boolean;
}) {
  return (
    <div
      className={
        emphasized
          ? `${styles.weeklyAmountCard} ${styles.weeklyAmountCardPrimary}`
          : styles.weeklyAmountCard
      }
    >
      <span>{label}</span>
      <strong>{formatUsd(value, language)}</strong>
      <small>{detail}</small>
    </div>
  );
}

function sortIpoRows(rows: IpoEvent[], sortKey: IpoSortKey) {
  const sorted = [...rows];
  if (sortKey === "listingDate") {
    return sorted.sort((a, b) =>
      compareDateAsc(a.expectedListingDate, b.expectedListingDate),
    );
  }
  if (sortKey === "hearingDate") {
    return sorted.sort((a, b) =>
      compareDateAsc(a.expectedHearingDate, b.expectedHearingDate),
    );
  }
  return sorted.sort((a, b) =>
    compareAmountDesc(a.expectedFundraisingSize, b.expectedFundraisingSize),
  );
}

function sortDividendRows(rows: DividendEvent[], sortKey: DividendSortKey) {
  const sorted = [...rows];
  if (sortKey === "dividendDate") {
    return sorted.sort((a, b) =>
      compareDateAsc(a.expectedDividendDate, b.expectedDividendDate),
    );
  }
  return sorted.sort((a, b) =>
    compareAmountDesc(a.expectedTotalDividendAmount, b.expectedTotalDividendAmount),
  );
}

function sortPlacementRows(rows: PlacementEvent[], sortKey: PlacementSortKey) {
  const sorted = [...rows];
  if (sortKey === "listingDate") {
    return sorted.sort((a, b) =>
      compareDateAsc(a.expectedNewSharesListingDate, b.expectedNewSharesListingDate),
    );
  }
  return sorted.sort((a, b) =>
    compareAmountDesc(a.expectedFundraisingSize, b.expectedFundraisingSize),
  );
}

function compareDateAsc(a: string | null, b: string | null) {
  return dateRank(a) - dateRank(b);
}

function compareAmountDesc(a: string | null, b: string | null) {
  return amountRank(b) - amountRank(a);
}

function dateRank(value: string | null) {
  if (!value) return Number.POSITIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

function amountRank(value: string | null) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const amountMatch = value.replace(/,/g, "").match(/([\d.]+)/);
  if (!amountMatch) return Number.NEGATIVE_INFINITY;

  const number = Number(amountMatch[1]);
  if (!Number.isFinite(number)) return Number.NEGATIVE_INFINITY;

  const lower = value.toLowerCase();
  const unitMultiplier = lower.includes("billion")
    ? 1_000_000_000
    : lower.includes("million")
      ? 1_000_000
      : lower.includes("bn")
        ? 1_000_000_000
        : lower.includes("m")
          ? 1_000_000
          : 1;
  const currencyMultiplier = lower.includes("usd") || lower.includes("us$")
    ? 7.8
    : lower.includes("rmb")
      ? 1.08
      : 1;

  return number * unitMultiplier * currencyMultiplier;
}

function buildWeeklySummary(data: DashboardResponse): WeeklySummary {
  const startDate = getHongKongDateKey();
  const endDate = addDaysToDateKey(startDate, 6);
  const ipo = summarizeWeeklyItems(
    data.ipo,
    (item) => item.expectedListingDate,
    (item) => item.expectedFundraisingSize,
  );
  const placements = summarizeWeeklyItems(
    data.placements,
    (item) => item.expectedNewSharesListingDate,
    (item) => item.expectedFundraisingSize,
  );
  const dividends = summarizeWeeklyItems(
    data.dividends,
    (item) => item.expectedDividendDate,
    (item) => item.expectedTotalDividendAmount,
  );
  const items: WeeklySummaryItem[] = [
    { key: "ipo", ...ipo },
    { key: "placement", ...placements },
    { key: "dividend", ...dividends },
  ];

  return {
    startDate,
    endDate,
    items,
    totalUsd: items.reduce((total, item) => total + item.totalUsd, 0),
  };

  function summarizeWeeklyItems<T>(
    itemsToSummarize: T[],
    getDate: (item: T) => string | null,
    getAmount: (item: T) => string | null,
  ) {
    return itemsToSummarize.reduce(
      (summary, item) => {
        const dateKey = extractDateKey(getDate(item));
        if (!dateKey || dateKey < startDate || dateKey > endDate) {
          return summary;
        }

        const amountUsd = parseMoneyToUsd(getAmount(item));
        return {
          eventCount: summary.eventCount + 1,
          amountCount: summary.amountCount + (amountUsd === null ? 0 : 1),
          totalUsd: summary.totalUsd + (amountUsd ?? 0),
        };
      },
      { totalUsd: 0, eventCount: 0, amountCount: 0 },
    );
  }
}

function getHongKongDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function extractDateKey(value: string | null) {
  return value?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

function formatDateKey(dateKey: string, language: Language) {
  const date = new Date(`${dateKey}T00:00:00+08:00`);
  return date.toLocaleDateString(language === "en" ? "en-HK" : "zh-HK", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function parseMoneyToUsd(value: string | null) {
  if (!value) return null;
  const clean = value.replace(/,/g, "").replace(/\s+/g, " ");
  const match = clean.match(
    /(?:HK\$|HKD|RMB|CNY|US\$|USD)?\s*([\d.]+)\s*(billion|million|bn|m)?/i,
  );
  if (!match) return null;

  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;

  const unit = match[2]?.toLowerCase();
  const unitMultiplier =
    unit === "billion" || unit === "bn"
      ? 1_000_000_000
      : unit === "million" || unit === "m"
        ? 1_000_000
        : 1;

  const currency = detectCurrency(clean);
  const usdRate =
    currency === "USD" ? 1 : currency === "RMB" || currency === "CNY" ? 1 / 7.2 : 1 / 7.8;

  return number * unitMultiplier * usdRate;
}

function detectCurrency(value: string) {
  const upper = value.toUpperCase();
  if (upper.includes("USD") || upper.includes("US$")) return "USD";
  if (upper.includes("RMB")) return "RMB";
  if (upper.includes("CNY")) return "CNY";
  return "HKD";
}

function formatUsd(value: number, language: Language) {
  if (!Number.isFinite(value) || value <= 0) return "US$0";
  const locale = language === "en" ? "en-US" : "zh-HK";
  if (value >= 1_000_000_000) {
    return `US$${formatCompactNumber(value / 1_000_000_000, locale)} billion`;
  }
  if (value >= 1_000_000) {
    return `US$${formatCompactNumber(value / 1_000_000, locale)} million`;
  }
  if (value >= 1_000) {
    return `US$${formatCompactNumber(value / 1_000, locale)} thousand`;
  }
  return `US$${Math.round(value).toLocaleString(locale)}`;
}

function formatCompactNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: value >= 10 ? 1 : 2,
  }).format(value);
}

function SourceLink({ url, label }: { url: string; label: string }) {
  return (
    <a className={styles.sourceLink} href={url} target="_blank" rel="noreferrer">
      {label}
      <ExternalLink size={14} />
    </a>
  );
}

function Notes({ item }: { item: UiCorporateAction }) {
  if (item.notes.length === 0) return <span className={styles.muted}>--</span>;
  return (
    <div className={styles.notes}>
      {item.notes.map((note) => (
        <span
          key={note}
          className={
            note.includes("估算") || note.includes("推測")
              ? styles.estimateTag
              : styles.noteTag
          }
        >
          {note}
        </span>
      ))}
    </div>
  );
}

function IpoTable({
  rows,
  labels,
  sourceLabel,
  missingLabel,
}: {
  rows: IpoEvent[];
  labels: IpoTableLabels;
  sourceLabel: string;
  missingLabel: string;
}) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>{labels.company}</th>
          <th>{labels.code}</th>
          <th>{labels.listingDate}</th>
          <th>{labels.lockup}</th>
          <th>{labels.multiple}</th>
          <th>{labels.hearing}</th>
          <th>{labels.fundraising}</th>
          <th>{labels.notes}</th>
          <th>{labels.source}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className={hasEstimate(row) ? styles.estimatedRow : ""}>
            <td>{row.companyName}</td>
            <td>{row.stockCode}</td>
            <td>{toDateLabel(row.expectedListingDate, missingLabel)}</td>
            <td>{showValue(row.expectedFundLockupPeriod, missingLabel)}</td>
            <td>{showValue(row.expectedSubscriptionMultiple, missingLabel)}</td>
            <td>{toDateLabel(row.expectedHearingDate, missingLabel)}</td>
            <td>{showValue(row.expectedFundraisingSize, missingLabel)}</td>
            <td>
              <Notes item={row} />
            </td>
            <td>
              <SourceLink url={row.sourceUrl} label={sourceLabel} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PlacementTable({
  rows,
  labels,
  sourceLabel,
  missingLabel,
}: {
  rows: PlacementEvent[];
  labels: PlacementTableLabels;
  sourceLabel: string;
  missingLabel: string;
}) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>{labels.company}</th>
          <th>{labels.code}</th>
          <th>{labels.listingDate}</th>
          <th>{labels.lockup}</th>
          <th>{labels.multiple}</th>
          <th>{labels.fundraising}</th>
          <th>{labels.notes}</th>
          <th>{labels.source}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className={hasEstimate(row) ? styles.estimatedRow : ""}>
            <td>{row.companyName}</td>
            <td>{row.stockCode}</td>
            <td>{toDateLabel(row.expectedNewSharesListingDate, missingLabel)}</td>
            <td>{showValue(row.expectedFundLockupPeriod, missingLabel)}</td>
            <td>{showValue(row.expectedSubscriptionMultiple, missingLabel)}</td>
            <td>{showValue(row.expectedFundraisingSize, missingLabel)}</td>
            <td>
              <Notes item={row} />
            </td>
            <td>
              <SourceLink url={row.sourceUrl} label={sourceLabel} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DividendTable({
  rows,
  labels,
  sourceLabel,
  missingLabel,
}: {
  rows: DividendEvent[];
  labels: DividendTableLabels;
  sourceLabel: string;
  missingLabel: string;
}) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>{labels.company}</th>
          <th>{labels.code}</th>
          <th>{labels.paymentDate}</th>
          <th>{labels.totalAmount}</th>
          <th>{labels.perShare}</th>
          <th>{labels.notes}</th>
          <th>{labels.source}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className={hasEstimate(row) ? styles.estimatedRow : ""}>
            <td>{row.companyName}</td>
            <td>{row.stockCode}</td>
            <td>{toDateLabel(row.expectedDividendDate, missingLabel)}</td>
            <td>{showValue(row.expectedTotalDividendAmount, missingLabel)}</td>
            <td>{showValue(row.dividendPerShare, missingLabel)}</td>
            <td>
              <Notes item={row} />
            </td>
            <td>
              <SourceLink url={row.sourceUrl} label={sourceLabel} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
