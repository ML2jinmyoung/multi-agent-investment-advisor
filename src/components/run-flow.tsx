"use client";

import type { AgentStreamEvent, RoutingDecision } from "@/domain/agent";
import { cn } from "@/lib/utils";

export type StepState = Extract<AgentStreamEvent, { type: "step" }>;

/** Node vocabulary: what each step is, in the user's words. The graph shape mirrors src/orchestration/graph.ts. */
const NODES: Record<string, { label: string; role: string; doing: string; engine: "decision" | "code" | "llm" }> = {
  router: { label: "Router", role: "무엇이 필요한지 판단", doing: "질문을 이해하고 필요한 분석을 고르고 있어요", engine: "decision" },
  "exposure-engine": { label: "Exposure", role: "노출 계산", doing: "보유 자산 노출을 계산하고 있어요", engine: "code" },
  "simulation-engine": { label: "Simulation", role: "What-if 계산", doing: "What-if 시나리오를 계산하고 있어요", engine: "code" },
  "policy-engine": { label: "Policy", role: "원칙 점검", doing: "내 투자 원칙에 맞는지 점검하고 있어요", engine: "code" },
  "portfolio-agent": { label: "Portfolio", role: "나에게 어떤 의미인가", doing: "내 포트폴리오에 어떤 의미인지 살펴보고 있어요", engine: "llm" },
  "evidence-agent": { label: "Evidence", role: "외부에서 확인된 사실", doing: "공시와 외부 근거를 확인하고 있어요", engine: "llm" },
  "template-synthesizer": { label: "Template", role: "규칙 기반 답변", doing: "답변을 정리하고 있어요", engine: "code" },
  synthesizer: { label: "Synthesizer", role: "근거·대안·위험·비용 구조화", doing: "근거·대안·위험·비용으로 답변을 정리하고 있어요", engine: "llm" },
  verification: { label: "Verification", role: "근거 없는 주장·예측 검사", doing: "근거 없는 주장이 없는지 검증하고 있어요", engine: "decision" },
  "llm-critic": { label: "Critic", role: "문제 있을 때만 비평", doing: "검증에 걸린 부분을 다시 비평하고 있어요", engine: "llm" },
  "synthesizer-revision": { label: "Revision", role: "비평 반영 수정", doing: "비평을 반영해 답변을 고치고 있어요", engine: "llm" },
};

type Stage = { nodes: string[]; layout: "single" | "chain" | "parallel" | "conditional"; caption?: string };
const STAGES: Stage[] = [
  { nodes: ["router"], layout: "single" },
  { nodes: ["exposure-engine", "simulation-engine", "policy-engine"], layout: "chain", caption: "결정론적 계산" },
  { nodes: ["portfolio-agent", "evidence-agent"], layout: "parallel", caption: "동시 실행" },
  { nodes: ["synthesizer", "template-synthesizer"], layout: "single" },
  { nodes: ["verification"], layout: "single" },
  { nodes: ["llm-critic", "synthesizer-revision"], layout: "conditional", caption: "검증에 걸렸을 때만" },
];

const ENGINE_LABEL = { decision: "Jev", code: "code", llm: "LLM" } as const;

type Status = "idle" | "running" | "ok" | "skipped" | "error";
const STATUS_WORD: Record<Status, string> = { idle: "대기", running: "진행 중", ok: "완료", skipped: "건너뜀", error: "실패" };
const FINISHED: Status[] = ["ok", "error", "skipped"];

function statusOf(s?: StepState): Status {
  if (!s) return "idle";
  return s.status === "started" ? "running" : s.status;
}

function visibleStages(byName: Map<string, StepState>): Stage[] {
  return STAGES.map((st) => ({ ...st, nodes: st.layout === "single" && st.nodes.length > 1 ? [st.nodes.find((n) => byName.has(n)) ?? st.nodes[0]] : st.nodes }));
}

/** What the PB is doing right now, in plain words (the most recently started node that is still running). */
export function activityOf(steps: StepState[]): string | undefined {
  const running = steps.filter((s) => s.status === "started");
  const last = running[running.length - 1];
  return last ? (NODES[last.name]?.doing ?? `${last.name} 실행 중`) : undefined;
}

/** Determinate progress over the nodes expected to run. The conditional critic loop only counts once it starts. */
export function flowProgress(steps: StepState[]): { done: number; total: number } {
  const byName = new Map(steps.map((s) => [s.name, s]));
  const nodes = visibleStages(byName).flatMap((st) => (st.layout === "conditional" ? st.nodes.filter((n) => byName.has(n)) : st.nodes));
  return { done: nodes.filter((n) => FINISHED.includes(statusOf(byName.get(n)))).length, total: nodes.length };
}

function Glyph({ status }: { status: Status }) {
  if (status === "running") return <span aria-hidden className="flow-spinner" />;
  return (
    <span aria-hidden className="flow-glyph">
      {{ idle: "", ok: "✓", skipped: "–", error: "✕" }[status]}
    </span>
  );
}

