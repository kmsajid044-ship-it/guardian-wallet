import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    // Compiled output of `pnpm build` must never be collected as tests.
    exclude: [...configDefaults.exclude, "dist/**"],
  },
});
