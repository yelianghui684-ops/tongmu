import { describe, expect, it } from 'vitest';
import { decodeSubtitleBytes, srtToVtt } from './subtitles';

describe('srtToVtt', () => {
  it('转换时间轴并去掉序号行', () => {
    const srt = ['1', '00:00:01,000 --> 00:00:03,500', '你好，世界', '', '2', '00:00:04,000 --> 00:00:06,000', '第二句', ''].join(
      '\n',
    );
    const vtt = srtToVtt(srt);
    expect(vtt).toContain('WEBVTT');
    expect(vtt).toContain('00:00:01.000 --> 00:00:03.500');
    expect(vtt).toContain('你好，世界');
    expect(vtt).not.toMatch(/^1$/m);
    expect(vtt).not.toContain(',000');
  });

  it('文本中的纯数字行不被误删', () => {
    const srt = ['1', '00:00:01,000 --> 00:00:02,000', '2024', ''].join('\n');
    expect(srtToVtt(srt)).toContain('2024');
  });
});

describe('decodeSubtitleBytes', () => {
  it('UTF-8 正常解码', () => {
    const buf = new TextEncoder().encode('中文字幕').buffer as ArrayBuffer;
    expect(decodeSubtitleBytes(buf)).toBe('中文字幕');
  });

  it('非法 UTF-8 回落到 GBK', () => {
    // "中文" 的 GBK 编码
    const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]);
    expect(decodeSubtitleBytes(gbk.buffer)).toBe('中文');
  });
});
