export type CorporateActionKind = "ipo" | "placement" | "dividend";

export type DataQuality = "official" | "estimated" | "not_disclosed";

export interface BaseCorporateAction {
  id: string;
  kind: CorporateActionKind;
  companyName: string;
  stockCode: string;
  sourceUrl: string;
  lastUpdated: string;
  notes: string[];
}

export interface IpoEvent extends BaseCorporateAction {
  kind: "ipo";
  expectedListingDate: string | null;
  expectedFundLockupPeriod: string | null;
  expectedSubscriptionMultiple: string | null;
  expectedHearingDate: string | null;
  expectedFundraisingSize: string | null;
}

export interface PlacementEvent extends BaseCorporateAction {
  kind: "placement";
  expectedNewSharesListingDate: string | null;
  expectedFundLockupPeriod: string | null;
  expectedSubscriptionMultiple: string | null;
  expectedFundraisingSize: string | null;
}

export interface DividendEvent extends BaseCorporateAction {
  kind: "dividend";
  expectedDividendDate: string | null;
  expectedTotalDividendAmount: string | null;
  dividendPerShare: string | null;
}

export type UiCorporateAction = IpoEvent | PlacementEvent | DividendEvent;

export type RefreshStatus = "updated" | "preserved" | "unchanged";

export interface DashboardResponse {
  generatedAt: string;
  refreshStatus?: RefreshStatus;
  rangeStart: string;
  rangeEnd: string;
  sourceStatus: SourceStatus[];
  ipo: IpoEvent[];
  placements: PlacementEvent[];
  dividends: DividendEvent[];
}

export interface SourceStatus {
  name: string;
  url: string;
  ok: boolean;
  message: string;
}
