import {createSharedCache} from './shared-cache.js';
import {extractArticle} from '../knowledge/link-content.js';
import {fetchArticle} from './fetch-article.js';
import {articleMarkdown} from '../knowledge/article-markdown.js';
import {Type} from '../tools/schema.js';

export function createSharedLinks({fetchHtml=fetchArticle}={}){
  const cache=createSharedCache({maxEntries:8,ttlMs:10*60*1000});
  const fetch=address=>{
    const url=new URL(address);url.hash='';
    return cache.run(url.href,async()=>{
      const response=await fetchHtml(url.href);
      // Verification pages are not successful content and must not be cached.
      extractArticle(response.html,response.url||url.href);
      return response;
    });
  };
  const tool={name:'content.read_link',source:'platform',provider:'content',group:'内容获取',risk:'read',timeoutMs:60_000,
    description:'读取公开文章正文。与微信知识采集共用获取缓存；读取微信文章时优先使用本工具，避免重复获取。不绕过登录或验证码。',
    inputSchema:Type.Object({url:Type.String()}),execute:async({url})=>{
      const response=await fetch(url),article=extractArticle(response.html,response.url||url);
      // The reply receives textual content; article images are not OCRed.
      const parsed=articleMarkdown(article.bodyHtml,response.url||url);
      return {title:article.title,url:response.url||url,text:parsed.markdown.replace(/@@ARTICLE_IMAGE_\d+@@/g,'（正文图片）'),articleInfo:article.articleInfo};
    }};
  return {fetchHtml:fetch,tool};
}
