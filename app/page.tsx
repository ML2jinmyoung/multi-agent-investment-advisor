import { Suspense, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, ChevronRight, DollarSign, FileText, ShieldCheck, TrendingUp, type LucideIcon } from "lucide-react";
import { MarketRefresh } from "@/components/market-refresh";
import { BriefingReveal, BriefingStage } from "@/components/pb-briefing";
import { PbOrb } from "@/components/pb-orb";
import { todayModelHooks } from "@/agents/today-hooks";
import type { TodayItem, TodayResponse } from "@/domain/today";
import { krw } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getToday } from "@/services/today-service";
import { currentUserId } from "@/lib/user-session";
import { isDemo, withoutLlm } from "@/providers/llm/demo";

export const dynamic = "force-dynamic";

const TYPE: Record<TodayItem["type"], { label: string; icon: LucideIcon }> = {
  price_move: { label: "가격 변동", icon: TrendingUp },
  fx_move: { label: "환율", icon: DollarSign },
  policy: { label: "투자 원칙", icon: ShieldCheck },
  warning: { label: "투자 유의", icon: AlertTriangle },
  filing: { label: "공시", icon: FileText },
};
const STAGGER_MS = 60;
const rise = (step: number): CSSProperties => ({ animationDelay: `${step * STAGGER_MS}ms` });
const signColor = (n: number) => (n < 0 ? "text-down" : n > 0 ? "text-up" : "");
const seoulTime = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" });
/** Opens AI PB and asks right away. */
const ask = (q: string) => ({ pathname: "/agent", query: { q, auto: "1" } });

export default function HomePage() {
  return (
    <div>
      <h1 className="sr-only">My AI PB</h1>
      <BriefingStage>
        <Suspense fallback={null}>
          <TodayBriefing />
        </Suspense>
      </BriefingStage>
    </div>
  );
}

function PbSays({ step, children }: { step: number; children: ReactNode }) {
  return (
    <div className="pb-rise flex items-start gap-2" style={rise(step)}>
      <PbOrb size={28} className="mt-0.5" />
      <div className="rounded-2xl rounded-tl-sm bg-card px-4 py-3 text-sm shadow-sm ring-1 ring-border">{children}</div>
    </div>
  );
}

/** What the PB team actually checked this round; a scope is marked missing when today-service reported it unavailable. */
function checkedScopes(today: TodayResponse) {
  const missing = (word: string) => today.limitations.some((l) => l.includes(word));
  return [
    { label: "시세", ok: today.valuationComplete !== false },
    { label: "환율", ok: !missing("환율") },
    { label: "공시", ok: !missing("공시") },
    { label: "투자 원칙", ok: true },
    { label: "투자 유의", ok: true },
  ];
}

