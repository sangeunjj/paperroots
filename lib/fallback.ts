// 키 없이 동작하는 폴백 브리프 생성 (Claude 미사용).
// - 트렌드 요약: OpenAlex 메타데이터(주제·논문 수·대표 논문)로 만든 템플릿 문장
// - 논문별 요약: 초록을 앞 몇 문장으로 잘라서 표시
// - 관련성 판단: OpenAlex topic 겹침으로 가볍게 필터링
import type { BriefResult } from "./claude";
import type { RawPaper, FoundationalPaper } from "./openalex";

/** 초록을 앞 N문장으로 잘라 3줄 카드 형태(줄바꿈 구분)로 만든다 */
function abstractToLines(abstract: string, n = 3): string {
  const clean = (abstract || "").trim();
  if (!clean) return "";
  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, n);
  return sentences.join("\n");
}

/** 빈도 상위 항목을 순서대로 반환 */
function topByFreq<T>(items: T[], n: number): T[] {
  const freq = new Map<T, number>();
  for (const it of items) freq.set(it, (freq.get(it) || 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

// 변별력 없는 일반 단어 — 이것만 맞아서는 관련성 근거가 약하다
const GENERIC = new Set([
  "large", "small", "deep", "model", "models", "learning", "neural", "network",
  "networks", "method", "methods", "approach", "approaches", "system", "systems",
  "data", "analysis", "framework", "study", "research", "based", "using",
  "artificial", "intelligence", "machine", "modeling", "technique", "techniques",
]);

/** 주제에서 의미 있는 키워드(4자 이상)를 뽑되, 변별력 있는 단어를 우선한다 */
function matchWords(text: string): string[] {
  const all = Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 4)
    )
  );
  const specific = all.filter((w) => !GENERIC.has(w));
  // 변별력 있는 단어가 있으면 그것만, 전부 일반어면 어쩔 수 없이 전체 사용
  return specific.length ? specific : all;
}

/** 제목+초록에 등장하는 서로 다른 키워드 수 */
function keywordHits(p: { title: string; abstract: string }, words: string[]): number {
  const hay = (p.title + " " + p.abstract).toLowerCase();
  return words.filter((w) => hay.includes(w)).length;
}

export function buildFallbackBrief(
  topic: string,
  queryText: string,
  influential: RawPaper[],
  latestTop: RawPaper[],
  foundationalCandidates: FoundationalPaper[]
): BriefResult {
  // 1) 핵심 논문들의 주제(topic) 분포로 분야 성격 파악 (트렌드 문장용)
  const coreTopicNames = topByFreq(
    influential.flatMap((p) => p.topicNames),
    4
  );
  // 오염 레코드 판별용 키워드 (OpenAlex topic 라벨은 오염 레코드도 NLP로 잘못 달려 무용)
  const words = matchWords(queryText);

  // 2) 연도 범위
  const years = influential
    .map((p) => p.year)
    .filter((y): y is number => typeof y === "number");
  const minY = years.length ? Math.min(...years) : null;
  const maxY = years.length ? Math.max(...years) : null;

  const topCited = influential[0]; // fetchTopicPapers 에서 피인용 내림차순 정렬됨
  const topFoundational = foundationalCandidates[0];

  // 3) 템플릿 트렌드 요약문 조립
  const parts: string[] = [];
  parts.push(`"${topic}" 분야에서 핵심 논문 ${influential.length}편을 분석했습니다.`);
  if (coreTopicNames.length) {
    parts.push(`주로 ${coreTopicNames.slice(0, 3).join(", ")} 등의 주제를 중심으로 연구가 이루어지고 있습니다.`);
  }
  if (minY && maxY) {
    parts.push(`최근 연구는 대략 ${minY}–${maxY}년에 집중되어 있습니다.`);
  }
  if (topCited) {
    parts.push(`가장 많이 인용된 대표 연구로는 「${topCited.title}」(피인용 ${topCited.citationCount.toLocaleString()})가 있습니다.`);
  }
  if (topFoundational) {
    parts.push(`이 분야의 근간이 되는 논문으로는 「${topFoundational.title}」 등이 자주 공통 인용됩니다.`);
  }

  const trendSummary = parts.join(" ");

  // 4) 논문별 판단: 요약(초록 기반) + 관련성(topic 겹침)
  const judgements: BriefResult["judgements"] = {};

  for (const p of latestTop) {
    judgements[p.id] = {
      summary: abstractToLines(p.abstract) || "초록이 제공되지 않은 논문입니다.",
      relevant: true, // 최신 논문은 관련성 검색 결과라 그대로 둔다
    };
  }

  // 근간 후보는 제목·초록 내용이 주제 핵심어와 맞는지로 거른다.
  // (핵심어가 하나도 없으면 — 예: 약어 주제 — 필터를 적용하지 않는다)
  for (const p of foundationalCandidates) {
    const relevant = words.length === 0 || keywordHits(p, words) >= 1;
    judgements[p.id] = {
      summary: abstractToLines(p.abstract) || "초록이 제공되지 않은 논문입니다.",
      relevant,
    };
  }

  return { trendSummary, judgements };
}
