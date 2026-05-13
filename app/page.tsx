"use client";

import {
  AlertCircle,
  CalendarDays,
  Download,
  ExternalLink,
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

const tabs: Array<{ key: CorporateActionKind; label: string }> = [
  { key: "ipo", label: "IPO" },
  { key: "placement", label: "增發" },
  { key: "dividend", label: "中資分紅" },
];

const kindLabels: Record<CorporateActionKind, string> = {
  ipo: "IPO",
  placement: "增發",
  dividend: "中資分紅",
};

const ipoSortOptions: Array<{ key: IpoSortKey; label: string }> = [
  { key: "listingDate", label: "按預計上市時間" },
  { key: "hearingDate", label: "按聆訊時間" },
  { key: "fundraisingSize", label: "按募集規模由大到小" },
];

const placementSortOptions: Array<{ key: PlacementSortKey; label: string }> = [
  { key: "listingDate", label: "按上市時間" },
  { key: "fundraisingSize", label: "按募集規模由大到小" },
];

const dividendSortOptions: Array<{ key: DividendSortKey; label: string }> = [
  { key: "dividendDate", label: "按派息日" },
  { key: "totalAmount", label: "按分紅總規模由大到小" },
];

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const refreshEndpoint = process.env.NEXT_PUBLIC_REFRESH_ENDPOINT || "";
const refreshPendingMessage =
  "已提交後台刷新，資料生成及發布通常需要數分鐘。同一 IP 24 小時內只能刷新一次。";
const refreshUpdatedMessage = "現在資料已更新，你在24小時之內無法再請求刷新資料。";
const refreshPollIntervalMs = 10_000;
const refreshPollAttempts = 30;

function staticAssetPath(path: string) {
  return `${basePath}${path}`;
}

function formatMinute(value: Date) {
  return value.toLocaleString("zh-HK", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function toDateLabel(value: string | null) {
  return value || "未公布";
}

function showValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "未公布";
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

export default function Home() {
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

  const loadData = useCallback(async (force = false) => {
    setError(null);
    setRefreshing(force);
    setLoading((previous) => previous || !force);
    try {
      const json = await fetchLatestSnapshot();
      setData(json);
      setLastRefreshAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法載入資料");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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
        setRefreshMessage(refreshUpdatedMessage);
        return;
      }
    }

    setRefreshMessage(
      "已提交後台刷新，資料仍在生成或發布中；請稍後再重新載入資料。",
    );
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshMessage(null);

    if (!refreshEndpoint) {
      await loadData(true);
      setRefreshMessage("已重新載入最新已發布資料。若需要重新抓取官方資料，請使用公開網站的後台刷新。");
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
        setRefreshMessage(
          result.nextAllowedAt
            ? `此 IP 於 24 小時內已刷新過。下次可刷新時間：${formatMinute(
                new Date(result.nextAllowedAt),
              )}。`
            : "此 IP 於 24 小時內已刷新過，請稍後再試。",
        );
        await loadData(false);
        return;
      }

      if (!response.ok) {
        throw new Error(result.message || `刷新請求失敗 ${response.status}`);
      }

      setRefreshMessage(refreshPendingMessage);
      await waitForUpdatedData(previousGeneratedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法提交刷新請求");
    } finally {
      setRefreshing(false);
    }
  }, [data?.generatedAt, loadData, waitForUpdatedData]);

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

  const totalCount = data
    ? data.ipo.length + data.placements.length + data.dividends.length
    : 0;

  return (
    <main className={styles.shell}>
      <section className={styles.header}>
        <div>
          <p className={styles.kicker}>官方公開資料 · 未來三個月</p>
          <h1>香港上市公司事項查詢</h1>
          <p className={styles.subtitle}>
            讀取後台已生成的港交所 IPO、增發及中資分紅資料快照；IPO 包含已刊發招股書及仍在申請階段的 AP/PHIP 公司，中資分紅只顯示中國內地主營業務公司。
          </p>
        </div>
        <div className={styles.actions}>
          <div className={styles.contact}>
            聯繫：
            <a href="mailto:songtaozhang@gmail.com">songtaozhang@gmail.com</a>
          </div>
          <button
            className={styles.secondaryButton}
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            title={refreshEndpoint ? "提交後台資料刷新" : "重新讀取靜態資料"}
          >
            <RefreshCw size={18} className={refreshing ? styles.spin : ""} />
            刷新
          </button>
          <a
            className={styles.primaryButton}
            href={staticAssetPath("/data/latest.xlsx")}
            download="hk-corp-actions-latest.xlsx"
          >
            <Download size={18} />
            下載 Excel
          </a>
        </div>
      </section>

      <section className={styles.summaryGrid} aria-label="資料摘要">
        <SummaryCard label="IPO" value={data?.ipo.length ?? 0} />
        <SummaryCard label="增發" value={data?.placements.length ?? 0} />
        <SummaryCard label="中資分紅" value={data?.dividends.length ?? 0} />
        <SummaryCard
          label="最後更新"
          value={data ? formatMinute(new Date(data.generatedAt)) : "--"}
        />
        <SummaryCard
          label="刷新時間"
          value={lastRefreshAt ? formatMinute(lastRefreshAt) : "--"}
        />
      </section>

      <section className={styles.controls}>
        <div className={styles.tabs} role="tablist" aria-label="事項類型">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={active === tab.key}
              className={active === tab.key ? styles.activeTab : styles.tab}
              onClick={() => setActive(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <label className={styles.searchBox}>
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜尋公司名稱或代號"
            aria-label="搜尋公司名稱或代號"
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
            <h2>{kindLabels[active]}</h2>
            <p>
              顯示 {rows.length} 筆；全部事項 {totalCount} 筆。{active === "dividend" ? "中資分紅已按中國內地主營業務篩選。" : ""}未公布及估算值會以標籤標示。
            </p>
          </div>
          <div className={styles.tableHeaderActions}>
            {active === "ipo" ? (
              <SortSelect
                label="排序"
                value={ipoSort}
                options={ipoSortOptions}
                onChange={(value) => setIpoSort(value as IpoSortKey)}
              />
            ) : active === "placement" ? (
              <SortSelect
                label="排序"
                value={placementSort}
                options={placementSortOptions}
                onChange={(value) => setPlacementSort(value as PlacementSortKey)}
              />
            ) : active === "dividend" ? (
              <SortSelect
                label="排序"
                value={dividendSort}
                options={dividendSortOptions}
                onChange={(value) => setDividendSort(value as DividendSortKey)}
              />
            ) : null}
            <div className={styles.rangeBadge}>
              <CalendarDays size={16} />
              未來三個月
            </div>
          </div>
        </div>

        {loading ? (
          <div className={styles.emptyState}>正在載入官方資料...</div>
        ) : rows.length === 0 ? (
          <div className={styles.emptyState}>目前沒有符合條件的資料。</div>
        ) : (
          <div className={styles.tableScroll}>
            {active === "ipo" ? (
              <IpoTable rows={rows as IpoEvent[]} />
            ) : active === "placement" ? (
              <PlacementTable rows={rows as PlacementEvent[]} />
            ) : (
              <DividendTable rows={rows as DividendEvent[]} />
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

function SourceLink({ url }: { url: string }) {
  return (
    <a className={styles.sourceLink} href={url} target="_blank" rel="noreferrer">
      來源
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

function IpoTable({ rows }: { rows: IpoEvent[] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>公司名稱</th>
          <th>代號</th>
          <th>預計上市時間</th>
          <th>募集資金凍結時間</th>
          <th>募集倍數</th>
          <th>聆訊時間</th>
          <th>募集規模</th>
          <th>備註</th>
          <th>來源</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className={hasEstimate(row) ? styles.estimatedRow : ""}>
            <td>{row.companyName}</td>
            <td>{row.stockCode}</td>
            <td>{toDateLabel(row.expectedListingDate)}</td>
            <td>{showValue(row.expectedFundLockupPeriod)}</td>
            <td>{showValue(row.expectedSubscriptionMultiple)}</td>
            <td>{toDateLabel(row.expectedHearingDate)}</td>
            <td>{showValue(row.expectedFundraisingSize)}</td>
            <td>
              <Notes item={row} />
            </td>
            <td>
              <SourceLink url={row.sourceUrl} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PlacementTable({ rows }: { rows: PlacementEvent[] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>公司名稱</th>
          <th>代號</th>
          <th>新股上市時間</th>
          <th>募集資金凍結時間</th>
          <th>募集倍數</th>
          <th>募集規模</th>
          <th>備註</th>
          <th>來源</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className={hasEstimate(row) ? styles.estimatedRow : ""}>
            <td>{row.companyName}</td>
            <td>{row.stockCode}</td>
            <td>{toDateLabel(row.expectedNewSharesListingDate)}</td>
            <td>{showValue(row.expectedFundLockupPeriod)}</td>
            <td>{showValue(row.expectedSubscriptionMultiple)}</td>
            <td>{showValue(row.expectedFundraisingSize)}</td>
            <td>
              <Notes item={row} />
            </td>
            <td>
              <SourceLink url={row.sourceUrl} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DividendTable({ rows }: { rows: DividendEvent[] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>公司名稱</th>
          <th>代號</th>
          <th>預計派息日</th>
          <th>分紅總規模</th>
          <th>每股分紅</th>
          <th>備註</th>
          <th>來源</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className={hasEstimate(row) ? styles.estimatedRow : ""}>
            <td>{row.companyName}</td>
            <td>{row.stockCode}</td>
            <td>{toDateLabel(row.expectedDividendDate)}</td>
            <td>{showValue(row.expectedTotalDividendAmount)}</td>
            <td>{showValue(row.dividendPerShare)}</td>
            <td>
              <Notes item={row} />
            </td>
            <td>
              <SourceLink url={row.sourceUrl} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
