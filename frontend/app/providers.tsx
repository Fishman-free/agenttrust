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
        <WagmiProvider config={wagmiConfig}>
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