function Node({ name, step, compact }: { name: string; step?: StepState; compact?: boolean }) {
  const meta = NODES[name] ?? { label: name, role: "", doing: "", engine: "code" as const };
  const status = statusOf(step);
  const where = step?.provider ?? (status !== "idle" && status !== "skipped" && meta.engine === "code" ? "code" : undefined);
  const detail =
    status === "skipped"
      ? `건너뜀 · ${step?.detail ?? ""}`
      : status === "error"
        ? `실패 · ${step?.detail ?? ""}`
        : status === "running"
          ? `${meta.role} · 진행 중`
          : status === "ok"
            ? `${meta.role}${step?.latencyMs !== undefined ? ` · ${step.latencyMs} ms` : ""}`
            : meta.role;
  const badge = <span className="flow-badge ml-auto shrink-0 rounded px-1 text-[11px] leading-4">{ENGINE_LABEL[meta.engine]}</span>;
  const label = <span className={cn("shrink-0 text-sm font-medium", status === "skipped" && "line-through decoration-muted-foreground/60")}>{meta.label}</span>;
  const aria = `${meta.label}: ${STATUS_WORD[status]}${step?.detail ? `, ${step.detail}` : ""}`;

  if (compact) {
    return (
      <div role="listitem" aria-label={aria} data-status={status} className="flow-node flex items-center gap-2 px-2.5 py-1.5">
        <Glyph status={status} />
        {label}
        <span className="flow-detail min-w-0 truncate text-xs">{detail}</span>
        {badge}
      </div>
    );
  }
  return (
    <div role="listitem" aria-label={aria} data-status={status} className="flow-node px-2.5 py-2">
      <div className="flex items-center gap-2">
        <Glyph status={status} />
        {label}
        {badge}
      </div>
      <p className="flow-detail mt-0.5 truncate pl-6 text-xs">{detail}</p>
      {(where || step?.model) && status !== "idle" && status !== "skipped" && (
        <p className="flow-detail truncate pl-6 text-[11px] leading-4">
          {where}
          {step?.model ? ` · ${step.model}` : ""}
        </p>
      )}
    </div>
  );
}

/** Link between stages: fills once the stage above has finished, and streams while the stage below is running. */
function Connector({ state }: { state: "idle" | "done" | "flowing" }) {
  return <div aria-hidden data-state={state} className="flow-link" />;
}

const Legend = () => (
  <p aria-hidden className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
    {(["running", "ok", "skipped", "error"] as const).map((s) => (
      <span key={s} data-status={s} className="flow-legend inline-flex items-center gap-1">
        <Glyph status={s} />
        {STATUS_WORD[s]}
      </span>
    ))}
  </p>
);

/**
 * Live flow chart of one agent run. Nodes light up as SSE step events arrive; the same component replays a persisted run.
 * Status is carried by glyph + text + color together; motion (shimmer, spinner, flowing links) is off under reduced motion.
 * Styles: `.flow-*` in app/globals.css.
 */
export function RunFlow({ steps, routing, legend = true }: { steps: StepState[]; routing?: RoutingDecision; legend?: boolean }) {
  const byName = new Map(steps.map((s) => [s.name, s]));
  const stageStatus = (st: Stage): "idle" | "running" | "done" => {
    const ss = st.nodes.map((n) => statusOf(byName.get(n)));
    if (ss.includes("running")) return "running";
    return ss.some((s) => FINISHED.includes(s)) ? "done" : "idle";
  };
  const visible = visibleStages(byName);

  return (
    <div role="list" aria-label="에이전트 실행 흐름" className="text-sm">
      {legend && <Legend />}
      {routing && (
        <p className="mb-2 text-xs text-muted-foreground">
          {routing.decidedBy}
          {routing.escalated ? " → LLM" : ""} · 확신 {Math.round(routing.confidence * 100)}% ·{" "}
          {Object.entries(routing.scores)
            .filter(([, v]) => v >= 0.5)
            .map(([k]) => k.replace("needs_", ""))
            .join(" · ") || "lookup only"}
        </p>
      )}
      {visible.map((st, i) => {
        const status = stageStatus(st);
        const prev = i > 0 ? stageStatus(visible[i - 1]) : undefined;
        return (
          <div key={st.nodes.join("+")} data-stage={status} className="flow-stage">
            {i > 0 && <Connector state={status === "running" ? "flowing" : prev === "done" ? "done" : "idle"} />}
            {st.caption && <p className="mb-1 text-center text-[11px] leading-4 text-muted-foreground">{st.caption}</p>}
            {st.layout === "parallel" ? (
              <div className="grid grid-cols-2 gap-2">
                {st.nodes.map((n) => (
                  <Node key={n} name={n} step={byName.get(n)} />
                ))}
              </div>
            ) : st.layout === "chain" || st.layout === "conditional" ? (
              <div className={cn("space-y-1 rounded-xl p-1", st.layout === "conditional" && "border border-dashed")}>
                {st.nodes.map((n) => (
                  <Node key={n} name={n} step={byName.get(n)} compact />
                ))}
              </div>
            ) : (
              <Node name={st.nodes[0]} step={byName.get(st.nodes[0])} />
            )}
          </div>
        );
      })}
    </div>
  );
}
