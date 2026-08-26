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
    expect(screen.getByRole("link", { name: "View trade flow" })).toHaveAttribute("href", "/trade");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelector(".trust-visual")).toHaveAttribute("aria-hidden", "true");
  });

  it("makes the undeployed research-preview limitation explicit", () => {
    render(<Home />);

    expect(screen.getAllByText("Research Preview")[0]).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Contracts are not deployed on Base Sepolia; on-chain reads and transactions are unavailable.",
    );
  });
});
