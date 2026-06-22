// OpenAlex API 연동 — 논문 검색 + 인용 그래프 기반 "근간 논문" 계산
// OpenAlex 는 무료이며 API 키가 필요 없습니다. https://docs.openalex.org

import type { Paper } from "./types";

const OPENALEX = "https://api.openalex.org";
const MAILTO = process.env.OPENALEX_MAILTO || "research@example.com";

// 필요한 필드만 선택해 응답 크기를 줄인다
const SELECT =
  "id,title,display_name,publication_year,publication_date,cited_by_count," +
  "referenced_works,abstract_inverted_index,authorships,primary_location,best_oa_location,doi,topics";

interface OAWork {
  id: string;
  title: string | null;
  display_name: string | null;
  publication_year: number | null;
  publication_date: string | null;
  cited_by_count: number;
  referenced_works: string[];
  abstract_inverted_index: Record<string, number[]> | null;
  authorships: { author: { display_name: string } }[];
  primary_location: {
    landing_page_url: string | null;
    source: { display_name: string | null } | null;
  } | null;
  best_oa_location: { landing_page_url: string | null; pdf_url: string | null } | null;
  doi: string | null;
  topics: { id: string; display_name: string }[] | null;
}

/** abstract_inverted_index({단어: [위치들]}) 를 원래 초록 문자열로 복원 */
export function reconstructAbstract(inv: Record<string, number[]> | null): string {
  if (!inv) return "";
  const slots: string[] = [];
  for (const [word, positions] of Object.entries(inv)) {
    for (const p of positions) slots[p] = word;
  }
  return slots.filter(Boolean).join(" ").trim();
}

async function oaFetch(url: string, signal?: AbortSignal): Promise<any> {
  const res = await fetch(url, {
    headers: { "User-Agent": `PaperRoots/1.0 (mailto:${MAILTO})` },
    signal,
    // OpenAlex 응답은 서버에서 매번 새로 받는다 (Next 캐시 비활성화)
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`OpenAlex ${res.status}: ${url}`);
  }
  return res.json();
}

/** 단어 수 기준으로 초록을 잘라 토큰 비용을 제한 */
function truncateWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ") + " …";
}

function url(work: OAWork): string {
  return (
    work.primary_location?.landing_page_url ||
    work.doi ||
    work.best_oa_location?.landing_page_url ||
    work.id
  );
}

function toPaper(work: OAWork): Paper & {
  abstract: string;
  topicIds: string[];
  topicNames: string[];
} {
  const topics = work.topics || [];
  return {
    id: work.id.replace("https://openalex.org/", ""),
    title: work.title || work.display_name || "(제목 없음)",
    year: work.publication_year,
    authors: (work.authorships || []).slice(0, 4).map((a) => a.author.display_name),
    citationCount: work.cited_by_count,
    url: url(work),
    venue: work.primary_location?.source?.display_name || null,
    abstract: truncateWords(reconstructAbstract(work.abstract_inverted_index), 110),
    topicIds: topics.map((t) => t.id.replace("https://openalex.org/", "")),
    topicNames: topics.map((t) => t.display_name),
  };
}

function isoYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function buildQuery(topic: string, extraKeywords?: string): string {
  return [topic, extraKeywords].filter(Boolean).join(" ").trim();
}

export interface RawPaper extends Paper {
  abstract: string;
  referencedWorks: string[];
  topicIds: string[];
  topicNames: string[];
}

/** computeFoundational 이 돌려주는, 부가 정보가 붙은 근간 논문 */
export type FoundationalPaper = Paper & { abstract: string; topicIds: string[]; topicNames: string[] };

const todayISO = () => new Date().toISOString().slice(0, 10);

function toRaw(w: OAWork): RawPaper {
  return { ...toPaper(w), referencedWorks: w.referenced_works || [] };
}

/**
 * 주제 검색. 핵심은 "관련성(relevance) 우선으로 후보를 모은 뒤, 그 안에서 재정렬"하는 것.
 * (OpenAlex 에서 곧장 피인용수로 정렬하면 주제와 무관한 고인용 논문이 섞여 들어온다.)
 *  - influential: 관련성 높은 최근 4년 논문 풀에서 피인용수 상위 = 분야의 현재 핵심 (근간 논문 추적의 토대)
 *  - latest: 관련성 높은 최근 2년 논문 풀에서 가장 최신
 */
