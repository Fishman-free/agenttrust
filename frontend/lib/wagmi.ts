"use client";
import { createConfig, http } from "wagmi";
import { localAnvil } from "./config";

export const wagmiConfig = createConfig({
  chains: [localAnvil],
  transports: { [localAnvil.id]: http("http://127.0.0.1:8545") },
});
