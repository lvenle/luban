import { register } from '../registry.js';
import { clearAiSessions } from '../../aiSession.js';

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
          appId: { type: 'string', description: 'App ID' }
        },
        required: ['appId']
      }
    }
  },
  handler: async (args) => {
    return clearAiSessions(args.appId);
  }
});
