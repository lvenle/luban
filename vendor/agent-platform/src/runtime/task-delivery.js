// Domain-neutral requirements and artifact accounting. Only trusted adapters
// call this API; model text/tool arguments are proposals, never receipts.
const clone = value => structuredClone(value);
const stable = value => JSON.stringify(value, (_, v) => v && !Array.isArray(v) && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
export class TaskDelivery {
 constructor({question, messages = [], onEvent = () => {}, snapshot, requireReceipts = false} = {}) {
  if(typeof question !== 'string' || !question.trim()) throw TypeError('Original question required');
  this.question = question; this.messages = clone(messages); this.onEvent = onEvent;
  this.requireReceipts = requireReceipts; this.requirements = []; this.artifacts = new Map();
  this.disposition = 'running'; this.requirementsState = 'unresolved'; this.revision = 0; this.publication = null;
  if(snapshot) {
   if(snapshot.question !== question) throw Error('Delivery snapshot belongs to another question');
   this.messages = clone(snapshot.messages || messages); this.requireReceipts = snapshot.requireReceipts ?? requireReceipts;
   this.requirements = clone(snapshot.requirements || []); this.revision = snapshot.revision || 1;
   this.requirementsState = snapshot.requirementsState || (this.requirements.length ? 'ready' : 'unresolved');
   for(const a of snapshot.artifacts || []) this.artifacts.set(a.id, clone(a));
   this.setDisposition(snapshot.disposition || 'running'); this.publication = clone(snapshot.publication || null);
  }
 }
 setRequirements(items, {reason, actor = 'executor', expectedRevision = this.revision} = {}) {
  if(expectedRevision !== this.revision) throw Error('Task requirements version conflict');
  const ids = new Set(), sources = [this.question, ...this.messages.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : '')];
  if(!Array.isArray(items) || items.length > 30) throw Error('Invalid delivery requirements');
  for(const r of items) {
   if(!r || typeof r.id !== 'string' || !r.id || ids.has(r.id) || typeof r.request !== 'string' || !r.request.trim() || !sources.some(s => s.includes(r.request)) || typeof r.type !== 'string' || !r.type || !r.attributes || typeof r.attributes !== 'object' || Array.isArray(r.attributes)) throw Error('Requirements must be grounded in the original user request');
   if(this.requireReceipts && r.type === 'scope' && !Object.keys(r.attributes).length) throw Error('Scope requirements need explicit constraints');
   ids.add(r.id);
  }
  if(this.requirements.some(r => !ids.has(r.id))) throw Error('Existing delivery requirements cannot be removed');
  if(this.requirements.some(r => items.some(n => n.id === r.id && (n.request !== r.request || n.type !== r.type)))) throw Error('Requirement identity cannot change within a task');
  if(stable(items) === stable(this.requirements)) return this.revision;
  if(this.revision && !reason?.trim()) throw Error('Requirement binding changes need an explicit reason');
  this.requirements = clone(items); this.revision++; this.requirementsState = items.length ? 'ready' : 'unresolved'; this.publication = null;
  this.onEvent({type:'delivery_requirements_updated', revision:this.revision, actor, reason:reason || 'initial requirements', requirements:clone(items)});
  return this.revision;
 }
 matches(r, a) {
  return a.verified === true && (!this.requireReceipts || a.taskRevision === this.revision) && r.type === a.type && Object.entries(r.attributes).every(([k,v]) => Array.isArray(v) ? Array.isArray(a.attributes?.[k]) && v.every(x => a.attributes[k].includes(x)) : stable(a.attributes?.[k]) === stable(v));
 }
 registerArtifact(artifact) {
  if(!artifact?.id || !artifact.type || !artifact.attributes || artifact.verified !== true) throw Error('A verified artifact from a trusted adapter is required');
  if(this.requireReceipts && (!artifact.receipt?.producerCallId || !artifact.receipt?.contentVersion || !Array.isArray(artifact.receipt?.checks) || artifact.taskRevision !== this.revision)) throw Error('Artifact requires current task revision and validation receipt');
  const existing = this.artifacts.get(artifact.id);
  if(existing && (existing.verified === false || stable(existing) !== stable(artifact))) throw Error('Artifact identity already bound; create a new version');
  this.artifacts.set(artifact.id, clone(artifact));
  if(!existing) this.onEvent({type:'delivery_artifact_registered', artifact:clone(artifact)});
 }
 deriveArtifact(parentId, artifact) {
  const parent = this.artifacts.get(parentId); if(!parent || parent.verified !== true) throw Error('Unknown or invalid parent artifact');
  const lost = this.requirements.filter(r => this.matches(r,parent) && r.type === artifact.type && !this.matches(r,artifact));
  if(lost.length) { const e = Error('Transformation loses requested content: ' + lost.map(r=>r.request).join('、')); e.code = 'delivery_loss'; throw e; }
  this.registerArtifact({...artifact,inputArtifactIds:[...new Set([parentId,...(artifact.inputArtifactIds || [])])]});
 }
 invalidateArtifact(id, reason) {
  if(typeof reason !== 'string' || !reason.trim()) throw Error('Invalidation reason required');
  const ids = new Set([id]); let changed = true;
  while(changed) { changed = false; for(const a of this.artifacts.values()) if(!ids.has(a.id) && a.inputArtifactIds?.some(p=>ids.has(p))) { ids.add(a.id); changed = true; } }
  for(const key of ids) { const a = this.artifacts.get(key); if(a) this.artifacts.set(key,{...a,verified:false,invalidReason:reason}); }
  this.publication = null; this.disposition = 'running';
  this.onEvent({type:'delivery_artifacts_invalidated',artifactIds:[...ids],reason});
 }
 setDisposition(value) {
  if(!['running','complete','partial','waiting_for_user'].includes(value)) throw Error('Invalid delivery disposition');
  this.disposition = value;
 }
 assess({artifactIds = this.publication?.artifactIds, artifacts:proposed} = {}) {
  const artifacts = proposed || (artifactIds ? artifactIds.map(id=>this.artifacts.get(id)).filter(Boolean) : [...this.artifacts.values()]);
  const missing = this.requirements.filter(r=>!artifacts.some(a=>this.matches(r,a))).map(r=>({id:r.id,request:r.request}));
  if(this.requireReceipts && !artifactIds && !proposed && !this.publication) missing.push({id:'publication_missing',request:'发布已验证的最终产物'});
  if(this.requirementsState !== 'ready') missing.unshift({id:'requirements_unresolved',request:'确认本次任务的交付要求'});
  return {complete:this.requirementsState === 'ready' && !missing.length, missing, disposition:this.disposition, revision:this.revision, requirementsState:this.requirementsState, requirements:clone(this.requirements)};
 }
 publish({artifactIds, status = 'completed', expectedRevision = this.revision} = {}) {
  if(expectedRevision !== this.revision) throw Error('Task publication version conflict');
  if(!Array.isArray(artifactIds) || artifactIds.some(id=>!this.artifacts.has(id) || this.artifacts.get(id).verified !== true)) throw Error('Only valid registered artifacts can be published');
  if(!['completed','partial'].includes(status)) throw Error('Invalid publication status');
  const ids = [...new Set(artifactIds)].sort(), assessment = this.assess({artifactIds:ids});
  const result = {revision:this.revision, artifactIds:ids, status:assessment.complete ? 'completed' : 'partial', ...assessment};
  if(status === 'partial') result.status = 'partial';
  if(this.publication) {
   if(stable(this.publication.artifactIds) !== stable(ids) || this.publication.status !== result.status) throw Error('Task already published; create a new task revision');
   return clone(this.publication);
  }
  this.setDisposition(result.status === 'completed' ? 'complete' : 'partial'); result.disposition = this.disposition;
  this.publication = clone(result); this.onEvent({type:'delivery_published',...clone(result)}); return clone(result);
 }
 snapshot() {
  return clone({version:2,question:this.question,messages:this.messages,requireReceipts:this.requireReceipts,revision:this.revision,requirementsState:this.requirementsState,requirements:this.requirements,artifacts:[...this.artifacts.values()],disposition:this.disposition,publication:this.publication});
 }
}
