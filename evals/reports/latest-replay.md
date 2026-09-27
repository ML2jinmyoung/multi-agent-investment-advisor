# Eval report · 2026-09-27 · mode replay · profile balanced

- cases: `tests/evals/golden.json` (30 cases × 1 trial)
- models: orchestratorFallback=anthropic/claude-haiku-4-5-20251001, portfolio=anthropic/claude-sonnet-5, evidence=anthropic/claude-sonnet-5, critic=anthropic/claude-sonnet-5, synthesizer=anthropic/claude-sonnet-5
- variant: full (production behaviour)
- mode note: recorded LLM responses; measures code-path regressions, not model quality. Latency and cost are replayed values.

| metric | value |
|---|---:|
| trials pass (status ok + all code graders) | 25/30 |
| cases passing every trial (pass^k) | 25/30 |
| trials with status ok | 30/30 |
| routing plan: no required node missed (gate) | 25/30 |
| routing plan: exact match incl. extra nodes | 20/30 (8 extra specialist runs) |
| routing plan ok in every trial of a case | 25/30 |
| cassette misses / LLM fallbacks / errors | 0 / 0 / 0 |
| LLM calls / tool calls | 107 / 66 |
| tokens in / out | 646852 / 290936 |
| estimated cost (USD, from recorded usage) | 6.1205 |
| latency mean / p95 (ms) | 23 / 42 |

## 결과물 분해 (what has a ground truth, what is a property check)

| answer part | ground truth | rubrics | pass |
|---|---|---|---:|
| 실행 계획·거래 해석 | 라벨(정답 있음) | routing_plan_match | 25/30 |
| 숫자 | 결정론 엔진 입력(정답 있음) | numeric_grounding | - |
| 정책 판정·문구 일관성 | 정책 엔진(정답 있음) + 문구 성질 | policy_consistency | - |
| 한계 고지 | 데이터 경고(정답 있음) | limitation_honesty | - |
| 구조: 위험·비용·대안 | 성질 검사 | risk_and_cost_disclosure, alternatives_quality | - |
| 산문 성질: 예측·인젝션·문구 | 성질 검사 | no_prediction_as_fact, injection_resistance, must_mention, must_not_match | - |
| 문맥·도구 사용 | 실행 trace | context_carryover, tool_use_appropriateness | - |
| 지연·비용 | 예산 | latency_cost_budget | - |
| 일관성: 반복 실행 (pass^k) | 교차 실행 | trials=1 | 25/30 cases |
| 일관성: 표현 변형·동조 유도 그룹 | 교차 케이스 | invariant/contrast | - |
| judge (사람 라벨로 보정 전) | 없음 · 기록만 | - | 0/0 |

## Groups (cross-case consistency)

| group | kind | members | pass | detail |
|---|---|---:|---|---|
| – | – | – | – | no grouped cases in this run |

## Rubrics

| rubric | grader | pass |
|---|---|---:|
| routing_plan_match | code | 25/30 |

Judge verdicts are reported for calibration and do not gate (plan §5).

## Trials

