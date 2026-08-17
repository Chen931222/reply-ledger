import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const ogUrl = `${protocol}://${host}/og.png`;
  const title = "Reply Ledger｜回覆帳簿";
  const description = "站在客服旁邊的 AI 觀察員：分析、建議、留下根據，但不擅自替人說話。";

  return {
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
