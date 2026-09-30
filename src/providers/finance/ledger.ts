import type { Account, Position, Provenance } from "@/domain/portfolio";
import { accountLabel, tradingCurrency } from "@/domain/ledger";
import { getSecurityMeta } from "@/providers/market/securities";
import type { LedgerAccountView } from "@/services/ledger-store";
import type { PortfolioProvider } from "./interface";

export const LEDGER_SOURCE = "증권사별 장부 (직접 입력, 미검증)";

/** One Account per brokerage account in the user's ledger; positions carry the folded quantity and average cost. */
export class LedgerPortfolioProvider implements PortfolioProvider {
  readonly id = "ledger";
  readonly source = LEDGER_SOURCE;
  readonly isMock = false;
  constructor(private accounts: LedgerAccountView[]) {}
  async getAccounts(): Promise<Account[]> {
    return this.accounts.map((a) => ({ id: `ledger-${a.id}`, provider: a.broker, name: accountLabel(a), type: a.type, isLive: false, channel: "manual" }));
  }
  async getPositions(): Promise<Position[]> {
    const provenance: Provenance = { source: this.source, retrievedAt: new Date().toISOString(), isMock: false };
    return this.accounts.flatMap((a) => {
      const accountId = `ledger-${a.id}`;
      const positions: Position[] = a.holdings.map((h) => {
        const meta = getSecurityMeta(h.symbol);
        const currency = tradingCurrency(h.symbol);
        return { accountId, symbol: h.symbol, name: meta?.name ?? h.symbol, assetType: meta?.assetType ?? "stock", market: currency === "KRW" ? "KR" : "US", currency, quantity: h.quantity, averagePrice: h.averagePrice, marketValueKRW: 0, provenance };
      });
      for (const [currency, quantity] of [["KRW", a.cashKRW], ["USD", a.cashUSD]] as const) {
        if (quantity) positions.push({ accountId, symbol: currency, name: `${currency} 현금`, assetType: "cash", market: "OTHER", currency, quantity, currentPrice: 1, marketValueKRW: 0, provenance });
      }
      return positions;
    });
  }
}
