# My AI PB · Personal Investment Intelligence Agent

금융 데이터를 검증·정규화하고, 질문에 필요한 에이전트와 도구를 선택해 투자 의사결정의 영향을 설명하는 프로젝트입니다. 금액·비중·수수료·투자 원칙은 TypeScript로 계산하고, LLM은 그 결과를 해석합니다.

## 데모

[공개 데모 열기](https://my-ai-pb-jinmyoung.fly.dev)

보유자산은 데모 데이터로 시작하며, `/assets`에서 방문자가 종목·수량·매입가·현금을 직접 입력하면 해당 브라우저의 분석에 반영됩니다. 운영자의 실제 계좌는 조회하지 않습니다.

시세·종목명·환율은 Toss 시장 API에서 조회하도록 분리했습니다(60초 캐시, 제공 시각 표시). **현재 Toss 허용 IP 등록 및 실연동 검증 대기 중**이며, 조회할 수 없는 값은 예시 가격으로 대체하지 않습니다. 공시 키가 없으면 공시는 제외하고, 실시간 ETF 구성정보는 미지원입니다. 영상은 추후 추가합니다.

| 체험 | 확인할 내용 |
|---|---|
| `/` | PB 오브 인트로 후 오늘 내 자산에 중요한 변화를 대화형 브리핑으로 표시 |
| `/assets` | 데모/직접 입력 보유자산, 시장 데이터 출처·기준 시각 |
| `/agent` — “NVDA 500만원 더 살까?” | 질문 라우팅, 거래 시뮬레이션, 투자 원칙 점검. 답변 생성 중 멀티 에이전트 실행 흐름을 실시간으로 표시(진행 중·완료·건너뜀 단계, 진행률, 경과 시간) |
| 이어서 “그중 절반만” | 이전 대화를 활용한 후속 질문 처리 |
| `/trace` | 실행·생략 단계, 도구 호출, 지연 시간, 토큰 및 추정 비용 |

**실행 모드:** 공개 데모는 OpenRouter **무료 모델**로 AI 답변을 제공하며, 방문자별 하루 AI 질문 수가 정해져 있습니다. 한도를 넘거나 키가 없으면 규칙 라우터와 템플릿 답변으로 동작하며, 이때는 LLM 멀티 에이전트·Function Calling·LLM Critic이 실행되지 않습니다. 직접 설치하면 본인의 Claude·OpenAI·OpenRouter 키로 실행할 수 있습니다.

## 구현으로 보여주는 역량

| 역량 | 구현 근거 |
|---|---|
| **Agent 오케스트레이션** | [라우터](src/orchestration/router.ts)가 실행 계획을 결정하고, [오케스트레이터](src/orchestration/orchestrator.ts)가 Portfolio·Evidence 에이전트를 병렬 실행한 뒤 결과를 합성합니다. 단순 질문은 실행 단계를 줄입니다. |
| **Tool Use / Function Calling** | [AI SDK 도구](src/tools)는 포트폴리오·시세·공시·시뮬레이션을 제공합니다. 입력 스키마, 결과 검증, 단계 수 제한, 호출별 추적을 적용했습니다. |
| **메모리 관리** | [대화 저장소](src/services/conversation-store.ts)에 세션별 대화를 저장하고, 최근 12개 메시지를 압축된 문맥으로 전달합니다. 정책도 세션별로 저장하며, 익명 세션 구분은 사용자 인증이 아닙니다. |
| **응답 검증·수정** | [검증 단계](src/orchestration/escalation.ts)가 원칙 충돌·예측 단정 등을 검사합니다. 모델 사용 시 임계값에 따라 Critic을 호출하고, 필요하면 답변을 한 번 재작성합니다. |
| **Eval 구축** | [30문항 정답 데이터](tests/evals/golden.json)와 [라우팅 평가 하네스](tests/evals/routing-eval.test.ts), 계산·메모리·연동 회귀 테스트를 제공합니다. |
| **금융 데이터 처리** | [계좌 통합](src/services/portfolio-aggregator.ts), 원화 환산, ETF 구성 비중 반영, Zod 검증, 출처·기준 시각·예시 데이터 표시를 구현했습니다. OpenDART·SEC는 공시 메타데이터와 재무 지표를 도구에 제공합니다. |
| **운영 관측과 장애 처리** | [Trace](src/orchestration/tracer.ts), SSE 진행 이벤트, 병렬 작업의 부분 실패 처리, 일부 모델 실패 시 규칙 기반 대체, Toss 토큰 발급 중복 방지·재시도를 구현했습니다. |

모델 사용 시 실행 흐름:

```text
질문 + 대화 문맥 → Router → 실행 계획
  → 결정론적 금융 계산
  → Portfolio Agent ∥ Evidence Agent → Synthesizer
  → 검증 → 필요 시 Critic 및 재작성 → 답변 + Trace
```

## 검증 결과와 범위

2026-09-27, Node 22 환경에서 **15개 파일 / 55개 테스트 통과**.

검증 명령: `npm test` · `npm run typecheck` · `npm run build`. 라우팅, 계산, 세션 분리, 시장 전용 접근 제한, 시세 누락 시 예시값 미사용을 검사합니다.

| 라우팅 평가 · 30문항 | 실행 계획 정확 일치율 |
|---|---:|
| 규칙 기반 적응형 라우팅 | 100% · 30/30 |
| 모든 전문 에이전트를 항상 선택하는 기준선 | 16.7% · 5/30 |

이 평가는 **규칙 라우터의 계획 선택**을 측정합니다. LLM 답변 품질, 모델 라우터 성능, 실제 지연·비용 절감 효과를 입증하는 결과는 아닙니다.

현재는 단일 인스턴스·SQLite 기반 프로토타입입니다. **대규모 사용자 서빙, 반복 실험을 통한 응답 품질 향상, 비정형 문서 본문의 수집·정제·검색 파이프라인은 아직 입증하지 않습니다.** 구현과 부족한 근거는 [역량 점검](docs/capability-review.md)에 정리했습니다.

## 실행

Node.js 22.12 이상을 사용합니다. API 키 없이도 실행할 수 있습니다(규칙 기반).

```bash
git clone <this-repo> && cd personal-investment-multiagent
npm ci
npm run dev
npm test
npm test -- tests/evals/routing-eval.test.ts
```

본인 모델로 쓰려면 `.env.local`에 키와 모델명을 넣습니다. 이때 `PUBLIC_DEMO_MODE`는 켜지 않습니다.

```bash
# Claude
ANTHROPIC_API_KEY=sk-ant-...
PORTFOLIO_MODEL=claude-sonnet-5
SYNTHESIZER_MODEL=claude-sonnet-5
EVIDENCE_MODEL=claude-sonnet-5
CRITIC_MODEL=claude-haiku-4-5
ORCHESTRATOR_MODEL=claude-haiku-4-5

# 또는 OpenAI: LLM_PROVIDER=openai, OPENAI_API_KEY=..., 위 *_MODEL에 OpenAI 모델명
# 또는 OpenRouter: LLM_PROVIDER=openrouter, OPENROUTER_API_KEY=..., *_MODEL에 OpenRouter 모델 ID
```

Next.js · TypeScript · Vercel AI SDK · Zod · Drizzle / libSQL · Docker / Fly.io.

Fly.io 배포, 시장 API 및 LLM 설정 방법은 [운영 가이드](docs/deployment.md)를 참고하세요.
