/**
 * providers.test.ts — Unit tests for qmd-ja's ONNX provider abstraction layer.
 *
 * src/providers.ts is a qmd-ja addition that routes embedding and reranking
 * requests to either the ONNX backend (@huggingface/transformers) or the
 * default LlamaCpp backend, based on the model URI scheme.
 *
 * These tests cover:
 *   - isOnnxEmbedModel / isOnnxRerankModel URI detection
 *   - getEmbeddingProvider / getRerankProvider provider selection
 *   - shouldUseLlamaCppTokenizerForEmbedding logic
 *
 * No real models are loaded. All tests are pure routing-logic checks.
 *
 * Run with: npx vitest run test/providers.test.ts
 */

import { describe, test, expect } from "vitest";
import { isOnnxEmbedModel, isOnnxRerankModel } from "../src/llm.js";
import {
  getEmbeddingProvider,
  getRerankProvider,
  shouldUseLlamaCppTokenizerForEmbedding,
} from "../src/providers.js";

// =============================================================================
// isOnnxEmbedModel — URI scheme detection
// =============================================================================

describe("isOnnxEmbedModel", () => {
  test("returns true for onnxe: URIs", () => {
    expect(isOnnxEmbedModel("onnxe:mochiya98/ruri-v3-310m-onnx/q8")).toBe(true);
    expect(isOnnxEmbedModel("onnxe:some-org/some-model/fp32")).toBe(true);
    expect(isOnnxEmbedModel("onnxe:model-only")).toBe(true);
  });

  test("returns false for non-onnxe URIs", () => {
    expect(isOnnxEmbedModel("hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf")).toBe(false);
    expect(isOnnxEmbedModel("onnx:hotchpotch/japanese-reranker-xsmall-v2/model_qint8_avx2")).toBe(false);
    expect(isOnnxEmbedModel("")).toBe(false);
    expect(isOnnxEmbedModel("gguf:some/model")).toBe(false);
  });

  test("is case-sensitive — ONNXE: does not match", () => {
    expect(isOnnxEmbedModel("ONNXE:mochiya98/ruri-v3-310m-onnx/q8")).toBe(false);
  });
});

// =============================================================================
// isOnnxRerankModel — URI scheme detection
// =============================================================================

describe("isOnnxRerankModel", () => {
  test("returns true for onnx: URIs", () => {
    expect(isOnnxRerankModel("onnx:hotchpotch/japanese-reranker-xsmall-v2/model_qint8_avx2")).toBe(true);
    expect(isOnnxRerankModel("onnx:some-org/some-reranker/model")).toBe(true);
    expect(isOnnxRerankModel("onnx:model-only")).toBe(true);
  });

  test("returns false for non-onnx URIs", () => {
    expect(isOnnxRerankModel("hf:ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF/qwen3-reranker-0.6b-q8_0.gguf")).toBe(false);
    expect(isOnnxRerankModel("onnxe:mochiya98/ruri-v3-310m-onnx/q8")).toBe(false);
    expect(isOnnxRerankModel("")).toBe(false);
  });

  test("is case-sensitive — ONNX: does not match", () => {
    expect(isOnnxRerankModel("ONNX:hotchpotch/japanese-reranker-xsmall-v2/model")).toBe(false);
  });
});

// =============================================================================
// getEmbeddingProvider — provider selection
// =============================================================================

describe("getEmbeddingProvider", () => {
  test("returns an object with embed and embedBatch for onnxe: URI", () => {
    const provider = getEmbeddingProvider("onnxe:mochiya98/ruri-v3-310m-onnx/q8");
    expect(typeof provider.embed).toBe("function");
    expect(typeof provider.embedBatch).toBe("function");
  });

  test("returns an object with embed and embedBatch for hf: URI", () => {
    const provider = getEmbeddingProvider("hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf");
    expect(typeof provider.embed).toBe("function");
    expect(typeof provider.embedBatch).toBe("function");
  });

  test("onnxe: and hf: return different provider instances", () => {
    const onnx = getEmbeddingProvider("onnxe:mochiya98/ruri-v3-310m-onnx/q8");
    const gguf = getEmbeddingProvider("hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf");
    // Different constructors — not the same object
    expect(onnx).not.toBe(gguf);
  });

  test("same onnxe: URI returns consistent provider interface", () => {
    const uri = "onnxe:mochiya98/ruri-v3-310m-onnx/q8";
    const a = getEmbeddingProvider(uri);
    const b = getEmbeddingProvider(uri);
    expect(typeof a.embed).toBe("function");
    expect(typeof b.embed).toBe("function");
  });
});

// =============================================================================
// getRerankProvider — provider selection
// =============================================================================

describe("getRerankProvider", () => {
  test("returns an object with rerank for onnx: URI", () => {
    const provider = getRerankProvider("onnx:hotchpotch/japanese-reranker-xsmall-v2/model_qint8_avx2");
    expect(typeof provider.rerank).toBe("function");
  });

  test("returns an object with rerank for hf: URI", () => {
    const provider = getRerankProvider("hf:ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF/qwen3-reranker-0.6b-q8_0.gguf");
    expect(typeof provider.rerank).toBe("function");
  });

  test("onnx: and hf: return different provider instances", () => {
    const onnx = getRerankProvider("onnx:hotchpotch/japanese-reranker-xsmall-v2/model_qint8_avx2");
    const gguf = getRerankProvider("hf:ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF/qwen3-reranker-0.6b-q8_0.gguf");
    expect(onnx).not.toBe(gguf);
  });
});

// =============================================================================
// shouldUseLlamaCppTokenizerForEmbedding — tokenizer routing
// =============================================================================

describe("shouldUseLlamaCppTokenizerForEmbedding", () => {
  test("returns false for onnxe: URIs (ONNX does not need llama.cpp tokenizer)", () => {
    expect(shouldUseLlamaCppTokenizerForEmbedding("onnxe:mochiya98/ruri-v3-310m-onnx/q8")).toBe(false);
    expect(shouldUseLlamaCppTokenizerForEmbedding("onnxe:some-org/some-model/fp16")).toBe(false);
  });

  test("returns true for hf: URIs (llama.cpp tokenizer required)", () => {
    expect(
      shouldUseLlamaCppTokenizerForEmbedding(
        "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf"
      )
    ).toBe(true);
  });

  test("returns true for onnx: rerank URIs (not an embed URI)", () => {
    // onnx: is for reranking, not embedding — should fall back to llama.cpp tokenizer
    expect(
      shouldUseLlamaCppTokenizerForEmbedding(
        "onnx:hotchpotch/japanese-reranker-xsmall-v2/model_qint8_avx2"
      )
    ).toBe(true);
  });
});
