import { applicationRequestContext } from './request-context.js';
import { WikiStore } from '../knowledge/wiki.js';
/** Read-only cross-application boundary. Each call rechecks the initiating identity. */
export function createKnowledgeSearchCapability({ knowledge, authorize }) {
  return async ({ libraryId, question }, { signal } = {}) => {
    const current = applicationRequestContext();
    if (!current || !authorize(current.identity, 'platform', 'knowledge')) { const error=new Error('当前用户无权检索企业知识库');error.status=403;throw error; }
    signal?.throwIfAborted();
    if (!/^[\w-]+$/.test(libraryId || '') || typeof question !== 'string' || !question.trim() || question.length>4000) throw Error('Invalid knowledge query');
    const snapshot = knowledge.snapshot(libraryId);
    const grounding = await new WikiStore(snapshot.root, { maxGroundingBytes: 40000 }).grounding(question);
    signal?.throwIfAborted();
    return { libraryId, version: snapshot.version, pages: grounding.pages, citations: grounding.pages.map((page,index)=>({number:index+1,libraryId,version:snapshot.version,path:page.path})) };
  };
}
