import { generateObject } from "ai";
import { z } from "zod";
import { PLANNER_SYSTEM } from "@/agents/prompts";
import { confidenceOf, type DecisionModel, ROUTING_THRESHOLD } from "@/decision";
import { ROUTING_KEYS, type RoutingDecision, type RoutingKey } from "@/domain/agent";
import { llmAvailable, modelFor } from "@/providers/llm/registry";
import { getSecurityMeta } from "@/providers/market/securities";
import type { Tracer } from "./tracer";

// ---- deterministic parsing (symbols, trade, scenario, prediction) ----
const ALIASES: Record<string, string> = {
  엔비디아: "NVDA", nvidia: "NVDA", 삼성전자: "005930", 삼전: "005930", 하이닉스: "000660", sk하이닉스: "000660",
  애플: "AAPL", 테슬라: "TSLA", 마이크로소프트: "MSFT", 아마존: "AMZN", "kodex 200": "069500", 코덱스200: "069500",
  "tiger 미국s&p500": "360750", "tiger 미국나스닥100": "133690",
};
const UNIT: Record<string, number> = { 억: 1e8, 천만: 1e7, 백만: 1e6, 만: 1e4, 천: 1e3 };
const SECTOR_WORDS: [RegExp, string][] = [[/기술주|테크|반도체|it주/i, "Technology"], [/금융주|은행주/, "Financials"], [/헬스케어|바이오/, "Health Care"]];

export interface ParsedMessage {
  symbols: string[];
  trade?: { symbol: string; action: "buy" | "sell"; amountKRW?: number; quantity?: number };
  scenario?: { kind: "symbol" | "sector" | "fx" | "market"; target: string; changePct: number };
  isPredictionRequest: boolean;
}

export function parseAmountKRW(text: string): number | undefined {
  const m = text.match(/(\d[\d,]*(?:\.\d+)?)\s*(억|천만|백만|만|천)(?:\s*원)?|(\d[\d,]*)\s*원/);
  if (!m) return undefined;
  if (m[3]) return Number(m[3].replace(/,/g, ""));
  return Number(m[1].replace(/,/g, "")) * UNIT[m[2]];
}

export function parseMessage(message: string, heldSymbols: string[] = [], history: RouteInput["history"] = []): ParsedMessage {
  const lower = message.toLowerCase();
  const symbols = new Set<string>();
  for (const [alias, sym] of Object.entries(ALIASES)) if (lower.includes(alias)) symbols.add(sym);
  for (const tok of message.match(/[A-Za-z]{1,5}(?:\.[A-Za-z])?|\d{6}/g) ?? []) {
    const t = tok.toUpperCase();
    if (getSecurityMeta(t) || heldSymbols.includes(t)) symbols.add(t);
  }
  let list = [...symbols];
  let previous: ParsedMessage | undefined;
  if (/그중|그거|그 종목|아까|그러면|그대로|절반|반만/.test(message)) {
    for (const turn of [...history].reverse()) {
      if (turn.role !== "user") continue;
      const parsed = parseMessage(turn.content, heldSymbols);
      if (parsed.symbols.length || parsed.trade || parsed.scenario) {
        previous = parsed;
        break;
      }
    }
    if (!list.length && previous?.symbols.length) list = previous.symbols.slice(0, 1);
  }

  let trade: ParsedMessage["trade"];
  const buy = /(매수|살까|사면|사고|사는|사도|더\s*사|사볼|\bbuy\b)/i.test(message);
  const sell = /(매도|팔까|팔면|팔고|팔아|정리할까|\bsell\b)/i.test(message);
  // F-004: JS \b treats Hangul as a non-word char, so "5주 팔까" never matched; exclude only 주식/주간/주일 and alphanumerics after 주
  const qty = message.match(/(\d+)\s*주(?![식간일A-Za-z0-9])/);
  if (list.length && (buy || sell)) {
    const amount = parseAmountKRW(message) ?? (/절반|반만/.test(message) ? previous?.trade?.amountKRW && previous.trade.amountKRW / 2 : undefined);
    const quantity = qty ? Number(qty[1]) : (/절반|반만/.test(message) ? previous?.trade?.quantity && previous.trade.quantity / 2 : undefined);
    trade = { symbol: list[0], action: sell && !buy ? "sell" : "buy", amountKRW: amount, quantity };
  }

  let scenario: ParsedMessage["scenario"];
  const pct = message.match(/(-?\d+(?:\.\d+)?)\s*%/);
  const down = /(떨어지|하락|급락|빠지|내리|폭락)/.test(message);
  const up = /(오르|상승|급등|올라)/.test(message);
  if (pct && (down || up || pct[1].startsWith("-")) && /(면|가정|경우|시나리오|되면|하면|if)/i.test(message)) {
    let changePct = Number(pct[1]);
    if (down && changePct > 0) changePct = -changePct;
    if (/환율|달러|usd/i.test(message)) scenario = { kind: "fx", target: "USD", changePct };
    else if (/코스피|국내\s*시장|국내\s*증시|한국\s*시장/.test(message)) scenario = { kind: "market", target: "KR", changePct };
    else if (/나스닥|s&p|미국\s*(시장|증시)|뉴욕/i.test(message)) scenario = { kind: "market", target: "US", changePct };
    else if (SECTOR_WORDS.some(([re]) => re.test(message))) scenario = { kind: "sector", target: SECTOR_WORDS.find(([re]) => re.test(message))![1], changePct };
    else if (list.length) scenario = { kind: "symbol", target: list[0], changePct };
    else if (/시장|증시|전체|다\s*떨어/.test(message)) scenario = { kind: "market", target: "ALL", changePct };
  }

  const isPredictionRequest = /(오를까|오르나|오를\s*것\s*같|떨어질까|갈까|전망|예측|얼마까지|어떻게\s*될|will\s+(it\s+)?(go up|rise|fall|drop))/i.test(message) && !scenario;
  return { symbols: list, trade, scenario, isPredictionRequest };
}

