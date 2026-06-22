// 공통 타입 정의

/** 사용자 신분 — 트렌드 요약의 난이도/톤 조절에 사용 */
export type Role = "undergrad" | "grad" | "professor" | "industry";

export const ROLE_LABELS: Record<Role, string> = {
  undergrad: "학부생",
  grad: "대학원생",
  professor: "교수 / 연구자",
  industry: "현업 개발자",
};

/** 클라이언트 → /api/research 요청 본문 */
export interface ResearchRequest {
  topic: string;
  role: Role;
  extraKeywords?: string;
  /** 검색할 기간 (년). 0 이면 전체 기간 */
  yearRange?: number;
  /** 무료로 볼 수 있는(오픈액세스) 논문만 */
  openAccessOnly?: boolean;
  /** 리뷰·서베이 논문 중심으로 (분야 개관에 유리) */
  reviewFocus?: boolean;
}

export interface SearchOptions {
  yearRange: number;
  openAccessOnly: boolean;
  reviewFocus: boolean;
}

/** 한 편의 논문 (OpenAlex + Claude 요약이 합쳐진 최종 형태) */
export interface Paper {
  id: string; // OpenAlex ID (W...)
  title: string;
  year: number | null;
  authors: string[];
  citationCount: number;
  url: string; // 클릭하면 바로 열리는 링크
  venue: string | null;
  /** 근간 논문일 때: 입력한 최신 논문 중 몇 편이 이 논문을 인용했는지 */
  coCitedBy?: number;
  /** Claude가 만든 3줄 요약 (줄바꿈으로 구분) */
  summary?: string;
}

/** /api/research 응답 본문 */
export interface ResearchResponse {
  topic: string;
  role: Role;
  /** 분야 트렌드 요약 (신분에 맞춰 작성) */
  trendSummary: string;
  /** 최신 논문 목록 */
  latest: Paper[];
  /** 근간이 되는 논문 목록 (인용 그래프 기반) */
  foundational: Paper[];
  /** 트렌드 요약의 근거가 된 논문 수 등 메타 */
  meta: {
    analyzedCount: number;
    model: string;
    elapsedMs: number;
    /** ai = Claude 요약, fallback = 키 없이 초록 기반 */
    mode: "ai" | "fallback";
  };
}
