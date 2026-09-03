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

  it("loops a decorative background video inside the hero stage", () => {
    const { container } = render(<Home />);

    const video = container.querySelector("video.home-bg-video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("autoplay");
    // React 把 muted 作为 DOM property（mutedProp）而不是 HTML attribute 写入，
    // 所以这里断言 property，其余静音相关项仍可用 attribute 断言。
    expect((video as HTMLVideoElement).muted).toBe(true);
    expect(video).toHaveAttribute("loop");
    expect(video).toHaveAttribute("playsinline");
    expect(video).toHaveAttribute("aria-hidden", "true");
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
