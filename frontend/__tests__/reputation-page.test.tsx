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
    expect(screen.getByText("完成交易").previousElementSibling).toHaveTextContent("4");
    expect(screen.getByText("不可变责任主体").nextElementSibling).toHaveTextContent(responsibleParty);
    expect(screen.getByText("当前 NFT 所有者").nextElementSibling).toHaveTextContent(currentOwner);

    const jurorSection = screen.getByRole("heading", { name: "责任主体的陪审信誉" }).closest("section");
    expect(jurorSection).not.toBeNull();
    const juror = within(jurorSection!);
    expect(juror.getByText("当前符合陪审资格")).toBeInTheDocument();
    expect(juror.getByText("揭示率").previousElementSibling).toHaveTextContent("80.0%");
    expect(juror.getByText("共识样本").previousElementSibling).toHaveTextContent("4");
    expect(juror.getByText("共识一致率").previousElementSibling).toHaveTextContent("75.0%");
    expect(juror.getByText(/不代表客观真相/)).toBeInTheDocument();

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

    const jurorSection = screen.getByRole("heading", { name: "责任主体的陪审信誉" }).closest("section");
    const juror = within(jurorSection!);
    expect(juror.getByText("揭示率").previousElementSibling).toHaveTextContent("—");
    expect(juror.getByText("共识一致率").previousElementSibling).toHaveTextContent("—");
  });
});
