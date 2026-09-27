# 실행 및 배포

## 공개 데모: Fly.io

배포 주소: https://my-ai-pb-jinmyoung.fly.dev

기존 앱 재배포: `fly deploy --ha=false --local-only` (로컬 Docker 필요).

`fly.toml`은 도쿄(`nrt`)의 단일 Docker Machine과 `/app/data` 영구 볼륨을 사용합니다. `PUBLIC_DEMO_MODE=true`는 Toss 실계좌 조회와 공개 모델 설정 변경을 차단합니다. 실계좌 조회와 별도로 `MARKET_DATA_PROVIDER=toss`로 시장 정보만 조회합니다. 시장 조회용 키와 토스 허용 목록에 등록할 고정 출발 IP가 필요합니다.

Fly CLI 설치·로그인 후 처음 배포할 때:

```bash
fly apps create <app-name>
fly volumes create app_data --app <app-name> --region nrt --size 1
fly deploy --app <app-name> --ha=false
```

앱 주소는 `https://<app-name>.fly.dev`입니다. 재배포는 마지막 명령을 사용합니다. Machine과 볼륨은 같은 리전에 두고 인스턴스를 하나로 유지합니다. SQLite 대화·정책·Trace를 보존하려면 볼륨을 백업합니다. 호스팅 비용은 Fly.io 요금제와 리소스 사용량에 따릅니다.

모델 키 없이도 규칙 기반 데모가 동작하며 모델 API 비용은 발생하지 않습니다.

### 공개 데모의 LLM: OpenRouter 무료 모델

방문자는 아무것도 연결하지 않습니다. `PUBLIC_DEMO_MODE=true`에서는 운영자의 OpenRouter 키로 **`:free` 모델만** 호출하며, 이는 코드에서 강제됩니다(`src/providers/llm/demo.ts`). 운영자의 `ANTHROPIC_API_KEY`·`OPENAI_API_KEY`는 설정돼 있어도 무시합니다.

```bash
fly secrets set OPENROUTER_API_KEY=sk-or-...        # OpenRouter에서 데모 전용 키를 만들고 credit limit을 $0으로 설정
fly secrets set DEMO_LLM_MODEL=qwen/qwen3.8-27b:free # 선택, 기본값과 같음. ':free'로 끝나지 않으면 LLM을 쓰지 않음
fly secrets set DEMO_QUESTIONS_PER_DAY=5            # 선택, 세션(브라우저)별 하루 AI 질문 수
```

- OpenRouter 무료 모델 한도는 **계정 전체 기준** 하루 50회(크레딧을 $10 이상 구매한 계정은 1,000회), 분당 20회입니다. 질문 하나에 LLM을 최대 5~6번 호출하므로 무충전 계정은 방문자 전체 합산 하루 약 8~10개 질문입니다.
- 세션별 한도나 무료 한도를 넘으면 규칙 기반 답변으로 대체하고 화면에 안내합니다.
- 홈 브리핑은 60초마다 갱신되므로 데모에서는 LLM 없이 규칙 기반으로 설명합니다.
- 무료 모델은 제공사가 입력을 학습 등에 사용할 수 있습니다. 데모는 예시·방문자 입력 보유자산만 다룹니다.
- `TYPESAFE_API_KEY`(Jev)는 이 정책의 대상이 아닙니다. 데모 secrets에 넣으면 방문자 요청의 라우팅·검증이 운영자 Jev 키로 호출됩니다.

## 데모 보유자산 + 실제 시장 정보

- 기본 보유내역은 fixture, 방문자 입력은 `portfolio_inputs`에 익명 세션별 저장됩니다. `/assets`의 삭제 버튼으로 기본값을 복원합니다. 이는 사용자 인증을 갖춘 실계좌 연결 서비스가 아닙니다.
- 공개 주소를 `PUBLIC_APP_ORIGIN`에 설정합니다(Fly 내부 HTTP 주소와 외부 HTTPS 주소가 달라도 자산 저장 요청의 출처를 검증하기 위해 사용).
- `MARKET_DATA_PROVIDER=toss`, `PUBLIC_DEMO_MODE=true`, `ENABLE_REAL_TOSS=false`를 유지합니다.
- `.env.local` 또는 Fly secrets에 `TOSS_MARKET_CLIENT_ID`, `TOSS_MARKET_CLIENT_SECRET`을 설정합니다. 기존 계좌용 `TOSS_CLIENT_*`와 구분합니다. 시장 전용 transport는 계좌·주문 endpoint와 계좌 헤더를 차단합니다.
- Fly에서는 `fly ips allocate-egress --app my-ai-pb-jinmyoung -r nrt`로 고정 출발 IP를 할당하고 Toss 허용 목록에 등록합니다. 웹 접속용 ingress IP와 다릅니다. 키는 `fly secrets import`의 표준입력으로 등록하고 로그·저장소에 남기지 않습니다.
- 종목명·현재가·이전 거래일 종가·USD/KRW 환율은 실제 API 응답을 검증합니다. 시세·환율 누락 시 데모 값으로 대체하지 않으며, 불완전한 평가액으로 분석·매매 시뮬레이션을 실행하지 않습니다.
- 시장 요청은 프로세스 내 60초 캐시와 동시 요청 병합, endpoint 그룹별 간격 제한을 적용합니다. 화면은 60초마다 갱신합니다. 틱 단위 스트리밍이 아니며 휴장·지연 시 마지막 제공 시세가 표시됩니다.
- 가격 변동 영향은 현재 보유 수량 × 이전 거래일 종가 대비 변동을 현재 환율로 환산한 값입니다. 실제 계좌의 일간 실현/미실현 손익과 다릅니다. 환율 영향은 24시간 전 대비 별도 추정합니다.
- 공시 인증정보가 없으면 예시 공시를 사용하지 않습니다. 실시간 ETF 구성정보는 아직 없으므로 live 모드에서 예시 구성 비중을 제외합니다. 섹터·ETF 경제적 노출 분류와 수수료·세금 계산은 정적 참고값/가정이며 체결 견적이 아닙니다.

