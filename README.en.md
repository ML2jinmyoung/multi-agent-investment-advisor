# My AI PB · Multi-Agent Investment Advisor

[한국어](README.md)

Financial markets change every day. The hard part is deciding what to do about it.
Use a team of agents to make investment decisions tailored to your portfolio.

## Demo

[Live demo](https://my-ai-pb-jinmyoung.fly.dev)

[![My AI PB demo video](./demo.gif)](./demo.mp4)

- See the three most important changes in your assets today.
- Ask your personal AI PB a question and the appropriate agents and tools are selected. TypeScript calculates amounts, allocations, fees, and investment-policy checks; the LLM interprets the results.
- Define your own investment principles.

- The app starts with demo holdings. Visitors can enter tickers, quantities, purchase prices, and cash at `/assets`; the analysis then uses that data in the same browser. No real brokerage account is accessed.

- Prices, security names, and exchange rates come from the [Toss Open API](https://corp.tossinvest.com/ko/open-api).

- The hosted demo answers with a free OpenRouter model. A self-hosted installation can use your own Claude, OpenAI, or OpenRouter key.

Execution flow when a model is enabled:

```text
Question + conversation context → Router → execution plan
  → deterministic financial calculations
  → Portfolio Agent ∥ Evidence Agent → Synthesizer
  → validation → Critic and rewrite when needed → answer + trace
```

## Evaluation Harness

`npm run eval` sends questions from the labeled dataset through the **real orchestrator** (`runAgent`) and saves JSON and Markdown reports in `evals/reports/`.

| Mode | Command | LLM | Purpose |
| --- | --- | --- | --- |
| `replay` (default) | `npm run eval -- --mode replay` | Replays recorded responses; no key or network required | CI regression checks for the **code path**, including parsing, synthesis, validation, and Critic. Does not measure model quality |
| `record` | `npm run eval -- --mode record` | Calls real models and saves responses in `tests/evals/cassettes/` | Refreshes replay recordings. Record again after changing prompts or models |
| `live` | `npm run eval -- --mode live --trials 3` | Calls real models without recording | Measures current model quality, latency, and cost. Repeated runs measure consistency (pass^k) |
| `rules` | `npm run eval -- --mode rules` | None | Uses only the rule router, deterministic engine, and response templates |

Common options: `--profile <balanced|concentrated-nvda|cash-heavy|demo>` `--cases <file>` `--trials <k>` `--filter <text>` `--limit <n>`.

**Controlled environment.** The environment is fixed before application modules are loaded: a separate database (`data/eval.db`), fixture prices and exchange rates, disabled external filing lookups, and the configured LLM decision model. Holdings, cash, and investment principles from [`fixtures/profiles/*.json`](fixtures/profiles) are installed for an `eval:<name>` user through the same storage path used by visitor input. The same profile therefore produces the same snapshot, simulation, and policy-check results without relying on live prices or an operator account ([determinism test](tests/evals/determinism.test.ts)).

**Record/replay behavior.** Responses are stored under a hash of the model ID, prompt, tool definitions, and response format. Snapshot timestamps (`asOf`, `retrievedAt`) are excluded so the same recording can be found across runs. When a replay recording is missing, the harness reports `cassette_miss` and exits with code 1 instead of silently falling back to a rule-based answer. The recorded model configuration is in `tests/evals/cassettes/manifest.json`.

**Dataset.** [`tests/evals/cases/`](tests/evals/cases) contains 125 cases across 10 layers: retrieval, trades, scenarios, forecasts, evidence, follow-ups, data defects, sycophancy pressure, injection, and paraphrases. [`tests/evals/holdout/`](tests/evals/holdout) contains 24 holdout cases that are not used for prompt tuning. Each case includes user turns, a profile, expected execution-plan and trade interpretation, expected policy violations, code-grader checks, judge-grader checks, required and forbidden phrases, and a decision rationale (`reference`). `suite: regression` contains 89 cases that must currently pass; `suite: capability` contains 36 cases that document unsupported behavior. When a fix makes a capability case pass, it moves to regression and the change is recorded in the CHANGELOG. [Tests](tests/evals/cases.test.ts) enforce the schema, minimum counts per layer, and holdout ratio. Labels were assigned by one author and have not yet received third-party validation.

**Evaluation.** Answers are graded against the deterministic inputs visible to the model: snapshots, simulations, policy checks, and tool results. The report's output-breakdown table separates each part of an answer.

| Answer component | Ground truth | Evaluation method |
| --- | --- | --- |
| Execution plan and trade/scenario interpretation | Yes (case labels) | Compares eight plan fields and parsed results. The LLM router fails only when it **omits** a required node; extra execution is counted as cost |
| Numbers | Yes (deterministic engine inputs) | Every number in the answer must exist in the snapshot, simulation, policy, or tool output. Rounding to KRW 10,000 or KRW 100 million units is allowed |
| Policy decisions | Yes (policy engine) | A violation requires an explicit warning and a defer option, and forbids unconditional-buy language. A compliant result must not claim a violation |
| Limitations | Yes (data warnings) | Snapshot and tool warnings must appear unchanged in `limitations` |
| Risks, costs, alternatives, forecast phrasing, and injection | No → property checks | A good answer must include at least one risk; costs for trades; three alternatives including “do nothing”; no certainty claims about forecasts; no system-prompt disclosure or policy-result manipulation; and all required/forbidden phrases |
| Consistency | No → cross-comparison | Repeats the same question k times (pass^k); `invariantOf` paraphrase groups must produce the same decision and numbers; `contrastOf` sycophancy groups must produce the same decision regardless of user preference |
| Interpretation quality | No → judge + human | Records binary decisions from a separate model. Only items with verified agreement against human labels become gates |

System-variant comparisons use the same principle. Run baselines with `--variant single-agent` (Synthesizer only, without specialist agents) and `--variant no-critic`, then use `npm run eval:compare -- A.json B.json` to compare pass rates, Critic calls, tokens, cost, latency, and per-case transitions. The focus is what changed on the same cases, not an absolute score.

| Grader | Checks | Method |
| --- | --- | --- |
| [Code](evals/graders/code.ts) | Numeric grounding; policy consistency; no certainty claims; risk and cost disclosure; honest limitations; alternative quality; follow-up context; tool re-invocation; injection resistance; latency and cost budgets; routing-plan match; required and forbidden phrases | Deterministic. Runs in every mode and acts as the **gate** for regression and golden suites |
| [Judge](evals/graders/judge.ts) | Policy consistency, certainty claims, sycophancy, honest limitations, injection resistance, numeric grounding | A model separate from the agent (`JUDGE_MODEL`, defaulting to the orchestrator fallback model) records pass/fail plus a supporting quote. It is **recorded but not gated** until agreement with human labels (κ) is established |

Reports (`evals/reports/latest-<mode>.md`) include pass rates by check, failed checks and evidence per case, pass^k (cases that passed every repetition), routing agreement, Critic calls, tokens, cost, and latency. Latency and cost budgets (`EVAL_LATENCY_BUDGET_MS`, `EVAL_COST_BUDGET_USD`) apply only in live and record modes.

**CI.** The [workflow](.github/workflows/eval.yml) runs typecheck → tests → a 30-question golden replay (gate) → regression replay (allowed to fail until cassettes are recorded) → rules baseline, and uploads the reports as artifacts.

**Findings.** Issues discovered while building the harness are numbered F-001 onward in [evals/CHANGELOG.md](evals/CHANGELOG.md). Examples: the Critic runs even for simple lookups, costing about 70 seconds and $0.14 per question (F-001, open); without the original policy text, the Critic incorrectly treats quoted policy limits as fabricated numbers (F-002, fixed); the parser misses quantities after Korean text such as “5주 팔까” (F-004, fixed); the LLM router omits portfolio retrieval for questions about held securities (F-011, fixed); simple lookups skip the policy engine and therefore fail to report existing violations (F-012, open). Each fix records before-and-after reports in the same file.

## Running Locally

Requires Node.js 22.12 or later. The rule-based mode works without API keys.

```bash
git clone <this-repo> && cd personal-investment-multiagent
npm ci
npm run dev
npm test
npm test -- tests/evals/routing-eval.test.ts
npm run eval -- --mode replay      # full 30-question path using recorded LLM responses; no key required
```

To use your own model, add the keys and model names to `.env.local`. Do not enable `PUBLIC_DEMO_MODE`.

```bash
# Claude
ANTHROPIC_API_KEY=sk-ant-...
PORTFOLIO_MODEL=claude-sonnet-5
SYNTHESIZER_MODEL=claude-sonnet-5
EVIDENCE_MODEL=claude-sonnet-5
CRITIC_MODEL=claude-haiku-4-5
ORCHESTRATOR_MODEL=claude-haiku-4-5

# Or OpenAI: LLM_PROVIDER=openai, OPENAI_API_KEY=..., and OpenAI model names in the *_MODEL variables above
# Or OpenRouter: LLM_PROVIDER=openrouter, OPENROUTER_API_KEY=..., and OpenRouter model IDs in the *_MODEL variables above
```

Next.js · TypeScript · Vercel AI SDK · Zod · Drizzle / Fly.io.

# TODO

- [ ] Add data sources for asset analysis, including financial reports
- [ ] Develop prompts that define how asset changes should be weighted
