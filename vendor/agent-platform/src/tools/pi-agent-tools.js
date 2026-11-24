import { createCodingTools } from '@earendil-works/pi-coding-agent';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const mutations = new Set(['bash', 'edit', 'write']);
const TOOL_IDS = { read: 'workspace.read_file', bash: 'runtime.exec', edit: 'workspace.edit_file', write: 'workspace.write_file' };

function within(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

async function assertWorkspacePath(root, value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Workspace file path must be a non-empty string');
  const target = resolve(root, value);
  if (!within(root, target)) throw new Error(`Workspace tool path is outside the configured workspace: ${value}`);

  // Resolve an existing target, or its nearest existing parent, so symlinks cannot
  // make an apparently in-root path escape the workspace.
  let probe = target;
  while (true) {
    try {
      await lstat(probe);
      const actual = await realpath(probe);
      if (!within(root, actual)) throw new Error(`Workspace tool path resolves outside the configured workspace: ${value}`);
      return;
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
      const parent = dirname(probe);
      if (parent === probe) throw new Error(`Unable to resolve workspace tool path: ${value}`);
      probe = parent;
    }
  }
}

/** Create portable workspace/command capabilities, implemented by the configured coding runtime. */
export async function createWorkspaceTools({ workspaceRoot }) {
  const root = await realpath(resolve(workspaceRoot));
  // The platform owns Runs independently of the underlying coding runtime's sessions.
  const nativeTools = createCodingTools(root, { bash: { exposeSessionEnvironment: false } });
  return nativeTools.map(native => {
    const name = TOOL_IDS[native.name];
    return {
      name,
      label: native.label,
      description: `${native.description}\n当前工作区根目录：${JSON.stringify(root)}。相对路径以此目录为基准。`,
      inputSchema: structuredClone(native.parameters),
      ...(native.outputSchema ? { outputSchema: structuredClone(native.outputSchema) } : {}),
      risk: mutations.has(native.name) ? 'write' : 'read',
      requiresConfirmation: mutations.has(native.name),
      idempotent: false,
      timeoutMs: native.name === 'bash' ? 120_000 : 30_000,
      source: 'platform',
      provider: 'coding-runtime',
      enabled: true,
      execute: async (input, { callId, signal }) => {
        if (native.name !== 'bash') await assertWorkspacePath(root, input.path);
        const result = await native.execute(callId, input, signal, undefined, { cwd: root });
        const text = result?.content?.filter(item => item.type === 'text').map(item => item.text).join('\n');
        return text ? { text, ...(result.details ? { details: result.details } : {}) } : result;
      }
    };
  });
}

/** Backwards-compatible export for internal integrations; emitted tool IDs are provider-neutral. */
export const createPiAgentTools = createWorkspaceTools;

export const WORKSPACE_TOOL_IDS = Object.freeze(Object.values(TOOL_IDS));
