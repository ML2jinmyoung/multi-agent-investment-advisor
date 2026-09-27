import { z } from "zod";
import type { AgentStreamEvent } from "@/domain/agent";
import { runAgent } from "@/orchestration/orchestrator";
import { userIdFromRequest } from "@/lib/user-session";
import { demoQuestionsPerDay, isDemo, takeDemoQuestion, withoutLlm } from "@/providers/llm/demo";
import { llmAvailable } from "@/providers/llm/registry";
import { addMessage, DEFAULT_CONVERSATION, listMessages, memoryTurns } from "@/services/conversation-store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({ message: z.string().min(1).max(2000), conversationId: z.string().optional() });

/** SSE: run -> routing -> step... -> verification -> answer -> done */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });
  const { message, conversationId = DEFAULT_CONVERSATION } = parsed.data;
  const userId = userIdFromRequest(req);
  const history = memoryTurns(await listMessages(userId, conversationId, 12));
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: AgentStreamEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        await addMessage(userId, conversationId, "user", message);
        // public demo: each session gets a few free-model questions a day, then deterministic answers
        const outOfQuota = isDemo() && llmAvailable() && !takeDemoQuestion(userId);
        if (outOfQuota) send({ type: "notice", message: `데모에서는 AI 질문을 하루 ${demoQuestionsPerDay()}개까지 할 수 있어요. 오늘은 규칙 기반으로 답해 드릴게요.` });
        const run = () => runAgent(message, send, { userId, history });
        const { answer, runId } = await (outOfQuota ? withoutLlm(run) : run());
        await addMessage(userId, conversationId, "assistant", answer, runId);
        send({ type: "done" });
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
