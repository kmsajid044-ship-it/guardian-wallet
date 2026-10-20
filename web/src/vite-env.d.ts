/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AGENT_API_URL?: string;
  readonly VITE_CHAIN_ID?: string;
  /** "1" only in the hosted online demo build (hosted/Dockerfile). */
  readonly VITE_DEMO_PUBLIC?: string;
  /** Hosted online demo: where the container runs, shown in the banner (e.g. "an Azure VM"). */
  readonly VITE_DEMO_HOST_LABEL?: string;
  /** Local dev only (CLAUDE.md rule 10). Read exclusively via src/owner/demoOwnerKey.ts. */
  readonly VITE_DEMO_OWNER_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
