import { createPublicClient, defineChain, getAddress, http, type Chain, type PublicClient, type Transport } from "viem";
import type { Config, Deployment } from "../config.js";

export type ChainClients = {
  publicClient: PublicClient<Transport, Chain>;
  walletAddress: `0x${string}`;
  deployment: Deployment;
};

export function createChainClients(config: Config, deployment: Deployment): ChainClients {
  const chain = defineChain({
    id: config.CHAIN_ID,
    name: deployment.network,
    nativeCurrency: { name: "Local execution unit", symbol: "LEU", decimals: 18 },
    rpcUrls: { default: { http: [config.RPC_URL] } },
  });
  return {
    publicClient: createPublicClient({ chain, transport: http(config.RPC_URL) }),
    walletAddress: getAddress(deployment.guardianWallet),
    deployment,
  };
}
