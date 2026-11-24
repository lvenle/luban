import { randomUUID } from 'node:crypto';

export const planTool = {
  name: 'platform.plan.manage', risk: 'write', group: 'planning',
  description: '记录计划，不执行业务操作。步骤完成只表示计划记录，不能证明业务操作成功。',
  instructions: '使用 action 选择 create/list/get/rename/add_step/update_step/remove_step；修改时必须提供对应 planId、stepId 和所需字段。该工具只维护计划清单，不会代替实际执行。',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['action'],
    properties: {
      action: { enum: ['create', 'list', 'get', 'rename', 'add_step', 'update_step', 'remove_step'] },
      planId: { type: 'string' }, title: { type: 'string', minLength: 1, maxLength: 200 },
      stepId: { type: 'string' }, status: { enum: ['pending', 'in_progress', 'completed', 'failed'] }
    }
  }
};

/** Instance isolation follows the owning database; session is supplied by RunService. */
export class PlanNotebook {
  constructor(db) {
    this.db = db;
    db.exec('CREATE TABLE IF NOT EXISTS plans(session_id TEXT, id TEXT, value TEXT, PRIMARY KEY(session_id,id))');
  }
  execute(input, { sessionId, runId, onChange = () => {} }) {
    if (input.action === 'list') return this.db.prepare('SELECT value FROM plans WHERE session_id=?').all(sessionId).map(r => JSON.parse(r.value));
    let plan;
    if (input.action === 'create') {
      if (!input.title?.trim()) throw Error('Plan title required');
      plan = { id: randomUUID(), title: input.title, steps: [], revision: 0 };
    } else {
      const row = this.db.prepare('SELECT value FROM plans WHERE session_id=? AND id=?').get(sessionId, input.planId || '');
      if (!row) throw Error('Plan not found in current session');
      plan = JSON.parse(row.value);
      if (input.action === 'get') return plan;
      if (input.action === 'rename') {
        if (!input.title?.trim()) throw Error('Plan title required');
        plan.title = input.title;
      } else if (input.action === 'add_step') {
        if (!input.title?.trim()) throw Error('Step title required');
        if (plan.steps.length >= 100) throw Error('Plan step limit reached');
        plan.steps.push({ id: randomUUID(), title: input.title, status: 'pending' });
      } else if (['update_step','remove_step'].includes(input.action)) {
        const step = plan.steps.find(s => s.id === input.stepId);
        if (!step) throw Error('Step not found');
        if (input.action === 'remove_step') plan.steps = plan.steps.filter(s => s.id !== input.stepId);
        else {
          if (input.title !== undefined) step.title = input.title;
          if (input.status !== undefined) step.status = input.status;
        }
      } else throw Error('Unsupported plan action');
    }
    plan.revision++; plan.runId = runId; plan.updatedAt = new Date().toISOString();
    this.db.prepare('INSERT OR REPLACE INTO plans VALUES(?,?,?)').run(sessionId, plan.id, JSON.stringify(plan));
    onChange({ action: input.action, plan });
    return plan;
  }
}
