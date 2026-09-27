import type { RunContext } from "@/agents/context";
import { runEvidenceAgent } from "@/agents/evidence-agent";
import { runCritic } from "@/agents/llm-critic";
import { answerDirectly, runPortfolioAgent } from "@/agents/portfolio-agent";
import { runSynthesizer } from "@/agents/synthesizer";
import { decisionModel } from "@/decision";
import type { AgentAnswer, AgentStreamEvent, RoutingDecision, VerificationResult } from "@/domain/agent";
import type { InvestmentPolicy, PolicyCheck } from "@/domain/policy";
import type { SimulationRequest, SimulationResult } from "@/domain/simulation";
import { krw } from "@/lib/format";
import { llmAvailable } from "@/providers/llm/registry";
import { getMetrics } from "@/services/exposure-engine";
import { checkPolicy } from "@/services/policy-engine";
import { getPolicy } from "@/services/policy-store";
import { getPortfolioSnapshot } from "@/services/portfolio-aggregator";
import { runSimulation, SimulationError } from "@/services/simulation-engine";
import { snapshotView } from "@/tools/portfolio-tools";
import { simulationView, type SimulationView } from "@/tools/simulation-tools";
import { verifyAnswer } from "./escalation";
import { buildPlan } from "./graph";
import { route } from "./router";
import { runParallel } from "./runner";
import { type StepRecord, type ToolCallRecord, Tracer } from "./tracer";

export interface AgentRunResult {
  runId: string;
  routing: RoutingDecision;
  answer: AgentAnswer;
  summary: ReturnType<Tracer["summary"]>;
  verification: VerificationResult;
  /** the deterministic inputs the models saw; evals grade the answer against these, never against the answer itself */
  context: { snapshot: SnapshotView; policy: InvestmentPolicy; policyChecks: PolicyCheck[]; simulationView?: SimulationView; limitations: string[] };
  trace: { steps: Pick<StepRecord, "name" | "kind" | "status" | "latencyMs" | "model">[]; toolCalls: Pick<ToolCallRecord, "tool" | "status" | "stepId" | "input" | "output" | "rawOutput">[] };
}
type SnapshotView = RunContext["snapshot"];

const NO_PREDICTION = "미래 가격은 예측하지 않습니다. 위 내용은 현재 보유 자산 기준의 계산과 확인된 근거이며, 가정 시나리오는 예측이 아닙니다.";

/**
 * Eval-only system variants for baseline comparison (docs/eval-loop-plan.md §4-2). `full` is production behaviour.
 * single-agent: no Portfolio/Evidence specialists, the Synthesizer works from deterministic inputs alone.
 * no-critic: verification runs but never escalates to the Critic.
 */
export type AgentVariant = "full" | "single-agent" | "no-critic";
export const agentVariant = (): AgentVariant => {
  const v = process.env.AGENT_VARIANT;
  return v === "single-agent" || v === "no-critic" ? v : "full";
};

/**
 * Router -> deterministic engines -> (Portfolio Agent ∥ Evidence Agent) -> Synthesizer -> Jev verification -> optional Critic.
 * Only the intelligence a question needs is invoked; everything numeric is computed in code before any model runs.
 */
