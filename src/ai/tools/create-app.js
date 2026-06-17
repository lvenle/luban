import { register } from '../registry.js';
import { generatePackageFromPrompt } from '../../ai.js';
import { createAppFromPackage } from '../../models/app.js';
import { getSetting } from '../../models/session.js';
import { pickSamplePackage } from '../../samplePackages.js';

register({
  name: 'create_app',
  description: 'Create a brand new app from scratch. Use this when the user asks to create a new app and no app is currently open. Generates a complete app with tables, fields, pages, and actions based on the user\'s description.',
  risk: 'medium',
  schema: {
    type: 'function',
    function: {
      name: 'create_app',
      description: 'Create a new app from a description',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'User\'s description of the app they want to create, in their own words. Include key features and workflows they mentioned.' }
        },
        required: ['description']
      }
    }
  },
  handler: async (args) => {
    const settings = getSetting('ai') || {};
    let pkg = await generatePackageFromPrompt(args.description, settings);
    if (!pkg?.schema?.entities?.length || !pkg?.ui?.pages?.length) {
      pkg = pickSamplePackage(args.description);
    }
    const app = createAppFromPackage(pkg);
    return { appId: app.id, name: app.name, slug: app.slug };
  }
});
