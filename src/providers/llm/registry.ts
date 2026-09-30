import { anthropic } from "@ai-sdk/anthropic";
import { createOpenAI, openai } from "@ai-sdk/openai";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { cassetteMode, recordingModel, replayModel } from "./cassette";
import { demoFreeModel, isDemo, llmAllowedHere, OPENROUTER_BASE_URL } from "./demo";
import { flag } from "@/lib/env";

export const AGENT_NAMES = ["orchestratorFallback", "portfolio", "evidence", "critic", "synthesizer"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export const ModelConfig = z.object({ provider: z.enum(["openai", "anthropic", "openrouter"]), model: z.string() });
export type ModelConfig = z.infer<typeof ModelConfig>;
export type Provider = ModelConfig["provider"];

/** Defaults come from env; model names are never hardcoded. LLM_PROVIDER picks the provider for every agent (default anthropic). */
const ENV_MODEL: Record<AgentName, string> = {
  orchestratorFallback: "ORCHESTRATOR_MODEL",
  portfolio: "PORTFOLIO_MODEL",
  evidence: "EVIDENCE_MODEL",
  critic: "CRITIC_MODEL",
  synthesizer: "SYNTHESIZER_MODEL",
};
const defaultProvider = (): Provider => {
  const p = ModelConfig.shape.provider.safeParse(process.env.LLM_PROVIDER);
  return p.success ? p.data : "anthropic";
};

const KEY_ENV: Record<Provider, string> = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", openrouter: "OPENROUTER_API_KEY" };

/** In the public demo only the free OpenRouter model counts as configured; the owner's other keys are ignored. */
export function hasProviderKey(provider: Provider): boolean {
  // eval replay answers from recorded cassettes: no key is needed and none is read
  if (cassetteMode() === "replay") return true;
  if (isDemo()) return provider === "openrouter" && Boolean(demoFreeModel());
  return Boolean(process.env[KEY_ENV[provider]]);
}

export const llmAvailable = () => llmAllowedHere() && (hasProviderKey("openai") || hasProviderKey("anthropic") || hasProviderKey("openrouter"));

export async function getModelConfigs(): Promise<Record<AgentName, ModelConfig>> {
  const db = await getDb();
  const rows = await db.select().from(schema.modelSettings);
  const out = {} as Record<AgentName, ModelConfig>;
  for (const agent of AGENT_NAMES) {
    const row = rows.find((r) => r.agent === agent);
    const parsed = row ? ModelConfig.safeParse({ provider: row.provider, model: row.model }) : undefined;
    out[agent] = parsed?.success ? parsed.data : { provider: defaultProvider(), model: process.env[ENV_MODEL[agent]] ?? "" };
  }
  return out;
}

export async function setModelConfig(agent: AgentName, cfg: ModelConfig): Promise<void> {
  const db = await getDb();
  const row = { agent, provider: cfg.provider, model: cfg.model };
  await db.insert(schema.modelSettings).values(row).onConflictDoUpdate({ target: schema.modelSettings.agent, set: row });
}

export class ModelNotConfiguredError extends Error {}

export function getModel(config: ModelConfig) {
  if (!config.model) throw new ModelNotConfiguredError(`model name not configured for ${config.provider}`);
  const mode = cassetteMode();
  if (mode === "replay") return replayModel(config.provider, config.model);
  if (!hasProviderKey(config.provider)) throw new ModelNotConfiguredError(`${config.provider} API key missing`);
  const live = liveModel(config);
  return mode === "record" ? recordingModel(live, config.model) : live;
}

function liveModel(config: ModelConfig) {
  if (config.provider === "openai") return openai(config.model);
  if (config.provider === "anthropic") return anthropic(config.model);
  if (config.provider === "openrouter") return createOpenAI({ baseURL: OPENROUTER_BASE_URL, apiKey: process.env.OPENROUTER_API_KEY, headers: { "X-Title": "My AI PB" } }).chat(config.model);
  throw new Error("Unsupported provider");
}

/** Resolves the model for an agent; falls back to any configured provider when the preferred one has no key. */
export async function modelFor(agent: AgentName): Promise<{ model: ReturnType<typeof getModel>; config: ModelConfig }> {
  if (!llmAllowedHere()) throw new ModelNotConfiguredError("LLM disabled for this request");
  if (isDemo()) {
    const model = demoFreeModel();
    if (!model) throw new ModelNotConfiguredError("demo has no free OpenRouter model configured");
    const config = { provider: "openrouter" as const, model };
    return { model: getModel(config), config };
  }
  const configs = await getModelConfigs();
  let config = configs[agent];
  if (!hasProviderKey(config.provider) || !config.model) {
    const alt = (Object.values(configs) as ModelConfig[]).find((c) => c.model && hasProviderKey(c.provider));
    // the owner of a public demo who set no key of their own still gets the demo's free model, without the quota
    const free = flag("PUBLIC_DEMO_MODE") ? demoFreeModel() : undefined;
    if (alt) config = alt;
    else if (free) config = { provider: "openrouter", model: free };
  }
  return { model: getModel(config), config };
}
