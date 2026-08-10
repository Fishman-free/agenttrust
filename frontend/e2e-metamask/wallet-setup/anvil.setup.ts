import { defineWalletSetup } from "@synthetixio/synpress";
import { MetaMask } from "@synthetixio/synpress/playwright";

export const ANVIL_NETWORK = {
  name: "Local Anvil",
  rpcUrl: "http://127.0.0.1:8545",
  chainId: 31337,
  symbol: "ETH",
} as const;

// Public first Anvil account. Never replace this with a real recovery phrase.
const ANVIL_MNEMONIC =
  "test test test test test test test test test test test junk";
const WALLET_PASSWORD = "synpress-anvil-disposable";

export default defineWalletSetup(WALLET_PASSWORD, async (context, walletPage) => {
  // Synpress 4.1.2 bundles a second playwright-core; the runtime objects are compatible.
  const metamask = new MetaMask(context as never, walletPage as never, WALLET_PASSWORD);
  await metamask.importWallet(ANVIL_MNEMONIC);
  await metamask.addNetwork(ANVIL_NETWORK);
});
