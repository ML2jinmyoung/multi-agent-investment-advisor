import { describe, expect, it } from "vitest";
import { installProfile, listProfiles, loadProfile } from "@/evals/profiles";
import type { PortfolioSnapshot } from "@/domain/portfolio";
import { buildPlan } from "@/orchestration/graph";
import { route } from "@/orchestration/router";
import { Tracer } from "@/orchestration/tracer";
import { getMetrics } from "@/services/exposure-engine";
import { getPolicy } from "@/services/policy-store";
import { getPortfolioSnapshot } from "@/services/portfolio-aggregator";
import { runSimulation } from "@/services/simulation-engine";

/** Eval graders assume that everything before the LLM is a pure function of the profile. */
const stable = (s: PortfolioSnapshot) => ({
  marketMode: s.marketMode,
  positions: s.positions.map((p) => ({ symbol: p.symbol, quantity: p.quantity, currentPrice: p.currentPrice, marketValueKRW: p.marketValueKRW })).sort((a, b) => a.symbol.localeCompare(b.symbol)),
  totals: s.totals,
  fxRates: s.fxRates,
  warnings: s.warnings,
});

describe("eval profiles are deterministic inputs", () => {
  it("every profile installs and values completely from fixture market data", async () => {
    const names = listProfiles().filter((n) => n !== "demo" && n !== "missing-quote");
    expect(names).toEqual(expect.arrayContaining(["balanced", "diversified", "concentrated-nvda", "cash-heavy"]));
    for (const name of names) {
      const p = loadProfile(name);
      const userId = await installProfile(name);
      const snap = await getPortfolioSnapshot(userId);
      expect(snap.marketMode, name).toBe("fixture");
      expect(snap.valuationComplete, `${name}: ${snap.warnings.join("; ")}`).toBe(true);
      expect(snap.accounts[0].channel).toBe("manual");
      expect(await getPolicy(userId)).toEqual(p.policy);
    }
  });

  it("missing-quote profile: fixture market falls back to the average price but keeps the warning for the answer", async () => {
    const snap = await getPortfolioSnapshot(await installProfile("missing-quote"));
    expect(snap.marketMode).toBe("fixture");
    expect(snap.warnings.some((w) => w.includes("AVGO") && w.includes("시세"))).toBe(true);
    const avgo = snap.positions.find((p) => p.symbol === "AVGO");
    expect(avgo?.marketProvenance).toBeUndefined();
    expect(avgo?.currentPrice).toBe(avgo?.averagePrice);
  });

  it("same profile -> identical snapshot, simulation, policy checks and routing plan", async () => {
    const userId = await installProfile("balanced");
    const [a, b] = await Promise.all([getPortfolioSnapshot(userId), getPortfolioSnapshot(userId)]);
    expect(stable(a)).toEqual(stable(b));

    const policy = await getPolicy(userId);
    const { etf } = await getMetrics(a);
    const req = { type: "trade" as const, symbol: "NVDA", action: "buy" as const, amountKRW: 5_000_000 };
    const s1 = await runSimulation(req, { userId, snapshot: a, policy, etf });
    const s2 = await runSimulation(req, { userId, snapshot: b, policy, etf });
    expect(s1.changes).toEqual(s2.changes);
    expect(s1.policyChecks).toEqual(s2.policyChecks);
    // the balanced profile is designed so this trade crosses the single-stock limit
    expect(s1.policyChecks.find((c) => c.rule === "singleStockPct" && c.subject === "NVDA")?.status).toBe("violation");

    const held = a.positions.filter((p) => p.assetType !== "cash").map((p) => p.symbol);
    const input = { message: "NVDA 500만원 더 살까?", hasPortfolio: true, hasPolicy: true, heldSymbols: held };
    const r1 = await route(input, null, new Tracer("eval"));
    const r2 = await route(input, null, new Tracer("eval"));
    expect(buildPlan(r1)).toEqual(buildPlan(r2));
    expect(r1.trade).toEqual(r2.trade);
    expect(r1.trade).toEqual({ symbol: "NVDA", action: "buy", amountKRW: 5_000_000, quantity: undefined });
  });
});
