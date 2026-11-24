import { createLocalEmbedding } from './local-embedding.js';
import { createHash } from 'node:crypto';
import { chmod, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getLoadablePath } from 'sqlite-vec';

const hash = value => createHash('sha256').update(value).digest('hex');
const queues = new Map();

/** OpenAI-compatible embedding endpoints; deliberately separate from chat credentials. */
export function embeddingFromEnvironment(env = process.env) {
  if (env.KNOWLEDGE_EMBEDDING_MODE === 'keyword') return null;
  if (env.KNOWLEDGE_EMBEDDING_MODE !== 'remote') return createLocalEmbedding(env);
  if (!env.KNOWLEDGE_EMBEDDING_URL || !env.KNOWLEDGE_EMBEDDING_MODEL) throw new Error('Remote embedding requires URL and model');
  const url = env.KNOWLEDGE_EMBEDDING_URL;
  const model = env.KNOWLEDGE_EMBEDDING_MODEL;
  return {
    id: `${url}|${model}|${env.KNOWLEDGE_EMBEDDING_REVISION || '1'}`,
    async embed(input) {
      const response = await fetch(url, {
        method: 'POST', signal: AbortSignal.timeout(30_000),
        headers: { 'Content-Type': 'application/json', ...(env.KNOWLEDGE_EMBEDDING_API_KEY ? { Authorization: `Bearer ${env.KNOWLEDGE_EMBEDDING_API_KEY}` } : {}) },
        body: JSON.stringify({ model, input })
      });
      if (!response.ok) throw new Error(`Knowledge embedding HTTP ${response.status}`);
      const data = (await response.json()).data;
      if (!Array.isArray(data) || data.length !== input.length) throw new Error('Invalid embedding response count');
      const ordered = [...data].sort((a, b) => a.index - b.index);
      if (ordered.some((entry, index) => entry.index !== index)) throw new Error('Invalid embedding response indices');
      return ordered.map(entry => entry.embedding);
    }
  };
}

export function chunkPage(page, size = 1200, overlap = 150) {
  const chunks = [];
  for (let start = 0; start < page.body.length; start += size - overlap) {
    chunks.push({ path: page.path, title: page.title, preview: page.body.slice(start, start + size), text: `${page.title}\n${page.body.slice(start, start + size)}` });
    if (start + size >= page.body.length) break;
  }
  return chunks;
}

function vector(value, dimensions) {
  if (!Array.isArray(value) || !value.length || (dimensions && value.length !== dimensions) ||
      value.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 3.4e38) || !value.some(n => n !== 0)) {
    throw new Error('Invalid embedding vector or dimensions');
  }
  return new Uint8Array(new Float32Array(value).buffer);
}

/** SQLite's native loader cannot read Electron's virtual asar paths. */
export function vectorExtensionPath(path, electron = Boolean(process.versions.electron)) {
  return electron ? path.replace(/\.asar([/\\])/, '.asar.unpacked$1') : path;
}

/** A rebuildable sidecar, keyed by immutable Wiki root + embedding identity. */
export async function vectorSearch(root, pages, query, { embedding, cacheDirectory = process.env.KNOWLEDGE_VECTOR_CACHE || join(homedir(), '.agent-platform/cache/wiki-vectors'), limit = 32, maxDistance = 0.5 }) {
  if (!embedding?.id || typeof embedding.embed !== 'function') throw new Error('Embedding provider requires id and embed');
  const key = join(cacheDirectory, `${hash(`${root}|${embedding.id}|chunks-v2|${embedding.chunkSize || 1200}|${embedding.chunkOverlap ?? 150}`)}.sqlite`);
  const previous = queues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(async () => {
    await mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(key, { allowExtension: true });
    try {
      await chmod(key, 0o600);
      db.loadExtension(vectorExtensionPath(getLoadablePath()));
      db.enableLoadExtension(false);
      db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS chunks(id INTEGER PRIMARY KEY, path TEXT NOT NULL, title TEXT NOT NULL, preview TEXT NOT NULL, fingerprint TEXT NOT NULL); CREATE TABLE IF NOT EXISTS metadata(dimensions INTEGER NOT NULL)');
      const existing = db.prepare('SELECT * FROM chunks').all();
      const byHash = new Map(existing.map(row => [row.fingerprint, row]));
      const chunks = pages.flatMap(page => chunkPage({ ...page, title: page.title.slice(0, 80) }, embedding.chunkSize || 1200, embedding.chunkOverlap ?? 150)).map(chunk => ({ ...chunk, fingerprint: hash(`${chunk.path}|${chunk.text}`) }));
      const fingerprints = new Set(chunks.map(chunk => chunk.fingerprint));
      let dimensions = db.prepare('SELECT dimensions FROM metadata').get()?.dimensions;
      const additions = [];
      const missing = [...new Map(chunks.filter(chunk => !byHash.has(chunk.fingerprint)).map(chunk => [chunk.fingerprint, chunk])).values()];
      for (let i = 0; i < missing.length; i += 32) {
        const batch = missing.slice(i, i + 32);
        const values = await embedding.embed(batch.map(chunk => chunk.text));
        if (!Array.isArray(values) || values.length !== batch.length) throw new Error('Invalid embedding response count');
        batch.forEach((chunk, index) => {
          const bytes = vector(values[index], dimensions);
          dimensions ||= values[index].length;
          additions.push({ ...chunk, bytes });
        });
      }
      if (!dimensions) return [];
      const queries = await embedding.embed([query], { kind: 'query' });
      if (!Array.isArray(queries) || queries.length !== 1) throw new Error('Invalid query embedding count');
      const queryVector = vector(queries[0], dimensions);
      // No network awaits inside the transaction: readers see either complete index generation.
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vectors USING vec0(embedding float[${dimensions}] distance_metric=cosine)`);
        if (!db.prepare('SELECT dimensions FROM metadata').get()) db.prepare('INSERT INTO metadata VALUES (?)').run(dimensions);
        for (const row of existing) if (!fingerprints.has(row.fingerprint)) {
          db.prepare('DELETE FROM vectors WHERE rowid=?').run(BigInt(row.id));
          db.prepare('DELETE FROM chunks WHERE id=?').run(BigInt(row.id));
        }
        for (const chunk of additions) {
          const { lastInsertRowid } = db.prepare('INSERT INTO chunks(path,title,preview,fingerprint) VALUES (?,?,?,?)').run(chunk.path, chunk.title, chunk.preview, chunk.fingerprint);
          db.prepare('INSERT INTO vectors(rowid,embedding) VALUES (?,?)').run(BigInt(lastInsertRowid), chunk.bytes);
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      const rows = db.prepare('SELECT rowid,distance FROM vectors WHERE embedding MATCH ? AND k=? ORDER BY distance').all(queryVector, BigInt(Math.max(1, limit)));
      const results = new Map();
      for (const row of rows) {
        if (row.distance > maxDistance) continue;
        const chunk = db.prepare('SELECT path,title,preview FROM chunks WHERE id=?').get(row.rowid);
        if (chunk && !results.has(chunk.path)) results.set(chunk.path, { ...chunk, distance: row.distance });
      }
      return [...results.values()];
    } finally { db.close(); }
  });
  queues.set(key, current);
  try { return await current; } finally { if (queues.get(key) === current) queues.delete(key); }
}
