/** Enterprise composition deliberately excludes the standalone WeChat product. */
export function deploymentManifest(input = { applications: ['knowledge', 'ai-db', 'luban'] }) {
  if (!input || !Array.isArray(input.applications) || input.applications.length === 0) throw Error('部署清单必须至少选择一个应用');
  const supported = new Set(['knowledge', 'ai-db', 'luban']);
  if (input.applications.some(id => !supported.has(id)) || new Set(input.applications).size !== input.applications.length) throw Error('部署清单仅支持不重复的 knowledge、ai-db、luban');
  return Object.freeze({ applications: Object.freeze([...input.applications]) });
}
