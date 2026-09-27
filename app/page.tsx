import { Suspense, type CSSProperties, type ReactNode } from "react";
import { MarketRefresh } from "@/components/market-refresh";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BriefingReveal, BriefingStage } from "@/components/pb-briefing";
import { PbOrb } from "@/components/pb-orb";
import { todayModelHooks } from "@/agents/today-hooks";
import { krw } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getToday } from "@/services/today-service";
import { currentUserId } from "@/lib/user-session";
import { isDemo, withoutLlm } from "@/providers/llm/demo";

export const dynamic = "force-dynamic";

const TYPE_LABEL = { price_move: "가격 변동", fx_move: "환율", policy: "투자 원칙", warning: "투자 유의", filing: "공시" } as const;
const STAGGER_MS = 120;

const rise = (step: number): CSSProperties => ({ animationDelay: `${step * STAGGER_MS}ms` });

export default function HomePage() {
  return (
    <div>
      <h1 className="text-xl font-semibold">My AI PB</h1>
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
      <div className="rounded-2xl rounded-tl-sm bg-muted px-4 py-3 text-sm">{children}</div>
    </div>
  );
}

async function TodayBriefing() {
  const userId = await currentUserId();
  // demo: the home briefing refreshes every minute, so it stays rule-based to save the shared free-model quota
  const run = () => getToday(userId, todayModelHooks());
  const today = await (isDemo() ? withoutLlm(run) : run());
  const pnlColor = today.dailyPnLKRW < 0 ? "text-blue-600" : today.dailyPnLKRW > 0 ? "text-red-600" : "";
  const n = today.items.length;
  // steps: 0 = PB summary bubble, 1..n = cards, then trailing blocks
  const after = n + 1;

  return (
    <BriefingReveal>
      <PbSays step={0}>
        <p className="font-medium">
          {n > 0 ? `오늘 내 돈에 중요한 변화가 ${n}개 있어요.` : today.valuationComplete === false ? "시장 데이터를 확인하지 못해 변화 분석을 보류했어요." : "확인된 데이터에서 중요한 변화는 없어요."}
        </p>
        <p className="mt-1 text-muted-foreground">
          {today.valuationComplete === false ? "확인된 평가액" : "분석 자산"} {krw(today.totalValueKRW)} · 가격 변동 영향 <span className={cn("font-medium tabular-nums", pnlColor)}>{today.valuationComplete === false ? "확인 필요" : krw(today.dailyPnLKRW)}</span>
        </p>
      </PbSays>

      {today.items.map((item, i) => (
        <Card key={item.id} className="pb-rise" style={rise(i + 1)}>
          <CardHeader>
            <CardTitle className="flex items-start justify-between gap-2 text-base">
              <span>
                {i + 1}. {item.title}
              </span>
              <Badge variant="outline">{TYPE_LABEL[item.type]}</Badge>
            </CardTitle>
            {item.portfolioImpactKRW !== 0 && (
              <p className={cn("text-sm tabular-nums", item.portfolioImpactKRW < 0 ? "text-blue-600" : "text-red-600")}>
                내 자산 영향 {krw(item.portfolioImpactKRW)}
                {item.exposurePct !== undefined && <span className="text-muted-foreground"> · 노출 {item.exposurePct}%</span>}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{item.explanation}</p>
            <p className="text-xs text-muted-foreground">
              중요도 {Math.round(item.importance * 100)}% · {item.explanationBy === "llm" ? "AI 설명" : "규칙 기반 설명"}
              {item.sources.some((s) => s.isMock) && " · 데모 보유자산 포함"}
            </p>
            <p className="text-xs text-muted-foreground">{item.sources.filter((s) => !s.isMock && s.asOf).map((s) => `${s.source} · ${new Date(s.asOf!).toLocaleString("ko-KR")}`).join(" / ")}</p>
            <Link href={{ pathname: "/agent", query: { q: item.symbol ? `${item.title} 나에게 어떤 의미야?` : `${item.title} 내 포트폴리오에 어떤 영향이야?` } }} className="text-xs underline underline-offset-4">
              AI PB에게 물어보기
            </Link>
          </CardContent>
        </Card>
      ))}

      {today.limitations.length > 0 && (
        <section className="pb-rise rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900" style={rise(after)}>
          <p className="font-medium">확인하지 못한 데이터</p>
          <ul className="mt-1 list-disc pl-4">
            {today.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="pb-rise space-y-3" style={rise(after + 1)}>
        <PbSays step={0}>더 궁금한 점이 있으면 편하게 물어보세요.</PbSays>
        <Link href="/agent" className="flex items-center gap-2 rounded-full border px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted">
          Ask your PB… 예) NVDA 500만원 더 살까?
        </Link>
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>{today.marketMode === "live" ? "실제 시세·환율 조회 · 보유자산은 데모 또는 직접 입력" : "예시 시장 데이터"} · 가격은 이전 거래일 종가 대비, 환율 영향은 별도 추정</p>
          <MarketRefresh />
          <p>미래 가격 예측이 아니라 현재 보유 자산 기준의 계산입니다.</p>
        </div>
      </div>
    </BriefingReveal>
  );
}
