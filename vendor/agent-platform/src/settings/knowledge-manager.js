import { readdir, lstat, readFile, realpath } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export function createKnowledgeManager(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS wiki_config(id INTEGER PRIMARY KEY,value TEXT);
    CREATE TABLE IF NOT EXISTS wiki_sources(path TEXT PRIMARY KEY,page_id TEXT,hash TEXT,status TEXT,reason TEXT);
    CREATE TABLE IF NOT EXISTS wiki_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT,status TEXT,detail TEXT);`);
  let busy = false;
  const config = () => JSON.parse(db.prepare('SELECT value FROM wiki_config WHERE id=1').get()?.value || '{"enabled":true,"directory":"","builtDirectory":"","updatedAt":null}');
  const save = c => db.prepare('INSERT OR REPLACE INTO wiki_config VALUES(1,?)').run(JSON.stringify(c));
  const log = (state,detail) => db.prepare('INSERT INTO wiki_logs(at,status,detail) VALUES(?,?,?)').run(new Date().toISOString(),state,detail);
  function snapshot() { const files = db.prepare('SELECT * FROM wiki_sources ORDER BY path').all(); return { ...config(), busy, sourceCount:files.length, pageCount:files.filter(f=>f.status==='ready').length, skippedCount:files.filter(f=>f.status==='skipped').length, files, logs:db.prepare('SELECT at,status,detail FROM wiki_logs ORDER BY id DESC LIMIT 30').all() }; }
  async function build(full) {
    if(busy) throw Error('已有构建正在进行');
    const c=config(); if(!c.directory) throw Error('请先设置源目录');
    busy=true;
    try {
      const root=await realpath(c.directory); if(!(await lstat(root)).isDirectory())throw Error('来源不是目录');
      const files=[]; let bytes=0;
      async function scan(dir,relative='',depth=0){
        if(depth>20)throw Error('目录层级过深');
        for(const e of await readdir(dir,{withFileTypes:true})){
          const name=relative?relative+'/'+e.name:e.name;
          if(files.length>=1000)throw Error('来源超过 1000 项，请选择更小目录');
          if(e.name.startsWith('.')||e.isSymbolicLink()||['node_modules','build','dist'].includes(e.name)){files.push({path:name,status:'skipped',reason:'隐藏文件、缓存或符号链接'});continue;}
          if(e.isDirectory()){await scan(join(dir,e.name),name,depth+1);continue;}
          if(!e.isFile())continue;
          if(!['.md','.txt','.markdown','.json','.yaml','.yml','.csv','.tsv'].includes(extname(name).toLowerCase())){files.push({path:name,status:'skipped',reason:'当前版本尚无该格式解析器'});continue;}
          const stat=await lstat(join(dir,e.name));if(stat.size>100000){files.push({path:name,status:'skipped',reason:'超过单文件 100 KB 限制'});continue;}
          bytes+=stat.size;if(bytes>10000000)throw Error('目录文本超过 10 MB');
          const buffer=await readFile(join(dir,e.name));let text;
          try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer)}catch{files.push({path:name,status:'skipped',reason:'非 UTF-8 文本'});continue;}
          if(!text.trim()||text.includes('\0')){files.push({path:name,status:'skipped',reason:'空文件或二进制内容'});continue;}
          files.push({path:name,status:'ready',hash:createHash('sha256').update(buffer).digest('hex'),content:text});
        }
      }
      await scan(root);
      let changed=0,unchanged=0,removed=0;
      db.exec('BEGIN IMMEDIATE');
      try {
        const old=db.prepare('SELECT * FROM wiki_sources').all();const oldMap=new Map(old.map(f=>[f.path,f]));
        const incoming=new Set(files.filter(f=>f.status==='ready').map(f=>f.path));
        for(const f of old)if(f.page_id&&!incoming.has(f.path)){db.prepare('DELETE FROM knowledge_pages WHERE id=?').run(f.page_id);removed++;}
        db.prepare('DELETE FROM wiki_sources').run();
        for(const f of files){let id=null;if(f.status==='ready'){
          const prior=oldMap.get(f.path);id=prior?.page_id||randomUUID();
          if(!full&&c.builtDirectory===root&&prior?.hash===f.hash&&db.prepare('SELECT id FROM knowledge_pages WHERE id=?').get(id))unchanged++;
          else{db.prepare('INSERT OR REPLACE INTO knowledge_pages VALUES(?,?,?,?)').run(id,f.path,'# '+f.path+'\n\n来源：'+f.path+'\n\n'+f.content,new Date().toISOString());changed++;}
        }db.prepare('INSERT INTO wiki_sources VALUES(?,?,?,?,?)').run(f.path,id,f.hash||null,f.status,f.reason||null);}
        save({...c,builtDirectory:root,updatedAt:new Date().toISOString()});
        log('success',`${full?'完整重建':'增量更新'}：更新 ${changed}，未变 ${unchanged}，移除 ${removed}，跳过 ${files.filter(f=>f.status==='skipped').length}`);
        db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;}
      return {changed,unchanged,removed};
    }catch(e){log('failed',e.message);throw e;}finally{busy=false;}
  }
  return { config, async handle(method,url,input){
    if(url==='/knowledge/manage'&&method==='GET')return snapshot();
    if(url==='/knowledge/manage'&&method==='PATCH'){
      if(busy)throw Error('构建中，请稍后修改');const c=config();
      if(input.enabled!==undefined){if(typeof input.enabled!=='boolean')throw Error('启用状态无效');c.enabled=input.enabled;}
      if(input.directory!==undefined){if(typeof input.directory!=='string'||input.directory.length>4096)throw Error('目录无效');c.directory=input.directory.trim()?resolve(input.directory.trim()):'';}
      save(c);return snapshot();
    }
    if(url==='/knowledge/build'&&method==='POST')return build(input.full===true);
    if(url==='/knowledge/wiki'&&method==='GET'){
      const pages=db.prepare('SELECT id,title FROM knowledge_pages ORDER BY title').all();
      return {index:'# 知识库索引\n\n'+pages.map(p=>`- [[${p.id}|${p.title}]]`).join('\n'),overview:`# 知识库概览\n\n共 ${pages.length} 篇来源页。按标题定位后阅读全文，不使用向量索引。`,pages};
    }
    return undefined;
  }};
}
