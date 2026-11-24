/** 冻结决议 37：运行时选中的模型不可用时，Run 直接失败的错误码。不静默切换其他模型。 */
export const MODEL_UNAVAILABLE = 'MODEL_UNAVAILABLE';
export class ModelUnavailableError extends Error {
  constructor(message = '模型当前不可用') {
    super(message);
    this.name = 'ModelUnavailableError';
    this.code = MODEL_UNAVAILABLE;
  }
}
export function explainProviderError(message, {productName='Agent'}={}) {
  if (/HTTP 503\b/i.test(message) || /service is too busy/i.test(message)) {
    return `模型服务当前繁忙（503），${productName}已重试但仍未成功。请稍后重试，本次消息尚未处理完成。`;
  }
  if (/^(?:Connection error\.?|Request timed out\.?)$/i.test(message) || /\bfetch failed\b/i.test(message)) {
    return `连接模型服务失败，${productName}已重试但仍未成功。请检查网络、Base URL 或稍后重试，本次消息尚未处理完成。`;
  }
  return message;
}
