#!/usr/bin/env node
/**
 * bench-ja.mjs — Vaporetto WASM vs kuromoji Japanese tokenization benchmark
 *
 * Usage:
 *   node bench-ja.mjs
 *
 * Tests:
 *   - Initialization time
 *   - Throughput (µs/call) for short and long Japanese strings
 *   - Tokenization quality samples
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const RUNS = 500;

const testCases = [
  "プロンプトコンパイラとは何ですか",
  "機械学習モデルのファインチューニングとプロンプト最適化の手法についてわかりやすく解説します",
  "ナレッジベースとDSPyの最適化手法について",
  "ナレッジベース",
  "プロンプトコンパイラ",
  "最適化",
];

const shortText = "プロンプトコンパイラとは何ですか";
const longText = "機械学習モデルのファインチューニングとプロンプト最適化の手法についてわかりやすく解説します";

// ============================================================
// 1. Vaporetto WASM benchmark
// ============================================================
console.log("=".repeat(60));
console.log("Vaporetto WASM Benchmark");
console.log("=".repeat(60));

const wasmPath = join(__dirname, "vendor", "vaporetto-node-wasm", "vaporetto_node_wasm.js");
const { VaporettoTokenizer } = require(wasmPath);

// Try models in order of preference
const models = [
  { name: "bccwj-suw_c0.003 (lightweight)", path: join(__dirname, "models", "vaporetto-bccwj.model") },
  { name: "bccwj-suw+unidic_pos+pron (UniDic)", path: join(__dirname, "models", "vaporetto-bccwj.model.zst") },
];

for (const { name, path } of models) {
  if (!existsSync(path)) {
    console.log(`\n[SKIP] Model not found: ${path}`);
    continue;
  }

  console.log(`\n--- Model: ${name} ---`);
  const modelData = readFileSync(path);
  console.log(`Model size: ${(modelData.length / 1024).toFixed(1)} KB`);

  const t0 = performance.now();
  const vap = new VaporettoTokenizer(modelData);
  const initMs = (performance.now() - t0).toFixed(1);
  console.log(`Init time: ${initMs} ms`);

  console.log("\n分かち書きサンプル:");
  for (const text of testCases) {
    const result = vap.tokenize(text);
    console.log(`  ${text}`);
    console.log(`  → ${result}`);
  }

  let start = performance.now();
  for (let i = 0; i < RUNS; i++) vap.tokenize(shortText);
  const shortUs = ((performance.now() - start) / RUNS * 1000).toFixed(1);

  start = performance.now();
  for (let i = 0; i < RUNS; i++) vap.tokenize(longText);
  const longUs = ((performance.now() - start) / RUNS * 1000).toFixed(1);

  console.log(`\nPerformance (${RUNS} runs):`);
  console.log(`  短文 (${shortText.length}文字): ${shortUs} µs/回`);
  console.log(`  長文 (${longText.length}文字): ${longUs} µs/回`);
}

// ============================================================
// 2. Kuromoji benchmark (for comparison)
// ============================================================
console.log("\n" + "=".repeat(60));
console.log("Kuromoji Benchmark (for comparison)");
console.log("=".repeat(60));

try {
  const kuromoji = require("kuromoji");
  const dicPath = dirname(dirname(require.resolve("kuromoji"))) + "/dict";

  const t0 = performance.now();
  const kuroTokenizer = await new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath }).build((err, tokenizer) => {
      if (err) reject(err);
      else resolve(tokenizer);
    });
  });
  const initMs = (performance.now() - t0).toFixed(1);
  console.log(`\nInit time: ${initMs} ms`);

  console.log("\n分かち書きサンプル:");
  for (const text of testCases) {
    const tokens = kuroTokenizer.tokenize(text);
    const result = tokens.map(t => t.surface_form).join(" ");
    console.log(`  ${text}`);
    console.log(`  → ${result}`);
  }

  let start = performance.now();
  for (let i = 0; i < RUNS; i++) kuroTokenizer.tokenize(shortText);
  const shortUs = ((performance.now() - start) / RUNS * 1000).toFixed(1);

  start = performance.now();
  for (let i = 0; i < RUNS; i++) kuroTokenizer.tokenize(longText);
  const longUs = ((performance.now() - start) / RUNS * 1000).toFixed(1);

  console.log(`\nPerformance (${RUNS} runs):`);
  console.log(`  短文 (${shortText.length}文字): ${shortUs} µs/回`);
  console.log(`  長文 (${longText.length}文字): ${longUs} µs/回`);
} catch (e) {
  console.log(`[SKIP] kuromoji not available: ${e.message}`);
}

// ============================================================
// 3. Summary
// ============================================================
console.log("\n" + "=".repeat(60));
console.log("Note: kuromoji baseline (from previous measurement):");
console.log("  短文: ~79.5 µs/回");
console.log("  長文: ~403 µs/回");
console.log("=".repeat(60));
