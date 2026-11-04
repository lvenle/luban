import { requireTool, isBuilder } from '../enterprise/context.js';
import { LUBAN_TOOL_NAMES } from './runtime-adapter.js';
import { getTools } from '../ai/registry.js';

function platformRisk(risk) {
  return risk === 'low' ? 'read' : 'write';
}

export class LubanToolProvider {
  constructor({
    tools = getTools(),
    requireContext = false,
    appId = null,
    pageId = null,
    requestApproval = async () => false,
    onExecution = () => {}
  } = {}) {
    this.tools = tools;
    this.requireContext = requireContext;
    this.appId = appId;
    this.pageId = pageId;
    this.requestApproval = requestApproval;
    this.onExecution = onExecution;
  }

  listTools() {
    return this.tools.map((tool) => {
      const name = LUBAN_TOOL_NAMES[tool.name];
      if (!name) throw new Error(`Luban tool is missing a namespace mapping: ${tool.name}`);
      return {
        name,
        legacyName: tool.name,
        source: 'business',
        provider: 'luban',
        label: tool.schema?.function?.description || tool.description,
        description: isBuilder()&&tool.name==='create_app'?'根据需求提出应用名称、数据表和字段建议，等待用户在界面确认；不会直接创建应用。':tool.description,
        inputSchema: structuredClone(tool.schema?.function?.parameters || { type: 'object', properties: {} }),
        risk: platformRisk(tool.risk),
        idempotent: false,
        timeoutMs: 60_000,
        execute: async (input, { callId, signal }) => {
          if (this.requireContext) throw new Error('鲁班业务工具只能在鲁班会话中执行');
          const args = { ...input };
          if (this.appId) args.appId = this.appId;
          requireTool(tool.name, args);
          if (this.pageId && !args.pageId) args.pageId = this.pageId;
          if (tool.risk === 'high') {
            const allowed = await this.requestApproval({ callId, name, input: args, signal });
            if (!allowed || signal.aborted) throw new Error('用户未确认此高风险操作');
          }
          this.onExecution({ callId, name, legacyName: tool.name, status: 'running', input: args });
          try {
            requireTool(tool.name, args);
            const output = await tool.handler(args, { signal, callId });
            this.onExecution({ callId, name, legacyName: tool.name, status: 'success', output });
            return output;
          } catch (error) {
            this.onExecution({ callId, name, legacyName: tool.name, status: 'failed', error: error.message });
            throw error;
          }
        }
      };
    });
  }
}
