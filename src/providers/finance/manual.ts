import type { PortfolioInput } from "@/domain/portfolio-input";
import type { Account, Position, Provenance } from "@/domain/portfolio";
import { getSecurityMeta } from "@/providers/market/securities";
import type { PortfolioProvider } from "./interface";

export class ManualPortfolioProvider implements PortfolioProvider {
  readonly id = "manual";
  readonly source = "방문자 직접 입력 (미검증)";
  readonly isMock = false;
  constructor(private input: PortfolioInput) {}
  async getAccounts(): Promise<Account[]> {
    return [{ id: this.id, provider: "직접 입력", name: "입력한 보유자산", type: "brokerage", isLive: false, channel: "manual" }];
  }
  async getPositions(): Promise<Position[]> {
    const provenance: Provenance = { source: this.source, retrievedAt: new Date().toISOString(), isMock: false };
    const positions: Position[] = this.input.holdings.map((h) => {
      const meta = getSecurityMeta(h.symbol);
      const kr = /^\d{5}[A-Z0-9]$/.test(h.symbol);
      return { ...h, accountId: this.id, name: meta?.name ?? h.symbol, assetType: meta?.assetType ?? "stock", market: kr ? "KR" : "US", currency: kr ? "KRW" : "USD", marketValueKRW: 0, provenance };
    });
    for (const [currency, quantity] of [["KRW", this.input.cashKRW], ["USD", this.input.cashUSD]] as const) {
      if (quantity) positions.push({ accountId: this.id, symbol: currency, name: `${currency} 현금`, assetType: "cash", market: "OTHER", currency, quantity, currentPrice: 1, marketValueKRW: 0, provenance });
    }
    return positions;
  }
}