export async function runAgent(
  message: string,
  emit: (e: AgentStreamEvent) => void = () => {},
  options: { userId?: string; history?: { role: "user" | "assistant"; content: string }[] } = {},
): Promise<AgentRunResult> {
  const userId = options.userId ?? "demo";
  const history = options.history?.slice(-12) ?? [];
  const tracer = new Tracer(message, emit, userId);
  emit({ type: "run", runId: tracer.runId });
  let routing: RoutingDecision | undefined;
  try {
    const [snapshot, policy] = await Promise.all([getPortfolioSnapshot(userId), getPolicy(userId)]);
    if (snapshot.valuationComplete === false) throw new Error("시세·환율을 확인하지 못해 자산 분석을 진행할 수 없습니다. 자산 화면의 데이터 안내를 확인해 주세요.");
    const { metrics, warnings: exposureWarnings, etf } = await tracer.step("exposure-engine", "deterministic", () => getMetrics(snapshot));
    const heldSymbols = [...new Set(snapshot.positions.filter((p) => p.assetType !== "cash").map((p) => p.symbol))];
    const dm = decisionModel();

    routing = await route({ message, hasPortfolio: snapshot.positions.length > 0, hasPolicy: true, heldSymbols, history }, dm, tracer);
    emit({ type: "routing", routing });
    const plan = buildPlan(routing);

    // deterministic: simulation + policy (never a model)
    let simulation: SimulationResult | undefined;
    const limitations: string[] = [...snapshot.warnings, ...exposureWarnings];
    if (plan.simulation) {
      const req = simulationRequest(routing);
      if (!req) {
        limitations.push("거래 금액이나 수량을 알려주시면 시뮬레이션합니다.");
        tracer.skip("simulation-engine", "amount not specified");
      } else {
        try {
          simulation = await tracer.step("simulation-engine", "deterministic", () => runSimulation(req, { userId, snapshot, policy, etf }), { input: req });
        } catch (e) {
          if (!(e instanceof SimulationError)) throw e;
          limitations.push(e.message);
        }
      }
    } else tracer.skip("simulation-engine", "not needed");
    const policyChecks = simulation
      ? await tracer.step("policy-engine", "deterministic", async () => simulation!.policyChecks, { input: { source: "simulation before/after" } })
      : plan.policy
        ? await tracer.step("policy-engine", "deterministic", async () => checkPolicy(metrics, metrics, policy))
        : (tracer.skip("policy-engine", "not needed"), []);

    const ctx: RunContext = { userId, message, history, routing, tracer, snapshot: await snapshotView(userId, snapshot), policyChecks, simulation, simulationView: simulation && simulationView(simulation), policy };

    let answer: AgentAnswer;
    if (!llmAvailable()) {
      for (const n of ["portfolio-agent", "evidence-agent", "synthesizer"]) tracer.skip(n, "no LLM provider configured");
      answer = await tracer.step("template-synthesizer", "deterministic", async () => deterministicAnswer(ctx, limitations));
    } else {
      try {
        if (agentVariant() === "single-agent") {
          for (const n of ["portfolio-agent", "evidence-agent"]) tracer.skip(n, "variant single-agent");
          answer = await runSynthesizer(ctx, {});
        } else if (plan.simple) {
          for (const n of ["evidence-agent", "synthesizer"]) tracer.skip(n, "simple portfolio query");
          answer = await answerDirectly(ctx);
        } else {
          const tasks: Record<string, () => Promise<unknown>> = {};
          if (plan.portfolio) tasks.portfolio = () => runPortfolioAgent(ctx);
          else tracer.skip("portfolio-agent", "not needed");
          if (plan.evidence) tasks.evidence = () => runEvidenceAgent(ctx);
          else tracer.skip("evidence-agent", routing.symbols.length ? "not needed" : "no symbol mentioned");
          const { results, errors } = await runParallel(tasks);
          limitations.push(...errors.map((e) => `에이전트 실패: ${e}`));
          answer = await runSynthesizer(ctx, { portfolio: results.portfolio as never, evidence: results.evidence as never });
        }
      } catch (e) {
        // an LLM/provider failure (quota, network, bad model name) must not lose the deterministic work
        limitations.push(`LLM 호출 실패로 규칙 기반 답변으로 대체했습니다: ${(e as Error).message.slice(0, 160)}`);
        answer = await tracer.step("template-synthesizer", "deterministic", async () => deterministicAnswer(ctx, limitations));
      }
    }
    answer.limitations = [...new Set([...answer.limitations, ...limitations])];
    if (routing.isPredictionRequest && !answer.limitations.includes(NO_PREDICTION)) answer.limitations.unshift(NO_PREDICTION);

    const verification = await verifyAnswer({ message, answer, policyChecks, dataAsOf: snapshot.asOf, warnings: limitations }, dm, tracer);
    emit({ type: "verification", verification });
    if (verification.needsCritic && llmAvailable() && agentVariant() !== "no-critic") {
      const critique = await runCritic(ctx, answer, verification);
      if (critique.verdict === "revise" && critique.problems.length) {
        answer = await runSynthesizer(ctx, { critique: critique.problems.map((p) => `${p.kind}: ${p.detail}`).join("\n"), previous: answer });
        answer.limitations = [...new Set([...answer.limitations, ...limitations])];
        // F-013: the revision may drop the code-owned disclaimer; put it back
        if (routing.isPredictionRequest && !answer.limitations.includes(NO_PREDICTION)) answer.limitations.unshift(NO_PREDICTION);
      } else tracer.skip("synthesizer-revision", "critic passed the draft");
    } else tracer.skip("llm-critic", agentVariant() === "no-critic" ? "variant no-critic" : verification.needsCritic ? "no LLM provider configured" : "verification passed");

    emit({ type: "answer", answer });
    await tracer.persist({ answer, routing });
    return {
      runId: tracer.runId,
      routing,
      answer,
      summary: tracer.summary(),
      verification,
      context: { snapshot: ctx.snapshot, policy, policyChecks, simulationView: ctx.simulationView, limitations },
      trace: {
        steps: tracer.steps.map((s) => ({ name: s.name, kind: s.kind, status: s.status, latencyMs: s.latencyMs, model: s.model })),
        toolCalls: tracer.toolCalls.map((t) => ({ tool: t.tool, status: t.status, stepId: t.stepId, input: t.input, output: t.output, rawOutput: t.rawOutput })),
      },
    };
  } catch (e) {
    await tracer.persist({ routing, error: (e as Error).message }).catch(() => {});
    throw e;
  }
}

function simulationRequest(r: RoutingDecision): SimulationRequest | undefined {
  if (r.trade && (r.trade.amountKRW || r.trade.quantity)) return { type: "trade", symbol: r.trade.symbol, action: r.trade.action, amountKRW: r.trade.amountKRW, quantity: r.trade.quantity };
  if (r.scenario) return { type: "scenario", shocks: [r.scenario] };
  return undefined;
}

