const RULE_MESSAGE_PATTERNS = [
  [/^新增\s+\S+\s+记录$/i, '已检测到新增记录'],
  [/^通过关联字段[^。]*找到\s*\d+\s*条目标记录$/i, '已找到相关联的数据'],
  [/^从\s+\S+\s+读取到\s*\d+\s*条记录$/i, '已找到符合条件的数据'],
  [/^按\s+\S+\s+汇总\s+\S+[^。]*$/i, '数据汇总已完成'],
  [/^[A-Za-z0-9_]+\.[A-Za-z0-9_]+\s+从\s+.+\s+变为\s+.+$/i, '目标字段已完成更新'],
  [/^[A-Za-z0-9_]+\.[A-Za-z0-9_]+\s+\S+\s+(>=|<)\s+\S+\s+\S+$/i, '业务条件检查已完成'],
  [/^执行成功，日志在事务内写入$/i, '业务处理已完成'],
  [/update\.field 找不到目标上下文[^。]*/i, '没有找到需要处理的关联数据，请检查关联字段是否已经填写'],
  [/update\.field 找不到记录[^。]*/i, '没有找到需要更新的数据，可能已被删除'],
  [/read\.related[^。]*(配置不完整|找不到)[^。]*/i, '无法读取关联数据，请检查规则中的关联字段'],
  [/read\.records[^。]*(配置不完整|无效)[^。]*/i, '无法读取规则需要的数据，请检查规则配置'],
  [/aggregate\.sum[^。]*/i, '汇总数据时遇到无法识别的内容，请检查相关数字字段'],
  [/condition[^。]*/i, '无法完成规则条件判断，请检查相关字段和值'],
  [/无法解析占位符[^。]*/i, '规则需要的数据还没有准备好，请检查相关字段是否已填写'],
  [/Contract Step[^。]*/i, '这条业务规则包含无法执行的步骤，请重新编辑或让 AI 修复'],
  [/Contract 缺少[^。]*/i, '这条业务规则配置不完整，请重新编辑或让 AI 修复'],
  [/不支持的 Step 类型[^。]*/i, '这条业务规则包含暂不支持的操作，请重新配置'],
  [/update\.field[^。]*(仅支持|必须)[^。]*/i, '规则中的字段更新方式不正确，请重新配置'],
  [/找不到触发记录[^。]*/i, '触发这条规则的数据已经不存在'],
  [/触发表不存在[^。]*/i, '没有找到规则指定的来源表，请重新选择'],
  [/目标表不存在[^。]*/i, '没有找到规则要修改的数据表，请重新选择'],
  [/触发字段不存在[^。]*/i, '没有找到规则指定的触发字段，请重新选择'],
  [/目标字段不存在[^。]*/i, '没有找到规则要修改的字段，请重新选择'],
  [/来源字段不存在[^。]*/i, '没有找到规则取值所需的字段，请重新选择'],
  [/跨表规则必须指定触发表上的 relation 字段/i, '要修改另一张表的数据，请先选择两张表之间的关联字段'],
  [/关联字段不能定位目标表[^。]*/i, '当前关联字段无法找到要修改的数据，请重新选择'],
  [/不支持的触发类型[^。]*/i, '暂时无法按这种方式触发规则，请选择新增记录或字段变化'],
  [/不支持的字段操作[^。]*/i, '暂时无法执行这种字段修改，请选择设置、增加或减少'],
  [/不支持的值来源[^。]*/i, '暂时无法使用这种取值方式，请选择记录字段或固定值']
];

const SYSTEM_MESSAGE_PATTERNS = [
  [/(Failed to fetch|NetworkError|fetch failed|ECONNREFUSED)/i, '暂时无法连接服务，请检查网络后重试'],
  [/(timeout|timed out|连接超时)/i, '等待时间过长，请稍后重试'],
  [/(SQLITE|database is locked|UNIQUE constraint|FOREIGN KEY constraint)/i, '数据暂时无法保存，请刷新页面后重试'],
  [/请求缺少 entityId[^。]*/i, '没有找到要操作的数据表，请刷新页面后重试'],
  [/实体不存在[^。]*/i, '对应的数据表已经不存在，请刷新页面后重试'],
  [/API 不存在/i, '这个功能暂时不可用，请刷新页面后重试'],
  [/Unexpected token[^。]*/i, '系统返回了无法识别的数据，请稍后重试'],
  [/Internal Server Error/i, '系统暂时遇到问题，请稍后重试']
];

const EXACT_BUSINESS_LABELS = {
  'read.records': '查找相关数据',
  'read.related': '查找关联数据',
  'aggregate.sum': '汇总相关数据',
  condition: '检查业务条件',
  'update.field': '更新目标字段',
  block: '业务条件未通过',
  'log.run': '完成业务处理',
  validation: '检查规则配置',
  success: '已完成',
  failed: '未完成',
  skipped: '本次无需处理',
  blocked: '业务条件未满足'
};

export function humanizeMessage(message, fallback = '操作没有完成，请稍后重试') {
  const raw = String(message || '').trim();
  if (!raw) return fallback;
  if (EXACT_BUSINESS_LABELS[raw]) return EXACT_BUSINESS_LABELS[raw];
  for (const [pattern, replacement] of [...RULE_MESSAGE_PATTERNS, ...SYSTEM_MESSAGE_PATTERNS]) {
    if (pattern.test(raw)) return `${replacement}。`;
  }
  return raw
    .replace(/record\.created/g, '新增记录时')
    .replace(/record\.updated/g, '字段变化时')
    .replace(/\bdisabled\b/g, '未启用')
    .replace(/\bactive\b/g, '已启用')
    .replace(/\bdraft\b/g, '草稿');
}
