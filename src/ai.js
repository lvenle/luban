import { normalizeFieldId } from './ids.js';
import { pickSamplePackage } from './samplePackages.js';

export async function generatePackageFromPrompt(prompt, settings = {}) {
  if (!settings?.apiKey) return pickSamplePackage(prompt);
  try {
    const body = await requestChatCompletion(settings, [
      {
        role: 'system',
        content:
          '你是 Software Garden 的软件设计助手。只输出 JSON，不要 Markdown。顶层必须包含 manifest、schema、ui、actions、prompts。不要生成代码。'
      },
      { role: 'user', content: prompt }
    ]);
    return parseJsonContent(body.choices?.[0]?.message?.content || '{}');
  } catch (error) {
    console.warn(`AI package generation failed, using local fallback: ${error.message}`);
    return pickSamplePackage(prompt);
  }
}

export async function generatePatchFromPrompt(prompt, currentPackage, settings = {}) {
  if (!settings?.apiKey) return mockPatch(prompt, currentPackage);
  try {
    const body = await requestChatCompletion(settings, [
      {
        role: 'system',
        content:
          '你是 Software Garden 的软件进化助手。只输出 Patch JSON，顶层包含 summary 和 operations。operations 只能使用支持的 Patch 操作。'
      },
      { role: 'user', content: JSON.stringify({ currentPackage, request: prompt }) }
    ]);
    return parseJsonContent(body.choices?.[0]?.message?.content || '{}');
  } catch (error) {
    console.warn(`AI patch generation failed, using local fallback: ${error.message}`);
    return mockPatch(prompt, currentPackage);
  }
}

