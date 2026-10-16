export type Deployment = {
  network: string;
  chainId: number;
  deployedAt: number;
  guardianWallet: `0x${string}`;
  demoLedger: `0x${string}`;
  owner: `0x${string}`;
  agent: `0x${string}`;
  guardian: `0x${string}`;
  feeAccount: `0x${string}`;
};

export async function loadDeployment(network = import.meta.env.VITE_NETWORK ?? "local"): Promise<Deployment> {
  const response = await fetch(`/${network}.json`, { cache: "no-store" });
  if (!response.ok) throw new Error(`deployment manifest unavailable: ${response.status}`);
  return (await response.json()) as Deployment;
}
