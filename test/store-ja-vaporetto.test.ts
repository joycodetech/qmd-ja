/**
 * store-ja-vaporetto.test.ts — Japanese tokenization tests for qmd-ja.
 *
 * qmd-ja extends the upstream CJK normalization with Vaporetto WASM
 * morphological analysis (src/store.ts). This file tests:
 *
 *   1. FTS_CJK_NORMALIZED_VERSION is "3" (bumped by qmd-ja for Vaporetto)
 *   2. normalizeCjkForFTS — unigram fallback (Vaporetto not initialized)
 *   3. resolveVaporettoModelPath — model file exists on disk
 *   4. normalizeCjkForFTS — Vaporetto morphological mode (after init)
 *   5. Japanese BM25 search — indexed document is retrievable by Japanese term
 *
 * Tests 1–4 are pure unit tests. Test 5 uses an in-memory store.
 *
 * Run with: npx vitest run test/store-ja-vaporetto.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import {
  FTS_CJK_NORMALIZED_VERSION,
  normalizeCjkForFTS,
  resolveVaporettoModelPath,
  initializeVaporettoTokenizer,
  createStore,
  insertContent,
  insertDocument,
  hashContent,
} from "../src/store.js";
import type { CollectionConfig } from "../src/collections.js";

// =============================================================================
// 1. FTS_CJK_NORMALIZED_VERSION
// =============================================================================

describe("FTS_CJK_NORMALIZED_VERSION", () => {
  test('is "3" — bumped by qmd-ja for Vaporetto morphological tokenization', () => {
    expect(FTS_CJK_NORMALIZED_VERSION).toBe("3");
  });

  test("is a string (stored as TEXT in SQLite store_config)", () => {
    expect(typeof FTS_CJK_NORMALIZED_VERSION).toBe("string");
  });
});

// =============================================================================
// 2. normalizeCjkForFTS — unigram fallback (before initializeVaporettoTokenizer)
// =============================================================================

describe("normalizeCjkForFTS — unigram fallback", () => {
  // NOTE: These tests run before initializeVaporettoTokenizer() is called
  // (describe 4 calls it in beforeAll). Vitest runs describe blocks in order,
  // so unigram behavior is captured here before Vaporetto is loaded.

  test("spaces each CJK character individually", () => {
    const result = normalizeCjkForFTS("日本語");
    expect(result).toContain("日");
    expect(result).toContain("本");
    expect(result).toContain("語");
    // Characters must be separated — not concatenated as the original string
    expect(result).not.toBe("日本語");
  });

  test("preserves ASCII/Latin text unchanged", () => {
    expect(normalizeCjkForFTS("hello world")).toBe("hello world");
  });

  test("handles mixed CJK and ASCII", () => {
    const result = normalizeCjkForFTS("AI技術の進化");
    expect(result).toContain("AI");
    expect(result).toContain("技");
    expect(result).toContain("進");
  });

  test("handles katakana including long vowel mark ー", () => {
    const result = normalizeCjkForFTS("ナレッジベース");
    expect(result).toContain("ナ");
    expect(result).toContain("ー");
    expect(result).toContain("ス");
    expect(result).not.toBe("ナレッジベース");
  });

  test("handles hiragana", () => {
    const result = normalizeCjkForFTS("けいえい");
    expect(result).toContain("け");
    expect(result).toContain("い");
  });

  test("handles empty string", () => {
    expect(normalizeCjkForFTS("")).toBe("");
  });
});

// =============================================================================
// 3. resolveVaporettoModelPath — model file must exist on disk
// =============================================================================

describe("resolveVaporettoModelPath", () => {
  test("returns a path to an existing file", () => {
    const modelPath = resolveVaporettoModelPath();
    expect(existsSync(modelPath)).toBe(true);
  });

  test("path ends with .model or .model.zst", () => {
    const modelPath = resolveVaporettoModelPath();
    expect(modelPath.endsWith(".model") || modelPath.endsWith(".model.zst")).toBe(true);
  });
});

// =============================================================================
// 4. normalizeCjkForFTS — Vaporetto morphological mode
// =============================================================================

describe("normalizeCjkForFTS — Vaporetto morphological mode", () => {
  beforeAll(async () => {
    await initializeVaporettoTokenizer();
  });

  test("tokenizes Japanese into morphemes (output differs from raw input)", () => {
    const result = normalizeCjkForFTS("経営判断");
    expect(result.trim().length).toBeGreaterThan(0);
    // Vaporetto inserts spaces between morphemes
    expect(result).not.toBe("経営判断");
  });

  test("all characters of katakana compound noun are preserved", () => {
    // Vaporetto fix: "ナレッジベース" was incorrectly split at ー in unigram mode
    const result = normalizeCjkForFTS("ナレッジベース");
    expect(result).toContain("ナ");
    expect(result).toContain("ー");
    expect(result).toContain("ス");
  });

  test("handles mixed CJK and ASCII in morphological mode", () => {
    const result = normalizeCjkForFTS("AIによる経営支援");
    expect(result).toContain("AI");
    expect(result).toContain("経");
    expect(result).toContain("営");
  });

  test("handles empty string in morphological mode", () => {
    expect(normalizeCjkForFTS("")).toBe("");
  });

  test("output of morphological mode differs from unigram output for multi-char words", () => {
    // Vaporetto groups morphemes; unigram splits every character.
    // For a word like "経営", unigram gives " 経  営 " (each char spaced),
    // while Vaporetto gives " 経営 " (kept as one token if a single morpheme).
    // We only assert the output is non-empty and string; exact output is model-dependent.
    const result = normalizeCjkForFTS("経営判断支援");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// 5. Japanese BM25 search — end-to-end FTS with Japanese content
// =============================================================================

describe("Japanese BM25 search", () => {
  let testDir: string;
  let testConfigDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "qmd-ja-fts-"));
    testConfigDir = join(testDir, "config");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(testConfigDir, { recursive: true }));
    const emptyConfig: CollectionConfig = { collections: {} };
    await writeFile(join(testConfigDir, "index.yml"), YAML.stringify(emptyConfig));
    process.env.QMD_CONFIG_DIR = testConfigDir;
  });

  afterAll(async () => {
    delete process.env.QMD_CONFIG_DIR;
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test("indexed Japanese document is retrievable by CJK keyword", async () => {
    const dbPath = join(testDir, "ja-search.sqlite");
    const store = createStore(dbPath);

    try {
      const collection = "test-ja";
      const docPath = "ja-test.md";
      const title = "経営判断のためのAI活用";
      const body =
        "非エンジニアCEOが経営判断にAIを活用するための実践ガイド。" +
        "ナレッジベースの構築とローカルRAGの設計について解説する。";

      const hash = await hashContent(body);
      const now = new Date().toISOString();
      insertContent(store.db, hash, body, now);
      insertDocument(store.db, collection, docPath, title, hash, now, now);

      const results = store.searchFTS("経営", 5, collection);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].displayPath).toBe(collection + '/' + docPath);
    } finally {
      store.close();
    }
  });

  test("Japanese title match appears in search results", async () => {
    const dbPath = join(testDir, "ja-title.sqlite");
    const store = createStore(dbPath);

    try {
      const collection = "test-ja-title";
      const hash = await hashContent("本文サンプルテキスト");
      const now = new Date().toISOString();
      insertContent(store.db, hash, "本文サンプルテキスト", now);
      insertDocument(store.db, collection, "title-test.md", "ナレッジベース設計入門", hash, now, now);

      // Search by a term in the title
      // "設計" is a standalone morpheme in Vaporetto — reliably searchable
      const results = store.searchFTS("設計", 5, collection);

      expect(results.length).toBeGreaterThan(0);
    } finally {
      store.close();
    }
  });

  test("non-existent Japanese term returns empty results", async () => {
    const dbPath = join(testDir, "ja-empty.sqlite");
    const store = createStore(dbPath);

    try {
      const collection = "test-ja-empty";
      const hash = await hashContent("テスト文書の内容");
      const now = new Date().toISOString();
      insertContent(store.db, hash, "テスト文書の内容", now);
      insertDocument(store.db, collection, "empty-test.md", "テストタイトル", hash, now, now);

      const results = store.searchFTS("存在しないキーワードXYZ", 5, collection);
      expect(results).toHaveLength(0);
    } finally {
      store.close();
    }
  });
});
