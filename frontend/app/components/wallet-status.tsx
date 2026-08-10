"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { injected } from "wagmi/connectors";
import { activeChain, WRITE_BLOCK_REASON } from "@/lib/config";

export type WalletStateProps = {
  address?: `0x${string}`;
  chainId?: number;
  chainName?: string;
  expectedChainId: number;
  expectedChainName: string;
  isConnected: boolean;
  isConnecting?: boolean;
  isSwitching?: boolean;
  error?: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onSwitchChain: () => void;
};

function shortAddress(address: `0x${string}`) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletState({
  address,
  chainId,
  chainName,
  expectedChainId,
  expectedChainName,
  isConnected,
  isConnecting,
  isSwitching,
  error,
  onConnect,
  onDisconnect,
  onSwitchChain,
}: WalletStateProps) {
  const wrongNetwork = isConnected && chainId !== expectedChainId;

  return (
    <section className="wallet-panel" aria-label="钱包状态">
      {!isConnected ? (
        <button className="button button-primary" onClick={onConnect} disabled={isConnecting}>
          {isConnecting ? "连接中…" : "连接钱包"}
        </button>
      ) : (
        <>
          <div className="wallet-details">
            <span className="wallet-label">当前账户</span>
            <span className="wallet-value" title={address}>{address ? shortAddress(address) : "未知"}</span>
            <span className="wallet-label">当前网络</span>
            <span className={wrongNetwork ? "wallet-value network-error" : "wallet-value"}>
              {chainName ?? `Chain ${chainId ?? "未知"}`}
            </span>
          </div>
          {wrongNetwork && (
            <button className="button button-warning" onClick={onSwitchChain} disabled={isSwitching}>
              {isSwitching ? "切换中…" : `切换/添加 ${expectedChainName}`}
            </button>
          )}
          <button className="button button-secondary" onClick={onDisconnect}>断开</button>
        </>
      )}
      {wrongNetwork && (
        <p className="wallet-message" role="alert">
          网络错误：需要 {expectedChainName}（Chain ID {expectedChainId}）。
        </p>
      )}
      {error && <p className="wallet-message" role="alert">{error}</p>}
      {WRITE_BLOCK_REASON && <p className="wallet-message" role="status">{WRITE_BLOCK_REASON}</p>}
    </section>
  );
}

export function WalletStatus() {
  const { address, chain, chainId, isConnected } = useAccount();
  const { connect, isPending: isConnecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching, error: switchError } = useSwitchChain();

  return (
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
      onConnect={() => connect({ connector: injected() })}
      onDisconnect={() => disconnect()}
      onSwitchChain={() => switchChain({ chainId: activeChain.id })}
    />
  );
}
