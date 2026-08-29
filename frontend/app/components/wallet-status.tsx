"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { activeChain, getWriteBlockReason } from "@/lib/config";
import { formatMessage, useLocale } from "@/lib/locale";
import { useWalletPicker } from "./wallet-picker";

export type WalletStateProps = { address?: `0x${string}`; chainId?: number; chainName?: string; expectedChainId: number; expectedChainName: string; isConnected: boolean; isConnecting?: boolean; isSwitching?: boolean; error?: string; onConnect: () => void; onDisconnect: () => void; onSwitchChain: () => void };
function shortAddress(address: `0x${string}`) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }

export function WalletState({ address, chainId, chainName, expectedChainId, expectedChainName, isConnected, isConnecting, isSwitching, error, onConnect, onDisconnect, onSwitchChain }: WalletStateProps) {
  const { locale, dictionary: t } = useLocale();
  const wrongNetwork = isConnected && chainId !== expectedChainId;
  return <section className="wallet-panel" aria-label={t.wallet.status}>
    {!isConnected ? <button className="button button-primary" onClick={onConnect} disabled={isConnecting}>{isConnecting ? t.common.connecting : t.common.connectWallet}</button> : <>
      <div className="wallet-details"><span className="wallet-label">{t.wallet.currentAccount}</span><span className="wallet-value" title={address} aria-label={address ? formatMessage(t.wallet.accountValue, { address }) : t.wallet.accountUnknown}>{address ? shortAddress(address) : t.common.unknown}</span><span className="wallet-label">{t.wallet.currentNetwork}</span><span className={wrongNetwork ? "wallet-value network-error" : "wallet-value"}>{chainName ?? `Chain ${chainId ?? t.common.unknown}`}</span></div>
      {wrongNetwork && <button className="button button-warning" onClick={onSwitchChain} disabled={isSwitching}>{isSwitching ? t.wallet.switching : formatMessage(t.wallet.switchTo, { chain: expectedChainName })}</button>}
      <button className="button button-secondary" onClick={onDisconnect}>{t.wallet.disconnect}</button>
    </>}
    {wrongNetwork && <p className="wallet-message" role="alert">{formatMessage(t.wallet.networkError, { chain: expectedChainName, chainId: expectedChainId })}</p>}
    {error && <p className="wallet-message" role="alert">{error}</p>}
    {getWriteBlockReason(locale) && <p className="wallet-message" role="status">{getWriteBlockReason(locale)}</p>}
  </section>;
}

/**
 * 钱包操作容器。
 *
 * 「连接钱包」永远打开钱包选择面板 —— 即便当前已经连着某个钱包，
 * 再点一次也要重新给一次选择机会（切换钱包 / 换账户都走这条路）。
 * 已连过的钱包由 wagmi 的持久化 + EIP-6963 自动发现负责静默重连。
 */
export function WalletStatus({
  variant = "standalone",
  onAfterDisconnect,
}: {
  variant?: "standalone" | "embedded";
  onAfterDisconnect?: () => void;
} = {}) {
  const { address, chain, chainId, isConnected } = useAccount();
  const { isPending: isConnecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching, error: switchError } = useSwitchChain();
  const picker = useWalletPicker();

  const openPicker = () => picker.open(isConnected ? "switch" : "connect");

  return (
    <div className={variant === "embedded" ? "wallet-host wallet-host-embedded" : "wallet-host"}>
      <WalletState
        address={address}
        chainId={chainId}
        chainName={chain?.name}
        expectedChainId={activeChain.id}
        expectedChainName={activeChain.name}
        isConnected={isConnected}
        isConnecting={isConnecting}
        isSwitching={isSwitching}
        error={connectError?.message ?? switchError?.message}
        onConnect={openPicker}
        onDisconnect={() => { disconnect(); onAfterDisconnect?.(); }}
        onSwitchChain={() => switchChain({ chainId: activeChain.id })}
      />
    </div>
  );
}

/** 顶栏的紧凑连接按钮：未连接时展示，点击即弹出钱包选择。 */
export function ConnectWalletButton() {
  const { dictionary: t } = useLocale();
  const { isPending: isConnecting } = useConnect();
  const picker = useWalletPicker();
  return (
    <button
      type="button"
      className="button button-primary connect-pill"
      onClick={() => picker.open("connect")}
      disabled={isConnecting}
    >
      {isConnecting ? t.common.connecting : t.common.connectWallet}
    </button>
  );
}
