import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';

/** Kernel-owned local endpoint: process exit releases ownership, no stale lock file. */
export async function acquireInstance(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const canonical = await realpath(directory);
  const digest = createHash('sha256').update(canonical).digest('hex').slice(0, 32);
  // A hash collision is a clear startup error, never permission to share storage.
  const endpoint = { host: '127.0.0.1', port: 20000 + (parseInt(digest.slice(0, 8), 16) % 20000), exclusive: true };
  const server = createServer(socket => socket.end());
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(endpoint, resolve); });
  } catch (cause) {
    const error = new Error('此实例已被其他服务占用，或本机实例端点不可用：' + canonical, { cause });
    error.code = 'instance_in_use'; throw error;
  }
  server.unref();
  return () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
