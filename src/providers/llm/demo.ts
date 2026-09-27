import { AsyncLocalStorage } from "node:async_hooks";
import { flag } from "@/lib/env";

/**
 * Public demo LLM policy. Visitors never connect anything: the demo answers with the owner's OpenRouter key,
 * restricted in code to `:free` models, with a per-session daily question quota. Self-hosted installs
 * (PUBLIC_DEMO_MODE off) use their own keys from .env instead.
 */

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_DEMO_MODEL = "qwen/qwen3.8-27b:free";

export const isDemo = () => flag("PUBLIC_DEMO_MODE");

/** The free model the demo may use, or undefined when the demo has no OpenRouter key / a non-free model is configured. */
export function demoFreeModel(): string | undefined {
  const model = process.env.DEMO_LLM_MODEL || DEFAULT_DEMO_MODEL;
  return process.env.OPENROUTER_API_KEY && model.endsWith(":free") ? model : undefined;
}

// ── request scope: lets an entry point run the pipeline without any LLM ──
const scope = new AsyncLocalStorage<{ llm: boolean }>();
export const withoutLlm = <T>(fn: () => T): T => scope.run({ llm: false }, fn);
export const llmAllowedHere = () => scope.getStore()?.llm ?? true;

// ── per-session daily quota (in memory: the demo runs on one machine) ──
const used = new Map<string, { day: string; count: number }>();
const today = () => new Date().toISOString().slice(0, 10);
export const demoQuestionsPerDay = () => Number(process.env.DEMO_QUESTIONS_PER_DAY ?? 5);

export function demoQuota(userId: string): { used: number; limit: number; left: number } {
  const limit = demoQuestionsPerDay();
  const u = used.get(userId);
  const n = u?.day === today() ? u.count : 0;
  return { used: n, limit, left: Math.max(0, limit - n) };
}

/** Consume one AI question; false when this session is out for today. */
export function takeDemoQuestion(userId: string): boolean {
  const q = demoQuota(userId);
  if (q.left <= 0) return false;
  used.set(userId, { day: today(), count: q.used + 1 });
  return true;
}
