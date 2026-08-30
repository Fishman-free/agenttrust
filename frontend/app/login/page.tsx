"use client";

import { Apple, ArrowLeft, FlaskConical, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useConnect, useSignMessage } from "wagmi";
import { canonicalLoginUrl, sanitizeReturnTo, useAuth, type OidcProvider } from "@/lib/auth";
import { LanguageSwitch } from "@/app/components/language-switch";
import { WalletPicker } from "@/app/components/wallet-picker";
import { useLocale } from "@/lib/locale";

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

  // 每次点击都先让用户挑选钱包（Rabby / MetaMask / 其它），不复用上一次的连接器。
  function startWalletLogin() {
    setError(undefined);
    setPickerOpen(true);
  }

  async function signIn(account: `0x${string}`) {
    setBusy(true); setError(undefined);
    try { await completeWalletLogin(account, (message) => signMessageAsync({ message, account })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t.auth.loginFailed); }
    finally { setBusy(false); }
  }
  async function oidcLogin(provider: OidcProvider) {
    setOidcBusy(provider); setError(undefined);
    try { window.location.assign(await startOidc(provider, returnTo ?? "/agents/")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t.auth.loginFailed); setOidcBusy(undefined); }
  }

  const unavailable = state === "unavailable";
  const walletEnabled = capabilities?.wallet.enabled === true && capabilities.wallet.siwe;
  return <main className="login-page">
    <header className="login-header"><Link href="/" className="brand"><ArrowLeft size={16} />AgentTrust</Link><LanguageSwitch /></header>
    <div className="login-grid">
      <section className="login-intro"><span className="home-eyebrow"><ShieldCheck size={16} />{t.auth.accessEyebrow}</span><h1>{t.auth.title}</h1><p>{t.auth.subtitle}</p>
        <ul><li>{t.auth.benefitSession}</li><li>{t.auth.benefitWallet}</li><li>{t.auth.benefitSeparate}</li></ul>
      </section>
      <section className="login-stack" aria-label={t.auth.loginOptions}>
        <div className="login-card login-card-primary"><span className="login-card-tag">{t.auth.recommended}</span><Wallet size={24} aria-hidden="true" /><h2>{t.auth.walletTitle}</h2><p>{t.auth.walletDescription}</p>
          <button className="button button-primary login-action" type="button" onClick={startWalletLogin} disabled={busy || connecting || !walletEnabled || unavailable}>{busy || connecting ? t.auth.signing : t.auth.connectAndSign}</button>
          {!unavailable && capabilities && !walletEnabled && <p className="form-warning">{t.auth.walletUnavailable}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {unavailable && <a className="button button-secondary login-action" href={canonicalLoginUrl(returnTo ?? "/agents/")}>{t.auth.continueCanonical}</a>}
        </div>
        <div className="login-social-row">
          <button type="button" className="login-social" disabled={!capabilities?.oidc.google.configured || Boolean(oidcBusy)} onClick={() => void oidcLogin("google")}><span className="google-mark">G</span><span>Google</span><small>{capabilities?.oidc.google.configured ? (oidcBusy === "google" ? t.auth.redirecting : t.auth.continueWith) : t.auth.configuring}</small></button>
          <button type="button" className="login-social" disabled={!capabilities?.oidc.apple.configured || Boolean(oidcBusy)} onClick={() => void oidcLogin("apple")}><Apple size={19} /><span>Apple</span><small>{capabilities?.oidc.apple.configured ? (oidcBusy === "apple" ? t.auth.redirecting : t.auth.continueWith) : t.auth.configuring}</small></button>
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
