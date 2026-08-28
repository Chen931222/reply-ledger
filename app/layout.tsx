import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export function generateMetadata(): Metadata {
  const publicOrigin = "https://reply-ledger-tw.ntumed301.chatgpt.site";
  const ogUrl = `${publicOrigin}/og.png`;
  const title = "Reply Ledger｜回覆帳簿";
  const description = "站在客服旁邊的 AI 觀察員：分析、建議、留下根據，但不擅自替人說話。";

  return {
    metadataBase: new URL(publicOrigin),
    title,
    description,
    openGraph: { title, description, images: [{ url: ogUrl, width: 1733, height: 909 }] },
    twitter: { card: "summary_large_image", title, description, images: [ogUrl] },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
