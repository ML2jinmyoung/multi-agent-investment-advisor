import { describe, expect, it } from "vitest";
import type { DecisionModel, ManyDecision, YesNoQuestion } from "@/decision";
import { buildPlan } from "@/orchestration/graph";
import { parseAmountKRW, parseMessage, route } from "@/orchestration/router";
import { Tracer } from "@/orchestration/tracer";

const held = ["NVDA", "QQQ", "VOO", "AAPL", "005930", "000660", "069500", "TSLA", "360750", "152380", "133690"];

describe("rule floor under the model router (F-011)", () => {
  it("a low-scoring model cannot drop portfolio for a held symbol or policy/risk for a decision question", async () => {
    const r = await route(input("삼성전자 최근 공시 있어?"), fakeModel(0.05), new Tracer("t"));
    expect(r.decidedBy).toBe("jev");
    expect(buildPlan(r).portfolio).toBe(true);
    const d = await route(input("엔비디아 최근 실적 어때?"), fakeModel(0.05), new Tracer("t"));
    expect(buildPlan(d)).toMatchObject({ portfolio: true, evidence: true, policy: true, riskReview: true });
  });
  it("the model can still add specialists the rules did not select", async () => {
    const r = await route(input("삼성전자 오를까?"), fakeModel(0.95), new Tracer("t"));
    expect(buildPlan(r).evidence).toBe(true); // rules alone: false
  });
  it("rule hints below the threshold do not force a node", async () => {
    const r = await route(input("환율 앞으로 어떻게 될까?"), fakeModel(0.05), new Tracer("t"));
    expect(buildPlan(r).portfolio).toBe(false); // rule score 0.25 is a hint, model said no
  });
});

describe("quantity parsing (F-004)", () => {
  it("reads share counts followed by Hangul, particles or punctuation", () => {
    expect(parseMessage("애플 5주 팔까?", held).trade?.quantity).toBe(5);
    expect(parseMessage("삼성전자 20주 매도하면 세금 얼마야?", held).trade?.quantity).toBe(20);
    expect(parseMessage("VOO 3주만 팔면?", held).trade?.quantity).toBe(3);
    expect(parseMessage("KODEX 200 50주를 팔면 어때?", held).trade?.quantity).toBe(50);
  });
  it("does not read weeks or 주식 as a share count", () => {
    expect(parseMessage("NVDA 2주일 뒤에 살까?", held).trade?.quantity).toBeUndefined();
    expect(parseMessage("NVDA 1주간 지켜보고 살까?", held).trade?.quantity).toBeUndefined();
    expect(parseMessage("삼성전자 주식 100만원 사면?", held).trade?.quantity).toBeUndefined();
  });
});
const input = (message: string) => ({ message, hasPortfolio: true, hasPolicy: true, heldSymbols: held });

function fakeModel(p: number): DecisionModel {
  return {
    name: "jev",
    async choice() {
      throw new Error("unused");
    },
    async score() {
      throw new Error("unused");
    },
    async evaluate() {
      return { probability: p, meta: { model: "fake", latencyMs: 1 } };
    },
    async evaluateMany<K extends string>(_s: unknown, statements: Record<K, YesNoQuestion>): Promise<ManyDecision<K>> {
      return { probabilities: Object.fromEntries(Object.keys(statements).map((k) => [k, p])) as Record<K, number>, meta: { model: "fake", latencyMs: 1 } };
    },
  };
}

describe("message parsing", () => {
  it("parses Korean amounts", () => {
    expect(parseAmountKRW("NVDA 500만원 더 살까?")).toBe(5_000_000);
    expect(parseAmountKRW("삼성전자 1,000만 매수")).toBe(10_000_000);
    expect(parseAmountKRW("1억 정도")).toBe(100_000_000);
    expect(parseAmountKRW("3000000원어치")).toBe(3_000_000);
    expect(parseAmountKRW("10% 떨어지면")).toBeUndefined();
  });

  it("detects a trade with symbol aliases", () => {
    const p = parseMessage("요즘 엔비디아 실적 좋다던데 500만원 더 살까?", held);
    expect(p.symbols).toEqual(["NVDA"]);
    expect(p.trade).toEqual({ symbol: "NVDA", action: "buy", amountKRW: 5_000_000, quantity: undefined });
    expect(p.isPredictionRequest).toBe(false);
  });

  it("detects fx and symbol scenarios", () => {
    expect(parseMessage("환율이 10% 떨어지면?", held).scenario).toEqual({ kind: "fx", target: "USD", changePct: -10 });
    expect(parseMessage("NVDA가 30% 하락하면 내 포트폴리오는?", held).scenario).toEqual({ kind: "symbol", target: "NVDA", changePct: -30 });
    expect(parseMessage("기술주가 20% 빠지는 경우", held).scenario).toEqual({ kind: "sector", target: "Technology", changePct: -20 });
  });

  it("flags prediction requests and simple lookups", () => {
    expect(parseMessage("삼성전자 오를까?", held).isPredictionRequest).toBe(true);
    const simple = parseMessage("내가 제일 많이 가진 종목은?", held);
    expect(simple.symbols).toEqual([]);
    expect(simple.trade).toBeUndefined();
  });

  it("resolves a follow-up trade from recent conversation", () => {
    const parsed = parseMessage("그중 절반만 사면?", held, [
      { role: "user", content: "NVDA 500만원 더 살까?" },
      { role: "assistant", content: "현재 원칙상 비중 한도를 넘습니다." },
    ]);
    expect(parsed.trade).toEqual({ symbol: "NVDA", action: "buy", amountKRW: 2_500_000, quantity: undefined });
  });
});

describe("routing + plan", () => {
  it("rule routing: simple lookup avoids evidence, simulation and critic", async () => {
    const r = await route(input("내가 제일 많이 가진 종목은?"), null, new Tracer("t"));
    expect(r.decidedBy).toBe("rule");
    const plan = buildPlan(r);
    expect(plan).toMatchObject({ portfolio: true, simulation: false, evidence: false, simple: true });
  });

  it("rule routing: trade question runs portfolio + simulation + policy + evidence", async () => {
    const r = await route(input("NVDA 500만원 더 살까?"), null, new Tracer("t"));
    expect(buildPlan(r)).toMatchObject({ portfolio: true, simulation: true, evidence: true, policy: true, riskReview: true, simple: false });
  });

  it("jev routing with high confidence is not escalated", async () => {
    const r = await route(input("NVDA 500만원 더 살까?"), fakeModel(0.97), new Tracer("t"));
    expect(r.decidedBy).toBe("jev");
    expect(r.confidence).toBeCloseTo(0.94, 2);
    expect(r.escalated).toBe(false);
  });

  it("ambiguous jev answers fall below the threshold (escalation candidate)", async () => {
    const r = await route(input("이거 어때?"), fakeModel(0.55), new Tracer("t"));
    expect(r.confidence).toBeLessThan(0.7);
    expect(r.escalated).toBe(false); // no LLM configured in tests -> stays with jev
  });
});