// ---- routing: atomic decisions, code-owned graph ----
export interface RouteInput {
  message: string;
  hasPortfolio: boolean;
  hasPolicy: boolean;
  heldSymbols: string[];
  history?: { role: "user" | "assistant"; content: string }[];
}

const QUESTIONS: Record<RoutingKey | "is_prediction_request", { question: string; true: string; false: string }> = {
  needs_portfolio_data: { question: "Does answering require the user's own holdings, exposure or buying power?", true: "The question is about the user's money, portfolio, weights or accounts", false: "A general market or company fact that does not depend on what the user owns" },
  needs_simulation: { question: "Does the user describe a hypothetical trade or a what-if scenario whose effect on their portfolio should be computed?", true: "Buying/selling an amount, or 'if X drops N%'", false: "No hypothetical action or scenario" },
  needs_external_evidence: { question: "Does a good answer need external verifiable facts such as filings, financial statements, price history or exchange warnings?", true: "The user asks why, about earnings, news, whether to buy, or about a company's condition", false: "Pure portfolio arithmetic or policy question" },
  needs_policy_check: { question: "Should the answer be checked against the user's investment policy limits?", true: "Any decision about buying, selling, concentration, or 'is it okay'", false: "Informational question with no decision" },
  needs_risk_review: { question: "Is this an investment decision question where risks and uncertainty must be reviewed?", true: "Should I buy/sell, is it a good idea, how much", false: "Simple lookup" },
  is_prediction_request: { question: "Is the user asking to predict a future price, return or direction?", true: "Will it go up, how far, forecast", false: "What-if scenario or factual question" },
};

export function ruleScores(message: string, parsed: ParsedMessage, input: RouteInput): Record<RoutingKey, number> {
  const mine = /(내|나의|제|우리|보유|포트폴리오|비중|자산|계좌|얼마나|가진|가지고|투자\s*가능|데이터.*기준|기준.*데이터)/.test(message) || parsed.symbols.some((s) => input.heldSymbols.includes(s));
  const decision = /(살까|팔까|어때|해야|려야|괜찮|더\s*사|줄일까|늘릴까|추천)/.test(message);
  const hypo = Boolean(parsed.trade || parsed.scenario);
  return {
    needs_portfolio_data: input.hasPortfolio && (mine || hypo || decision) ? 0.92 : 0.25,
    needs_simulation: hypo ? 0.95 : 0.05,
    needs_external_evidence: parsed.symbols.length && (/(왜|실적|공시|뉴스|이유|근거|어때|살까|전망|재무|구성)/.test(message) || decision) ? 0.8 : 0.15,
    needs_policy_check: input.hasPolicy && (hypo || decision || /(원칙|한도|지키|괜찮)/.test(message)) ? 0.93 : 0.3,
    needs_risk_review: decision || parsed.isPredictionRequest ? 0.85 : 0.15,
  };
}

