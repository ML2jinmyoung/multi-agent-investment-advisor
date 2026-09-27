import { AgentChat } from "@/components/agent-chat";
import { SimulationPanel } from "@/components/simulation-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { flag } from "@/lib/env";
import { listMessages } from "@/services/conversation-store";
import { getPortfolioSnapshot } from "@/services/portfolio-aggregator";
import { currentUserId } from "@/lib/user-session";
import { demoFreeModel, demoQuota, isDemo } from "@/providers/llm/demo";

export const dynamic = "force-dynamic";

export default async function AgentPage({ searchParams }: PageProps<"/agent">) {
  const { q } = await searchParams;
  const userId = await currentUserId();
  const [messages, snapshot] = await Promise.all([listMessages(userId), getPortfolioSnapshot(userId)]);
  const demoModel = isDemo() ? demoFreeModel() : undefined;
  const quota = demoModel ? demoQuota(userId) : undefined;
  const held = [...new Set(snapshot.positions.filter((p) => p.assetType !== "cash").map((p) => p.symbol))];
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Ask your PB</h1>
        <p className="text-sm text-muted-foreground">추천이 아니라 근거·대안·위험·비용·원칙 점검으로 답합니다.</p>
        {demoModel && quota && (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-1.5 rounded-full bg-[var(--pb-live)]" />
              데모 · 무료 AI 모델 {demoModel.replace(/:free$/, "").split("/").pop()}
            </span>
            <span>오늘 남은 AI 질문 {quota.left}/{quota.limit}</span>
          </p>
        )}
      </header>
      {snapshot.valuationComplete === false && <p className="rounded border border-amber-300 p-3 text-sm text-amber-800">시장 데이터 연결을 기다리고 있습니다. 시세·환율을 확인한 후 분석과 시뮬레이션을 이용할 수 있습니다.</p>}
      <Tabs defaultValue={typeof q === "string" && q ? "chat" : "chat"}>
        <TabsList className="w-full">
          <TabsTrigger value="chat" className="flex-1">
            대화
          </TabsTrigger>
          <TabsTrigger value="simulate" className="flex-1">
            What-if 시뮬레이션
          </TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="pt-3">
          <AgentChat initialMessages={messages} initialQuestion={typeof q === "string" ? q : undefined} showTrace={flag("ENABLE_AGENT_TRACE", true)} />
        </TabsContent>
        <TabsContent value="simulate" className="pt-3">
          <SimulationPanel heldSymbols={held} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
