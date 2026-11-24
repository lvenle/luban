import { Type } from '../tools/schema.js';

/** Canonical media contracts. Runtime-specific implementations are injected by the host. */
export function createMediaTools(runtime) {
  if (!runtime) throw new TypeError('media runtime is required');
  return [
    { name: 'media.analyze_image', source: 'platform', provider: 'media', group: '多媒体', risk: 'read', timeoutMs: 60_000,
      description: '使用本机或平台配置的图像解析能力分析图片并提取文字。',
      inputSchema: Type.Object({path: Type.String(), ocr: Type.Optional(Type.Boolean())}),
      execute: input => runtime.analyzeImage(input) },
    { name: 'media.transcribe_audio', source: 'platform', provider: 'media', group: '多媒体', risk: 'read', timeoutMs: 95_000,
      description: '使用本机或平台配置的语音识别能力转写音频。',
      inputSchema: Type.Object({path: Type.String(), language: Type.Optional(Type.String())}),
      execute: input => runtime.transcribeAudio(input) },
    { name: 'media.inspect_video', source: 'platform', provider: 'media', group: '多媒体', risk: 'read', timeoutMs: 95_000,
      description: '读取视频元数据，并按需提取关键帧。',
      inputSchema: Type.Object({path: Type.String(), extractFrames: Type.Optional(Type.Boolean()), maxFrames: Type.Optional(Type.Integer({minimum: 1, maximum: 12}))}),
      execute: input => runtime.inspectVideo(input) }
  ];
}
