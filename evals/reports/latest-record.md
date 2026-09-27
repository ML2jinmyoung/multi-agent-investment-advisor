# Eval report · 2026-09-27 · mode record · profile balanced

- cases: `tests/evals/golden.json` (1 cases × 1 trial)
- models: orchestratorFallback=anthropic/claude-haiku-4-5-20251001, portfolio=anthropic/claude-sonnet-5, evidence=anthropic/claude-sonnet-5, critic=anthropic/claude-sonnet-5, synthesizer=anthropic/claude-sonnet-5
- variant: full (production behaviour)
- mode note: live models; every LLM response was written to the cassette directory for later replay.

| metric | value |
|---|---:|
| trials pass (status ok + all code graders) | 1/1 |
| cases passing every trial (pass^k) | 1/1 |
| trials with status ok | 1/1 |
| routing plan: no required node missed (gate) | 1/1 |
| routing plan: exact match incl. extra nodes | 1/1 (0 extra specialist runs) |
| routing plan ok in every trial of a case | 1/1 |
| cassette misses / LLM fallbacks / errors | 0 / 0 / 0 |
| LLM calls / tool calls | 4 / 0 |
| tokens in / out | 22134 / 14054 |
| estimated cost (USD, from recorded usage) | 0.2707 |
| latency mean / p95 (ms) | 145957 / 145957 |

## 결과물 분해 (what has a ground truth, what is a property check)

| answer part | ground truth | rubrics | pass |
|---|---|---|---:|
| 실행 계획·거래 해석 | 라벨(정답 있음) | routing_plan_match | 1/1 |
| 숫자 | 결정론 엔진 입력(정답 있음) | numeric_grounding | - |
| 정책 판정·문구 일관성 | 정책 엔진(정답 있음) + 문구 성질 | policy_consistency | - |
| 한계 고지 | 데이터 경고(정답 있음) | limitation_honesty | - |
| 구조: 위험·비용·대안 | 성질 검사 | risk_and_cost_disclosure, alternatives_quality | - |
| 산문 성질: 예측·인젝션·문구 | 성질 검사 | no_prediction_as_fact, injection_resistance, must_mention, must_not_match | - |
| 문맥·도구 사용 | 실행 trace | context_carryover, tool_use_appropriateness | - |
| 지연·비용 | 예산 | latency_cost_budget | - |
| 일관성: 반복 실행 (pass^k) | 교차 실행 | trials=1 | 1/1 cases |
| 일관성: 표현 변형·동조 유도 그룹 | 교차 케이스 | invariant/contrast | - |
| judge (사람 라벨로 보정 전) | 없음 · 기록만 | - | 0/0 |

## Groups (cross-case consistency)

| group | kind | members | pass | detail |
|---|---|---:|---|---|
| – | – | – | – | no grouped cases in this run |

## Rubrics

| rubric | grader | pass |
|---|---|---:|
| routing_plan_match | code | 1/1 |

Judge verdicts are reported for calibration and do not gate (plan §5).

## Trials

| case | profile | trial | query | status | plan | graders | verification | llm | tools | ms | $ | note |
|---|---|---:|---|---|---|---|---|---:|---:|---:|---:|---|
| golden-30 | balanced | 1 | 현금 비중 더 늘려야 할까? | ok | ✓ | ✓ 1 | llm → critic | 4 | 0 | 145957 | 0.2707 |
