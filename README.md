# 🌱 PaperRoots — 연구 논문 계보 어시스턴트

> 연구 주제 하나만 입력하면, 그 분야의 **트렌드**와 **최신 논문**, 그리고 그 분야의 **근간이 되는(foundational) 논문**까지 3줄 요약과 함께 정리해 주는 AI 리서치 어시스턴트.

산업인공지능세미나(IME844) 기말 프로젝트 — *AI 코딩 에이전트(Claude Code)와 협업해 만든 바이브 코딩 결과물.*

---

## 🎯 무슨 문제를 푸는가

특정 주제의 논문을 찾을 때, 구글 스칼라로 논문을 하나하나 뒤지고 그 논문이 **딛고 선 기초·근간 논문**을 역추적하는 일은 번거롭고 시간이 많이 든다. PaperRoots는 이 과정을 자동화한다.

- 🔍 **검색이 아니라 계보(lineage)**: 단순 키워드 검색이 아니라, **인용 그래프(citation graph)** 를 분석해 "여러 핵심 논문이 공통으로 인용하는 논문 = 근간 논문"을 계산한다.
- 🧠 **AI를 판단 파트너로**: Claude가 분야 트렌드를 요약하고, 각 논문을 3줄로 정리하며, 검색 데이터에 섞인 **관련 없는/오염된 레코드를 직접 걸러낸다.**
- 👤 **읽는 사람 맞춤**: 학부생 / 대학원생 / 교수 / 현업 개발자에 따라 트렌드 요약의 난이도와 관점을 조절한다.

## 🏗️ 시스템 구조

```
[사용자] 신분 + 주제 + (선택)세부 키워드
   │  POST /api/research
   ▼
[Next.js API Route]
   ├─① OpenAlex 검색  (무료, 키 불필요)
   │     • 관련성 우선 풀 → 피인용 재정렬 = 핵심 논문
   │     • 관련성 우선 풀 → 최신순 = 최신 논문
   │     • 핵심 논문들의 referenced_works 빈도 = 근간 후보 (인용 그래프)
   │
   └─② Claude API (claude-opus-4-8)
         • 분야 트렌드 요약 (신분 맞춤)
         • 논문별 3줄 요약 (moonlight 스타일)
         • 관련성·신뢰성 판단으로 오염 레코드 필터링
   │
   ▼
[결과] 트렌드 카드 · 근간 논문 · 최신 논문 (각 3줄 요약 + 바로가기 링크)
```

## 💻 기술 스택

| 분야 | 사용 |
|---|---|
| Frontend / Backend | Next.js 15 (App Router) · TypeScript · 순수 CSS |
| AI | Claude API (`@anthropic-ai/sdk`, 구조화 출력 tool use) |
| 논문 데이터 | OpenAlex API (인용 그래프, 무료·키 불필요) |
| 배포 | Vercel |

---

## 🚀 로컬 실행

```bash
# 1. 의존성 설치
npm install

# 2. 환경변수 설정
cp .env.local.example .env.local
#   → .env.local 을 열어 ANTHROPIC_API_KEY 를 본인 키로 채운다
#     (https://console.anthropic.com 에서 발급)

# 3. 개발 서버
npm run dev
#   → http://localhost:3000
```

### 환경변수

| 변수 | 필수 | 설명 |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | Claude API 키 (`sk-ant-...`) |
| `CLAUDE_MODEL` | ❌ | 기본 `claude-opus-4-8`. 비용 절감 시 `claude-haiku-4-5` (약 1/5 비용) |
| `OPENALEX_MAILTO` | ❌ | OpenAlex 정중한 요청용 이메일 (rate-limit 우대) |

> 💡 **비용**: 검색 1회 = Claude 호출 1회. opus-4-8 기준 약 $0.1, haiku-4-5 기준 약 $0.02. 신규 가입 무료 크레딧으로 충분히 시연 가능.

---

## ☁️ Vercel 배포

1. 이 코드를 GitHub 새 저장소에 push (아래 참고)
2. [vercel.com](https://vercel.com) → **New Project** → 해당 GitHub 저장소 선택
3. **Environment Variables** 에 `ANTHROPIC_API_KEY` 추가 (`CLAUDE_MODEL`, `OPENALEX_MAILTO` 선택)
4. **Deploy** → 끝. 빌드 후 공개 URL 발급

```bash
# GitHub 새 저장소에 올리기 (예시)
git init
git add .
git commit -m "PaperRoots: 연구 논문 계보 어시스턴트"
git branch -M main
git remote add origin https://github.com/<본인계정>/paperroots.git
git push -u origin main
```

---

## 🤝 AI 코딩 에이전트 활용 (Claude Code)

이 프로젝트는 **Claude Code와 협업**해 설계·구현했다.
- 디자인 씽킹 단계별 문제 정의 및 MVP 범위 산정
- OpenAlex / Claude API 데이터 파이프라인 설계
- 검증 과정에서 발견한 문제(관련성 낮은 검색 결과, 오염 레코드)를 함께 진단하고 해결
  - "피인용 정렬 → 관련성 우선 재정렬" 전환
  - "오염 레코드는 Claude가 관련성 판단으로 필터링"

자세한 협업 과정은 발표자료(`PRESENTATION.md`) 참고.