/** Rule scores at or above the ON threshold are hard signals; below it they are hints the model may override. */
export const RULE_FLOOR = 0.5;
export function withRuleFloor(model: Record<RoutingKey, number>, rule: Record<RoutingKey, number>): Record<RoutingKey, number> {
  return Object.fromEntries(ROUTING_KEYS.map((k) => [k, rule[k] >= RULE_FLOOR ? Math.max(model[k], rule[k]) : model[k]])) as Record<RoutingKey, number>;
}

const PlannerOutput = z.object(Object.fromEntries([...ROUTING_KEYS, "is_prediction_request"].map((k) => [k, z.number().min(0).max(1)])) as Record<RoutingKey | "is_prediction_request", z.ZodNumber>);

/**
 * Jev answers atomic yes/no questions; the graph itself is code. Low confidence escalates to a frontier-LLM planner.
 * Without any model configured, keyword rules keep the demo working.
 */
export async function route(input: RouteInput, dm: DecisionModel | null, tracer: Tracer): Promise<RoutingDecision> {
  const parsed = parseMessage(input.message, input.heldSymbols, input.history);
  const state = {
    message: input.message,
    hasPortfolio: input.hasPortfolio,
    hasInvestmentPolicy: input.hasPolicy,
    symbolsMentioned: parsed.symbols,
    heldSymbolsMentioned: parsed.symbols.filter((s) => input.heldSymbols.includes(s)),
    tradeDetected: parsed.trade ?? null,
    scenarioDetected: parsed.scenario ?? null,
    recentConversation: input.history?.slice(-6) ?? [],
  };
  const t0 = Date.now();

  const base: Omit<RoutingDecision, "scores" | "confidence" | "decidedBy" | "escalated" | "latencyMs"> = {
    symbols: parsed.symbols,
    trade: parsed.trade,
    scenario: parsed.scenario,
    isPredictionRequest: parsed.isPredictionRequest,
  };

  return tracer.step(
    "router",
    "decision",
    async (rec) => {
      const rule = ruleScores(input.message, parsed, input);
      let scores: Record<RoutingKey, number> = rule;
      let decidedBy: RoutingDecision["decidedBy"] = "rule";
      let confidence = 1;
      let prediction = parsed.isPredictionRequest ? 1 : 0;
      if (dm) {
        try {
          const r = await dm.evaluateMany(state, QUESTIONS);
          // F-011: the model may add specialists the rules missed, never drop what a deterministic signal requires
          // (held symbol -> portfolio, trade/scenario -> simulation+policy, decision wording -> policy+risk)
          scores = withRuleFloor(Object.fromEntries(ROUTING_KEYS.map((k) => [k, r.probabilities[k]])) as Record<RoutingKey, number>, rule);
          prediction = Math.max(prediction, r.probabilities.is_prediction_request);
          decidedBy = dm.name;
          confidence = confidenceOf(scores);
          rec.provider = dm.name;
          rec.model = r.meta.model;
          tracer.usage(rec, r.meta, r.meta.model);
        } catch (e) {
          rec.input = { fallback: "rule", reason: (e as Error).message };
        }
      }
      let escalated = false;
      if (decidedBy === "jev" && confidence < ROUTING_THRESHOLD && llmAvailable()) {
        escalated = true;
        const { model, config } = await modelFor("orchestratorFallback");
        const r = await generateObject({ model, schema: PlannerOutput, system: PLANNER_SYSTEM, prompt: `STATE: ${JSON.stringify(state)}\nQUESTIONS: ${JSON.stringify(QUESTIONS)}` });
        tracer.usage(rec, r.usage, config.model);
        scores = withRuleFloor(Object.fromEntries(ROUTING_KEYS.map((k) => [k, r.object[k]])) as Record<RoutingKey, number>, rule);
        prediction = Math.max(prediction, r.object.is_prediction_request);
        decidedBy = "llm";
        rec.model = `${rec.model ?? ""} -> ${config.provider}/${config.model}`;
      }
      const decision: RoutingDecision = { ...base, scores, confidence: Math.round(confidence * 100) / 100, decidedBy, escalated, isPredictionRequest: prediction >= 0.5, latencyMs: Date.now() - t0 };
      rec.output = { scores, confidence: decision.confidence, decidedBy, escalated, symbols: parsed.symbols, trade: parsed.trade, scenario: parsed.scenario, isPredictionRequest: decision.isPredictionRequest };
      return decision;
    },
    { input: state },
  );
}
