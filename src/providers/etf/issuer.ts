import type { EtfHoldings } from "@/domain/evidence";
import { DataProviderError } from "@/domain/portfolio";
import { loadFixture } from "@/lib/fixtures";
import type { EtfHoldingsProvider } from "./interface";

type EtfFixture = { etf: string; asOf: string; source: string; holdings: EtfHoldings["holdings"] };

/**
 * Priority in the plan: issuer official PDF -> external provider -> static snapshot.
 * ponytail: static snapshots only (QQQ, VOO, KODEX 200, TIGER S&P500/나스닥100); add an issuer fetcher when a live feed exists.
 */
export class StaticEtfHoldingsProvider implements EtfHoldingsProvider {
  readonly source = "Static ETF holdings snapshot";

  async getHoldings(etf: string): Promise<EtfHoldings> {
    if (process.env.MARKET_DATA_PROVIDER === "toss") throw new DataProviderError("NOT_AVAILABLE", this.source, "live ETF constituents not configured");
    let f: EtfFixture;
    try {
      f = loadFixture<EtfFixture>(`etf/${etf}.json`);
    } catch {
      throw new DataProviderError("NOT_AVAILABLE", this.source, etf);
    }
    return { etf, holdings: f.holdings, asOf: f.asOf, provenance: { source: f.source, asOf: f.asOf, retrievedAt: new Date().toISOString(), isMock: true } };
  }
}

export const etfHoldingsProvider = (): EtfHoldingsProvider => new StaticEtfHoldingsProvider();
