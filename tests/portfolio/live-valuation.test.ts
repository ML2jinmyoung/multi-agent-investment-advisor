import { describe, expect, it } from "vitest";
import type { PortfolioProvider } from "@/providers/finance/interface";
import type { MarketDataProvider } from "@/providers/market/interface";
import { buildSnapshot } from "@/services/portfolio-aggregator";
const provenance = { source: "demo holdings", isMock: true, retrievedAt: "2026-09-25T00:00:00Z" };
const provider: PortfolioProvider = { id: "demo", source: "demo", isMock: true,
  async getAccounts() { return [{ id: "demo", name: "demo", provider: "demo", type: "brokerage", channel: "open_api", isLive: false }]; },
  async getPositions() { return [{ accountId: "demo", symbol: "NVDA", name: "old name", assetType: "stock", market: "US", currency: "USD", quantity: 10, currentPrice: 999, averagePrice: 888, dailyChangePct: -77, marketValueKRW: 999999, provenance }]; } };
function market(quotes = true, fx = true): MarketDataProvider { return { source: "live market", isMock: false,
  async getQuote() { throw new Error("unused"); }, async getPriceHistory() { return []; },
  async getQuotes() { return quotes ? [{ symbol: "NVDA", name: "actual name", price: 100, currency: "USD", provenance: { ...provenance, source: "live market", isMock: false } }] : []; },
  async getFxRates() { return fx ? [{ currency: "USD", rateKRW: 1400, provenance: { ...provenance, isMock: false } }] : []; } }; }
describe("demo quantities with live valuation", () => {
  it("uses current price and FX while preserving holdings provenance", async () => {
    const snap = await buildSnapshot([provider], market()); const p = snap.positions[0];
    expect(snap.valuationComplete).toBe(true); expect(snap.totals.marketValueKRW).toBe(1400000);
    expect(p.name).toBe("actual name"); expect(p.provenance.isMock).toBe(true); expect(p.marketProvenance?.isMock).toBe(false);
    expect(p.dailyChangePct).toBeUndefined();
  });
  it.each([[false, true], [true, false]])("does not fall back to demo prices or FX: quote=%s, fx=%s", async (quotes, fx) => {
    const snap = await buildSnapshot([provider], market(quotes, fx));
    expect(snap.valuationComplete).toBe(false); expect(snap.positions[0].valuationAvailable).toBe(false);
    expect(snap.totals.marketValueKRW).toBe(0); expect(snap.positions[0].dailyChangePct).toBeUndefined();
  });
});