function chatCompletionsUrl(baseUrl = 'https://api.openai.com/v1') {
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

function firstEntity(pkg) {
  return pkg.schema.entities[0]?.id || 'record';
}

function mockPatch(prompt, pkg) {
  const text = String(prompt || '');
  const entity = firstEntity(pkg);
  const entityDef = pkg.schema.entities.find((item) => item.id === entity) || pkg.schema.entities[0];
  if (text.includes('旅游')) {
    return {
      summary: '增加旅游预算字段和统计页面',
      operations: [
        {
          op: 'addField',
          entity,
          field: { id: 'travel_budget', label: '是否计入旅游预算', type: 'boolean' }
        },
        {
          op: 'addPage',
          page: {
            id: 'travel-budget-chart',
            title: '旅游预算统计',
            type: 'chart',
            entity,
            chart: { type: 'bar', groupBy: 'travel_budget', value: 'count' }
          }
        }
      ]
    };
  }
  if (text.includes('今日')) {
    return {
      summary: '增加今日任务页面',
      operations: [
        {
          op: 'addPage',
          page: { id: 'today-list', title: '今日任务', type: 'list', entity, features: ['create', 'edit', 'delete', 'search'] }
        }
      ]
    };
  }
  if (text.includes('爆款') || text.includes('标题')) {
    return {
      summary: '增加爆款标题分析 Action',
      operations: [
        {
          op: 'addAction',
          action: {
            id: 'viral_title_analysis',
            name: '爆款标题分析',
            type: 'ai.generateText',
            input: { records: entity },
            prompt: '分析当前文章主题，给出 5 个更有传播力的公众号标题，并说明理由。'
          }
        }
      ]
    };
  }
  if (text.includes('提醒')) {
    return {
      summary: '增加跟进提醒日期字段',
      operations: [{ op: 'addField', entity, field: { id: 'follow_up_date', label: '跟进提醒日期', type: 'date' } }]
    };
  }
  if (text.includes('统计') || text.includes('图表') || text.includes('看板')) {
    const groupField = chooseGroupField(entityDef);
    return {
      summary: `增加${fieldLabel(groupField)}统计页面`,
      operations: [
        {
          op: 'addPage',
          page: {
            id: `${groupField.id}-chart`,
            title: `${fieldLabel(groupField)}统计`,
            type: 'chart',
            entity,
            chart: { type: 'bar', groupBy: groupField.id, value: 'count' }
          }
        }
      ]
    };
  }
  if (text.includes('导出')) {
    return {
      summary: '增加 CSV 导出 Action',
      operations: [
        {
          op: 'addAction',
          action: { id: `export_${entity}`, name: `导出${entityDef?.name || '记录'} CSV`, type: 'export.csv', input: { records: entity } }
        }
      ]
    };
  }
  if (text.includes('生成') || text.includes('总结') || text.includes('分析')) {
    return {
      summary: '增加 AI 分析 Action',
      operations: [
        {
          op: 'addAction',
          action: {
            id: 'ai_analysis',
            name: 'AI 分析',
            type: 'ai.generateText',
            input: { records: entity },
            prompt: `根据当前${entityDef?.name || '记录'}数据生成简洁分析和建议。`
          }
        }
      ]
    };
  }
  const requestedField = inferRequestedField(text);
  if (requestedField) {
    return {
      summary: `增加${requestedField.label}字段`,
      operations: [{ op: 'addField', entity, field: requestedField }]
    };
  }
  return {
    summary: '增加备注增强字段',
    operations: [{ op: 'addField', entity, field: { id: 'extra_note', label: '补充备注', type: 'textarea' } }]
  };
}

function inferRequestedField(text) {
  const match = text.match(/(?:增加|添加|新增)(?:一个)?(.+?)(?:字段|日期|时间|功能)?$/);
  if (!match) return null;
  const raw = match[1].replace(/功能$/, '').trim();
  if (!raw) return null;
  const label = raw.endsWith('日期') || raw.endsWith('时间') ? raw : raw.replace(/字段$/, '');
  const type = inferFieldType(label);
  return {
    id: normalizeFieldId(translateKnownField(label), fallbackFieldId(label, type)),
    label,
    type,
    options: inferFieldOptions(label)
  };
}

function translateKnownField(label) {
  const known = {
    标签: 'tag',
    分类: 'category',
    状态: 'status',
    优先级: 'priority',
    评分: 'rating',
    金额: 'amount',
    价格: 'price',
    数量: 'quantity',
    日期: 'date',
    时间: 'time',
    负责人: 'owner',
    备注: 'note'
  };
  return known[label] || label;
}

function inferFieldType(label) {
  if (label.includes('日期')) return 'date';
  if (label.includes('时间')) return 'datetime';
  if (/(金额|价格|数量|评分|分数|时长|预算|进度)/.test(label)) return 'number';
  if (/(是否|完成|启用)/.test(label)) return 'boolean';
  if (/(状态|优先级|分类|类型|标签|来源)/.test(label)) return 'select';
  if (/(备注|说明|描述|复盘|步骤)/.test(label)) return 'textarea';
  return 'text';
}

function inferFieldOptions(label) {
  if (label.includes('状态')) return ['未开始', '进行中', '已完成'];
  if (label.includes('优先级')) return ['低', '中', '高'];
  if (label.includes('分类') || label.includes('类型') || label.includes('标签')) return ['默认', '重要', '其他'];
  if (label.includes('来源')) return ['线上', '线下', '其他'];
  return undefined;
}

function fallbackFieldId(label, type) {
  if (label.includes('日期')) return 'date_field';
  if (label.includes('时间')) return 'time_field';
  if (label.includes('金额')) return 'amount';
  if (label.includes('数量')) return 'quantity';
  if (label.includes('评分')) return 'rating';
  if (label.includes('状态')) return 'status';
  if (label.includes('分类')) return 'category';
  if (label.includes('优先级')) return 'priority';
  if (label.includes('负责人')) return 'owner';
  if (label.includes('备注')) return 'note';
  return `${type || 'text'}_field`;
}

function chooseGroupField(entityDef) {
  return entityDef?.fields?.find((field) => field.type === 'select' || field.type === 'boolean') || entityDef?.fields?.[0] || { id: 'status', label: '状态' };
}

function fieldLabel(field) {
  return field?.label || field?.id || '记录';
}
