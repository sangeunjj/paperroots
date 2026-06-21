import { NextResponse } from "next/server";
import { fetchTopicPapers, computeFoundational, type RawPaper } from "@/lib/openalex";
import { generateBrief, activeModel, type PaperForSummary } from "@/lib/claude";
import { ROLE_LABELS, type Paper, type ResearchRequest, type ResearchResponse, type Role } from "@/lib/types";

// Vercel 서버리스 함수 최대 실행 시간 (검색 + Claude 호출에 여유 확보)
export const maxDuration = 60;
export const runtime = "nodejs";

function cleanPaper(p: Paper & { abstract?: string; referencedWorks?: string[] }): Paper {
  return {
    id: p.id,
    title: p.title,
    year: p.year,
    authors: p.authors,
    citationCount: p.citationCount,
    url: p.url,
    venue: p.venue,
    coCitedBy: p.coCitedBy,
    summary: p.summary,
  };
}

export async function POST(req: Request) {
  const started = Date.now();
  let body: ResearchRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  const topic = (body.topic || "").trim();
  const role = (body.role || "grad") as Role;
  const extraKeywords = (body.extraKeywords || "").trim();

  if (!topic) {
    return NextResponse.json({ error: "관심 주제를 입력해 주세요." }, { status: 400 });
  }

  // 전체 외부요청 타임아웃 (OpenAlex)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    // 1) OpenAlex: 핵심/최신 논문 검색
    const { influential, latest } = await fetchTopicPapers(topic, extraKeywords, controller.signal);

    if (influential.length === 0 && latest.length === 0) {
      clearTimeout(timeout);
      return NextResponse.json(
        { error: `"${topic}" 관련 논문을 찾지 못했습니다. 더 일반적인 영어 키워드로 시도해 보세요.` },
        { status: 404 }
      );
    }

    // 2) 인용 그래프 기반 근간 논문 계산
    const seen = new Set<string>([
      ...influential.map((p) => p.id),
      ...latest.map((p) => p.id),
    ]);
    const foundationalRaw = (await computeFoundational(
      influential,
      seen,
      controller.signal
    )) as (Paper & { abstract: string })[];

    clearTimeout(timeout);

    // 3) 화면 후보 정리 (근간은 넉넉히 보낸 뒤 Claude 판단으로 추림)
    const latestTop = latest.slice(0, 8);
    const foundationalCandidates = foundationalRaw.slice(0, 14);

    // 4) Claude 요약/판단 대상 구성 (최신 + 근간 후보)
    const toSummarize: PaperForSummary[] = [...latestTop, ...foundationalCandidates].map((p) => ({
      id: p.id,
      title: p.title,
      year: p.year,
      abstract: (p as RawPaper & { abstract: string }).abstract || "",
    }));
    const landscapeTitles = influential.map((p) => `(${p.year ?? "?"}) ${p.title}`);

    const roleLabel = ROLE_LABELS[role] || ROLE_LABELS.grad;

    // 5) Claude 호출: 트렌드 + 3줄 요약 + 관련성 판단
    const brief = await generateBrief(topic, roleLabel, landscapeTitles, toSummarize);
    const judge = brief.judgements;

    // 6) 관련성 판단으로 거르고, 요약을 합친다
    const latestOut = latestTop
      .filter((p) => judge[p.id]?.relevant !== false)
      .map((p) => cleanPaper({ ...p, summary: judge[p.id]?.summary }));

    const foundationalOut = foundationalCandidates
      .filter((p) => judge[p.id]?.relevant !== false)
      .slice(0, 8)
      .map((p) => cleanPaper({ ...p, summary: judge[p.id]?.summary }));

    const response: ResearchResponse = {
      topic,
      role,
      trendSummary: brief.trendSummary,
      latest: latestOut,
      foundational: foundationalOut,
      meta: {
        analyzedCount: influential.length,
        model: activeModel(),
        elapsedMs: Date.now() - started,
      },
    };

    return NextResponse.json(response);
  } catch (err: any) {
    clearTimeout(timeout);
    if (err?.code === "NO_API_KEY") {
      return NextResponse.json(
        {
          error:
            "Claude API 키가 설정되지 않았습니다. .env.local 에 ANTHROPIC_API_KEY 를 넣고 서버를 다시 시작하세요.",
          code: "NO_API_KEY",
        },
        { status: 500 }
      );
    }
    if (err?.status === 401 || err?.status === 403) {
      return NextResponse.json(
        { error: "Claude API 키가 올바르지 않거나 권한이 없습니다. 키를 확인해 주세요." },
        { status: 502 }
      );
    }
    console.error("research error:", err);
    return NextResponse.json(
      { error: `처리 중 오류가 발생했습니다: ${err?.message || "알 수 없는 오류"}` },
      { status: 500 }
    );
  }
}
