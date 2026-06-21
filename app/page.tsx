"use client";

import { useEffect, useState } from "react";
import { ROLE_LABELS, type Paper, type ResearchResponse, type Role } from "@/lib/types";

const ROLES = Object.entries(ROLE_LABELS) as [Role, string][];
const EXAMPLES = ["large language models", "diffusion models", "reinforcement learning", "graph neural networks", "robot manipulation"];

const LOADING_STEPS = [
  "OpenAlex에서 관련 논문을 검색하는 중…",
  "인용 그래프를 분석해 근간 논문을 찾는 중…",
  "Claude가 트렌드와 3줄 요약을 작성하는 중…",
];

function PaperCard({ paper, kind }: { paper: Paper; kind: "latest" | "root" }) {
  const lines = (paper.summary || "").split("\n").map((l) => l.trim()).filter(Boolean);
  return (
    <div className="card">
      <a className="title" href={paper.url} target="_blank" rel="noopener noreferrer">
        {paper.title}
      </a>
      <div className="by">
        {paper.authors.length > 0 ? paper.authors.join(", ") : "저자 미상"}
        {paper.authors.length >= 4 ? " 외" : ""}
        {paper.venue ? ` · ${paper.venue}` : ""}
      </div>
      <div className="badges">
        {paper.year && <span className="badge year">{paper.year}</span>}
        <span className="badge cite">피인용 {paper.citationCount.toLocaleString()}</span>
        {kind === "root" && paper.coCitedBy != null && (
          <span className="badge cocite">핵심 논문 {paper.coCitedBy}편이 인용</span>
        )}
      </div>
      {lines.length > 0 ? (
        <ul className="summary">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      ) : (
        <p className="no-summary">요약을 생성하지 못했습니다.</p>
      )}
      <a className="arrow" href={paper.url} target="_blank" rel="noopener noreferrer">
        논문 보러가기 →
      </a>
    </div>
  );
}

export default function Home() {
  const [role, setRole] = useState<Role>("grad");
  const [topic, setTopic] = useState("");
  const [extra, setExtra] = useState("");
  const [loading, setLoading] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ResearchResponse | null>(null);

  // 로딩 중 단계 메시지 순환
  useEffect(() => {
    if (!loading) return;
    setStepIdx(0);
    const t = setInterval(() => setStepIdx((i) => Math.min(i + 1, LOADING_STEPS.length - 1)), 4000);
    return () => clearInterval(t);
  }, [loading]);

  async function run() {
    if (!topic.trim() || loading) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, role, extraKeywords: extra }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "오류가 발생했습니다.");
      } else {
        setData(json as ResearchResponse);
      }
    } catch (e: any) {
      setError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="wrap">
      <header className="hero">
        <h1 className="brand">
          Paper<span className="roots">Roots</span>
        </h1>
        <p className="tagline">
          연구 주제 하나만 입력하면, 그 분야의 <b>트렌드</b>와 <b>최신 논문</b>, 그리고 그 분야의{" "}
          <b>근간이 되는 논문</b>까지 3줄 요약으로 정리해 드립니다.
        </p>
      </header>

      <section className="search">
        <p className="label">나는</p>
        <div className="roles">
          {ROLES.map(([key, label]) => (
            <button
              key={key}
              className={`chip ${role === key ? "active" : ""}`}
              onClick={() => setRole(key)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        <p className="label">관심 주제 (영어 키워드 권장)</p>
        <input
          className="field"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="예: large language models, diffusion models, reinforcement learning"
        />

        <p className="label">세부 관심사 (선택)</p>
        <input
          className="field"
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="예: agent, evaluation, medical … (좁히고 싶은 키워드)"
        />

        <button className="go" onClick={run} disabled={loading || !topic.trim()} type="button">
          {loading ? "분석 중…" : "논문 계보 분석하기"}
        </button>

        <p className="examples">
          <b>예시:</b>{" "}
          {EXAMPLES.map((ex) => (
            <button key={ex} className="ex" onClick={() => setTopic(ex)} type="button">
              {ex}
            </button>
          ))}
        </p>
      </section>

      {error && (
        <div className="note err">⚠️ {error}</div>
      )}

      {loading && (
        <div className="loading">
          <div className="spinner" />
          <div className="steps">{LOADING_STEPS[stepIdx]}</div>
        </div>
      )}

      {data && !loading && (
        <div className="results">
          <div className="trend">
            <h2>📈 {data.topic} — 분야 트렌드</h2>
            <p>{data.trendSummary}</p>
          </div>
          <p className="meta">
            {ROLE_LABELS[data.role]} 관점 · 핵심 논문 {data.meta.analyzedCount}편 분석 ·{" "}
            {data.meta.model} · {(data.meta.elapsedMs / 1000).toFixed(1)}초
          </p>

          {data.foundational.length > 0 && (
            <>
              <div className="section-head">
                <span className="dot root" />
                <h3>근간이 되는 논문</h3>
                <span className="sub">최신 핵심 논문들이 공통으로 인용하는, 이 분야의 토대</span>
              </div>
              {data.foundational.map((p) => (
                <PaperCard key={p.id} paper={p} kind="root" />
              ))}
            </>
          )}

          {data.latest.length > 0 && (
            <>
              <div className="section-head">
                <span className="dot latest" />
                <h3>최신 논문</h3>
                <span className="sub">이 주제에서 가장 최근에 나온 연구들</span>
              </div>
              {data.latest.map((p) => (
                <PaperCard key={p.id} paper={p} kind="latest" />
              ))}
            </>
          )}
        </div>
      )}

      <footer className="footer">
        데이터: <code>OpenAlex</code> · 요약: <code>Claude API</code> · 만든 도구:{" "}
        <code>Claude Code</code>
      </footer>
    </div>
  );
}
