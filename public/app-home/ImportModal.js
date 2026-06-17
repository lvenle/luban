import { h } from '../common/dom.js';
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';

export function openImportModal() {
  const fileInput = h('input', { type: 'file', accept: '.sgpkg,application/octet-stream' });
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal' }, [
      h('div', { class: 'toolbar' }, [h('h3', { text: '导入软件包' }), h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })]),
      h('p', { class: 'muted', text: '选择 .sgpkg 文件，系统会校验数据结构、页面和动作后安装。' }),
      fileInput,
      h('div', { class: 'row', style: 'margin-top:14px' }, [
        h('button', {
          text: '安装',
          onclick: async () => {
            if (!fileInput.files[0]) return toast('请选择 .sgpkg 文件。');
            const buffer = await fileInput.files[0].arrayBuffer();
            const body = await api('/api/apps/import', {
              method: 'POST',
              body: buffer,
              headers: { 'content-type': 'application/octet-stream' }
            });
            backdrop.remove();
            const { openApp } = await import('../app-runtime/index.js');
            await openApp(body.appId);
          }
        })
      ])
    ])
  ]);
  document.body.append(backdrop);
}
