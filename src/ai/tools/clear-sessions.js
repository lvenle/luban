import { register } from '../registry.js';
import { clearAiSessions, createAiSession } from '../../models/session.js';

register({
  name: 'clear_sessions',
  description: 'Clear all AI chat history sessions for the current app.',
  risk: 'low',
  schema: {
    type: 'function',
    function: {
      name: 'clear_sessions',
      description: 'Clear all AI chat history sessions',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'App ID (optional, leave empty to clear sessions without an app)' }
        }
      }
    }
  },
  handler: async (args, context) => {
    const sessionId = context?.session?.id;
    clearAiSessions(args.appId || null, sessionId);
    return { ok: true };
  }
});
