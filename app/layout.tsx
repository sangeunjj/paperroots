import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PaperRoots — 연구 논문 계보 어시스턴트",
  description:
    "주제 하나만 입력하면 그 분야의 트렌드, 최신 논문, 그리고 근간이 되는 논문들을 3줄 요약과 함께 정리해 드립니다.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
