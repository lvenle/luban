import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BGE_MODEL = 'Xenova/bge-small-zh-v1.5';
export const BGE_REVISION = '75c43b069aac4d136ba6bc1122f995fedcfd2781';
export const BGE_QUERY_PREFIX = '为这个句子生成表示以用于检索相关文章：';
const bundled = fileURLToPath(new URL('../../models/bge-small-zh-v1.5/', import.meta.url));
const extractors = new Map();

async function loadExtractor(options) {
  const { pipeline, env } = await import('@huggingface/transformers');
  if (options.offline && options.model === BGE_MODEL) throw new Error('Local BGE model is not cached; run npm run knowledge:model:prepare while online');
  if (options.host) env.remoteHost = options.host.replace(/\/?$/, '/');
  return pipeline('feature-extraction', options.model, {
    dtype: 'q8', device: 'cpu', revision: BGE_REVISION,
    cache_dir: options.cacheDirectory, local_files_only: options.offline,
    session_options: { intra_op_num_threads: 2, inter_op_num_threads: 1 }
  });
}

/** In-process ONNX inference. Only model assets are downloaded; text stays local. */
export function createLocalEmbedding(env = process.env, loader = loadExtractor) {
  const localDirectory = env.KNOWLEDGE_EMBEDDING_LOCAL_PATH || (existsSync(join(bundled, 'onnx/model_quantized.onnx')) ? bundled : null);
  const model = localDirectory ? resolve(localDirectory) : BGE_MODEL;
  const cacheDirectory = env.KNOWLEDGE_MODEL_CACHE || join(homedir(), '.agent-platform/cache/models');
  const snapshot = join(cacheDirectory, BGE_MODEL, BGE_REVISION);
  const cached = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'].every(file => existsSync(join(snapshot, file)));
  const options = {
    model: localDirectory ? model : cached ? snapshot : model, cacheDirectory,
    offline: Boolean(localDirectory) || cached || env.KNOWLEDGE_EMBEDDING_OFFLINE === '1',
    host: env.KNOWLEDGE_MODEL_HOST
  };
  const key = JSON.stringify(options);
  // Loader injection is for deterministic unit tests; production providers share one lazy session.
  const pool = loader === loadExtractor ? extractors : new Map();
  let queue = Promise.resolve();
  return {
    id: `local:${BGE_MODEL}@${BGE_REVISION}:q8:cls:normalized:query-v1:${localDirectory || 'hub'}:${env.KNOWLEDGE_EMBEDDING_REVISION || '1'}`,
    chunkSize: 320, chunkOverlap: 64,
    async embed(input, { kind = 'document' } = {}) {
      if (!Array.isArray(input) || input.some(text => typeof text !== 'string')) throw new TypeError('Embedding input must be strings');
      if (!input.length) return [];
      const run = queue.catch(() => {}).then(async () => {
        if (!pool.has(key)) {
          const loading = loader(options).catch(error => { pool.delete(key); throw error; });
          pool.set(key, loading);
        }
        const extractor = await pool.get(key);
        const values = [];
        for (let start = 0; start < input.length; start += 4) {
          const texts = input.slice(start, start + 4).map(text => kind === 'query' ? BGE_QUERY_PREFIX + text : text);
          const output = await extractor(texts, { pooling: 'cls', normalize: true, truncation: true, max_length: 512 });
          const rows = output.tolist();
          if (rows.length !== texts.length || rows.some(row => row.length !== 512 || row.some(n => !Number.isFinite(n)))) throw new Error('Invalid BGE embedding output');
          values.push(...rows);
        }
        return values;
      });
      queue = run;
      return run;
    }
  };
}
