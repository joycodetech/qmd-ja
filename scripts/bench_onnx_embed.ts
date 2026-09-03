import { OnnxEmbedder } from "../src/llm.ts";

const MODEL_URI = "onnxe:mochiya98/ruri-v3-310m-onnx/q8";

const TEXTS = {
  short:  "IT軍師として経営判断を支援する",
  medium: "非エンジニアのCEOが、AIエージェント時代に意思決定の質を落とさないための仕組みを構築する",
  long:   "Obsidian Vaultに蓄積した6,000件のノートを、Claude CodeのMCPサーバー経由でリアルタイム検索できるようにするためのローカル検索エンジンを、日本語形態素解析と日本語特化の埋め込みモデルで強化した。",
};

async function bench() {
  const embedder = new OnnxEmbedder(MODEL_URI);

  console.log("=== ruri-v3 ONNX q8 ベンチマーク ===\n");

  // Cold start（モデルロード + 初回推論）
  const coldStart = performance.now();
  const firstResult = await embedder.embed(`検索文書: ${TEXTS.short}`);
  const coldMs = performance.now() - coldStart;

  console.log(`[Cold start] ${coldMs.toFixed(0)} ms  (モデルロード + 初回推論込み)`);
  console.log(`  次元数: ${firstResult?.embedding.length}`);

  // Warm 推論
  const N = 20;

  for (const [label, text] of Object.entries(TEXTS)) {
    const times: number[] = [];
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      await embedder.embed(`検索文書: ${text}`);
      times.push(performance.now() - t0);
    }
    const avg = times.reduce((a, b) => a + b, 0) / N;
    const min = Math.min(...times);
    const max = Math.max(...times);
    console.log(`\n[${label} / ${text.length}文字 × ${N}回]`);
    console.log(`  avg: ${avg.toFixed(1)} ms  min: ${min.toFixed(1)} ms  max: ${max.toFixed(1)} ms`);
  }

  // メモリ
  const mem = process.memoryUsage();
  console.log(`\n[メモリ]`);
  console.log(`  RSS:       ${(mem.rss / 1024 / 1024).toFixed(0)} MB`);
  console.log(`  Heap used: ${(mem.heapUsed / 1024 / 1024).toFixed(0)} MB`);

  await embedder.dispose();
  console.log("\n完了");
}

bench().catch(console.error);
