import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveMarketProvider } from "@/providers/market/live-toss";
import { MarketOnlyTossTransport, type TossTransport } from "@/providers/finance/toss-api";
import { StaticEtfHoldingsProvider } from "@/providers/etf/issuer";

afterEach(() => vi.unstubAllEnvs());
function transport(rows: Record<string, unknown>): TossTransport {
  return { isLive: true, async get<T>(path: string) { if (!(path in rows)) throw new Error("unavailable"); return rows[path] as T; } };
}
const bar = (timestamp: string, price: string) => ({ timestamp, openPrice: price, highPrice: price, lowPrice: price, closePrice: price, volume: "10" });
const rows = {
  "/api/v1/prices": [{ symbol: "NVDA", lastPrice: "120", currency: "USD", timestamp: "2026-09-25T20:00:00Z" }],
  "/api/v1/stocks": [{ symbol: "NVDA", name: "엔비디아", securityType: "FOREIGN_STOCK", currency: "USD" }],
  "/api/v1/candles": { candles: [bar("2026-09-25T00:00:00-04:00", "120"), bar("2026-09-24T00:00:00-04:00", "100")] },
};
describe("live market without live holdings", () => {
  it("blocks account endpoints and account headers before making a request", async () => {
    const t = transport({}); const get = vi.spyOn(t, "get");
    const market = new MarketOnlyTossTransport(t);
    for (const path of ["/api/v1/accounts", "/api/v1/holdings", "/api/v1/buying-power", "/api/v1/commissions", "/api/v1/orders"]) await expect(market.get(path)).rejects.toThrow("market-only");
    await expect(market.get("/api/v1/prices", {}, 0)).rejects.toThrow("market-only");
    expect(get).not.toHaveBeenCalled();
  });
  it("shares concurrent market requests and caches the response", async () => {
    const t = transport(rows); const get = vi.spyOn(t, "get");
    const market = new MarketOnlyTossTransport(t);
    await Promise.all(Array.from({ length: 10 }, () => market.get("/api/v1/prices", { symbols: "NVDA" })));
    await market.get("/api/v1/prices", { symbols: "NVDA" });
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("derives change from the quote trading date and preceding close, even on weekends", async () => {
    const quote = await new LiveMarketProvider(transport(rows)).getQuote("NVDA");
    expect(quote).toMatchObject({ price: 120, name: "엔비디아", assetType: "stock", provenance: { isMock: false, asOf: "2026-09-25T20:00:00Z" } });
    expect(quote.changePct).toBeCloseTo(20);
  });
  it("does not invent change when historical candles are unavailable", async () => {
    const quote = await new LiveMarketProvider(transport({ ...rows, "/api/v1/candles": { candles: [] } })).getQuote("NVDA");
    expect(quote.price).toBe(120); expect(quote.changePct).toBeUndefined();
  });
  it("rejects invalid prices and returns no fixture quote", async () => {
    const provider = new LiveMarketProvider(transport({ ...rows, "/api/v1/prices": [{ symbol: "NVDA", lastPrice: "NaN", currency: "USD" }] }));
    expect(await provider.getQuotes(["NVDA"])).toEqual([]);
  });
  it("compares real FX mid rates at 24 hours apart", async () => {
    const requested: (Record<string, string> | undefined)[] = [];
    const t: TossTransport = { isLive: true, async get<T>(_path: string, params?: Record<string, string>) { requested.push(params); return { rate: "1402", midRate: params?.dateTime ? "1400" : "1401", validFrom: "2026-09-25T12:00:00Z" } as T; } };
    const [fx] = await new LiveMarketProvider(t).getFxRates();
    expect(fx.rateKRW).toBe(1401); expect(fx.buyRateKRW).toBe(1402);
    expect(fx.changePct).toBeCloseTo((1401 / 1400 - 1) * 100);
    expect(requested[1]?.dateTime).toBe("2026-09-24T12:00:00.000Z");
  });
  it("does not use example ETF constituents in live market mode", async () => {
    vi.stubEnv("MARKET_DATA_PROVIDER", "toss");
    await expect(new StaticEtfHoldingsProvider().getHoldings("QQQ")).rejects.toThrow("live ETF constituents");
  });
});
