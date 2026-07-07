import { runAction } from '../../services/actions.js';
import { sendJson } from '../_helpers.js';

export async function handleActionsApi(res, method, parts, app) {
  if (method === 'POST' && parts[3] === 'actions' && parts[4] && parts[5] === 'run') {
    sendJson(res, 200, await runAction(app, parts[4]));
    return true;
  }
  return false;
}
