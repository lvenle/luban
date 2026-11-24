import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Extract inline media before any runtime payload is written to SQLite. */
export function persistMediaReferences(value,directory) {
  const save=(data,mimeType='application/octet-stream')=>{
    const bytes=Buffer.from(data,'base64');
    const sha256=createHash('sha256').update(bytes).digest('hex');
    const folder=join(directory,'.runtime-media');
    mkdirSync(folder,{recursive:true,mode:0o700});
    const path=join(folder,sha256+'.bin');
    try { writeFileSync(path,bytes,{flag:'wx',mode:0o600}); }
    catch(error) {
      if(error.code!=='EEXIST')throw error;
      if(createHash('sha256').update(readFileSync(path)).digest('hex')!==sha256)throw Error('Stored media checksum mismatch');
    }
    return {path,mimeType,bytes:bytes.length,sha256,kind:mimeType.startsWith('image/')?'image':'file',source:'runtime-inline'};
  };
  const visit=item=>{
    if(typeof item==='string') {
      const match=/^data:([^;,]+);base64,([a-zA-Z0-9+/=\r\n]+)$/.exec(item);
      if(match)return {type:'file_ref',attachment:save(match[2],match[1])};
      // Tool envelopes are often JSON encoded a second time.
      if(item.includes(';base64,')&&/^[\[{]/.test(item.trim())) {
        let parsed;
        try {parsed=JSON.parse(item);} catch {return item;}
        return JSON.stringify(visit(parsed));
      }
      return item;
    }
    if(Array.isArray(item))return item.map(visit);
    if(!item||typeof item!=='object')return item;
    if(item.type==='image_url'&&/^data:/.test(item.image_url?.url||'')) {
      const ref=visit(item.image_url.url);
      if(ref?.attachment)return {type:'image_ref',attachment:ref.attachment};
    }
    if(['image','audio'].includes(item.type)&&typeof item.data==='string') {
      const {data,...rest}=item;
      return {...visit(rest),type:item.type+'_ref',attachment:save(data,item.mimeType)};
    }
    if(item.blob&&typeof item.blob==='string') {
      const {blob,...rest}=item;return {...visit(rest),attachment:save(blob,item.mimeType)};
    }
    return Object.fromEntries(Object.entries(item).map(([key,part])=>[key,visit(part)]));
  };
  return visit(value);
}

/** Restore only media previously stored in this instance, checking its digest. */
export function restoreMediaReferences(value, directory) {
  const visit = item => {
    if (Array.isArray(item)) return item.map(visit);
    if (!item || typeof item !== 'object') return item;
    if (item.type === 'image_ref' && item.attachment?.source === 'runtime-inline') {
      const {sha256,mimeType} = item.attachment;
      if (!/^[a-f0-9]{64}$/.test(sha256 || '') || !/^image\/(png|jpeg|gif|webp)$/.test(mimeType || '')) throw Error('Invalid stored image reference');
      const data = readFileSync(join(directory,'.runtime-media',sha256+'.bin'));
      if (createHash('sha256').update(data).digest('hex') !== sha256) throw Error('Stored image checksum mismatch');
      return {type:'image_url',image_url:{url:`data:${mimeType};base64,${data.toString('base64')}`}};
    }
    return Object.fromEntries(Object.entries(item).map(([key,part]) => [key,visit(part)]));
  };
  return visit(value);
}
