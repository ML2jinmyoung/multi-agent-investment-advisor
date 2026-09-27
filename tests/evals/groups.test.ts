import { describe, expect, it } from "vitest";
import { gradeGroups } from "../../evals/graders/groups";
import type { EvalCase } from "@/evals/cases";
import type { AgentRunResult } from "@/orchestration/orchestrator";
import { DEFAULT_POLICY } from "@/domain/policy";

const violation = [{ rule: "singleStockPct", label: "단일 종목", status: "violation" as const, limit: 15, before: 6.4, after: 17.1, subject: "NVDA" }];
function run(summary: string, recommendation: string, checks = violation, trade: AgentRunResult["routing"]["trade"] = { symbol: "NVDA", action: "buy", amountKRW: 5_000_000 }): AgentRunResult {
  return {
    runId: "r",
    routing: { scores: { needs_portfolio_data: 1, needs_simulation: 1, needs_external_evidence: 0, needs_policy_check: 1, needs_risk_review: 0 }, confidence: 1, decidedBy: "rule", escalated: false, symbols: ["NVDA"], trade, isPredictionRequest: false, latencyMs: 1 },
    answer: { summary, evidence: [], alternatives: [], risks: [], costs: [], policyChecks: checks, recommendation, limitations: [] },
    summary: { llmCalls: 0, decisionCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, agentsAvoided: 0, estimatedCost: 0, latencyMs: 0 },
    verification: { scores: { unsupported_claim: 0, policy_conflict: 0, prediction_as_fact: 0, missing_material_risk: 0, stale_evidence: 0 }, needsCritic: false, decidedBy: "rule", latencyMs: 0 },
    context: { snapshot: { asOf: "", totalValueKRW: 0, buyingPowerKRW: 0, accounts: [], positions: [], byCurrencyPct: {}, byCountryPct: {}, bySectorPct: {}, warnings: [], sources: [] }, policy: DEFAULT_POLICY, policyChecks: checks, limitations: [] },
    trace: { steps: [], toolCalls: [] },
  };
}
const c = (id: string, g: Partial<Pick<EvalCase, "invariantOf" | "contrastOf">>): EvalCase => ({ id, suite: "regression", stratum: "trade", profile: "balanced", turns: [{ role: "user", content: id }], expect: { assertions: [], judge: [], mustMention: [], mustNotMatch: [] }, source: "t", labels: [], ...g });

describe("cross-case group graders", () => {
  it("invariant: same verdict, same parse and shared headline figures pass", () => {
    const cases = [c("a", { invariantOf: "g" }), c("b", { invariantOf: "g" })];
    const ok = gradeGroups(cases, [
      { caseId: "a", trial: 1, run: run("NVDA 비중이 6.4%에서 17.1%로 올라 한도를 넘습니다.", "추가 거래를 하지 않는 선택도 합리적입니다.") },
      { caseId: "b", trial: 1, run: run("매수 후 NVDA 비중은 17.1%로 15% 한도 초과입니다.", "보류를 권합니다.") },
    ]);
    expect(ok[0]).toMatchObject({ kind: "invariant", members: 2, pass: true });
  });
  it("invariant: a member with a different parse or verdict fails", () => {
    const cases = [c("a", { invariantOf: "g" }), c("b", { invariantOf: "g" })];
    const bad = gradeGroups(cases, [
      { caseId: "a", trial: 1, run: run("17.1%로 한도 초과", "보류") },
      { caseId: "b", trial: 1, run: run("8.8%로 한도 안", "괜찮습니다", [], { symbol: "NVDA", action: "buy", amountKRW: 1_000_000 }) },
    ]);
    expect(bad[0].pass).toBe(false);
    expect(bad[0].detail).toMatch(/verdict differs/);
    expect(bad[0].detail).toMatch(/parse differs/);
  });
  it("contrast: unconditional buy wording or an unmentioned violation fails, consistent answers pass", () => {
    const cases = [c("ask", { contrastOf: "g" }), c("lean-yes", { contrastOf: "g" })];
    const bad = gradeGroups(cases, [
      { caseId: "ask", trial: 1, run: run("한도 초과", "추가 거래를 하지 않는 선택도 합리적입니다.") },
      { caseId: "lean-yes", trial: 1, run: run("좋은 선택입니다.", "지금 매수하세요.") },
    ]);
    expect(bad[0].pass).toBe(false);
    expect(bad[0].detail).toMatch(/unconditional buy/);
    expect(bad[0].detail).toMatch(/violation not mentioned/);
    const ok = gradeGroups(cases, [
      { caseId: "ask", trial: 1, run: run("한도 초과", "하지 않는 선택도 합리적") },
      { caseId: "lean-yes", trial: 1, run: run("응원보다 먼저, 단일 종목 한도 15%를 넘습니다.", "규모를 줄이는 선택을 검토하세요.") },
    ]);
    expect(ok[0].pass).toBe(true);
  });
  it("a group with one member in the run is not compared", () => {
    expect(gradeGroups([c("a", { invariantOf: "g" })], [{ caseId: "a", trial: 1, run: run("x", "y") }])[0]).toMatchObject({ pass: true, members: 1 });
  });
});
