import { z } from "zod";

export const Provenance = z.object({
  source: z.string(),
  asOf: z.string().optional(),
  retrievedAt: z.string(),
  isMock: z.boolean(),
});
export type Provenance = z.infer<typeof Provenance>;

export const AccountType = z.enum(["brokerage", "isa", "irp", "dc", "pension", "other"]);
export type AccountType = z.infer<typeof AccountType>;

export const Account = z.object({
  id: z.string(), // opaque id, never a real account number
  provider: z.string(), // 토스증권, 삼성증권, ...
  name: z.string(),
  type: AccountType,
  isLive: z.boolean(),
  channel: z.enum(["open_api", "mydata", "manual"]),
});
export type Account = z.infer<typeof Account>;

export const AssetType = z.enum(["stock", "etf", "bond", "cash", "fund", "other"]);
export type AssetType = z.infer<typeof AssetType>;
export const AssetClass = z.enum(["equity", "bond", "cash", "mixed", "other"]);
export type AssetClass = z.infer<typeof AssetClass>;
export const Market = z.enum(["KR", "US", "OTHER"]);
export type Market = z.infer<typeof Market>;

export const Position = z.object({
  accountId: z.string(),
  symbol: z.string(),
  name: z.string(),
  assetType: AssetType,
  market: Market, // listing market
  currency: z.string(), // trading currency
  quantity: z.number(),
  averagePrice: z.number().optional(),
  currentPrice: z.number().optional(),
  dailyChangePct: z.number().optional(),
  marketValueKRW: z.number(),
  provenance: Provenance,
  marketProvenance: Provenance.optional(),
  valuationAvailable: z.boolean().optional(),
});
export type Position = z.infer<typeof Position>;

export const PortfolioSnapshot = z.object({
  asOf: z.string(),
  accounts: z.array(Account),
  positions: z.array(Position),
  totals: z.object({
    marketValueKRW: z.number(),
    byBroker: z.record(z.string(), z.number()),
    byCurrency: z.record(z.string(), z.number()),
    byAccountType: z.record(z.string(), z.number()),
  }),
  /** currency -> KRW rate (KRW itself is 1) */
  fxRates: z.record(z.string(), z.number()),
  /** currency -> KRW customer buy rate, used for actual conversion cost */
  fxBuyRates: z.record(z.string(), z.number()).optional(),
  sources: z.array(Provenance),
  /** stale / missing data notes, surfaced to the user verbatim */
  warnings: z.array(z.string()),
  marketMode: z.enum(["live", "fixture"]).optional(),
  valuationComplete: z.boolean().optional(),
});
export type PortfolioSnapshot = z.infer<typeof PortfolioSnapshot>;

export const Money = z.object({ amount: z.number(), currency: z.string() });
export type Money = z.infer<typeof Money>;

export const Quote = z.object({
  symbol: z.string(),
  name: z.string().optional(),
  assetType: AssetType.optional(),
  market: Market.optional(),
  price: z.number(),
  currency: z.string(),
  changePct: z.number().optional(), // day change
  provenance: Provenance,
});
export type Quote = z.infer<typeof Quote>;

export const FxRate = z.object({
  currency: z.string(),
  rateKRW: z.number(), // valuation (mid) rate
  buyRateKRW: z.number().optional(), // what you actually pay when converting KRW -> currency
  changePct: z.number().optional(),
  provenance: Provenance,
});
export type FxRate = z.infer<typeof FxRate>;

export const Candle = z.object({
  date: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().optional(),
});
export type Candle = z.infer<typeof Candle>;

/** Static reference data for a security (sector/country/asset class). */
export const SecurityMeta = z.object({
  symbol: z.string(),
  name: z.string(),
  assetType: AssetType,
  assetClass: AssetClass,
  market: Market,
  currency: z.string(),
  sector: z.string().optional(),
  /** economic exposure, e.g. KR-listed S&P500 ETF -> US / USD */
  exposureCountry: z.string(),
  exposureCurrency: z.string(),
});
export type SecurityMeta = z.infer<typeof SecurityMeta>;

export type DataProviderErrorCode =
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "NOT_AVAILABLE"
  | "STALE_DATA"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export class DataProviderError extends Error {
  constructor(
    public code: DataProviderErrorCode,
    public source: string,
    message?: string,
  ) {
    super(message ?? `${source}: ${code}`);
    this.name = "DataProviderError";
  }
}

const CODE_MESSAGE: Record<DataProviderErrorCode, string> = {
  AUTH_FAILED: "인증 실패",
  RATE_LIMITED: "요청 한도 초과",
  NOT_AVAILABLE: "데이터 없음",
  STALE_DATA: "데이터 지연",
  NETWORK_ERROR: "네트워크 오류",
  UNKNOWN: "알 수 없는 오류",
};

/** User-facing status for a provider failure. Raw API messages never pass through. */
export function describeError(e: unknown): string {
  return e instanceof DataProviderError ? CODE_MESSAGE[e.code] : CODE_MESSAGE.UNKNOWN;
}

/** quantity x price converted to KRW; undefined when the FX rate is unknown. */
export function valueKRW(
  quantity: number,
  price: number,
  currency: string,
  fxRates: Record<string, number>,
): number | undefined {
  const rate = currency === "KRW" ? 1 : fxRates[currency];
  return rate === undefined ? undefined : quantity * price * rate;
}
