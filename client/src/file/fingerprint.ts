import type { FileFingerprint } from '@tongmu/shared';

const MB = 1024 * 1024;

/**
 * 快速文件指纹：大小 + SHA-256(头1MB + 中1MB + 尾1MB)。
 * GB 级文件也能在百毫秒级完成，用于双方"同一文件"校验与断点续传匹配。
 */
export async function computeFingerprint(file: File): Promise<FileFingerprint> {
  const sample =
    file.size <= 3 * MB
      ? file
      : new Blob([
          file.slice(0, MB),
          file.slice(Math.floor(file.size / 2 - MB / 2), Math.floor(file.size / 2 + MB / 2)),
          file.slice(file.size - MB),
        ]);
  const digest = await crypto.subtle.digest('SHA-256', await sample.arrayBuffer());
  return {
    name: file.name,
    size: file.size,
    mimeType: file.type,
    hash: toHex(digest),
  };
}

export function sameFingerprint(a: FileFingerprint, b: FileFingerprint): boolean {
  return a.size === b.size && a.hash === b.hash;
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 人类可读的文件大小 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * MB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / (1024 * MB)).toFixed(2)} GB`;
}
