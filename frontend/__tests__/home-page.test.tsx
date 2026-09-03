import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", () => ({
  activeChain: { name: "Base Sepolia" },
  WRITES_ENABLED: false,
}));

import Home from "@/app/page";

describe("Home", () => {
  it("presents a video-background hero with real navigation", () => {
    const { container } = render(<Home />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Verifiable trust for AI agents");
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeInTheDocument();

    for (const [name, href] of [
      ["Agent identity", "/agents"],
      ["Guaranteed trade", "/trade"],
      ["Dispute arbitration", "/disputes"],
      ["Reputation profile", "/reputation"],
    ]) {
      expect(screen.getByRole("link", { name: new RegExp(name) })).toHaveAttribute("href", href);
    }

    expect(screen.getByRole("link", { name: /Explore agents/ })).toHaveAttribute("href", "/agents");
    expect(container.querySelector(".home-trust")).toHaveAttribute("aria-hidden", "true");
  });

  it("loops a decorative full-page ambient background video", () => {
    const { container } = render(<Home />);

    // 2026-09 改版：视频从 hero-stage 上移到页面根部的 .ambient-bg（fixed 铺满整页）
    const ambient = container.querySelector(".ambient-bg");
    expect(ambient).not.toBeNull();
    expect(ambient).toHaveAttribute("aria-hidden", "true");
    const video = ambient?.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("autoplay");
    // React 把 muted 作为 DOM property（mutedProp）而不是 HTML attribute 写入，
    // 所以这里断言 property，其余静音相关项仍可用 attribute 断言。
    expect((video as HTMLVideoElement).muted).toBe(true);
    expect(video).toHaveAttribute("loop");
    expect(video).toHaveAttribute("playsinline");
    // basePath 兼容：本地/东京为 /media/hero-loop.mp4，Pages 构建注入 NEXT_PUBLIC_BASE_PATH 后带前缀
    const videoSrc = container.querySelector("source[src]")?.getAttribute("src") ?? "";
    expect(videoSrc.endsWith("/media/hero-loop.mp4")).toBe(true);
  });

  it("links first-time visitors to the trusted-trading guide", () => {
    render(<Home />);

    expect(screen.getByRole("link", { name: /Beginner's guide/ })).toHaveAttribute(
      "href",
      "https://github.com/Fishman-free/multiagent/blob/main/docs/guides/trusted-trading.md",
    );
  });

  it("shows both beginner tutorials as guide rows", () => {
    render(<Home />);

    expect(screen.getByRole("heading", { name: /Start from zero/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /MCP\/A2A endpoint setup guide/ })).toHaveAttribute(
      "href",
      "https://github.com/Fishman-free/multiagent/blob/main/docs/guides/mcp-a2a-endpoints.md",
    );
    expect(screen.getByRole("link", { name: /Trusted trading walkthrough/ })).toHaveAttribute(
      "href",
      "https://github.com/Fishman-free/multiagent/blob/main/docs/guides/trusted-trading.md",
    );
  });

  it("shows only verifiable protocol constants in the stats bar", () => {
    render(<Home />);

    for (const value of ["0.01 ETH", "2-3", "L1-L4", "10"]) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }
    for (const label of ["Registration deposit", "Guardians per agent", "Identity binding levels", "Trade lifecycle states"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("makes the undeployed research-preview limitation explicit", () => {
    render(<Home />);

    expect(screen.getAllByText("Research Preview")[0]).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Contracts are not deployed on Base Sepolia; on-chain reads and transactions are unavailable.",
    );
  });
});
