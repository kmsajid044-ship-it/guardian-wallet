import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("agent key boundary", () => {
  it("never reads AGENT_PRIVATE_KEY outside src/exec", () => {
    const violations = files(sourceRoot).filter(
      (path) => !path.includes("/exec/") && readFileSync(path, "utf8").includes("AGENT_PRIVATE_KEY"),
    );
    expect(violations).toEqual([]);
  });
});
