"use client";

import { Apple, ArrowLeft, Check, FlaskConical, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useConnect, useSignMessage } from "wagmi";
import {
  authErrorStatus,
  canonicalLoginUrl,
  OIDC_PROVIDER_ORDER,
  sanitizeReturnTo,
  useAuth,
  type OidcProvider,
} from "@/lib/auth";
import { LanguageSwitch } from "@/app/components/language-switch";
import { WalletPicker } from "@/app/components/wallet-picker";
import { AmbientBackground } from "@/app/components/ambient-background";
import { useLocale } from "@/lib/locale";

/** 当前版本的 lucide-react 没有 GitHub 品牌图标，直接内联官方 mark 路径。 */
function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" width="19" height="19" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A7.99 7.99 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

const SOCIAL_LABELS: Record<OidcProvider, string> = {
  google: "Google",
  github: "GitHub",
  apple: "Apple",
  casdoor: "Casdoor",
};

/**
 * 按钮行固定展示 Google 与 GitHub——它们是本站点对外承诺的登录方式，即使 BFF 侧还没配好
 * 也要把状态如实写出来（"需要配置"），而不是像之前那样一直显示"配置中"让人干等。
 * Apple / Casdoor 只有在 BFF 真正配置好时才补位，避免出现永远点不动的空按钮。
 */
const ALWAYS_SHOWN: readonly OidcProvider[] = ["google", "github"];

function SocialMark({ provider }: { provider: OidcProvider }) {
  if (provider === "google") return <span className="login-social-mark"><span className="google-mark">G</span></span>;
  if (provider === "github") return <span className="login-social-mark"><GithubMark /></span>;
  if (provider === "apple") return <span className="login-social-mark"><Apple size={19} /></span>;
  return <span className="login-social-mark"><ShieldCheck size={19} /></span>;
}

export default function LoginPage() {
  const { state, capabilities, completeWalletLogin, startOidc } = useAuth();
  const { isPending: connecting } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const { dictionary: t } = useLocale();
  const [returnTo, setReturnTo] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [oidcBusy, setOidcBusy] = useState<OidcProvider>();
  const [error, setError] = useState<string>();
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setReturnTo(sanitizeReturnTo(new URLSearchParams(window.location.search).get("returnTo"))), 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => { if (state === "authenticated" && returnTo) window.location.replace(returnTo); }, [state, returnTo]);

  /**
   * `auth_http_403` 之类的原始错误码对用户毫无意义。把它们翻译成能指导下一步操作的文案：
   * 403 = 访问入口不对，429 = 稍后重试，503 = 该方式没配好，5xx = 服务端故障。
   * 其余（比如用户在钱包里拒签）保留原始信息。
   */
  function describeError(cause: unknown): string {
    const status = authErrorStatus(cause);
    if (status === 403) return t.auth.errorOrigin;
    if (status === 429) return t.auth.errorRateLimited;
    if (status === 503) return t.auth.errorUnconfigured;
    if (status !== undefined && status >= 500) return t.auth.errorServer;
    return cause instanceof Error ? cause.message : t.auth.loginFailed;
  }

  // 每次点击都先让用户挑选钱包（Rabby / MetaMask / 其它），不复用上一次的连接器。
  function startWalletLogin() {
    setError(undefined);
    setPickerOpen(true);
  }

  async function signIn(account: `0x${string}`) {
    setBusy(true); setError(undefined);
    try { await completeWalletLogin(account, (message) => signMessageAsync({ message, account })); }
    catch (cause) { setError(describeError(cause)); }
    finally { setBusy(false); }
  }
  async function oidcLogin(provider: OidcProvider) {
    setOidcBusy(provider); setError(undefined);
    try { window.location.assign(await startOidc(provider, returnTo ?? "/agents/")); }
    catch (cause) { setError(describeError(cause)); setOidcBusy(undefined); }
  }

  const unavailable = state === "unavailable";
  const walletEnabled = capabilities?.wallet.enabled === true && capabilities.wallet.siwe;
  const benefits = [t.auth.benefitSession, t.auth.benefitWallet, t.auth.benefitSeparate];
  const socialProviders = OIDC_PROVIDER_ORDER.filter(
    (provider) => ALWAYS_SHOWN.includes(provider) || capabilities?.oidc[provider].configured === true,
  );

  return <main className="login-page">
    <AmbientBackground intense />
    <header className="login-header"><Link href="/" className="brand"><ArrowLeft size={16} />AgentTrust</Link><LanguageSwitch /></header>
    <div className="login-grid">
      <section className="login-intro">
        <span className="home-eyebrow"><ShieldCheck size={16} />{t.auth.accessEyebrow}</span>
        <h1>{t.auth.title}</h1>
        <p>{t.auth.subtitle}</p>
        <ul>{benefits.map((benefit) => <li key={benefit}><Check size={15} aria-hidden="true" /><span>{benefit}</span></li>)}</ul>
      </section>
      <section className="login-stack" aria-label={t.auth.loginOptions}>
        <div className="login-card login-card-primary"><span className="login-card-tag">{t.auth.recommended}</span><Wallet size={24} aria-hidden="true" /><h2>{t.auth.walletTitle}</h2><p>{t.auth.walletDescription}</p>
          <button className="button button-primary login-action" type="button" onClick={startWalletLogin} disabled={busy || connecting || !walletEnabled || unavailable}>{busy || connecting ? t.auth.signing : t.auth.connectAndSign}</button>
          {!unavailable && capabilities && !walletEnabled && <p className="form-warning">{t.auth.walletUnavailable}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {unavailable && <a className="button button-secondary login-action" href={canonicalLoginUrl(returnTo ?? "/agents/")}>{t.auth.continueCanonical}</a>}
        </div>
        <div className="login-social-row">
          {socialProviders.map((provider) => {
            const configured = capabilities?.oidc[provider].configured === true;
            const pending = oidcBusy === provider;
            return <button key={provider} type="button" className="login-social" disabled={!configured || Boolean(oidcBusy)} onClick={() => void oidcLogin(provider)}>
              <SocialMark provider={provider} />
              <span>{SOCIAL_LABELS[provider]}</span>
              <small>{capabilities === undefined ? t.auth.checkingProvider : configured ? (pending ? t.auth.redirecting : t.auth.continueWith) : t.auth.setupRequired}</small>
            </button>;
          })}
        </div>
        <div className="login-card identity-placeholder"><ShieldCheck size={22} /><div><h2>{t.auth.strongIdentityTitle}</h2><p>{t.auth.strongIdentityPlaceholder}</p></div><span>{t.auth.planned}</span></div>
        <details className="labs-card"><summary><FlaskConical size={18} />{t.auth.labs}</summary><p>{t.auth.worldIdLabs}</p></details>
      </section>
    </div>
    <WalletPicker
      open={pickerOpen}
      onClose={() => setPickerOpen(false)}
      onConnected={({ address: account }) => {
        if (!account) { setError(t.auth.walletMissing); return false; }
        void signIn(account);
        return true; // 关闭选择页，签名进度由登录卡片承接
      }}
    />
  </main>;
}
