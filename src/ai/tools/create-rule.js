import { register } from '../registry.js';
import { getApp } from '../../models/app.js';
import { getSetting } from '../../models/session.js';
import { generateBusinessRuleIntent } from '../service.js';
import { compileBusinessRule, saveCompiledRule, simulateCompiledRule } from '../../services/rule-creation.js';

register({
  name: 'create_rule',
  description: 'Create an app business rule from a natural-language intent. Always explain the trigger and effect before calling this tool. The system requires explicit user confirmation before execution.',
  risk: 'high',
  schema: {
    type: 'function',
    function: {
      name: 'create_rule',
      description: 'Create an active business rule after the user confirms the AI understanding.',
      parameters: {
        type: 'object',
        properties: {
          intent: { type: 'string', description: 'The user business-rule request in their own words.' }
        },
        required: ['intent']
      }
    }
  },
  handler: async (args) => {
    const app = getApp(args.appId);
    if (!app) throw new Error('请先打开需要增加业务规则的应用。');
    const intent = String(args.intent || '').trim();
    if (!intent) throw new Error('业务规则描述不能为空。');
    const businessIntent = await generateBusinessRuleIntent(intent, app, getSetting('ai') || {});
    const compiled = compileBusinessRule(app, intent, businessIntent);
    const simulation = simulateCompiledRule(compiled);
    const rule = saveCompiledRule(app.id, intent, compiled);
    return {
      success: true,
      appId: app.id,
      ruleId: rule.id,
      ruleName: rule.name,
      status: rule.status,
      preview: compiled.preview,
      simulation
    };
  }
});
