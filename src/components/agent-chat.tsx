"use client";

import { useEffect, useRef, useState } from "react";
import { AnswerCard } from "@/components/answer-card";
import { PbComposer } from "@/components/pb-composer";
import { PbOrb } from "@/components/pb-orb";
import { RunFlow, activityOf, flowProgress, type StepState } from "@/components/run-flow";
import type { AgentAnswer, AgentStreamEvent, RoutingDecision } from "@/domain/agent";
import type { ChatMessage } from "@/services/conversation-store";

type Progress = { runId?: string; routing?: RoutingDecision; steps: StepState[]; done?: boolean; startedAt: number; finishedAt?: number };

const EXAMPLES = ["NVDA 500만원 더 살까?", "내가 가장 많이 가진 종목은?", "환율이 10% 떨어지면?"];

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}초`;

/** Ticks while a run is live so the elapsed time keeps moving. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function PbLabel() {
  return (
    <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <PbOrb size={18} />
      My AI PB
    </p>
  );
}

function LiveRun({ progress }: { progress: Progress }) {
  const now = useNow(!progress.done);
  const { done, total } = flowProgress(progress.steps);
  const activity = activityOf(progress.steps) ?? (progress.steps.length === 0 ? "질문을 읽고 있어요" : "다음 단계를 준비하고 있어요");
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <section aria-label="분석 진행 상황" className="pb-rise pb-run rounded-2xl border p-4">
      <div className="flex items-center gap-3">
        <PbOrb size={40} state="thinking" />
        <p key={activity} aria-live="polite" className="pb-swap text-[15px] font-medium leading-snug">
          {activity}
        </p>
      </div>
      <div className="mt-4 flex items-center gap-3 text-xs tabular-nums text-muted-foreground">
        <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="완료된 단계" className="pb-progress h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="pb-progress-fill h-full rounded-full" style={{ width: `${pct}%` }} />
        </div>
        <span>
          {done}/{total} 단계 · {seconds(now - progress.startedAt)}
        </span>
      </div>
      <div className="mt-4">
        <RunFlow steps={progress.steps} routing={progress.routing} />
      </div>
    </section>
  );
}

export function AgentChat({ initialMessages, initialQuestion, autoSend, showTrace }: { initialMessages: ChatMessage[]; initialQuestion?: string; autoSend?: boolean; showTrace: boolean }) {
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState(initialQuestion ?? "");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const busy = Boolean(progress && !progress.done);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, progress]);

  // proactive questions from home arrive with auto=1: the PB starts answering right away
  const autoSent = useRef(false);
  useEffect(() => {
    if (!autoSend || !initialQuestion || autoSent.current) return;
    autoSent.current = true;
    window.history.replaceState(null, "", "/agent"); // a reload must not ask again
    send(initialQuestion);
    // send is stable enough for a one-shot mount effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setError(null);
    setNotice(null);
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", text: message, createdAt: new Date().toISOString() }]);
    setProgress({ steps: [], startedAt: Date.now() });
    const res = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
    if (!res.ok || !res.body) {
      setError("요청에 실패했습니다.");
      setProgress(null);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let runId: string | undefined;
    let answer: AgentAnswer | undefined;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const ev = JSON.parse(line.slice(6)) as AgentStreamEvent;
        if (ev.type === "run") runId = ev.runId;
        if (ev.type === "routing") setProgress((p) => ({ ...p!, runId, routing: ev.routing }));
        if (ev.type === "step") setProgress((p) => ({ ...p!, steps: [...p!.steps.filter((s) => s.name !== ev.name), ev] }));
        if (ev.type === "answer") answer = ev.answer;
        if (ev.type === "error") setError(ev.message);
        if (ev.type === "notice") setNotice(ev.message);
      }
    }
    if (answer) setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", answer, runId, createdAt: new Date().toISOString() }]);
    setProgress((p) => (p ? { ...p, done: true, finishedAt: Date.now() } : null));
  }

  const empty = messages.length === 0 && !progress;

  return (
    <div>
      {empty ? (
        <section className="flex flex-col items-center pt-10 pb-4 text-center">
          <PbOrb size={120} state={input ? "thinking" : "idle"} className="pb-pop" />
          <h2 className="pb-rise mt-8 text-2xl font-semibold tracking-tight" style={{ animationDelay: "150ms" }}>
            무엇이 궁금하세요?
          </h2>
          <p className="pb-rise mt-2 text-sm text-muted-foreground" style={{ animationDelay: "250ms" }}>
            근거·대안·위험·비용·원칙을 함께 점검해 드릴게요.
          </p>
          <ul className="mt-8 flex w-full flex-col items-center gap-2" aria-label="예시 질문">
            {EXAMPLES.map((q, i) => (
              <li key={q} className="pb-rise" style={{ animationDelay: `${400 + i * 90}ms` }}>
                <button
                  type="button"
                  onClick={() => {
                    setInput(q);
                    field.current?.focus();
                  }}
                  className="rounded-full border px-4 py-2.5 text-sm transition-colors hover:bg-muted"
                >
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="space-y-4">
          {messages.map((m) =>
            m.role === "user" ? (
              <p key={m.id} className="pb-rise ml-auto w-fit max-w-[85%] rounded-3xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                {m.text}
              </p>
            ) : m.answer ? (
              <div key={m.id} className="pb-rise">
                <PbLabel />
                <AnswerCard answer={m.answer} runId={m.runId} showTrace={showTrace} />
              </div>
            ) : (
              <div key={m.id} className="pb-rise">
                <PbLabel />
                <p className="text-sm">{m.text}</p>
              </div>
            ),
          )}
          {notice && (
            <p role="status" className="pb-rise rounded-2xl bg-muted px-4 py-3 text-sm">
              {notice}
            </p>
          )}
          {progress && !progress.done && <LiveRun progress={progress} />}
          {progress?.done && (
            <details className="pb-rise rounded-2xl border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                실행 경로 보기
                <span className="ml-2 font-normal text-muted-foreground tabular-nums">
                  {flowProgress(progress.steps).done}단계{progress.finishedAt ? ` · ${seconds(progress.finishedAt - progress.startedAt)}` : ""}
                </span>
              </summary>
              <div className="pt-3">
                <RunFlow steps={progress.steps} routing={progress.routing} />
              </div>
            </details>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
      <div ref={bottom} />
      <PbComposer ref={field} value={input} onChange={setInput} onSubmit={() => send(input)} busy={busy} />
    </div>
  );
}