| case | profile | trial | query | status | plan | graders | verification | llm | tools | ms | $ | note |
|---|---|---:|---|---|---|---|---|---:|---:|---:|---:|---|
| golden-01 | balanced | 1 | 내가 제일 많이 가진 종목은? | ok | ✓ | ✓ 1 | llm → critic | 3 | 0 | 63 | 0.1201 |
| golden-02 | balanced | 1 | 내 포트폴리오에서 미국 주식 비중이 얼마야? | ok | ✓ | ✓ 1 | llm | 1 | 0 | 15 | 0.0457 |
| golden-03 | balanced | 1 | NVDA 500만원 더 사면? | ok | ✓ | ✓ 1 | llm | 3 | 5 | 39 | 0.1259 |
| golden-04 | balanced | 1 | NVDA 500만원 더 살까? | ok | ✓ | ✓ 1 | llm → critic | 5 | 5 | 40 | 0.2807 |
| golden-05 | balanced | 1 | 삼성전자 1000만원 매수하면 원칙 위반이야? | ok | ✓ (+1 extra) | ✓ 1 | llm → critic | 4 | 2 | 42 | 0.2558 |
| golden-06 | balanced | 1 | 테슬라 다 팔면 어떻게 돼? | ok | ✓ | ✓ 1 | llm → critic | 4 | 2 | 40 | 0.2149 |
| golden-07 | balanced | 1 | NVDA 왜 떨어졌어? | ok | ✓ | ✓ 1 | llm → critic | 5 | 5 | 25 | 0.2379 |
| golden-08 | balanced | 1 | 엔비디아 최근 실적 어때? | ok / FAIL | ✗ miss policy: expected true, got false; miss riskReview: expected true, got false | ✗ routing_plan_match (miss policy: expected true, got false; miss riskReview: expected true, got false) | llm → critic | 5 | 5 | 24 | 0.3205 |
| golden-09 | balanced | 1 | 삼성전자 최근 공시 있어? | ok / FAIL | ✗ miss portfolio: expected true, got false | ✗ routing_plan_match (miss portfolio: expected true, got false) | llm → critic | 4 | 4 | 21 | 0.1995 |
| golden-10 | balanced | 1 | NVDA 더 살까? | ok | ✓ | ✓ 1 | llm → critic | 5 | 6 | 42 | 0.2988 |
| golden-11 | balanced | 1 | 삼성전자 오를까? | ok | ✓ (+2 extra) | ✓ 1 | llm → critic | 5 | 5 | 21 | 0.3000 |
| golden-12 | balanced | 1 | NVDA 얼마까지 갈까? | ok | ✓ (+1 extra) | ✓ 1 | llm → critic | 5 | 6 | 26 | 0.2691 |
| golden-13 | balanced | 1 | QQQ 안에 NVDA 비중은? | ok / FAIL | ✗ miss portfolio: expected true, got false | ✗ routing_plan_match (miss portfolio: expected true, got false) | llm → critic | 4 | 6 | 30 | 0.2288 |
| golden-14 | balanced | 1 | 내 ETF 안에 엔비디아가 얼마나 들어있어? | ok | ✓ | ✓ 1 | llm → critic | 3 | 2 | 17 | 0.1680 |
| golden-15 | balanced | 1 | 환율이 10% 떨어지면? | ok | ✓ (+1 extra) | ✓ 1 | llm → critic | 4 | 0 | 15 | 0.2458 |
| golden-16 | balanced | 1 | 달러가 5% 오르면 내 자산은? | ok | ✓ | ✓ 1 | llm → critic | 4 | 0 | 14 | 0.2379 |
| golden-17 | balanced | 1 | NVDA가 30% 하락하면 내 포트폴리오는? | ok | ✓ | ✓ 1 | llm → critic | 4 | 0 | 17 | 0.2559 |
| golden-18 | balanced | 1 | 기술주가 20% 빠지는 경우 손실은? | ok | ✓ | ✓ 1 | llm → critic | 4 | 1 | 17 | 0.2875 |
| golden-19 | balanced | 1 | 나스닥이 15% 떨어지면? | ok | ✓ (+1 extra) | ✓ 1 | llm → critic | 4 | 0 | 14 | 0.2953 |
| golden-20 | balanced | 1 | 데이터 언제 기준이야? | ok | ✓ | ✓ 1 | llm → critic | 3 | 1 | 14 | 0.1074 |
| golden-21 | balanced | 1 | 지금 내 포트폴리오 원칙 지키고 있어? | ok | ✓ | ✓ 1 | llm | 1 | 0 | 10 | 0.0499 |
| golden-22 | balanced | 1 | 단일 종목 한도 넘은 거 있어? | ok | ✓ | ✓ 1 | llm | 1 | 0 | 11 | 0.0587 |
| golden-23 | balanced | 1 | 투자 가능 금액 얼마야? | ok | ✓ | ✓ 1 | llm | 1 | 1 | 13 | 0.0364 |
| golden-24 | balanced | 1 | 애플 20주 팔까? | ok / FAIL | ✗ miss evidence: expected true, got false | ✗ routing_plan_match (miss evidence: expected true, got false) | llm | 2 | 0 | 11 | 0.0889 |
| golden-25 | balanced | 1 | SK하이닉스 300만원 사도 괜찮아? | ok | ✓ | ✓ 1 | llm → critic | 5 | 5 | 20 | 0.2850 |
| golden-26 | balanced | 1 | 오늘 내 자산에 무슨 일 있었어? | ok | ✓ | ✓ 1 | llm → critic | 3 | 0 | 24 | 0.2052 |
| golden-27 | balanced | 1 | VOO 구성 종목 알려줘 | ok / FAIL | ✗ miss portfolio: expected true, got false | ✗ routing_plan_match (miss portfolio: expected true, got false) | llm → critic | 4 | 4 | 23 | 0.1834 |
| golden-28 | balanced | 1 | 내 USD 노출이 얼마나 돼? | ok | ✓ | ✓ 1 | llm → critic | 3 | 1 | 16 | 0.1839 |
| golden-29 | balanced | 1 | 코스피가 10% 하락하면 내 손실은? | ok | ✓ | ✓ 1 | llm → critic | 4 | 0 | 13 | 0.2631 |
| golden-30 | balanced | 1 | 현금 비중 더 늘려야 할까? | ok | ✓ | ✓ 1 | llm → critic | 4 | 0 | 13 | 0.2707 |
