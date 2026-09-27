import { z } from "zod";
import { DataProviderError, type Quote, type Candle, type FxRate } from "@/domain/portfolio";
import { marketTossTransport, TOSS_SOURCE, type TossTransport } from "@/providers/finance/toss-api";
import type { MarketDataProvider } from "./interface";

const Positive = z.coerce.number().finite().positive();
const Price = z.object({ symbol: z.string(), timestamp: z.string().nullable().optional(), lastPrice: Positive, currency: z.enum(["KRW", "USD"]) });
const Stock = z.object({ symbol: z.string(), name: z.string(), securityType: z.string(), currency: z.enum(["KRW", "USD"]) });
const Bar = z.object({ timestamp: z.string(), openPrice: Positive, highPrice: Positive, lowPrice: Positive, closePrice: Positive, volume: z.coerce.number().finite().nonnegative() });
const Fx = z.object({ rate: Positive, midRate: Positive, validFrom: z.string() });

/** Actual market data, independent of any holdings or account credentials. */
export class LiveMarketProvider implements MarketDataProvider {
  readonly source = TOSS_SOURCE;
  readonly isMock = false;
  constructor(private transport?: TossTransport) {}
  private get t(): TossTransport {
    const t = this.transport ?? marketTossTransport();
    if (!t) throw new DataProviderError("AUTH_FAILED", this.source, "market credentials missing");
    return t;
  }
  async getQuote(symbol: string): Promise<Quote> {
    if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(symbol)) throw new DataProviderError("NOT_AVAILABLE", this.source);
    const [prices, stocks] = await Promise.all([
      this.t.get<unknown>("/api/v1/prices", { symbols: symbol }),
      this.t.get<unknown>("/api/v1/stocks", { symbols: symbol }),
    ]);
    const price = z.array(Price).parse(prices).find((p) => p.symbol === symbol);
    const stock = z.array(Stock).parse(stocks).find((p) => p.symbol === symbol);
    if (!price || !stock || price.currency !== stock.currency) throw new DataProviderError("NOT_AVAILABLE", this.source, symbol);
    let changePct: number | undefined;
    if (price.timestamp && Number.isFinite(Date.parse(price.timestamp))) {
      try {
        const day = new Intl.DateTimeFormat("en-CA", { timeZone: price.currency === "KRW" ? "Asia/Seoul" : "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(price.timestamp));
        const bars = await this.getPriceHistory(symbol, "1w");
        const previous = bars.filter((b) => b.date < day).at(-1);
        if (previous) changePct = (price.lastPrice / previous.close - 1) * 100;
      } catch { /* No fabricated daily change if the comparison close is missing. */ }
    }
    return { symbol, name: stock.name, assetType: ["ETF", "FOREIGN_ETF"].includes(stock.securityType) ? "etf" : ["STOCK", "FOREIGN_STOCK", "DEPOSITARY_RECEIPT", "REIT"].includes(stock.securityType) ? "stock" : "other", market: price.currency === "KRW" ? "KR" : "US", price: price.lastPrice, currency: price.currency, changePct,
      provenance: { source: this.source, asOf: price.timestamp ?? undefined, retrievedAt: new Date().toISOString(), isMock: false } };
  }
  async getQuotes(symbols: string[]): Promise<Quote[]> {
    const results = await Promise.allSettled([...new Set(symbols)].map((s) => this.getQuote(s)));
    return results.flatMap((r) => r.status === "fulfilled" ? [r.value] : []);
  }
  async getPriceHistory(symbol: string, period: string): Promise<Candle[]> {
    const count = ({ "1w": 5, "1m": 22, "3m": 66, "6m": 132, "1y": 200 } as Record<string, number>)[period] ?? 60;
    const raw = await this.t.get<unknown>("/api/v1/candles", { symbol, interval: "1d", count: String(count), adjusted: "true" });
    return z.object({ candles: z.array(Bar) }).parse(raw).candles.map((b) => ({ date: b.timestamp.slice(0, 10), open: b.openPrice, high: b.highPrice, low: b.lowPrice, close: b.closePrice, volume: b.volume })).sort((a, b) => a.date.localeCompare(b.date));
  }
  async getFxRates(): Promise<FxRate[]> {
    const params = { baseCurrency: "USD", quoteCurrency: "KRW" };
    const current = Fx.parse(await this.t.get("/api/v1/exchange-rate", params));
    let changePct: number | undefined;
    try {
      // Compare with the same time 24 hours earlier, not a fictional fixture rate.
      const dateTime = new Date(Date.parse(current.validFrom) - 86_400_000).toISOString();
      const previous = Fx.parse(await this.t.get("/api/v1/exchange-rate", { ...params, dateTime }));
      changePct = (current.midRate / previous.midRate - 1) * 100;
    } catch { /* rate remains usable without a change comparison */ }
    return [{ currency: "USD", rateKRW: current.midRate, buyRateKRW: current.rate, changePct, provenance: { source: this.source, asOf: current.validFrom, retrievedAt: new Date().toISOString(), isMock: false } }];
  }
}
