import { afterEach, describe, expect, test } from "vitest";
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const fixtures: string[] = [];

function makeTempFixture() {
  const root = mkdtempSync(join(tmpdir(), "qmd-bin-wrapper-"));
  fixtures.push(root);
  const capturePath = join(root, "capture.txt");
  const runtimeBin = join(root, "runtime-bin");
  mkdirSync(runtimeBin, { recursive: true });

  for (const runtime of ["node", "bun"]) {
    const runtimePath = join(runtimeBin, runtime);
    writeFileSync(
      runtimePath,
      `#!/bin/sh\n{\n  printf '%s\\n' '${runtime}'\n  printf '%s\\n' "$1"\n  shift\n  printf '%s\\n' "$@"\n} > "$QMD_WRAPPER_CAPTURE"\n`,
    );
    chmodSync(runtimePath, 0o755);
  }

  return { root, capturePath, runtimeBin };
}

function makePackage(root: string, packagePath: string, lockfiles: string[] = []) {
  const packageRoot = join(root, packagePath);
  mkdirSync(join(packageRoot, "bin"), { recursive: true });
  mkdirSync(join(packageRoot, "dist", "cli"), { recursive: true });
  copyFileSync(join(repoRoot, "bin", "qmd"), join(packageRoot, "bin", "qmd"));
  chmodSync(join(packageRoot, "bin", "qmd"), 0o755);
  writeFileSync(join(packageRoot, "dist", "cli", "qmd.js"), "// fixture\n");
  for (const lockfile of lockfiles) {
    writeFileSync(join(packageRoot, lockfile), "");
  }
  return packageRoot;
}

function symlinkRelative(target: string, linkPath: string) {
  mkdirSync(dirname(linkPath), { recursive: true });
  symlinkSync(relative(dirname(linkPath), target), linkPath);
}

