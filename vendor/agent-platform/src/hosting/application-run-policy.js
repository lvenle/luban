// Trusted host adapter. Product routing belongs here, never in AgentLoop or
// RunService. This policy can only require tools within existing host grants.
export function applicationRunPolicy({productId,applicationInstanceId,source}) {
 const reply=source==='wechat-auto-reply'||source==='wechat-simulated-draft';
 return {
  allowQuestionPreparation:!reply&&productId!=='smart-wechat'&&applicationInstanceId!=='smart-wechat',
  requireKnowledge:reply,
  conversationChannel:reply?'wechat':null,
  requiredToolNames:source==='wechat-auto-reply'?['wechat.send_message']:[],
  includePlanContext:!reply
 };
}
