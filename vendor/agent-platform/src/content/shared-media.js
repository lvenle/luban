import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createSharedCache} from './shared-cache.js';

/** One runtime for automatic replies, ingest and explicit media tools/API calls. */
export function createSharedMediaRuntime(runtime){
  if(!runtime)return null;
  const cache=createSharedCache();
  const shared=Object.create(runtime);
  for(const method of ['analyzeImage','transcribeAudio','inspectVideo']){
    if(typeof runtime[method]!=='function')continue;
    shared[method]=async input=>{
      const info=await stat(input.path);
      if(!info.isFile()||info.size>50*1024*1024)throw Error('媒体文件无效或超过50MB');
      const bytes=await readFile(input.path);
      if(bytes.length>50*1024*1024)throw Error('媒体文件超过50MB');
      const {path,...options}=input;
      // Normalize the defaults used by both the manager and media tools.
      if(method==='analyzeImage')options.ocr ??= true;
      if(method==='inspectVideo')options.extractFrames ??= false;
      const normalized=Object.fromEntries(Object.entries(options).sort(([a],[b])=>a.localeCompare(b)));
      // Video results may include extracted frame paths: keep their source path scoped.
      const key=JSON.stringify([method,createHash('sha256').update(bytes).digest('hex'),normalized,method==='inspectVideo'?path:null]);
      return cache.run(key,()=>runtime[method](input));
    };
  }
  return shared;
}