function runWrapper(commandPath: string, runtimeBin: string, capturePath: string, env: Record<string, string> = {}) {
  rmSync(capturePath, { force: true });
  execFileSync(commandPath, ["--version"], {
    env: {
      ...process.env,
      ...env,
      PATH: `${runtimeBin}:${process.env.PATH ?? ""}`,
      QMD_WRAPPER_CAPTURE: capturePath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [runtime, scriptPath, ...args] = readFileSync(capturePath, "utf8").trimEnd().split("\n");
  return { runtime, scriptPath, args };
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

describe("bin/qmd package wrapper", () => {
  test("direct package invocation resolves dist/cli/qmd.js from the package root", () => {
    const { root, runtimeBin, capturePath } = makeTempFixture();
    const packageRoot = makePackage(root, "node_modules/@tobilu/qmd");

    const result = runWrapper(join(packageRoot, "bin", "qmd"), runtimeBin, capturePath);

    expect(result.runtime).toBe("node");
    expect(result.scriptPath).toBe(realpathSync(join(packageRoot, "dist", "cli", "qmd.js")));
    expect(result.args).toEqual(["--version"]);
  });

  test("npm/Homebrew global bin symlink resolves scoped package path", () => {
    const { root, runtimeBin, capturePath } = makeTempFixture();
    const packageRoot = makePackage(root, "opt/homebrew/lib/node_modules/@tobilu/qmd");
    const globalBin = join(root, "opt", "homebrew", "bin", "qmd");
    symlinkRelative(join(packageRoot, "bin", "qmd"), globalBin);

    const result = runWrapper(globalBin, runtimeBin, capturePath);

    expect(result.runtime).toBe("node");
    expect(result.scriptPath).toBe(realpathSync(join(packageRoot, "dist", "cli", "qmd.js")));
  });

  test("multi-hop global bin symlink chain resolves to the real package root", () => {
    const { root, runtimeBin, capturePath } = makeTempFixture();
    const packageRoot = makePackage(root, "opt/homebrew/lib/node_modules/@tobilu/qmd");
    const globalBin = join(root, "opt", "homebrew", "bin", "qmd");
    const shim = join(root, "opt", "homebrew", "Cellar", "qmd", "current", "bin", "qmd");
    symlinkRelative(join(packageRoot, "bin", "qmd"), shim);
    symlinkRelative(shim, globalBin);

    const result = runWrapper(globalBin, runtimeBin, capturePath);

    expect(result.runtime).toBe("node");
    expect(result.scriptPath).toBe(realpathSync(join(packageRoot, "dist", "cli", "qmd.js")));
  });

  test("linuxbrew global bin symlink resolves lib/node_modules scoped package path", () => {
    const { root, runtimeBin, capturePath } = makeTempFixture();
    const packageRoot = makePackage(root, "home/linuxbrew/.linuxbrew/lib/node_modules/@tobilu/qmd");
    const globalBin = join(root, "home", "linuxbrew", ".linuxbrew", "bin", "qmd");
    symlinkRelative(join(packageRoot, "bin", "qmd"), globalBin);

    const result = runWrapper(globalBin, runtimeBin, capturePath);

    expect(result.runtime).toBe("node");
    expect(result.scriptPath).toBe(realpathSync(join(packageRoot, "dist", "cli", "qmd.js")));
  });

  test("npx scoped package .bin symlink resolves @tobilu/qmd package path", () => {
    const { root, runtimeBin, capturePath } = makeTempFixture();
    const packageRoot = makePackage(root, "npm/_npx/abc123/node_modules/@tobilu/qmd");
    const npxBin = join(root, "npm", "_npx", "abc123", "node_modules", ".bin", "qmd");
    symlinkRelative(join(packageRoot, "bin", "qmd"), npxBin);

    const result = runWrapper(npxBin, runtimeBin, capturePath);

    expect(result.runtime).toBe("node");
    expect(result.scriptPath).toBe(realpathSync(join(packageRoot, "dist", "cli", "qmd.js")));
  });

  test("bun global symlink uses bun when package-local bun lockfile exists", () => {
    const { root, runtimeBin, capturePath } = makeTempFixture();
    const packageRoot = makePackage(root, "home/user/.bun/install/global/node_modules/@tobilu/qmd", ["bun.lock"]);
    const bunBin = join(root, "home", "user", ".bun", "bin", "qmd");
    symlinkRelative(join(packageRoot, "bin", "qmd"), bunBin);

    const result = runWrapper(bunBin, runtimeBin, capturePath);

    expect(result.runtime).toBe("bun");
    expect(result.scriptPath).toBe(realpathSync(join(packageRoot, "dist", "cli", "qmd.js")));
  });

  test("ambient BUN_INSTALL alone does not select bun for an npm-installed package", () => {
    const { root, runtimeBin, capturePath } = makeTempFixture();
    const packageRoot = makePackage(root, "opt/homebrew/lib/node_modules/@tobilu/qmd");
    const globalBin = join(root, "opt", "homebrew", "bin", "qmd");
    symlinkRelative(join(packageRoot, "bin", "qmd"), globalBin);

    const result = runWrapper(globalBin, runtimeBin, capturePath, { BUN_INSTALL: join(root, ".bun") });

    expect(result.runtime).toBe("node");
    expect(result.scriptPath).toBe(realpathSync(join(packageRoot, "dist", "cli", "qmd.js")));
  });

  test("package-lock.json takes priority over bun lockfiles", () => {
    const { root, runtimeBin, capturePath } = makeTempFixture();
    const packageRoot = makePackage(root, "node_modules/@tobilu/qmd", ["package-lock.json", "bun.lock"]);

    const result = runWrapper(join(packageRoot, "bin", "qmd"), runtimeBin, capturePath);

    expect(result.runtime).toBe("node");
    expect(result.scriptPath).toBe(realpathSync(join(packageRoot, "dist", "cli", "qmd.js")));
  });
});
