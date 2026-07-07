import { h } from '../../common/dom.js';
import { api } from '../../common/api.js';
import { toast } from '../../common/toast.js';

export function createSampleImporter(samples, onImported) {
  const selected = new Set();
  const imported = new Set();
  let busy = false;

  const importIds = async (ids, panel) => {
    if (busy || !ids.length) return;
    busy = true;
    render(panel);
    try {
      const body = await api('/api/samples/import', {
        method: 'POST',
        body: JSON.stringify({ ids })
      });
      ids.forEach((id) => imported.add(id));
      selected.clear();
      onImported();
      toast(`已导入 ${body.imported?.length || ids.length} 个样例`);
    } catch (error) {
      toast(`导入失败：${error.message}`);
    } finally {
      busy = false;
      render(panel);
    }
  };

  const render = (panel) => {
    const allSelected = samples.length > 0 && selected.size === samples.length;
    const selectAll = h('input', {
      type: 'checkbox',
      checked: allSelected ? 'checked' : null,
      onchange: (event) => {
        selected.clear();
        if (event.currentTarget.checked) samples.forEach((sample) => selected.add(sample.id));
        render(panel);
      }
    });
    const cards = samples.map((sample) => {
      const checkbox = h('input', {
        type: 'checkbox',
        checked: selected.has(sample.id) ? 'checked' : null,
        onchange: (event) => {
          if (event.currentTarget.checked) selected.add(sample.id);
          else selected.delete(sample.id);
          render(panel);
        }
      });
      return h('article', { class: 'sample-import-card' }, [
        h('div', { class: 'sample-import-card-select' }, [checkbox]),
        h('div', { class: 'sample-import-card-body' }, [
          h('div', { class: 'sample-import-card-title' }, [
            h('strong', { text: sample.name }),
            h('span', { class: 'category-pill', text: sample.category || '未分类' }),
            imported.has(sample.id) ? h('span', { class: 'sample-imported-badge', text: '本次已导入' }) : null
          ]),
          h('p', { class: 'muted', text: sample.description || '暂无介绍' }),
          h('div', { class: 'sample-import-meta' }, [
            h('span', { text: `${sample.entityCount} 张表` }),
            h('span', { text: `${sample.recordCount} 条数据` }),
            h('span', { text: `${sample.ruleCount} 条业务规则` })
          ])
        ]),
        h('button', {
          class: 'secondary sample-import-one',
          text: busy ? '导入中…' : '导入',
          disabled: busy ? 'disabled' : null,
          onclick: () => importIds([sample.id], panel)
        })
      ]);
    });
    panel.replaceChildren(h('div', { class: 'sample-import-panel' }, [
      h('div', { class: 'sample-import-toolbar' }, [
        h('label', { class: 'sample-select-all' }, [selectAll, h('span', { text: '全选' })]),
        h('span', { class: 'muted', text: `共 ${samples.length} 个样例，已选择 ${selected.size} 个` }),
        h('button', {
          text: busy ? '导入中…' : `导入选中${selected.size ? ` (${selected.size})` : ''}`,
          disabled: busy || !selected.size ? 'disabled' : null,
          onclick: () => importIds([...selected], panel)
        })
      ]),
      samples.length ? h('div', { class: 'sample-import-list' }, cards) : h('div', { class: 'business-rules-empty' }, [
        h('h3', { text: '样例库为空' }),
        h('p', { class: 'muted', text: '当前还没有可导入的样例。' })
      ])
    ]));
  };
  return { render };
}
