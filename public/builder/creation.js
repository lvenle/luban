import { h } from '../common/dom.js';
import { api } from '../common/api.js';
const types=[['text','单行文本'],['textarea','多行文本'],['number','数字'],['date','日期'],['datetime','日期时间'],['select','单选'],['multiSelect','多选'],['file','附件'],['image','图片']];

export function openCreationDialog(existing=null) {
  document.querySelector('.creation-backdrop')?.remove();
  const controller=new AbortController();
  let plan=existing,proposal=existing?structuredClone(existing.proposal):null,busy=false;
  const error=h('p',{class:'creation-error',role:'alert'});
  const steps=h('div',{class:'creation-steps',text:'1 描述需求　→　2 确认名称与数据表　→　3 创建草稿'});
  const content=h('div',{class:'creation-content'});
  const prompt=h('textarea',{rows:4,placeholder:'例如：创建采购管理，记录供应商、采购订单和采购明细。','aria-label':'应用需求'});
  const close=()=>{controller.abort();backdrop.remove();};
  const modal=h('section',{class:'modal creation-dialog',role:'dialog','aria-modal':'true','aria-label':'确认应用创建方案'},[
    h('div',{class:'toolbar'},[h('h2',{text:'创建应用'}),h('button',{class:'ghost',text:'关闭',onclick:close})]),steps,content,error
  ]);
  const backdrop=h('div',{class:'modal-backdrop creation-backdrop'},[modal]);document.body.append(backdrop);
  function showDemand() {
    content.replaceChildren(h('p',{class:'muted',text:'先说明需求，AI 会建议应用名称、数据表和基本字段。你确认后才会创建，不会自动执行。'}),
      h('label',{class:'field'},[h('span',{text:'应用需求'}),prompt]));
    const actions=h('div',{class:'toolbar'});
    const suggest=h('button',{class:'primary',text:'生成建议',onclick:()=>generate(false)});
    const manual=h('button',{class:'secondary',text:'手动填写方案',onclick:()=>generate(true)});
    actions.append(suggest,manual);content.append(actions);prompt.focus();
    async function generate(manually) {
      if(busy)return;error.textContent='';busy=true;suggest.disabled=manual.disabled=true;suggest.textContent=manually?'生成建议':'正在分析需求…';
      try {
        plan=await api('/api/creation-plans',{method:'POST',signal:controller.signal,body:JSON.stringify({prompt:prompt.value,manual:manually})});
        if(controller.signal.aborted)return;
        proposal=structuredClone(plan.proposal);showProposal();
      }catch(e){if(!controller.signal.aborted)error.textContent=e.message;}finally{busy=false;suggest.disabled=manual.disabled=false;suggest.textContent='生成建议';}
    }
  }
  function showProposal() {
    error.textContent='';content.replaceChildren(h('p',{class:'muted',text:'请检查下面的建议：可修改应用名称、勾选数据表，并增删或修改字段。确认后创建未发布草稿，正式使用前仍需发布。'}));
    const name=h('input',{value:proposal.name,'aria-label':'应用名称',maxlength:80,oninput:e=>proposal.name=e.target.value});
    const description=h('textarea',{rows:2,value:proposal.description,'aria-label':'应用说明',oninput:e=>proposal.description=e.target.value});
    content.append(h('label',{class:'field'},[h('span',{text:'应用名称'}),name]),h('label',{class:'field'},[h('span',{text:'应用说明'}),description]));
    const tables=h('div',{class:'creation-tables'});content.append(h('h3',{text:'创建哪些数据表？'}),tables);
    function drawTables() {
      tables.innerHTML='';proposal.tables.forEach((table,index)=>{
        const check=h('input',{type:'checkbox','aria-label':`创建数据表 ${table.name}`,onchange:e=>{table.selected=e.target.checked;drawTables();}});check.checked=table.selected!==false;
        const tableName=h('input',{value:table.name,'aria-label':`第 ${index+1} 张表名称`,oninput:e=>table.name=e.target.value});
        const fields=h('div',{class:'creation-fields'});
        table.fields.forEach((field,fieldIndex)=>{
          const label=h('input',{value:field.label,'aria-label':`第 ${index+1} 张表第 ${fieldIndex+1} 个字段名称`,oninput:e=>field.label=e.target.value});
          const type=h('select',{'aria-label':`第 ${index+1} 张表第 ${fieldIndex+1} 个字段类型`},types.map(([value,text])=>h('option',{value,text})));type.value=field.type;
          type.onchange=()=>{field.type=type.value;if(['select','multiSelect'].includes(type.value))field.options||=['选项一','选项二'];else delete field.options;drawTables();};
          const options=['select','multiSelect'].includes(field.type)?h('input',{value:(field.options||[]).join('，'),placeholder:'选项用逗号分隔','aria-label':`${field.label}的选项`,oninput:e=>field.options=e.target.value.split(/[,，]/).map(v=>v.trim()).filter(Boolean)}):null;
          fields.append(h('div',{class:'creation-field-row'},[label,type,options,h('button',{class:'ghost',text:'移除字段','aria-label':`移除字段 ${field.label}`,onclick:()=>{table.fields.splice(fieldIndex,1);drawTables();}})]));
        });
        const card=h('section',{class:`creation-table ${table.selected===false?'unselected':''}`},[
          h('div',{class:'creation-table-head'},[check,tableName,h('button',{class:'ghost',text:'删除表',onclick:()=>{proposal.tables.splice(index,1);drawTables();}})]),
          table.selected===false?h('p',{class:'muted',text:'这张表不会创建'}):fields,
          table.selected!==false?h('button',{class:'secondary',text:'添加字段',onclick:()=>{table.fields.push({label:'新字段',type:'text'});drawTables();}}):null
        ]);tables.append(card);
      });
    }
    drawTables();
    const summary=h('p',{class:'creation-summary',text:'点击下方按钮前，不会创建任何应用或业务数据。'});
    const confirm=h('button',{class:'primary',text:'确认并创建',onclick:async()=>{
      if(busy)return;busy=true;confirm.disabled=true;error.textContent='';
      try {
        const result=await api(`/api/creation-plans/${plan.planId}/confirm`,{method:'POST',body:JSON.stringify({confirmed:true,proposal})});
        close();document.dispatchEvent(new CustomEvent('luban-application-created',{detail:result}));
      }catch(e){error.textContent=e.message;confirm.disabled=false;}finally{busy=false;}
    }});
    content.append(h('button',{class:'secondary',text:'添加数据表',onclick:()=>{proposal.tables.push({name:'新数据表',selected:true,fields:[{label:'名称',type:'text'}]});drawTables();}}),summary,
      h('div',{class:'toolbar creation-footer'},[h('button',{class:'secondary',text:'重新描述需求',onclick:()=>{plan=null;proposal=null;showDemand();}}),h('button',{class:'secondary',text:'暂不创建',onclick:close}),confirm]));
    name.focus();
  }
  if(proposal)showProposal();else showDemand();
}
