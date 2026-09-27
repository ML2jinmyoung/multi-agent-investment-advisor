import { LiveMarketProvider } from "@/providers/market/live-toss";
import { ManualPortfolioProvider } from "@/providers/finance/manual";
import { getPortfolioInput } from "./portfolio-input-store";
import { describeError, PortfolioSnapshot, type Position, type Provenance, type Quote, valueKRW } from "@/domain/portfolio";
import { flag } from "@/lib/env";
import type { PortfolioProvider } from "@/providers/finance/interface";
import { MockMyDataProvider } from "@/providers/finance/mock-mydata";
import { TossPortfolioProvider } from "@/providers/finance/toss";
import { FixtureTossTransport, liveTossTransport } from "@/providers/finance/toss-api";
import type { MarketDataProvider } from "@/providers/market/interface";
import { MockMarketDataProvider } from "@/providers/market/mock";
import { TossMarketDataProvider } from "@/providers/market/toss";

const MARKET_PRICED = new Set(["stock", "etf", "fund", "bond"]);


/** Live Toss when ENABLE_REAL_TOSS and credentials exist; otherwise the recorded demo fixture (shown as DEMO). */
const tossTransport = () => (flag("ENABLE_REAL_TOSS") && liveTossTransport()) || new FixtureTossTransport();
let providers: PortfolioProvider[] | undefined;
let marketProvider: MarketDataProvider | undefined;

export function portfolioProviders(): PortfolioProvider[] {
  if (!providers) {
    providers = [new TossPortfolioProvider(tossTransport())];
    if (flag("ENABLE_MOCK_MYDATA", true)) providers.push(new MockMyDataProvider());
  }
  return providers;
}

export function marketDataProvider(): MarketDataProvider {
  if (!marketProvider) {
    if (process.env.MARKET_DATA_PROVIDER === "toss") return marketProvider = new LiveMarketProvider();
    const t = tossTransport();
    marketProvider = t.isLive ? new TossMarketDataProvider(t) : new MockMarketDataProvider();
  }
  return marketProvider;
}

export async function getPortfolioSnapshot(userId = "demo", opts: { fresh?: boolean } = {}): Promise<PortfolioSnapshot> {
  // Holdings are always read fresh; shared market requests retain their 60s rate-limit cache.
  void opts;
  const input = await getPortfolioInput(userId);
  return buildSnapshot(input ? [new ManualPortfolioProvider(input)] : portfolioProviders(), marketDataProvider());
}

export async function getCommissionRates(accountId: string): Promise<Record<string, number> | undefined> {
  const toss = portfolioProviders().find((p): p is TossPortfolioProvider => p instanceof TossPortfolioProvider);
  return accountId.startsWith("toss-") ? toss?.getCommissionRates(accountId) : undefined;
}

export async function buildSnapshot(providers: PortfolioProvider[], market: MarketDataProvider): Promise<PortfolioSnapshot> {
  const now = new Date().toISOString();
  const warnings: string[] = [];
  const sources: Provenance[] = [];
  const accounts: PortfolioSnapshot["accounts"] = [];
  const raw: Position[] = [];

  for (const p of providers) {
    try {
      // Toss ACCOUNT endpoints are limited to 1 TPS. The provider reuses this account result.
      const a = await p.getAccounts();
      const pos = await p.getPositions();
      accounts.push(...a);
      raw.push(...pos);
      sources.push({ source: p.source, retrievedAt: now, isMock: p.isMock, asOf: pos[0]?.provenance.asOf });
    } catch (e) {
      warnings.push(`${p.source}: ${describeError(e)} — 이 계좌는 이번 분석에서 제외되었습니다.`);
    }
  }

  const fxRates: Record<string, number> = { KRW: 1 };
  const fxBuyRates: Record<string, number> = { KRW: 1 };
  try {
    for (const f of await market.getFxRates()) {
      sources.push(f.provenance);
      fxRates[f.currency] = f.rateKRW;
      if (f.buyRateKRW !== undefined) fxBuyRates[f.currency] = f.buyRateKRW;
    }
  } catch (e) {
    warnings.push(`환율: ${describeError(e)} — 외화 자산의 원화 환산이 불완전할 수 있습니다.`);
  }

  const quotes = new Map<string, Quote>();
  try {
    const symbols = [...new Set(raw.filter((p) => MARKET_PRICED.has(p.assetType)).map((p) => p.symbol))];
    for (const q of await market.getQuotes(symbols)) quotes.set(q.symbol, q);
    const first = quotes.values().next().value;
    sources.push({ source: market.source, retrievedAt: now, isMock: market.isMock, asOf: first?.provenance.asOf });
  } catch (e) {
    warnings.push(`시세: ${describeError(e)} — 최신 평가금액을 확인할 수 없습니다.`);
  }

  const positions = raw.map((p): Position => {
    const q = quotes.get(p.symbol);
    const priced = MARKET_PRICED.has(p.assetType);
    const price = q?.price ?? ((!market.isMock && priced) ? undefined : p.currentPrice ?? p.averagePrice);
    const currency = q?.currency ?? p.currency;
    if (!q && priced) warnings.push(`${p.name}(${p.symbol}): 최신 시세를 확인하지 못했습니다.`);
    const v = price === undefined ? undefined : valueKRW(p.quantity, price, currency, fxRates);
    if (v === undefined) warnings.push(`${p.name}: 시세 또는 환율이 없어 평가액을 계산하지 않았습니다.`);
    if (q && q.changePct === undefined && priced) warnings.push(`${q.name ?? p.name}: 이전 거래일 종가가 없어 등락률을 계산하지 않았습니다.`);
    return { ...p, name: q?.name ?? p.name, assetType: q?.assetType ?? p.assetType, market: q?.market ?? p.market,
      currency, currentPrice: price, dailyChangePct: market.isMock ? q?.changePct ?? p.dailyChangePct : q?.changePct,
      marketProvenance: q?.provenance, valuationAvailable: v !== undefined, marketValueKRW: v ?? (market.isMock ? p.marketValueKRW : 0) };
  });

  return PortfolioSnapshot.parse({
    asOf: now,
    marketMode: market.isMock ? "fixture" : "live",
    valuationComplete: positions.every((p) => p.valuationAvailable) && accounts.length > 0,
    accounts,
    positions,
    totals: computeTotals(accounts, positions),
    fxRates,
    fxBuyRates,
    sources,
    warnings: [...new Set(warnings)],
  });
}

export function computeTotals(accounts: PortfolioSnapshot["accounts"], positions: Position[]): PortfolioSnapshot["totals"] {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const sum = (key: (p: Position) => string) =>
    positions.reduce<Record<string, number>>((acc, p) => ((acc[key(p)] = (acc[key(p)] ?? 0) + p.marketValueKRW), acc), {});
  return {
    marketValueKRW: positions.reduce((s, p) => s + p.marketValueKRW, 0),
    byBroker: sum((p) => accountById.get(p.accountId)?.provider ?? "unknown"),
    byCurrency: sum((p) => p.currency),
    byAccountType: sum((p) => accountById.get(p.accountId)?.type ?? "other"),
  };
}
