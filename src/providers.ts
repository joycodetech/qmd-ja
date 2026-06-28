import {
  getDefaultLlamaCpp,
  isOnnxEmbedModel,
  isOnnxRerankModel,
  OnnxEmbedder,
  OnnxReranker,
  type EmbedOptions,
  type EmbeddingResult,
  type ILLMSession,
  type LlamaCpp,
  type RerankDocument,
  type RerankOptions,
  type RerankResult,
} from "./llm.js";

export interface EmbeddingProvider {
  embed(text: string, options?: EmbedOptions): Promise<EmbeddingResult | null>;
  embedBatch(texts: string[], options?: EmbedOptions): Promise<(EmbeddingResult | null)[]>;
}

export interface RerankProvider {
  rerank(query: string, documents: RerankDocument[], options?: RerankOptions): Promise<RerankResult>;
}

type EmbeddingClient = Pick<ILLMSession, "embed" | "embedBatch"> | Pick<LlamaCpp, "embed" | "embedBatch">;
type RerankClient = Pick<ILLMSession, "rerank"> | Pick<LlamaCpp, "rerank">;

const onnxEmbedders = new Map<string, OnnxEmbedder>();
const onnxRerankers = new Map<string, OnnxReranker>();

function getOnnxEmbedder(modelUri: string): OnnxEmbedder {
  let embedder = onnxEmbedders.get(modelUri);
  if (!embedder) {
    embedder = new OnnxEmbedder(modelUri);
    onnxEmbedders.set(modelUri, embedder);
  }
  return embedder;
}

function getOnnxReranker(modelUri: string): OnnxReranker {
  let reranker = onnxRerankers.get(modelUri);
  if (!reranker) {
    reranker = new OnnxReranker(modelUri);
    onnxRerankers.set(modelUri, reranker);
  }
  return reranker;
}

class LlamaCppEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly client?: EmbeddingClient) {}

  async embed(text: string, options?: EmbedOptions): Promise<EmbeddingResult | null> {
    return (this.client ?? getDefaultLlamaCpp()).embed(text, options);
  }

  async embedBatch(texts: string[], options?: EmbedOptions): Promise<(EmbeddingResult | null)[]> {
    return (this.client ?? getDefaultLlamaCpp()).embedBatch(texts, options);
  }
}

class OnnxEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly modelUri: string) {}

  async embed(text: string): Promise<EmbeddingResult | null> {
    return getOnnxEmbedder(this.modelUri).embed(text);
  }

  async embedBatch(texts: string[]): Promise<(EmbeddingResult | null)[]> {
    const embedder = getOnnxEmbedder(this.modelUri);
    return Promise.all(texts.map((text) => embedder.embed(text)));
  }
}

class LlamaCppRerankProvider implements RerankProvider {
  constructor(private readonly client?: RerankClient) {}

  async rerank(query: string, documents: RerankDocument[], options?: RerankOptions): Promise<RerankResult> {
    return (this.client ?? getDefaultLlamaCpp()).rerank(query, documents, options);
  }
}

class OnnxRerankProvider implements RerankProvider {
  constructor(private readonly modelUri: string) {}

  async rerank(query: string, documents: RerankDocument[]): Promise<RerankResult> {
    return getOnnxReranker(this.modelUri).rerank(query, documents);
  }
}

export function getEmbeddingProvider(modelUri: string, session?: ILLMSession | LlamaCpp): EmbeddingProvider {
  return isOnnxEmbedModel(modelUri) ? new OnnxEmbeddingProvider(modelUri) : new LlamaCppEmbeddingProvider(session);
}

export function getRerankProvider(modelUri: string, session?: ILLMSession | LlamaCpp): RerankProvider {
  return isOnnxRerankModel(modelUri) ? new OnnxRerankProvider(modelUri) : new LlamaCppRerankProvider(session);
}
