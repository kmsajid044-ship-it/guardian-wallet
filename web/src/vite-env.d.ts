/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AGENT_API_URL?: string;
  readonly VITE_CHAIN_ID?: string;
  /** Local dev only (CLAUDE.md rule 10). Read exclusively via src/owner/demoOwnerKey.ts. */
  readonly VITE_DEMO_OWNER_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
