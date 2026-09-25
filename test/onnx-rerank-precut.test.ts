import { describe, test, expect } from "vitest";
import { encodeRerankPair, ONNX_RERANK_PRECUT_CHARS } from "../src/llm.js";

// Fake tokenizer: `charsPerToken` chars → 1 token, truncated at max_length.
function fakeTokenizer(charsPerToken: number) {
  const calls: string[] = [];
  const tok = (query: string, opts: { text_pair: string; max_length: number }) => {
    calls.push(opts.text_pair);
    const n = Math.min(opts.max_length, Math.ceil((query.length + opts.text_pair.length) / charsPerToken));
    return { input_ids: { dims: [1, n] }, text_pair: opts.text_pair };
  };
  return { tok, calls };
}

describe("encodeRerankPair", () => {
  test("long, token-dense text is tokenized from the precut prefix only", () => {
    const { tok, calls } = fakeTokenizer(2);
    const text = "あ".repeat(3000);
    const enc = encodeRerankPair(tok, "q", text);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(ONNX_RERANK_PRECUT_CHARS);
    expect(enc.input_ids.dims.at(-1)).toBe(512);
  });

  test("falls back to the full text when the prefix does not fill the window", () => {
    const { tok, calls } = fakeTokenizer(5); // 1500 chars → 301 tokens < 512
    const text = "a".repeat(3000);
    const enc = encodeRerankPair(tok, "q", text);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(text);
    expect(enc.text_pair).toBe(text);
  });

  test("short text is tokenized once without cutting", () => {
    const { tok, calls } = fakeTokenizer(2);
    const text = "い".repeat(800);
    encodeRerankPair(tok, "q", text);
    expect(calls).toEqual([text]);
  });
});
