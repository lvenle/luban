import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: false });
const NAME = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/;

export function normalizeHttpTool(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('工具定义必须是对象');
  const name = String(input.name || '').trim();
  const description = String(input.description || '').trim();
  const instructions = String(input.instructions || '').trim();
  if (!NAME.test(name)) throw Error('工具标识须使用命名空间格式，例如 custom.lookup_order');
  if (!description || description.length > 2000) throw Error('工具说明必填且不能超过 2000 字');
  if (instructions.length > 4000) throw Error('调用说明不能超过 4000 字');
  let url;
  try { url = new URL(String(input.url || '').trim()); }
  catch { throw Error('请填写有效的 HTTP API 地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw Error('仅支持不含账号、密码和片段的 HTTP(S) 地址');
  const timeoutMs = Number(input.timeoutMs ?? 30000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) throw Error('超时须在 1–120 秒之间');
  if (input.risk !== undefined && !['read', 'write'].includes(input.risk)) throw Error('操作风险只能是 read 或 write');
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw Error('启用状态必须是布尔值');
  const checkSchema = (schema, label) => {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw Error(`${label}必须是 JSON Schema 对象`);
    if (Buffer.byteLength(JSON.stringify(schema)) > 100000) throw Error(`${label}不能超过 100 KB`);
    try { ajv.compile(schema); } catch (e) { throw Error(`${label}无效：${e.message}`); }
    return structuredClone(schema);
  };
  return {
    name, description, instructions, type: 'http-json', url: url.href,
    inputSchema: checkSchema(input.inputSchema, '输入 Contract'),
    outputSchema: checkSchema(input.outputSchema, '输出 Contract'),
    timeoutMs, enabled: input.enabled !== false,
    risk: input.risk === 'write' ? 'write' : 'read',
    requiresConfirmation: input.risk === 'write'
  };
}

export function executableHttpTool(definition) {
  const tool = normalizeHttpTool(definition);
  const validateOutput = ajv.compile(tool.outputSchema);
  return {
    ...tool, source: 'platform',
    async execute(input, { signal }) {
      const response = await fetch(tool.url, {
        method: 'POST', redirect: 'error', signal,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(input)
      });
      if (!response.ok) throw Error(`HTTP API 返回 ${response.status}`);
      if (!(response.headers.get('content-type') || '').includes('application/json')) throw Error('HTTP API 必须返回 JSON');
      const limit = 1024 * 1024;
      const reader = response.body.getReader();
      let size = 0; const chunks = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > limit) throw Error('HTTP API 响应超过 1 MB');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const bytes = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
      let result;
      try { result = JSON.parse(bytes.toString('utf8')); } catch { throw Error('HTTP API 返回了无效 JSON'); }
      if (!validateOutput(result)) throw Error(`输出不符合 Contract：${ajv.errorsText(validateOutput.errors)}`);
      return result;
    }
  };
}
