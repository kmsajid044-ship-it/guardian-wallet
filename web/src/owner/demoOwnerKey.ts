import type { Hex } from "viem";

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/**
 * DEMO ONLY. Returns the local-dev owner key, or undefined.
 * CLAUDE.md rule 10: read only when import.meta.env.DEV is true. Vite replaces DEV with
 * `false` in production builds, so this branch is removed from the bundle; the build also
 * fails outright if the variable is set (see env-guard.ts). Deployed pages sign owner actions
 * with the injected browser wallet only.
 */
export function getDemoOwnerKey(): Hex | undefined {
  if (!import.meta.env.DEV) return undefined;
  const value = import.meta.env.VITE_DEMO_OWNER_KEY?.trim();
  if (!value) return undefined;
  if (!PRIVATE_KEY_PATTERN.test(value)) {
    throw new Error("VITE_DEMO_OWNER_KEY must be a 0x-prefixed 32-byte hex test key");
  }
  return value as Hex;
}
