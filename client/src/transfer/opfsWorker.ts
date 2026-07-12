/**
 * OPFS 写入 Worker：用 FileSystemSyncAccessHandle 顺序写盘。
 * 这是唯一的全浏览器兼容写入路径（Safari 不支持主线程 createWritable）。
 *
 * 消息协议（均带 reqId，回复 { reqId, ok, ... }）：
 *  open  { key, }            → { size }   打开/创建文件，返回已有字节数（断点续传起点）
 *  write { key, offset, buf } → {}        在 offset 写入（buf 以 transferable 传入）
 *  close { key }              → {}        flush 并关闭
 *  remove { key }             → {}        删除缓存文件
 */

interface Req {
  reqId: number;
  type: 'open' | 'write' | 'close' | 'remove';
  key: string;
  offset?: number;
  buf?: ArrayBuffer;
}

const handles = new Map<string, FileSystemSyncAccessHandle>();

async function getHandle(key: string): Promise<FileSystemSyncAccessHandle> {
  const existing = handles.get(key);
  if (existing) return existing;
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle('transfers', { create: true });
  const fh = await dir.getFileHandle(key, { create: true });
  const handle = await fh.createSyncAccessHandle();
  handles.set(key, handle);
  return handle;
}

self.onmessage = async (ev: MessageEvent<Req>) => {
  const { reqId, type, key } = ev.data;
  try {
    switch (type) {
      case 'open': {
        const handle = await getHandle(key);
        self.postMessage({ reqId, ok: true, size: handle.getSize() });
        return;
      }
      case 'write': {
        const handle = await getHandle(key);
        handle.write(new Uint8Array(ev.data.buf!), { at: ev.data.offset! });
        self.postMessage({ reqId, ok: true });
        return;
      }
      case 'close': {
        const handle = handles.get(key);
        if (handle) {
          handle.flush();
          handle.close();
          handles.delete(key);
        }
        self.postMessage({ reqId, ok: true });
        return;
      }
      case 'remove': {
        const handle = handles.get(key);
        if (handle) {
          handle.close();
          handles.delete(key);
        }
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle('transfers', { create: true });
        await dir.removeEntry(key).catch(() => {});
        self.postMessage({ reqId, ok: true });
        return;
      }
    }
  } catch (err) {
    self.postMessage({ reqId, ok: false, error: String(err) });
  }
};
