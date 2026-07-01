import { FIELD_TYPES, PAGE_TYPES, ACTION_TYPES } from '../core/contract.js';
import { configurationError } from '../core/errors.js';

// ── Exported prompt-building helpers ──
// These produce structured descriptions from contract.js metadata,
// replacing hand-written type lists in AI prompts.

export function formatFieldTypesForPrompt(types) {
  return [...types].map((id) => `${FIELD_TYPES[id]?.label}(${id})`).join('、');
}
export function formatActionTypesForPrompt() {
  return [...ACTION_TYPES].map((id) => `${ACTION_TYPES[id]?.label}(${id})`).join('、');
}

export function formatPageTypesForPrompt() {
  return [...PAGE_TYPES].map((id) => `${PAGE_TYPES[id]?.label}(${id})`).join('、');
}

// Internal filtered collections
const PROMPT_FIELD_TYPES = [...FIELD_TYPES].filter((t) => t !== 'ai');
const PROMPT_FIELD_TYPES_STR = formatFieldTypesForPrompt(PROMPT_FIELD_TYPES);
const PROMPT_ACTION_TYPES_STR = formatActionTypesForPrompt();
const PROMPT_PAGE_TYPES_STR = formatPageTypesForPrompt();

export function normalizeAiCreatedPackage(pkg) {
  return structuredClone(pkg || {});
}

export async function generatePackageFromPrompt(prompt, settings = {}) {
  if (!settings?.apiKey) throw configurationError('请先在系统设置中配置 AI API Key。');
  try {
    const body = await requestChatCompletion(settings, [
      {
        role: 'system',
        content:
          '你是 Software Garden 的软件设计助手。只输出 JSON，不要 Markdown。\n\n输出 JSON 结构示例：\n{\n  "manifest": { "name": "应用名称", "description": "简短描述", "icon": "table" },\n  "schema": {\n    "entities": [\n      {\n        "id": "entity_唯一标识",\n        "name": "表名",\n        "fields": [\n          { "id": "field_唯一标识", "label": "字段名", "type": "text" }\n        ]\n      }\n    ]\n  },\n  "ui": {\n    "pages": [\n      { "id": "page_唯一标识", "title": "页面标题", "type": "table", "entity": "entity_唯一标识" }\n    ]\n  },\n  "actions": { "actions": [] },\n  "prompts": {}\n}\n\n要求：\n1. entity.id 和 field.id 使用唯一且有意义的 ID（如 entity_student, field_name），不能重复。\n2. field.type 只支持：' + PROMPT_FIELD_TYPES_STR + '。\n3. 每张表至少有一个 text 类型字段。\n4. manifest.name 和 entities 必须直接基于用户需求生成，不要添加用户没有提到的表或字段。\n5. 仔细理解用户的描述，只创建用户明确需要的表。例如如果用户说"创建作业管理"，就只创建作业/作业提交等相关表，不要创建账目、分类等无关表。\n6. 每个字段必须对应用户需求中的具体信息点，不要凭空添加额外字段。\n7. 做减法：宁可生成一个精准的表，也不要画蛇添足。\n8. 页面类型支持：' + PROMPT_PAGE_TYPES_STR + '。每张表至少生成一个 table 类型的数据页面。\n9. 所有 ID 都不能重复。\n10. actions.actions 中的 type 只支持：' + PROMPT_ACTION_TYPES_STR + '。如果不确定就用 data.createRecord。\n11. formula 字段的 expression 只支持 IF(条件, 是, 否) 条件判断、CONCAT 拼接、+ 运算符、{字段名} 引用字段。不要使用 & 运算符。可用函数：IF, CONCAT, ROUND, ABS, MIN, MAX, LEN, UPPER, LOWER, TODAY, DATEADD, DATEDIFF。公式中引用 select/multiSelect 字段做比较时，用选项的 label（显示值），不要用选项的 id。'
      },
      { role: 'user', content: prompt }
    ]);
    return normalizeAiCreatedPackage(parseJsonContent(body.choices?.[0]?.message?.content || '{}'));
  } catch (error) {
    throw new Error(`AI 生成失败，未使用 Mock 结果替代：${error.message}`);
  }
}


export async function generateOptions(prompt, settings = {}) {
  if (!settings?.apiKey) throw configurationError('生成选项需要先配置 AI API Key。');
  try {
    const body = await requestChatCompletion(settings, [
      {
        role: 'system',
        content:
          '你是一个下拉选项生成助手。根据用户提供的字段名和上下文，生成 2-8 个选项。' +
          '只输出 JSON 数组，每个对象格式：{ "label": "选项名称", "color": "blue" }。' +
          '可用颜色：gray, blue, green, yellow, orange, red, purple, teal, pink, indigo, cyan, lime。' +
          '选项名称要简洁、全面、不重复。输出示例：[{"label":"低","color":"green"},{"label":"中","color":"yellow"},{"label":"高","color":"red"}]'
      },
      { role: 'user', content: prompt }
    ]);
    const raw = body.choices?.[0]?.message?.content || '[]';
    return parseJsonContent(raw);
  } catch (error) {
    throw new Error(`AI 生成选项失败：${error.message}`);
  }
}

