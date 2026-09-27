import { NextResponse } from "next/server";
import { z } from "zod";
import { AGENT_NAMES, getModelConfigs, hasProviderKey, ModelConfig, setModelConfig } from "@/providers/llm/registry";
import { flag } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    agents: await getModelConfigs(),
    providers: { openai: hasProviderKey("openai"), anthropic: hasProviderKey("anthropic"), openrouter: hasProviderKey("openrouter") },
    decision: { provider: process.env.DECISION_PROVIDER ?? "jev", jev: Boolean(process.env.TYPESAFE_API_KEY) },
  });
}

const Body = z.object({ agent: z.enum(AGENT_NAMES), config: ModelConfig });

export async function PUT(req: Request) {
  if (flag("PUBLIC_DEMO_MODE")) return NextResponse.json({ error: "model settings are read-only in the public demo" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  await setModelConfig(parsed.data.agent, parsed.data.config);
  return NextResponse.json(await getModelConfigs());
}
