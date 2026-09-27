import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PortfolioInput } from "@/domain/portfolio-input";
import { getPortfolioInput, resetPortfolioInput, savePortfolioInput } from "@/services/portfolio-input-store";
import { getPortfolioSnapshot } from "@/services/portfolio-aggregator";
const input = { holdings: [{ symbol: "NVDA", quantity: 2 }], cashKRW: 100, cashUSD: 0 };
describe("visitor holdings", () => {
  it("rejects negative quantities, duplicate symbols, invalid symbols, and excess rows", () => {
    for (const holdings of [[{ symbol: "NVDA", quantity: -1 }], [{ symbol: "NVDA", quantity: 1 }, { symbol: "nvda", quantity: 2 }], [{ symbol: "../../accounts", quantity: 1 }], Array.from({ length: 41 }, (_, i) => ({ symbol: `A${i}`, quantity: 1 }))]) expect(PortfolioInput.safeParse({ ...input, holdings }).success).toBe(false);
  });
  it("keeps inputs and snapshots isolated and restores default holdings on reset", async () => {
    const a = randomUUID(), b = randomUUID();
    try {
      await savePortfolioInput(a, input);
      await savePortfolioInput(b, { ...input, holdings: [{ symbol: "NVDA", quantity: 3 }] });
      expect((await getPortfolioInput(a))?.holdings[0].quantity).toBe(2);
      const [sa, sb] = await Promise.all([getPortfolioSnapshot(a), getPortfolioSnapshot(b)]);
      expect(sa.positions.find((p) => p.symbol === "NVDA")?.quantity).toBe(2);
      expect(sb.positions.find((p) => p.symbol === "NVDA")?.quantity).toBe(3);
      expect(sa.accounts[0].channel).toBe("manual");
      await resetPortfolioInput(a);
      expect(await getPortfolioInput(a)).toBeNull();
      expect((await getPortfolioSnapshot(a)).accounts.every((a) => a.channel !== "manual")).toBe(true);
      expect((await getPortfolioInput(b))?.holdings[0].quantity).toBe(3);
    } finally { await resetPortfolioInput(a); await resetPortfolioInput(b); }
  });
});
