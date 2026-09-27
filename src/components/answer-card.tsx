import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, FileSearch, GitBranch, Receipt, ShieldCheck, type LucideIcon } from "lucide-react";
import { PolicyChecks } from "@/components/policy-checks";
import type { AgentAnswer } from "@/domain/agent";
import { krw } from "@/lib/format";

const SEVERITY = { low: "text-muted-foreground", medium: "text-amber-700", high: "text-red-700" } as const;
const SEVERITY_WORD = { low: "낮음", medium: "중간", high: "높음" } as const;

function Section({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Icon className="size-3.5 text-brand" aria-hidden />
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Structured AgentAnswer: conclusion first, then Evidence -> Risk -> Alternatives -> Cost -> Policy. */
export function AnswerCard({ answer, runId, showTrace }: { answer: AgentAnswer; runId?: string; showTrace?: boolean }) {
  return (
    <div className="space-y-4 rounded-2xl bg-card p-4 text-sm shadow-sm ring-1 ring-border">
      <p className="text-[15px] font-semibold leading-snug">{answer.summary}</p>
      <div className="rounded-xl bg-secondary px-3.5 py-3">
        <p className="text-xs font-semibold text-brand">PB 의견</p>
        <p className="mt-0.5 leading-relaxed">{answer.recommendation}</p>
      </div>
      <Section title="근거" icon={FileSearch}>
        <ul className="space-y-1.5">
          {answer.evidence.map((e, i) => (
            <li key={i}>
              {e.claim}
              <span className="block text-xs text-muted-foreground">
                {e.source}
                {e.asOf ? ` · ${e.asOf.slice(0, 10)}` : ""}
                {e.isMock ? " · DEMO" : ""}
                {e.url && (
                  <>
                    {" · "}
                    <a href={e.url} target="_blank" rel="noreferrer" className="underline">
                      원문
                    </a>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="위험·불확실성" icon={AlertTriangle}>
        <ul className="space-y-1">
          {answer.risks.map((r, i) => (
            <li key={i}>
              <span className={`font-medium ${SEVERITY[r.severity]}`}>
                {r.title} <span className="text-xs font-normal">({SEVERITY_WORD[r.severity]})</span>
              </span>{" "}
              <span className="text-muted-foreground">— {r.description}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="대안" icon={GitBranch}>
        <ul className="space-y-1">
          {answer.alternatives.map((a, i) => (
            <li key={i}>
              <span className="font-medium">{a.title}</span> <span className="text-muted-foreground">— {a.description}</span>
            </li>
          ))}
        </ul>
      </Section>
      {answer.costs.length > 0 && (
        <Section title="비용" icon={Receipt}>
          <ul className="space-y-0.5 tabular-nums">
            {answer.costs.map((c, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span>{c.label}</span>
                <span>
                  {c.amountKRW !== undefined ? krw(c.amountKRW) : ""}
                  {c.note ? <span className="ml-1 text-xs text-muted-foreground">{c.note}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="투자 원칙 점검" icon={ShieldCheck}>
        <PolicyChecks checks={answer.policyChecks} />
      </Section>
      {(answer.limitations.length > 0 || (showTrace && runId)) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
          {answer.limitations.length > 0 && (
            <details className="min-w-0 flex-1">
              <summary className="cursor-pointer">한계·데이터 안내 {answer.limitations.length}건</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {answer.limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </details>
          )}
          {showTrace && runId && (
            <Link href={`/trace/${runId}`} className="underline underline-offset-4">
              실행 기록
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
