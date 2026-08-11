import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", () => ({
  activeChain: { name: "Base Sepolia" },
  WRITES_ENABLED: false,
}));

import Home from "@/app/page";

describe("Home", () => {
  it("presents a compact protocol overview with real navigation", () => {
    const { container } = render(<Home />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("为智能体建立可验证的信任");
    expect(screen.getByRole("navigation", { name: "主要导航" })).toBeInTheDocument();

    for (const [name, href] of [
      ["智能体身份", "/agents"],
      ["担保交易", "/trade"],
      ["争议裁决", "/disputes"],
      ["信誉档案", "/reputation"],
    ]) {
      expect(screen.getByRole("link", { name: new RegExp(name) })).toHaveAttribute("href", href);
    }

    expect(screen.getByRole("link", { name: /探索智能体/ })).toHaveAttribute("href", "/agents");
    expect(screen.getByRole("link", { name: "查看交易流程" })).toHaveAttribute("href", "/trade");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelector(".trust-visual")).toHaveAttribute("aria-hidden", "true");
  });

  it("makes the undeployed research-preview limitation explicit", () => {
    render(<Home />);

    expect(screen.getByText("Research Preview")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Base Sepolia 合约尚未部署，链上读取与交易操作暂不可用。",
    );
  });
});
