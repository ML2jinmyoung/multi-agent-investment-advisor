import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { type LanguageModelMiddleware, wrapLanguageModel } from "ai";

/**
 * LLM record/replay for evals. `record` wraps the real model and stores every doGenerate result under a
 * content hash; `replay` serves those results without network or API keys, so the whole LLM path
 * (agents, synthesizer, verification, critic) can run deterministically in CI.
 *
 * The hash covers model id, prompt, tool definitions, tool choice and response format. Timestamps are
 * normalized because snapshots carry `asOf`/`retrievedAt` that change on every run.
 */
export type CassetteMode = "off" | "record" | "replay";

export function cassetteMode(): CassetteMode {
  const m = process.env.LLM_CASSETTE_MODE;
  return m === "record" || m === "replay" ? m : "off";
}

export const DEFAULT_CASSETTE_DIR = "tests/evals/cassettes";
export const cassetteDir = () => path.resolve(process.env.LLM_CASSETTE_DIR || DEFAULT_CASSETTE_DIR);

const ISO_TS = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g;
export const normalizeForKey = (text: string) => text.replace(ISO_TS, "<ts>");

export function cassetteKey(modelId: string, params: LanguageModelV4CallOptions): string {
  const material = {
    modelId,
    prompt: params.prompt,
    tools: params.tools?.map((t) => (t.type === "function" ? { name: t.name, description: t.description, inputSchema: t.inputSchema } : t)),
    toolChoice: params.toolChoice,
    responseFormat: params.responseFormat,
    temperature: params.temperature,
  };
  return createHash("sha256").update(normalizeForKey(JSON.stringify(material))).digest("hex").slice(0, 24);
}

export interface Cassette {
  key: string;
  modelId: string;
  recordedAt: string;
  /** first user-visible text of the prompt, for humans browsing the directory */
  preview: string;
  result: Pick<LanguageModelV4GenerateResult, "content" | "finishReason" | "usage" | "warnings" | "providerMetadata">;
}

export class CassetteMissError extends Error {
  constructor(
    readonly modelId: string,
    readonly key: string,
  ) {
    super(`cassette miss: ${modelId} ${key} (run the eval in record mode to capture it)`);
    this.name = "CassetteMissError";
  }
}

const fileFor = (key: string) => path.join(cassetteDir(), `${key}.json`);

/** Per-process counters so an eval runner can tell a replayed run from one that silently fell back to rules. */
export const cassetteStats: { hits: number; misses: string[] } = { hits: 0, misses: [] };
export function resetCassetteStats() {
  cassetteStats.hits = 0;
  cassetteStats.misses = [];
}

function preview(params: LanguageModelV4CallOptions): string {
  for (const m of params.prompt) {
    if (m.role !== "user") continue;
    for (const part of m.content) if (part.type === "text") return part.text.slice(0, 200);
  }
  return "";
}

export function saveCassette(modelId: string, params: LanguageModelV4CallOptions, result: LanguageModelV4GenerateResult): Cassette {
  const key = cassetteKey(modelId, params);
  const cassette: Cassette = {
    key,
    modelId,
    recordedAt: new Date().toISOString(),
    preview: preview(params),
    result: { content: result.content, finishReason: result.finishReason, usage: result.usage, warnings: result.warnings, providerMetadata: result.providerMetadata },
  };
  mkdirSync(cassetteDir(), { recursive: true });
  writeFileSync(fileFor(key), JSON.stringify(cassette, null, 2));
  return cassette;
}

export function loadCassette(modelId: string, params: LanguageModelV4CallOptions): Cassette {
  const key = cassetteKey(modelId, params);
  const f = fileFor(key);
  if (!existsSync(f)) {
    cassetteStats.misses.push(`${modelId}:${key}`);
    throw new CassetteMissError(modelId, key);
  }
  cassetteStats.hits++;
  return JSON.parse(readFileSync(f, "utf8")) as Cassette;
}

/** Wraps a live model so every generate call is written to the cassette directory. */
export function recordingModel<M extends Parameters<typeof wrapLanguageModel>[0]["model"]>(model: M, modelId: string) {
  const middleware: LanguageModelMiddleware = {
    wrapGenerate: async ({ doGenerate, params }) => {
      const result = await doGenerate();
      saveCassette(modelId, params, result);
      return result;
    },
  };
  return wrapLanguageModel({ model, middleware });
}

/** A model that answers only from cassettes. Streaming is not used by the agents and is rejected. */
export function replayModel(provider: string, modelId: string): LanguageModelV4 {
  return {
    specificationVersion: "v4",
    provider,
    modelId,
    supportedUrls: {},
    async doGenerate(params) {
      const c = loadCassette(modelId, params);
      return { ...c.result, warnings: c.result.warnings ?? [], response: { id: `cassette-${c.key}`, modelId } };
    },
    async doStream() {
      throw new Error("cassette replay does not support streaming");
    },
  };
}
