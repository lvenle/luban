import { validateRuntimeConfig } from '@xiaoya/agent-platform/config';

export const LUBAN_TOOL_NAMES = Object.freeze({
  create_app: 'luban.app.create',
  add_entity: 'luban.entity.create',
  update_entity: 'luban.entity.update',
  remove_entity: 'luban.entity.delete',
  add_field: 'luban.field.create',
  update_field: 'luban.field.update',
  remove_field: 'luban.field.delete',
  add_relation: 'luban.relation.create',
  add_page: 'luban.page.create',
  update_page: 'luban.page.update',
  remove_page: 'luban.page.delete',
  create_view: 'luban.view.create',
  add_view: 'luban.view.add',
  design_form: 'luban.form.design',
  add_action: 'luban.action.create',
  create_rule: 'luban.rule.create',
  update_rule: 'luban.rule.update',
  query_data: 'luban.records.query',
  add_record: 'luban.records.create',
  update_record: 'luban.records.update',
  delete_record: 'luban.records.delete',
  create_scheduled_task: 'luban.schedule.create',
  stop_scheduled_task: 'luban.schedule.stop',
  test_scheduled_task: 'luban.schedule.test',
  clear_sessions: 'luban.sessions.clear'
});

export const LUBAN_TOOL_PERMISSIONS = Object.freeze(Object.values(LUBAN_TOOL_NAMES));

export function buildLubanRuntimeConfig(settings, {
  packagePath = 'agents/luban-app-builder',
  productVersion = '2026.06.25',
  instanceId = 'local',
  enabledSkills = [],
  deniedTools = []
} = {}) {
  return validateRuntimeConfig({
    schema_version: 1,
    product: { id: 'luban', version: productVersion, instance_id: instanceId },
    agent: { id: 'luban-app-builder', version: '0.1.0', package_path: packagePath },
    model: {
      provider: settings.provider || 'openai-compatible',
      base_url: settings.baseUrl || 'https://api.openai.com/v1',
      model: settings.model || 'gpt-4.1-mini',
      credential_ref: 'secret:model-default',
      capabilities: { streaming: true, tool_calls: true }
    },
    skills: { root: settings.skillsRoot || 'data/skills', enabled: enabledSkills },
    mcp: { servers: settings.mcpServers || [] },
    tools: { allowed: LUBAN_TOOL_PERMISSIONS, denied: deniedTools },
    limits: { max_turns: 20, timeout_seconds: 240 }
  });
}
