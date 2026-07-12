/** OPFS 写入 Worker 的主线程封装 + 读取/清理工具 */

interface Pending {
  resolve: (v: { size?: number }) => void;
  reject: (e: Error) => void;
}

export class OpfsWriter {
  private worker: Worker;
  private pending = new Map<number, Pending>();
  private nextId = 1;

  constructor() {
    this.worker = new Worker(new URL('./opfsWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev) => {
      const { reqId, ok, error, ...rest } = ev.data as {
        reqId: number;
        ok: boolean;
        error?: string;
        size?: number;
      };
      const p = this.pending.get(reqId);
      if (!p) return;
      this.pending.delete(reqId);
      if (ok) p.resolve(rest);
      else p.reject(new Error(error ?? 'OPFS worker error'));
    };
  }

  private call(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<{ size?: number }> {
    const reqId = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
      this.worker.postMessage({ ...msg, reqId }, transfer);
    });
  }

  /** 打开/创建缓存文件，返回已有字节数（断点续传起点） */
  async open(key: string): Promise<number> {
    const { size } = await this.call({ type: 'open', key });
    return size ?? 0;
  }

  write(key: string, offset: number, buf: ArrayBuffer): Promise<unknown> {
    return this.call({ type: 'write', key, offset, buf }, [buf]);
  }

  close(key: string): Promise<unknown> {
    return this.call({ type: 'close', key });
  }

  remove(key: string): Promise<unknown> {
    return this.call({ type: 'remove', key });
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}

/** 从 OPFS 读出缓存文件（用于播放）；不存在返回 null */
export async function readOpfsFile(key: string, name: string, mimeType: string): Promise<File | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('transfers', { create: true });
    const fh = await dir.getFileHandle(key);
    const raw = await fh.getFile();
    return new File([raw], name, { type: mimeType });
  } catch {
    return null;
  }
}

export function opfsSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
}
