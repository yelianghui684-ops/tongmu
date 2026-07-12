/** 外挂字幕：.srt 转 WebVTT，.vtt 直接用；中文字幕常见 GBK 编码需探测 */

/** UTF-8 严格解码失败则按 GBK 解（覆盖绝大多数中文字幕） */
export function decodeSubtitleBytes(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('gbk').decode(buf);
  }
}

/**
 * SRT → WebVTT：
 * - 去掉序号行，时间轴逗号改点
 * - 保留样式无关的纯文本行
 */
export function srtToVtt(srt: string): string {
  const lines = srt.replace(/^﻿/, '').split(/\r?\n/);
  const out: string[] = ['WEBVTT', ''];
  const timeRe = /^(\d{2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}),(\d{3})(.*)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = timeRe.exec(line.trim());
    if (m) {
      out.push(`${m[1]}.${m[2]} --> ${m[3]}.${m[4]}${m[5] ?? ''}`);
    } else if (/^\d+$/.test(line.trim()) && timeRe.test((lines[i + 1] ?? '').trim())) {
      // 序号行：跳过
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

/** 把字幕文件转成可挂到 <track> 的 blob URL */
export async function subtitleFileToVttUrl(file: File): Promise<string> {
  const text = decodeSubtitleBytes(await file.arrayBuffer());
  const vtt = file.name.toLowerCase().endsWith('.vtt') ? text : srtToVtt(text);
  return URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
}
