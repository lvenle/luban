(()=>{
 let queue=Promise.resolve();
 function show(kind,message,initial=''){
  const action=queue.then(()=>new Promise(resolve=>{
   const previous=document.activeElement,dialog=document.createElement('dialog');dialog.className='platform-dialog';
   const heading=document.createElement('h2');heading.textContent=kind==='prompt'?'填写信息':kind==='alert'?'提示':'确认操作';
   const text=document.createElement('p');text.textContent=String(message??'');
   const form=document.createElement('form');form.method='dialog';let input;
   if(kind==='prompt'){input=document.createElement('input');input.value=String(initial??'');input.setAttribute('aria-label',String(message??'填写信息'));form.append(input)}
   const footer=document.createElement('footer');const cancel=document.createElement('button');cancel.type='button';cancel.textContent='取消';
   const submit=document.createElement('button');submit.type='submit';submit.className='primary';submit.textContent=kind==='alert'?'知道了':'确定';
   let settled=false;function finish(accepted){if(settled)return;settled=true;const value=kind==='prompt'?(accepted?input.value:null):kind==='confirm'?accepted:undefined;dialog.close();dialog.remove();if(previous?.isConnected)previous.focus();resolve(value)}
   cancel.onclick=()=>finish(false);dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false)});form.onsubmit=event=>{event.preventDefault();finish(true)};
   if(kind!=='alert')footer.append(cancel);footer.append(submit);form.append(footer);dialog.append(heading,text,form);document.body.append(dialog);dialog.setAttribute('aria-label',heading.textContent);dialog.showModal();(input||(kind==='confirm'?cancel:submit)).focus();input?.select();
  }));queue=action.catch(()=>{});return action;
 }
 globalThis.appConfirm=message=>show('confirm',message);
 globalThis.appPrompt=(message,initial)=>show('prompt',message,initial);
 globalThis.appAlert=message=>show('alert',message);
})();
