import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const responsibleParty = "0x1111111111111111111111111111111111111111";
const currentOwner = "0x2222222222222222222222222222222222222222";
const readContract = vi.hoisted(() => vi.fn());

vi.mock("wagmi", () => ({ useReadContract: readContract }));
vi.mock("@/lib/config", () => ({
  CONTRACT_ADDRESSES: {
    agentRegistry: "0x3333333333333333333333333333333333333333",
    reputationHub: "0x4444444444444444444444444444444444444444",
  },
  isZeroAddress: () => false,
}));

import ReputationPage from "@/app/(app)/reputation/page";

function mockReads(jurorReputation: readonly bigint[] = [BigInt(5), BigInt(4), BigInt(1), BigInt(3), BigInt(1)]) {
  readContract.mockImplementation(({ functionName }: { functionName: string }) => ({
    data: {
      agentCount: BigInt(2),
      reputation: [BigInt(4), BigInt(1), BigInt(2), BigInt(0)],
      reputationScore: BigInt(73),
      responsibleParty,
      ownerOf: currentOwner,
      jurorReputation,
      isJurorEligible: true,
    }[functionName],
    isPending: false,
    isError: false,
  }));
}

beforeEach(() => {
  readContract.mockReset();
  mockReads();
});

describe("ReputationPage", () => {
  it("keeps business reputation and separates immutable identity from current ownership", async () => {
    render(<ReputationPage />);
    await userEvent.type(screen.getByRole("textbox", { name: "Agent ID" }), "1");

    expect(screen.getByText("73")).toBeInTheDocument();
    expect(screen.getByText("Completed trades").previousElementSibling).toHaveTextContent("4");
    expect(screen.getByText("Responsible subject").nextElementSibling).toHaveTextContent(responsibleParty);
    expect(screen.getByText("Current NFT owner").nextElementSibling).toHaveTextContent(currentOwner);

    const jurorSection = screen.getByRole("heading", { name: "Juror reputation of the responsible subject" }).closest("section");
    expect(jurorSection).not.toBeNull();
    const juror = within(jurorSection!);
    expect(juror.getByText("Currently juror-eligible")).toBeInTheDocument();
    expect(juror.getByText("Reveal rate").previousElementSibling).toHaveTextContent("80.0%");
    expect(juror.getByText("Consensus samples").previousElementSibling).toHaveTextContent("4");
    expect(juror.getByText("Consensus alignment").previousElementSibling).toHaveTextContent("75.0%");
    expect(juror.getByText(/does not prove objective truth/)).toBeInTheDocument();

    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: "jurorReputation",
      args: [responsibleParty],
      query: { enabled: true },
    }));
  });

  it("shows unavailable rates when their samples are zero", async () => {
    mockReads([BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0)]);
    render(<ReputationPage />);
    await userEvent.type(screen.getByRole("textbox", { name: "Agent ID" }), "0");

    const jurorSection = screen.getByRole("heading", { name: "Juror reputation of the responsible subject" }).closest("section");
    const juror = within(jurorSection!);
    expect(juror.getByText("Reveal rate").previousElementSibling).toHaveTextContent("—");
    expect(juror.getByText("Consensus alignment").previousElementSibling).toHaveTextContent("—");
  });
});
