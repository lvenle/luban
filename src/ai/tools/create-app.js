import { register } from '../registry.js';
import { generatePackageFromPrompt } from '../service.js';
import { createAppFromPackage } from '../../models/app.js';
import { getSetting } from '../../models/session.js';

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
    let pkg;
    try {
      pkg = await generatePackageFromPrompt(args.description, settings);
    } catch (error) {
      throw new Error(`AI 生成失败：${error.message}`);
    }
    if (!pkg?.schema?.entities?.length || !pkg?.ui?.pages?.length) {
      throw new Error('AI 生成的应用结构缺少数据表或页面，创建未执行。');
    }
    try {
      const app = createAppFromPackage(pkg);
      return {
        appId: app.id,
        name: app.name,
        slug: app.slug,
        entities: app.schema.entities.map((entity) => ({
          id: entity.id,
          name: entity.name,
          fields: entity.fields.map((field) => ({ id: field.id, label: field.label, type: field.type }))
        }))
      };
    } catch (error) {
      // 捕获 preparePackage 校验错误，暴露具体原因
      throw new Error(`应用结构校验失败：${error.message}`);
    }
  }
});
