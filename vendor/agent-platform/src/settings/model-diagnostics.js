import { createModelProvider } from '../model/index.js';
import { mergeModelParams } from './instance-store.js';

const unknown = () => ({ tools: null, vision: null, structuredOutput: null, streaming: null });
export class ModelDiagnostics {
  constructor(store, { fetchImpl = fetch } = {}) { this.store = store; this.fetch = fetchImpl; }
  url(c, suffix) { return (c.baseUrl || (c.provider === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1')).replace(/\/$/, '') + '/' + suffix; }
  headers(c) { return c.provider === 'anthropic' ? { 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } : { authorization: `Bearer ${c.apiKey}`, 'content-type': 'application/json' }; }
  async list(id) {
    const c = this.store.resolveConnection(id);
    try {
      const r = await this.fetch(this.url(c, 'models'), { headers: this.headers(c), signal: AbortSignal.timeout(c.timeoutMs), redirect: 'error' });
      if (!r.ok) throw Error(`HTTP ${r.status}`);
      const body = await r.json();
      if (!Array.isArray(body.data)) throw Error('Provider returned no model list');
      return { items: body.data.filter(m => typeof m.id === 'string').map(m => ({ id: m.id, ...this.persisted(m.id, c) })), manualEntryAllowed: true };
    } catch (e) { return { items: [], manualEntryAllowed: true, error: this.safe(e.message, c) }; }
  }
  persisted(modelId, c) {
    const card = typeof this.store.modelCard === 'function' ? this.store.modelCard(c.id, modelId) : null;
    return card ? { capabilities: card.capabilities, paramOverrides: card.paramOverrides, cardUpdatedAt: card.updatedAt } : { capabilities: unknown() };
  }
  async remember(id, model, card) {
    if (typeof this.store.saveModelCard !== 'function') return;
    try {
      const previous = typeof this.store.modelCard === 'function' ? this.store.modelCard(id, model) : null;
      const capabilities = { ...unknown(), ...(previous?.capabilities || {}) };
      for (const [name, value] of Object.entries(card.capabilities || {})) {
        if (value !== null && value !== undefined) capabilities[name] = value;
      }
      await this.store.saveModelCard(id, model, {
        ...previous,
        ...card,
        capabilities,
        ...(previous?.paramOverrides ? { paramOverrides: previous.paramOverrides } : {})
      });
    }
    catch (e) { console.warn('[agent-platform] 模型能力卡持久化失败：' + e.message); }
  }
  safe(message, c) { return String(message).split(c.apiKey).join('[REDACTED]'); }
  async test(id, { kind, model }) {
    if (!['text','streaming','tools','structured'].includes(kind)) throw Error('Unknown diagnostic');
    const c = this.store.resolveConnection(id);
    model = model || c.model;
    if (typeof model !== 'string' || !model.trim()) throw Error('Model required');
    // 决议 40：诊断页展示本次测试实际生效的参数（覆盖顺序：能力卡 paramOverrides < 连接配置，基准值除外）。
    const known = typeof this.store.modelCard === 'function' ? this.store.modelCard(id, model) : null;
    const effectiveParams = mergeModelParams({ modelCard: known?.paramOverrides, connection: c.params });
    const signal = AbortSignal.timeout(c.timeoutMs), card = { id: model, capabilities: unknown() };
    let result;
    try {
      if (kind === 'structured') {
        result = await this.testStructured(c, model, card, signal);
      } else if (kind === 'text') {
        const body = c.provider === 'anthropic' ? { model, max_tokens: 32, messages: [{ role: 'user', content: 'Reply with OK.' }] } : { model, stream: false, max_tokens: 32, messages: [{ role: 'user', content: 'Reply with OK.' }] };
        const response = await this.fetch(this.url(c, c.provider === 'anthropic' ? 'messages' : 'chat/completions'), { method: 'POST', headers: this.headers(c), body: JSON.stringify(body), signal, redirect: 'error' });
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        const data = await response.json();
        const text = c.provider === 'anthropic' ? data.content?.filter(x => x.type === 'text').map(x => x.text).join('') : data.choices?.[0]?.message?.content;
        if (!text) throw Error('No text returned');
        result = { kind, status: 'passed', card, output: this.safe(text, c) };
      }
      const provider = kind === 'streaming' || kind === 'tools' ? createModelProvider({ provider: c.provider, base_url: c.baseUrl || undefined }, { apiKey: c.apiKey, fetchImpl: this.fetch }) : null;
      const tools = kind === 'tools' ? [{ name: 'diagnostic.echo', description: 'Test only; call with value OK.', inputSchema: { type: 'object', properties: { value: { const: 'OK' } }, required: ['value'], additionalProperties: false } }] : [];
      let text = '', sawDelta = false; const calls = new Map();
      if (provider) {
      for await (const event of provider.stream({ model, signal, maxTokens: 128, tools, messages: [{ role: 'user', content: kind === 'tools' ? 'Call diagnostic.echo with value OK. Do not answer in text.' : 'Reply with OK.' }] })) {
        if (event.type === 'text_delta') { text += event.delta; sawDelta = true; }
        if (event.type === 'tool_call_delta') { const key = event.index ?? event.id; const call = calls.get(key) || { name: '', args: '' }; if (event.name) call.name = event.name; call.args += event.arguments_delta || ''; calls.set(key, call); }
      }
      }
      if (kind === 'streaming' && !sawDelta) throw Error('No streaming text observed');
      if (kind === 'tools' && ![...calls.values()].some(call => { try { const args = JSON.parse(call.args); return call.name === 'diagnostic.echo' && args.value === 'OK' && Object.keys(args).length === 1; } catch { return false; } })) throw Error('No valid diagnostic tool call observed; capability remains unconfirmed');
      if (kind === 'streaming' || kind === 'tools') {
        card.capabilities[kind] = true;
        result = { kind, status: 'passed', card, output: this.safe(text, c), note: kind === 'tools' ? 'Validated tool call only; no external action executed.' : undefined };
      }
    } catch (e) { result = { kind, status: 'failed', card, error: this.safe(e.message, c) }; }
    if (result.status === 'passed') await this.remember(id, model, card);
    result.effectiveParams = effectiveParams;
    return result;
  }
  /** Native structured output probe. Anthropic has no response_format equivalent; report false without a network call. */
  async testStructured(c, model, card, signal) {
    if (c.provider === 'anthropic') {
      card.capabilities.structuredOutput = false;
      return { kind: 'structured', status: 'passed', card, note: 'Anthropic Messages 没有原生 response_format；结构化输出走“生成 → 本地校验 → 重试”回退路径。' };
    }
    const schema = { type: 'object', properties: { ok: { const: 'OK' } }, required: ['ok'], additionalProperties: false };
    const response = await this.fetch(this.url(c, 'chat/completions'), { method: 'POST', headers: this.headers(c), signal, redirect: 'error',
      body: JSON.stringify({ model, stream: false, max_tokens: 64, response_format: { type: 'json_schema', json_schema: { name: 'diagnostic_probe', strict: false, schema } }, messages: [{ role: 'user', content: 'Reply with {"ok":"OK"}.' }] }) });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw Error('Model did not return JSON under response_format'); }
    if (parsed?.ok !== 'OK' || Object.keys(parsed).length !== 1) throw Error('Model JSON did not match the requested schema');
    card.capabilities.structuredOutput = true;
    return { kind: 'structured', status: 'passed', card, output: this.safe(text, c), note: '原生结构化输出可用；运行仍会经过本地 Schema 校验。' };
  }
}
