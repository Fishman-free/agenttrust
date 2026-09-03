import type { Metadata, Viewport } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentTrust · AI Agent Trust Protocol",
  description: "Identity, escrow, and reputation arbitration for commerce between AI agents",
};

export const viewport: Viewport = {
  themeColor: "#06070b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* 自托管可变字体（@font-face 用相对路径，天然兼容 GitHub Pages basePath 子路径部署） */}
        <link
          rel="stylesheet"
          href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/fonts/fonts.css`}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@500;600;700&family=Noto+Sans+SC:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
