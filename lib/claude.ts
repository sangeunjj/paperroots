// Claude API 연동 — 분야 트렌드 요약 + 논문별 3줄 요약 생성
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";

// 신분별 트렌드 요약 톤/난이도 가이드
const ROLE_GUIDE: Record<string, string> = {
  학부생: "전문 용어는 풀어서 설명하고, 배경 맥락을 약간 곁들여 처음 접하는 사람도 이해하도록 작성한다.",
  대학원생: "연구의 흐름과 갈래를 중심으로, 적당한 전문성을 유지하며 작성한다.",
  "교수 / 연구자": "간결하고 정보 밀도 높게, 미해결 문제와 향후 연구 방향 위주로 작성한다.",
  "현업 개발자": "실제 응용·구현 관점에서 무엇이 실용적으로 쓸 만한지 중심으로 작성한다.",
};

export interface PaperForSummary {
  id: string;
  title: string;
  year: number | null;
  abstract: string;
}

export interface PaperJudgement {
  summary: string;
  relevant: boolean;
}

export interface BriefResult {
  trendSummary: string;
  judgements: Record<string, PaperJudgement>; // id -> 요약 + 관련성 판단
}

const TOOL = {
  name: "emit_research_brief",
  description: "연구 주제에 대한 트렌드 요약과 각 논문의 3줄 요약·관련성 판단을 제출한다.",
  input_schema: {
    type: "object" as const,
    properties: {
      trend_summary: {
        type: "string",
        description: "이 분야의 현재 트렌드 요약 (3~5문장, 한국어).",
      },
      paper_summaries: {
        type: "array",
        description: "각 논문의 3줄 요약 + 관련성 판단 목록.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "입력으로 받은 논문 id 그대로." },
            relevant: {
              type: "boolean",
              description:
                "이 논문이 주제와 실제로 관련 있고 신뢰할 만한 학술 논문이면 true. 주제와 명백히 무관하거나(예: 전혀 다른 분야) 비정상적인 레코드로 보이면 false. 애매하면 true.",
            },
            summary: {
              type: "string",
              description: "정확히 3줄 요약. 각 줄은 한 문장이며 줄바꿈(\\n)으로 구분.",
            },
          },
          required: ["id", "relevant", "summary"],
        },
      },
    },
    required: ["trend_summary", "paper_summaries"],
  },
};

export async function generateBrief(
  topic: string,
  roleLabel: string,
  landscapeTitles: string[],
  papers: PaperForSummary[]
): Promise<BriefResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error("ANTHROPIC_API_KEY 가 설정되지 않았습니다.");
    (err as any).code = "NO_API_KEY";
    throw err;
  }

  const client = new Anthropic({ apiKey });
  const guide = ROLE_GUIDE[roleLabel] || ROLE_GUIDE["대학원생"];

  const landscape = landscapeTitles
    .slice(0, 25)
    .map((t, i) => `${i + 1}. ${t}`)
    .join("\n");

  const paperList = papers
    .map(
      (p) =>
        `[id: ${p.id}] (${p.year ?? "연도미상"}) ${p.title}\n초록: ${
          p.abstract || "(초록 미제공)"
        }`
    )
    .join("\n\n");

  const userPrompt = `# 연구 주제
"${topic}"

# 읽는 사람
${roleLabel} — ${guide}

# 이 분야 주요 논문 제목들 (트렌드 파악용 참고 자료)
${landscape}

# 3줄 요약이 필요한 논문들
${paperList}

# 작업
1) trend_summary: 위 자료를 바탕으로 이 분야가 현재 어디로 향하고 있는지, 핵심 흐름과 키워드를 ${roleLabel}에게 맞춰 3~5문장으로 요약하라.
2) paper_summaries: 각 논문에 대해 아래를 판단하라.
   - relevant: 이 논문이 주제 "${topic}"와 실제로 관련 있고 신뢰할 만한 학술 논문인가? 주제와 명백히 무관한 분야의 논문이거나, 제목·피인용수가 비정상적으로 보이는 오염된 레코드면 false. 애매하면 true.
   - summary: 정확히 3줄 요약. 각 줄은 한 문장이며 줄바꿈(\\n)으로 구분한다. "무엇을 했는가 / 어떻게 / 무엇이 핵심 기여인가" 흐름으로, 군더더기 없이 간결하게(스타일: 짧은 3줄 카드 요약). 초록이 없으면 제목을 바탕으로 추정해 작성하되 마지막 줄 끝에 "(초록 미제공·추정)"을 붙여라.
모든 출력은 한국어. id는 입력 그대로 사용하라.`;

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system:
      "당신은 연구 논문을 분석해 핵심을 한국어로 명확하게 정리하는 전문 리서치 어시스턴트입니다. 정확하고 간결하게, 과장 없이 사실 위주로 요약합니다.",
    tools: [TOOL],
    tool_choice: { type: "tool", name: "emit_research_brief" },
    messages: [{ role: "user", content: userPrompt }],
  });

  const block = msg.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("Claude 응답에서 구조화된 결과를 찾지 못했습니다.");
  }

  const input = block.input as {
    trend_summary: string;
    paper_summaries: { id: string; summary: string; relevant?: boolean }[];
  };

  const judgements: Record<string, PaperJudgement> = {};
  for (const s of input.paper_summaries || []) {
    judgements[s.id] = { summary: s.summary, relevant: s.relevant !== false };
  }

  return { trendSummary: input.trend_summary, judgements };
}

export function activeModel(): string {
  return MODEL;
}