function SummaryCard({ today }: { today: TodayResponse }) {
  const complete = today.valuationComplete !== false;
  return (
    <section aria-label="오늘의 자산 요약" className="pb-rise rounded-3xl bg-primary p-5 text-primary-foreground shadow-lg shadow-primary/20" style={rise(0)}>
      <p className="flex items-center gap-2 text-xs text-primary-foreground/75">
        <span className="pb-live-dot" aria-hidden />
        PB가 실시간 점검 중 · {seoulTime(today.asOf)} 기준
      </p>
      <p className="mt-4 text-sm text-primary-foreground/75">{complete ? "분석 자산" : "확인된 평가액"}</p>
      <p className="text-3xl font-semibold tracking-tight tabular-nums">{krw(today.totalValueKRW)}</p>
      <p className="mt-1 text-sm tabular-nums">
        <span className="text-primary-foreground/75">오늘 가격 변동 </span>
        <span className={cn("font-semibold", today.dailyPnLKRW < 0 ? "text-[#9cc0ff]" : today.dailyPnLKRW > 0 ? "text-[#ff9b9b]" : "")}>
          {complete ? `${today.dailyPnLKRW > 0 ? "+" : ""}${krw(today.dailyPnLKRW)}` : "확인 필요"}
        </span>
      </p>
      <ul aria-label="PB 팀이 확인한 범위" className="mt-4 flex flex-wrap gap-1.5">
        {checkedScopes(today).map((s) => (
          <li key={s.label} className={cn("rounded-full px-2.5 py-1 text-xs", s.ok ? "bg-white/12 text-primary-foreground" : "bg-white/5 text-primary-foreground/55 line-through")}>
            {s.ok ? "✓ " : "– "}
            {s.label}
            <span className="sr-only">{s.ok ? " 확인함" : " 확인하지 못함"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChangeCard({ item, index }: { item: TodayItem; index: number }) {
  const { label, icon: Icon } = TYPE[item.type];
  const q = item.symbol ? `${item.title} 나에게 어떤 의미야?` : `${item.title} 내 포트폴리오에 어떤 영향이야?`;
  const source = item.sources.find((s) => !s.isMock && s.asOf);
  return (
    <article className="pb-rise rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border" style={rise(index + 2)}>
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-brand" aria-hidden>
          <Icon className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <h3 className="font-semibold leading-snug">{item.title}</h3>
          {item.portfolioImpactKRW !== 0 && (
            <p className="mt-0.5 text-sm tabular-nums">
              <span className={cn("font-semibold", signColor(item.portfolioImpactKRW))}>
                {item.portfolioImpactKRW > 0 ? "+" : ""}
                {krw(item.portfolioImpactKRW)}
              </span>
              {item.exposurePct !== undefined && <span className="text-muted-foreground"> · 내 자산의 {item.exposurePct}%</span>}
            </p>
          )}
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed">{item.explanation}</p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {item.explanationBy === "llm" ? "AI 설명" : "규칙 기반"}
          {source ? ` · ${source.source} ${seoulTime(source.asOf!)}` : ""}
          {item.sources.some((s) => s.isMock) && " · 데모 자산"}
        </span>
        <Link href={ask(q)} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-secondary px-3.5 text-xs font-medium text-brand transition-colors hover:bg-accent">
          PB에게 물어보기
          <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </article>
  );
}

async function TodayBriefing() {
  const userId = await currentUserId();
  // demo: the home briefing refreshes every minute, so it stays rule-based to save the shared free-model quota
  const run = () => getToday(userId, todayModelHooks());
  const today = await (isDemo() ? withoutLlm(run) : run());
  const n = today.items.length;
  const after = n + 2;
  const proactive = [...today.items.slice(0, 2).map((i) => (i.symbol ? `${i.title} 나에게 어떤 의미야?` : `${i.title} 내 포트폴리오에 어떤 영향이야?`)), "환율이 10% 떨어지면 내 자산은?"];

  return (
    <BriefingReveal>
      <MarketRefresh />
      <SummaryCard today={today} />

      <PbSays step={1}>
        <p className="font-medium">
          {n > 0 ? `오늘 먼저 확인할 변화 ${n}가지예요.` : today.valuationComplete === false ? "시장 데이터를 확인하지 못해 변화 분석을 보류했어요." : "오늘은 크게 신경 쓸 변화가 없어요."}
        </p>
      </PbSays>

      {today.items.map((item, i) => (
        <ChangeCard key={item.id} item={item} index={i} />
      ))}

      <section aria-label="PB가 먼저 제안하는 질문" className="pb-rise space-y-2 pt-1" style={rise(after)}>
        <PbSays step={0}>
          <p>이런 것도 바로 분석해 드릴게요.</p>
        </PbSays>
        <ul className="flex flex-col gap-2 pl-9">
          {proactive.map((q) => (
            <li key={q}>
              <Link href={ask(q)} className="flex min-h-11 items-center justify-between gap-2 rounded-2xl bg-card px-4 py-2.5 text-sm shadow-sm ring-1 ring-border transition-colors hover:bg-secondary">
                <span>{q}</span>
                <ArrowUpRight className="size-4 shrink-0 text-brand" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <footer className="pb-rise space-y-2 pt-2 text-xs text-muted-foreground" style={rise(after + 1)}>
        {today.limitations.length > 0 && (
          <details className="rounded-xl bg-secondary px-3 py-2">
            <summary className="cursor-pointer font-medium text-foreground">확인하지 못한 데이터 {today.limitations.length}건</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {today.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </details>
        )}
        <p>
          {today.marketMode === "live" ? "실제 시세" : "예시 시세"} · 이전 거래일 종가 대비 · 60초마다 갱신 · 예측이 아닌 현재 보유 기준 계산
        </p>
      </footer>
    </BriefingReveal>
  );
}
