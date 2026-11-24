import { fetchPublicHtml } from '../knowledge/link-content.js';
let articleFetchAt=0;
export async function fetchArticle(address){
  const wait=Math.max(0,articleFetchAt+1000-Date.now());articleFetchAt=Date.now()+wait;
  if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
  return fetchPublicHtml(address);
}
