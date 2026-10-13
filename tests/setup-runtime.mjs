import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
const root = await mkdtemp(join(tmpdir(), 'luban-runtime-suite-'));
process.env.LUBAN_DATA_DIR = join(root, 'product');
process.env.LUBAN_PLATFORM_INSTANCE_DIR = join(root, 'instance');
process.env.LUBAN_WORKSPACE_DIR = join(root, 'workspace');
after(async () => {
  const { closePlatformService } = await import('../src/agent/platform-service.js');
  await closePlatformService();
  await rm(root, { recursive: true, force: true });
});
