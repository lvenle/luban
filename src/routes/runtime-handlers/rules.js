import { executeRuleEvent } from '../../services/rule-engine.js';
import { listRuleRuns } from '../../models/rule-run.js';
import { listRuleRecordStates } from '../../models/rule-record-state.js';
import { getRule, listRules, updateRuleStatus, deleteRule } from '../../models/rule.js';
import { compileBusinessRule, updateCompiledRule } from '../../services/rule-creation.js';
import { sendJson, readJson, requireFields, notFound } from '../_helpers.js';

export async function handleRulesApi(req, res, method, parts, app, appId, url, runtime) {
  if (method === 'POST' && parts[3] === 'rules' && parts[4] === 'execute') {
    const body = await readJson(req);
    requireFields(body, ['rule', 'event']);
    sendJson(res, 200, executeRuleEvent({ appId, rule: body.rule, event: body.event }));
    return true;
  }

  if (parts[3] === 'rules' && parts.length === 4 && method === 'GET') {
    sendJson(res, 200, { rules: listRules(appId) });
    return true;
  }

  if (parts[3] === 'rules' && parts[4] && parts.length === 5) {
    const ruleId = parts[4];
    if (method === 'GET') {
      const rule = getRule(appId, ruleId);
      if (!rule) throw notFound('找不到业务规则。');
      sendJson(res, 200, { rule });
      return true;
    }
    if (method === 'PATCH') {
      const body = await readJson(req);
      let rule;
      if (body.businessIntentJson) {
        const sourceText = String(body.sourceText || '手动修改业务规则').trim();
        const compiled = compileBusinessRule(app, sourceText, body.businessIntentJson);
        rule = updateCompiledRule(appId, ruleId, sourceText, compiled);
      } else {
        rule = updateRuleStatus(appId, ruleId, body.status);
      }
      if (!rule) throw notFound('找不到业务规则。');
      sendJson(res, 200, { rule });
      return true;
    }
    if (method === 'DELETE') {
      if (!deleteRule(appId, ruleId)) throw notFound('找不到业务规则。');
      sendJson(res, 200, { ok: true });
      return true;
    }
  }

  if (parts[3] === 'rules' && parts[4] && parts[5] === 'runs' && method === 'GET') {
    if (!getRule(appId, parts[4])) throw notFound('找不到业务规则。');
    sendJson(res, 200, { runs: listRuleRuns(appId, { ruleId: parts[4], limit: url.searchParams.get('limit') || runtime.ruleRunDefaultLimit }) });
    return true;
  }

  if (parts[3] === 'rules' && parts[4] && parts[5] === 'states' && method === 'GET') {
    if (!getRule(appId, parts[4])) throw notFound('找不到业务规则。');
    sendJson(res, 200, {
      states: listRuleRecordStates(appId, {
        ruleId: parts[4],
        state: url.searchParams.get('state') || undefined,
        limit: url.searchParams.get('limit') || runtime.ruleStateDisplayLimit
      })
    });
    return true;
  }

  if (method === 'GET' && parts[3] === 'rule-runs') {
    sendJson(res, 200, {
      runs: listRuleRuns(appId, {
        ruleId: url.searchParams.get('ruleId') || undefined,
        limit: url.searchParams.get('limit') || runtime.ruleRunDefaultLimit
      })
    });
    return true;
  }

  return false;
}
