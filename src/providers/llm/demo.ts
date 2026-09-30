import { AsyncLocalStorage } from "node:async_hooks";
import { flag } from "@/lib/env";
import { OWNER_USER_ID } from "@/lib/owner-auth";

/**
 * Public demo LLM policy. Visitors never connect anything: the demo answers with the owner's OpenRouter key,
 * restricted in code to `:free` models, with a per-session daily question quota. Self-hosted installs
 * (PUBLIC_DEMO_MODE off) use their own keys from .env instead. The owner signed in with OWNER_PASSCODE is not a
 * visitor: inside `asOwner` the demo rules are off, so the owner's own Anthropic/OpenAI keys answer with no quota.
 */

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_DEMO_MODEL = "qwen/qwen3.8-27b:free";

// ── request scope: lets an entry point run the pipeline without any LLM, or as the signed-in owner ──
const scope = new AsyncLocalStorage<{ llm?: boolean; owner?: boolean }>();
export const withoutLlm = <T>(fn: () => T): T => scope.run({ ...scope.getStore(), llm: false }, fn);
export const asOwner = <T>(fn: () => T): T => scope.run({ ...scope.getStore(), owner: true }, fn);
export const llmAllowedHere = () => scope.getStore()?.llm ?? true;

export const isDemo = () => flag("PUBLIC_DEMO_MODE") && !scope.getStore()?.owner;
/** Whether this user gets the demo rules (free model, daily quota); never the signed-in owner. */
export const demoFor = (userId: string) => isDemo() && userId !== OWNER_USER_ID;
/** Runs `fn` with the demo rules this user is under. */
export const forUser = <T>(userId: string, fn: () => T): T => (userId === OWNER_USER_ID ? asOwner(fn) : fn());

/** The free model the demo may use, or undefined when the demo has no OpenRouter key / a non-free model is configured. */
export function demoFreeModel(): string | undefined {
  const model = process.env.DEMO_LLM_MODEL || DEFAULT_DEMO_MODEL;
  return process.env.OPENROUTER_API_KEY && model.endsWith(":free") ? model : undefined;
}

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
