// CLAUDE.md security rule 10: VITE_DEMO_OWNER_KEY is local-dev only.
// A production build must fail if it is set, so the key can never ship in a deployed bundle.

export const DEMO_OWNER_KEY_VAR = "VITE_DEMO_OWNER_KEY";

export function assertNoDemoKeyInBuild(command: "build" | "serve", env: Record<string, string | undefined>): void {
  if (command !== "build") return;
  const value = env[DEMO_OWNER_KEY_VAR];
  if (value !== undefined && value.trim() !== "") {
    throw new Error(
      `${DEMO_OWNER_KEY_VAR} is set. Refusing to build: the demo owner key must never ship in a bundle ` +
        `(CLAUDE.md rule 10). Unset it in .env / the shell environment and sign with a browser wallet.`,
    );
  }
}
