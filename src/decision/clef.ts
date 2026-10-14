import {
  type ChoiceDecision,
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

// Cloudflare Clef (https://huggingface.co/Cloudflare/clef), self-hosted with SGLang: POST /v1/systemone
type ClefQuestion =
  | { type: "noul"; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };
type ClefAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "score"; score: number; confidence: number; legend?: Record<string, string>; probabilities?: Record<string, number> };
type ClefResponse = { model: string; answers: Record<string, ClefAnswer>; usage?: { input_tokens: number; output_tokens: number } };

export class ClefDecisionModel implements DecisionModel {
  readonly name = "clef" as const;

  constructor(
    private baseUrl: string,
    private apiKey = process.env.CLEF_API_KEY || undefined,
    private model = process.env.CLEF_MODEL || "Cloudflare/clef",
    private timeoutMs = Number(process.env.CLEF_TIMEOUT_MS ?? 20_000),
    private maxStateChars = Number(process.env.CLEF_MAX_STATE_CHARS ?? 24_000),
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async ask(state: unknown, questions: Record<string, ClefQuestion>): Promise<{ answers: Record<string, ClefAnswer>; meta: DecisionMeta }> {
    const started = Date.now();
    // Clef encodes up to 16k tokens; oversized state is sent as truncated text rather than rejected
    const json = JSON.stringify(state);
    if (json.length > this.maxStateChars) state = json.slice(0, this.maxStateChars) + " …[truncated]";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/systemone`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: this.model, state, questions }),
        cache: "no-store",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new DecisionUnavailableError(`clef: ${(e as Error).name === "TimeoutError" ? `timeout after ${this.timeoutMs}ms` : "network error"}`);
    }
    if (!res.ok) throw new DecisionUnavailableError(`clef: HTTP ${res.status}`);
    const j = (await res.json()) as ClefResponse;
    if (!j?.answers) throw new DecisionUnavailableError("clef: response has no answers");
    return { answers: j.answers, meta: { model: `clef/${j.model ?? this.model}`, latencyMs: Date.now() - started, inputTokens: j.usage?.input_tokens, outputTokens: j.usage?.output_tokens } };
  }

  async choice<T extends string>(state: unknown, choices: readonly T[] | Record<T, string | null>, question: string): Promise<ChoiceDecision<T>> {
    // Clef encodes every option description, so an option without one is described by its id
    const criteria = Object.fromEntries(Object.entries<string | null>(toChoiceMap(choices)).map(([k, v]) => [k, v ?? k]));
    const { answers, meta } = await this.ask(state, { q: { type: "choice", instructions: question, criteria } });
    const a = answers.q;
    if (a?.type !== "choice") throw new DecisionUnavailableError("clef: unexpected answer type");
    return { choice: a.choice as T, confidence: a.confidence, probabilities: a.probabilities as Record<T, number>, meta };
  }

  async score(state: unknown, criteria: ScoreCriteria): Promise<ScoreDecision> {
    const { answers, meta } = await this.ask(state, { q: { type: "score", instructions: criteria.question, criteria: criteria.levels } });
    const a = answers.q;
    if (a?.type !== "score") throw new DecisionUnavailableError("clef: unexpected answer type");
    // Clef's score is the expected level index (fractional); callers get the nearest level
    return { score: Math.min(Math.round(a.score), criteria.levels.length - 1), confidence: a.confidence, probabilities: a.probabilities, meta };
  }

  async evaluate(state: unknown, statement: string, criteria?: { true?: string; false?: string }): Promise<ProbabilityDecision> {
    const r = await this.evaluateMany(state, { q: { question: statement, ...criteria } });
    return { probability: r.probabilities.q, meta: r.meta };
  }

  async evaluateMany<K extends string>(state: unknown, statements: Record<K, YesNoQuestion>): Promise<ManyDecision<K>> {
    const questions = Object.fromEntries(
      Object.entries<YesNoQuestion>(statements).map(([k, q]) => [
        k,
        typeof q === "string" ? { type: "noul", instructions: q } : { type: "noul", instructions: q.question, criteria: q.true || q.false ? { true: q.true, false: q.false } : undefined },
      ]),
    ) as Record<string, ClefQuestion>;
    const { answers, meta } = await this.ask(state, questions);
    const probabilities = {} as Record<K, number>;
    for (const k of Object.keys(statements) as K[]) {
      const a = answers[k];
      if (!a || a.type !== "noul") throw new DecisionUnavailableError(`clef: missing answer ${k}`);
      probabilities[k] = a.noul;
    }
    return { probabilities, meta };
  }
}
