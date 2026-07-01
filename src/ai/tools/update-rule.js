import { register } from '../registry.js';
import { getApp } from '../../models/app.js';
import { getRule } from '../../models/rule.js';
import { getSetting } from '../../models/session.js';
import { generateBusinessRuleIntent } from '../service.js';
import { compileBusinessRule, simulateCompiledRule, updateCompiledRule } from '../../services/rule-creation.js';

register({
  name: 'update_rule',
  description: 'Modify an existing app business rule from natural language. Explain the new behavior first; execution always requires user confirmation.',
  risk: 'high',
  schema: {
    type: 'function',
    function: {
      name: 'update_rule',
      description: 'Update an existing business rule after explicit confirmation.',
      parameters: {
        type: 'object',
        properties: {
          ruleId: { type: 'string', description: 'Existing rule ID from the current app rule list.' },
          intent: { type: 'string', description: 'The requested complete behavior after modification.' }
        },
        required: ['ruleId', 'intent']
      }
    }
  },
  handler: async (args) => {
    const app = getApp(args.appId);
    if (!app) throw new Error('请先打开需要修改规则的应用。');
    const existing = getRule(app.id, args.ruleId);
    if (!existing) throw new Error('找不到要修改的业务规则。');
    const request = String(args.intent || '').trim();
    if (!request) throw new Error('规则修改描述不能为空。');
    const businessIntent = await generateBusinessRuleIntent(request, app, getSetting('ai') || {}, {
      id: existing.id,
      name: existing.name,
      sourceText: existing.sourceText,
      businessIntentJson: existing.businessIntentJson
    });
    const compiled = compileBusinessRule(app, request, businessIntent);
    const simulation = simulateCompiledRule(compiled);
    const rule = updateCompiledRule(app.id, existing.id, request, compiled);
    return { success: true, appId: app.id, ruleId: rule.id, ruleName: rule.name, status: rule.status, preview: compiled.preview, simulation };
  }
});