export async function generateBusinessRuleIntent(intent, app, settings = {}, existingRule = null) {
  if (!settings?.apiKey) throw new Error('创建业务规则需要先配置 AI API Key。');
  const schema = (app?.schema?.entities || []).map((entity) => ({
    id: entity.id,
    name: entity.name,
    fields: (entity.fields || []).map((field) => ({
      id: field.id,
      label: field.label,
      type: field.type,
      targetEntity: field.targetEntity || null,
      options: (field.options || []).map((option) => ({ id: option.id, label: option.label }))
    }))
  }));
  const body = await requestChatCompletion(settings, [
    {
      role: 'system',
      content: `你是业务规则意图分析器。只输出 JSON，不要 Markdown。只能引用给定 Schema 中真实存在的 ID。
支持的规则：新增记录，或某条记录字段从 from 变为 to 后，设置、增加或减少当前记录或其 relation 关联记录的一个字段。
输出结构：
{"supported":true,"name":"规则名","summary":"摘要","trigger":{"event":"record.created|record.updated","entity":"实体ID","field":"updated 时必填","from":"updated 时必填的内部值","to":"updated 时必填的内部值"},"target":{"entity":"目标实体ID","relationField":"触发实体上的 relation 字段ID；更新当前记录时为 null","field":"目标字段ID"},"action":{"operation":"set|increment|decrement","value":{"type":"trigger.field|literal","field":"来源字段ID","value":0}},"display":{"when":"何时执行","then":"执行什么"}}
如果当前能力或 Schema 无法实现，输出 {"supported":false,"reason":"具体原因"}。select 字段 from/to 必须使用 option.id，不使用显示 label。不要猜测缺失字段或关联。`
    },
    { role: 'user', content: JSON.stringify({ intent: String(intent || '').trim(), existingRule, schema }) }
  ]);
  return parseJsonContent(body.choices?.[0]?.message?.content || '{}');
}


export async function generateFieldContent(prompt, settings = {}) {
  if (!settings?.apiKey) throw configurationError('生成字段内容需要先配置 AI API Key。');
  try {
    const body = await requestChatCompletion(settings, [
      {
        role: 'system',
        content:
          '你是一个 AI 字段生成助手。根据用户的提示词和提供的字段值，生成一段文本内容。' +
          '直接输出结果文本，不要加引号、不要加 Markdown 标记。字数控制在 500 字以内。'
      },
      { role: 'user', content: prompt }
    ]);
    return String(body.choices?.[0]?.message?.content || '').trim();
  } catch (error) {
    throw new Error(`AI 生成失败：${error.message}`);
  }
}

export function chatCompletionsUrl(baseUrl = 'https://api.openai.com/v1') {
  const clean = String(baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  if (clean.endsWith('/chat')) return `${clean}/completions`;
  if (clean.endsWith('/chat/completions')) return clean;
  return `${clean}/chat/completions`;
}

async function assertAiResponse(response) {
  if (response.ok) return '';
  const text = await response.text().catch(() => '');
  const message = text ? `AI 请求失败：${response.status} ${text}` : `AI 请求失败：${response.status}`;
  throw new Error(message);
}

async function requestChatCompletion(settings, messages) {
  const payload = {
    model: settings.model || 'gpt-4.1-mini',
    messages,
    response_format: { type: 'json_object' }
  };
  const first = await sendChatCompletion(settings, payload);
  if (first.ok) return first.json();
  const errorText = await first.text();
  if (errorText.includes('response_format')) {
    const retryPayload = { ...payload };
    delete retryPayload.response_format;
    const retry = await sendChatCompletion(settings, retryPayload);
    if (retry.ok) return retry.json();
    await throwAiError(retry);
  }
  throw new Error(`AI 请求失败：${first.status} ${errorText}`);
}

function sendChatCompletion(settings, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  return fetch(chatCompletionsUrl(settings.baseUrl), {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(payload)
  }).finally(() => clearTimeout(timeout));
}

async function throwAiError(response) {
  const text = await response.text().catch(() => '');
  throw new Error(text ? `AI 请求失败：${response.status} ${text}` : `AI 请求失败：${response.status}`);
}

function parseJsonContent(content) {
  const text = String(content || '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first >= 0 && last > first) return JSON.parse(text.slice(first, last + 1));
    throw new Error('AI 返回内容不是合法 JSON。');
  }
}