export async function fetchTopicPapers(
  topic: string,
  extraKeywords: string | undefined,
  signal?: AbortSignal
): Promise<{ influential: RawPaper[]; latest: RawPaper[] }> {
  const q = encodeURIComponent(buildQuery(topic, extraKeywords));

  // 관련성 기본 정렬(search 사용 시 relevance_score desc)로 넓게 가져온다
  const influentialPoolUrl =
    `${OPENALEX}/works?search=${q}` +
    `&filter=from_publication_date:${isoYearsAgo(4)}` +
    `&per_page=50&select=${SELECT}&mailto=${MAILTO}`;

  const latestPoolUrl =
    `${OPENALEX}/works?search=${q}` +
    `&filter=from_publication_date:${isoYearsAgo(2)}` +
    `&per_page=40&select=${SELECT}&mailto=${MAILTO}`;

  let [influentialRes, latestRes] = await Promise.all([
    oaFetch(influentialPoolUrl, signal),
    oaFetch(latestPoolUrl, signal),
  ]);

  // 결과가 너무 적으면 날짜 필터를 풀어 한 번 더 (니치 주제 대응)
  if ((influentialRes.results?.length ?? 0) < 5) {
    influentialRes = await oaFetch(
      `${OPENALEX}/works?search=${q}&per_page=50&select=${SELECT}&mailto=${MAILTO}`,
      signal
    );
  }

  // influential: 관련 풀 안에서 피인용수 상위 25편
  const influential: RawPaper[] = (influentialRes.results || [])
    .slice() // relevance 순서 보존용 복사
    .sort((a: OAWork, b: OAWork) => b.cited_by_count - a.cited_by_count)
    .slice(0, 25)
    .map(toRaw);

  // latest: 관련 풀 안에서 (미래 날짜 제외) 가장 최신 10편
  const today = todayISO();
  const latest: RawPaper[] = (latestRes.results || [])
    .filter((w: OAWork) => (w.publication_date || "0") <= today)
    .sort((a: OAWork, b: OAWork) =>
      (b.publication_date || "").localeCompare(a.publication_date || "")
    )
    .slice(0, 10)
    .map(toRaw);

  return { influential, latest };
}

/**
 * 인용 그래프 기반 "근간 논문" 계산.
 * 분야의 핵심(influential) 논문들이 공통으로 인용하는 논문일수록 근간이 된다.
 */
export async function computeFoundational(
  influential: RawPaper[],
  excludeIds: Set<string>,
  signal?: AbortSignal,
  limit = 14
): Promise<FoundationalPaper[]> {
  // 1) 모든 참고문헌을 모아 등장 빈도(= 몇 편의 핵심 논문이 인용했는지) 계산
  const freq = new Map<string, number>();
  for (const p of influential) {
    for (const ref of p.referencedWorks) {
      freq.set(ref, (freq.get(ref) || 0) + 1);
    }
  }

  // 2) 2편 이상이 공통 인용한 것만, 빈도 높은 순으로 정렬
  const ranked = [...freq.entries()]
    .filter(([id, count]) => count >= 2 && !excludeIds.has(id.replace("https://openalex.org/", "")))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  if (ranked.length === 0) return [];

  // 3) 상위 후보의 메타데이터를 병렬로 가져온다
  const fetched = await Promise.all(
    ranked.map(async ([refId, coCited]) => {
      try {
        const shortId = refId.replace("https://openalex.org/", "");
        const data = (await oaFetch(
          `${OPENALEX}/works/${shortId}?select=${SELECT}&mailto=${MAILTO}`,
          signal
        )) as OAWork;
        const paper = toPaper(data);
        return { ...paper, coCitedBy: coCited } as FoundationalPaper;
      } catch {
        return null;
      }
    })
  );

  // 4) 공통 인용 수 → 전체 피인용 수 순으로 최종 정렬
  return (fetched.filter(Boolean) as FoundationalPaper[]).sort(
    (a, b) => (b.coCitedBy || 0) - (a.coCitedBy || 0) || b.citationCount - a.citationCount
  );
}