/** No-LLM fallback: same AgentAnswer structure, built from deterministic results only. */
export function deterministicAnswer(ctx: RunContext, limitations: string[]): AgentAnswer {
  const { snapshot, simulation, policyChecks, routing } = ctx;
  const evidence: AgentAnswer["evidence"] = [];
  const top = snapshot.positions.slice(0, 3);
  for (const p of top) evidence.push({ kind: "portfolio", claim: `${p.name}(${p.symbol}) 평가액 ${krw(p.marketValueKRW)}, 비중 ${p.weightPct}%`, source: snapshot.sources[0] ?? "portfolio", asOf: snapshot.asOf });
  evidence.push({ kind: "portfolio", claim: `투자 가능 금액 ${krw(snapshot.buyingPowerKRW)}`, source: snapshot.sources[0] ?? "portfolio", asOf: snapshot.asOf });
  if (simulation) {
    for (const c of simulation.changes) evidence.push({ kind: "simulation", claim: `${c.label}: ${c.unit === "krw" ? `${krw(c.before)} → ${krw(c.after)}` : `${c.before}% → ${c.after}%`}`, source: "Simulation Engine (deterministic)", asOf: simulation.computedAt });
    if (simulation.impactKRW !== undefined) evidence.push({ kind: "simulation", claim: `시나리오 가정 시 평가액 영향 ${krw(simulation.impactKRW)}`, source: "Simulation Engine (deterministic)", asOf: simulation.computedAt });
  }
  for (const c of policyChecks.filter((c) => c.status !== "ok")) evidence.push({ kind: "policy", claim: `${c.label}${c.subject ? ` · ${c.subject}` : ""}: ${c.after}% / 한도 ${c.limit}% (${c.status})`, source: "Policy Engine (deterministic)" });

  const violated = policyChecks.some((c) => c.status === "violation");
  const trade = routing.trade;
  const alternatives = trade
    ? [
        { title: `${trade.symbol} ${trade.action === "buy" ? "매수" : "매도"} 그대로 실행`, description: "시뮬레이션 결과대로 비중이 바뀝니다." },
        { title: "절반만 실행", description: "비중 변화와 원칙 위반 여부를 줄입니다." },
        { title: "ETF로 분산", description: "단일 종목 집중 대신 지수 ETF로 같은 금액을 투자합니다." },
        { title: "기존 집중 종목 일부 축소 후 실행", description: "단일 종목 한도 안에서 실행할 수 있습니다." },
        { title: "아무것도 하지 않음", description: "현재 원칙 기준으로 합리적인 선택일 수 있습니다." },
      ]
    : [{ title: "아무것도 하지 않음", description: "현재 포트폴리오를 유지합니다." }, { title: "투자 원칙 점검", description: "원칙 페이지에서 현재 상태를 확인합니다." }, { title: "시뮬레이션으로 비교", description: "금액을 정해 매수/매도 결과를 미리 봅니다." }];
  const costs: AgentAnswer["costs"] = simulation?.cost
    ? [{ label: "수수료", amountKRW: simulation.cost.commissionKRW }, { label: "세금", amountKRW: simulation.cost.taxKRW }, { label: "환전비용", amountKRW: simulation.cost.fxKRW, note: simulation.cost.note }]
    : [];
  return {
    summary: simulation
      ? `시뮬레이션 결과 ${simulation.changes.map((c) => `${c.label} ${c.unit === "krw" ? `${krw(c.before)}→${krw(c.after)}` : `${c.before}%→${c.after}%`}`).slice(0, 3).join(", ")}.`
      : `연결 자산 ${krw(snapshot.totalValueKRW)} 중 가장 큰 보유는 ${top[0]?.name ?? "-"}(${top[0]?.weightPct ?? 0}%)입니다.`,
    evidence,
    alternatives,
    risks: [
      { title: "다음 실적 미확정", description: "향후 실적·가이던스는 확인되지 않은 정보입니다.", severity: "medium" },
      { title: "금리·환율 변화", description: "외화 자산 비중만큼 환율 변동에 노출됩니다.", severity: "medium" },
      { title: "가격 변동성", description: "단기 가격 변동은 계산에 반영되지 않았습니다.", severity: "high" },
    ],
    costs,
    policyChecks,
    recommendation: violated
      ? "시뮬레이션에서 투자 원칙 위반이 발생합니다. 현재 설정한 투자 원칙을 기준으로 보면 추가 거래를 하지 않거나 규모를 줄이는 선택도 합리적입니다."
      : simulation
        ? "시뮬레이션상 투자 원칙 위반은 없습니다. 위 근거와 비용을 확인한 뒤 판단하세요."
        : "위 근거는 현재 보유 자산 기준의 계산입니다. 행동 전에 시뮬레이션으로 결과를 확인하세요.",
    limitations: ["LLM 제공자가 설정되지 않아 규칙 기반 템플릿으로 답변했습니다.", ...limitations],
  };
}