시장 조회용 키는 로컬 `.env.local`에서 Fly secrets로 분리 등록했습니다. 토스 허용 IP에 Fly 출발 IPv4 `209.71.107.69`를 등록했습니다. 2026-09-27 공개 서버에서 11개 보유 포지션의 실제 시세 provenance와 USD/KRW 환율, 완전한 원화 평가액 응답을 확인했습니다. 이후 조회 상태는 API와 화면에 표시됩니다.

## LLM 경로 실행

개인 환경의 `.env.local` 또는 배포 플랫폼의 secrets에 사용할 제공자의 키와 모델명을 설정합니다. 키 값은 저장소에 커밋하지 않습니다.

| 변수 | 용도 |
|---|---|
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OPENROUTER_API_KEY` | LLM 제공자 인증 |
| `LLM_PROVIDER` | 모든 에이전트의 기본 제공자: `anthropic`(기본) · `openai` · `openrouter` |
| `ORCHESTRATOR_MODEL`, `PORTFOLIO_MODEL`, `EVIDENCE_MODEL`, `CRITIC_MODEL`, `SYNTHESIZER_MODEL` | 에이전트별 모델명 |
| `DECISION_PROVIDER=jev`, `TYPESAFE_API_KEY` | 선택적 Jev 라우팅·검증; 미설정 시 LLM 또는 규칙 사용 |
| `ROUTING_THRESHOLD`, `VERIFICATION_THRESHOLD` | planner 전환 및 Critic 호출 임계값 |
| `ENABLE_AGENT_TRACE=true` | 실행·도구 호출 기록 |

기본 모델 제공자는 Anthropic이며 `LLM_PROVIDER`로 바꿀 수 있습니다. 에이전트별로 다르게 쓰려면 개인 실행 환경의 `/api/settings/models`에서 provider와 model을 설정합니다. 공개 데모에서는 이 API의 변경 요청을 허용하지 않습니다.

예) OpenRouter 하나로 실행: `LLM_PROVIDER=openrouter`, `OPENROUTER_API_KEY=...`, 각 `*_MODEL`에 `anthropic/claude-sonnet-5` 같은 OpenRouter 모델 ID.

**본인 키로 실행할 때는 `PUBLIC_DEMO_MODE`를 켜지 않습니다.** 이 플래그가 켜져 있으면 공개 데모 정책에 따라 Anthropic·OpenAI 키를 무시하고 OpenRouter 무료 모델만 사용합니다.

## 개인용 Toss LIVE 실행

외부에 공개하지 않는 환경에서 `PUBLIC_DEMO_MODE=false`, `ENABLE_REAL_TOSS=true`, `TOSS_CLIENT_ID`, `TOSS_CLIENT_SECRET`을 설정하고 서버의 출발 IP를 토스증권 허용 목록에 등록합니다. 계좌 연결은 [공식 가이드](https://developers.tossinvest.com/)의 Client Credentials 방식입니다. 현재 서버 설정의 단일 계좌를 읽으며 사용자별 계좌 연결 서비스가 아닙니다.

`DART_API_KEY`, `SEC_USER_AGENT`는 외부 공시·재무 데이터 연동에 사용합니다. `DATABASE_URL` 기본값은 `file:./data/app.db`이며 첫 DB 접근 시 migration이 적용됩니다. 모델이나 공시 API가 없을 때 실행되는 경로와 누락 데이터는 UI·Trace에 표시됩니다.

기존 VM 배포는 `docker-compose.prod.yml`과 Caddy HTTPS 구성을 사용합니다. 로컬 JEFF를 사용할 경우 `scripts/jeff.sh`의 설치 경로를 확인하고 `JEV_BASE_URL`을 해당 서버 주소로 설정합니다.

최종 배포 검증: `b53e14f`를 별도 작업 폴더에서 빌드했고 55개 테스트와 lint를 통과했습니다. 공개 서버에서 직접 입력 저장·삭제, 브라우저 세션 분리, 입력 수량 × 실제 시세 × 환율 계산, Today 응답과 에이전트 SSE 응답을 확인했습니다.

2026-09-27 저녁 배포(`e42a4be`, 평가 하네스 포함): `flyctl deploy --remote-only` 성공, 헬스 체크 통과. 공개 서버 `/api/portfolio/snapshot` 응답에서 `marketMode=live`, `valuationComplete=true`, 보유 종목 시세의 `marketProvenance.isMock=false`(Toss Securities Open API), 보유·현금은 데모 fixture/직접 입력 출처를 확인했다. 평가 하네스는 배포 이미지와 무관하게 로컬·CI에서만 실행된다(`data/eval.db`, cassette 파일).
