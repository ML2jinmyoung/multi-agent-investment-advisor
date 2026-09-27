import { NextResponse } from "next/server";
import { todayModelHooks } from "@/agents/today-hooks";
import { getToday } from "@/services/today-service";
import { userIdFromRequest } from "@/lib/user-session";
import { isDemo, withoutLlm } from "@/providers/llm/demo";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  // demo: the home briefing refreshes every minute, so it stays rule-based to save the shared free-model quota
  const run = () => getToday(userIdFromRequest(req), todayModelHooks(), { fresh });
  return NextResponse.json(await (isDemo() ? withoutLlm(run) : run()));
}
