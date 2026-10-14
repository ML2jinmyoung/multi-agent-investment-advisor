import { generateObject } from "ai";
import type { z } from "zod";
import { modelFor } from "@/providers/llm/registry";
import {
  type ChoiceDecision,
  confidenceOf,
  type DecisionMeta,
  type DecisionModel,
  DecisionUnavailableError,
  type ManyDecision,
  type ProbabilityDecision,
  type ScoreCriteria,
  type ScoreDecision,
  toChoiceMap,
  type YesNoQuestion,
} from "./interface";
import { ChoiceOutput, ManyOutput, ScoreOutput } from "./schemas";

const SYSTEM =
  "You are a calibrated decision function inside an investment assistant. Read the JSON state and answer the questions with probabilities only. " +
  "0 means definitely no, 1 means definitely yes. Do not explain. Be well calibrated: use values near 0.5 only when genuinely uncertain.";

/** Runs the same atomic questions through OpenAI/Claude structured output when Clef is unavailable. */
export class LLMDecisionModel implements DecisionModel {
  readonly name = "llm" as const;

  private async run<S extends z.ZodTypeAny>(schema: S, prompt: string): Promise<{ object: z.infer<S>; meta: DecisionMeta }> {
    const started = Date.now();
    let model, config;
    try {
      ({ model, config } = await modelFor("orchestratorFallback"));
    } catch (e) {
      throw new DecisionUnavailableError((e as Error).message);
    }
    const r = await generateObject({ model, schema, system: SYSTEM, prompt });
    return { object: r.object as z.infer<S>, meta: { model: `${config.provider}/${config.model}`, latencyMs: Date.now() - started, inputTokens: r.usage?.inputTokens, outputTokens: r.usage?.outputTokens } };
  }

  async choice<T extends string>(state: unknown, choices: readonly T[] | Record<T, string | null>, question: string): Promise<ChoiceDecision<T>> {
    const map = toChoiceMap(choices);
    const { object, meta } = await this.run(
      ChoiceOutput,
      `STATE:\n${JSON.stringify(state)}\n\nQUESTION: ${question}\nOPTIONS (option: description):\n${JSON.stringify(map)}\nReturn the chosen option and a probability for every option (sum to 1).`,
    );
    const probabilities = Object.fromEntries(Object.keys(map).map((k) => [k, object.probabilities.find((p) => p.option === k)?.probability ?? 0])) as Record<T, number>;
    const choice = (Object.keys(map).includes(object.choice) ? object.choice : Object.keys(map)[0]) as T;
    return { choice, confidence: Math.max(...Object.values<number>(probabilities)), probabilities, meta };
  }

  async score(state: unknown, criteria: ScoreCriteria): Promise<ScoreDecision> {
    const { object, meta } = await this.run(
      ScoreOutput,
      `STATE:\n${JSON.stringify(state)}\n\nRATE: ${criteria.question}\nLEVELS (index: description):\n${criteria.levels.map((l, i) => `${i}: ${l}`).join("\n")}\nReturn the level index and a probability per level index.`,
    );
    const probabilities = Object.fromEntries(criteria.levels.map((l, i) => [l, object.probabilities.find((p) => p.level === i)?.probability ?? 0]));
    return { score: Math.min(object.level, criteria.levels.length - 1), confidence: Math.max(...Object.values(probabilities)), probabilities, meta };
  }

  async evaluate(state: unknown, statement: string, criteria?: { true?: string; false?: string }): Promise<ProbabilityDecision> {
    const r = await this.evaluateMany(state, { q: { question: statement, ...criteria } });
    return { probability: r.probabilities.q, meta: r.meta };
  }

  async evaluateMany<K extends string>(state: unknown, statements: Record<K, YesNoQuestion>): Promise<ManyDecision<K>> {
    const lines = Object.entries<YesNoQuestion>(statements).map(([id, q]) =>
      typeof q === "string" ? `- ${id}: ${q}` : `- ${id}: ${q.question}${q.true ? ` (yes = ${q.true})` : ""}${q.false ? ` (no = ${q.false})` : ""}`,
    );
    const { object, meta } = await this.run(
      ManyOutput,
      `STATE:\n${JSON.stringify(state)}\n\nYES/NO QUESTIONS (answer each id with P(yes)):\n${lines.join("\n")}`,
    );
    const probabilities = {} as Record<K, number>;
    for (const id of Object.keys(statements) as K[]) probabilities[id] = object.answers.find((a) => a.id === id)?.probability ?? 0.5;
    void confidenceOf;
    return { probabilities, meta };
  }
}
