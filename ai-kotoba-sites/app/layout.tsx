import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI-Kotoba · 日语情景会话学习",
  description: "支持场景对话、三行对译、发音诊断和 AI 语音 Tutor 的日语学习网站。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
