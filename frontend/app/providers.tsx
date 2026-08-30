"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { MotionConfig } from "motion/react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { LocaleProvider } from "@/lib/locale";
import { AuthProvider } from "@/lib/auth";
import { ProfileProvider } from "@/lib/profile";
import { TxHistoryProvider } from "@/lib/tx-history";
import { WalletPickerProvider } from "@/app/components/wallet-picker";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <LocaleProvider>
      {/* reducedMotion="user"：尊重系统「减弱动态效果」，Motion 自动用淡入淡出替代位移与弹簧。 */}
      <MotionConfig reducedMotion="user">
        {/* reconnectOnMount={false}: wagmi default auto-fires the previously used connector
            on mount (stored under `wagmi.recentConnectorId`). Disabling it ensures every
            wallet connect begins from the picker UI — the only observable path — so the
            user is never silently redirected away from a freshly-opened picker when the
            last-used wallet is locked or has been closed. Active sessions still reattach
            via the cookie-driven SIWE session above; only the wagmi connector state is
            now opt-in. */}
        <WagmiProvider config={wagmiConfig} reconnectOnMount={false}>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <WalletPickerProvider>
                <ProfileProvider>
                  <TxHistoryProvider>{children}</TxHistoryProvider>
                </ProfileProvider>
              </WalletPickerProvider>
            </AuthProvider>
          </QueryClientProvider>
        </WagmiProvider>
      </MotionConfig>
    </LocaleProvider>
  );
}
