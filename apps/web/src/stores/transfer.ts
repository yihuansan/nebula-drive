import { defineStore } from 'pinia';

/** 全局传输任务（上传/下载），由 TransferCenter 统一展示 */
export interface TransferTask {
  id: string;
  name: string;
  kind: 'upload' | 'download';
  size: number;
  percent: number; // 0-100
  status: 'active' | 'done' | 'error';
  error?: string;
  uploadId?: string;
  startedAt: number;
}

const STORAGE_KEY = 'nd-transfer-tasks';
const MAX_TASKS = 60;

function loadSnapshot(): TransferTask[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const items = JSON.parse(raw);
    if (!Array.isArray(items)) return [];
    // 刷新后仍在进行的上传转为等待态（File 句柄已丢失，由文件页恢复队列）
    return items.map((t: TransferTask) => ({
      ...t,
      status: t.status === 'active' ? 'done' : t.status,
    }));
  } catch {
    return [];
  }
}

export const useTransferStore = defineStore('transfer', {
  state: () => ({
    tasks: loadSnapshot() as TransferTask[],
    expanded: false,
  }),
  getters: {
    activeCount: (state) => state.tasks.filter((t) => t.status === 'active').length,
    hasTasks: (state) => state.tasks.length > 0,
  },
  actions: {
    persist() {
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.tasks.slice(0, MAX_TASKS)));
      } catch { /* 忽略 */ }
    },
    nextId(kind: string) {
      return `${kind}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    },
    /** 登记一个上传任务（由文件页上传引擎调用），返回任务 id */
    startUpload(name: string, size: number, uploadId?: string): string {
      const id = this.nextId('u');
      this.tasks.unshift({ id, name, kind: 'upload', size, percent: 0, status: 'active', uploadId, startedAt: Date.now() });
      this.persist();
      return id;
    },
    /** 按 name+size 查找进行中的上传任务（刷新恢复场景） */
    findUpload(name: string, size: number): TransferTask | undefined {
      return this.tasks.find((t) => t.kind === 'upload' && t.name === name && t.size === size && t.status === 'active');
    },
    update(id: string, percent: number) {
      const t = this.tasks.find((x) => x.id === id);
      if (t) {
        t.percent = percent;
        if (t.status !== 'active') t.status = 'active';
        this.persist();
      }
    },
    finish(id: string) {
      const t = this.tasks.find((x) => x.id === id);
      if (t) {
        t.status = 'done';
        t.percent = 100;
        this.persist();
      }
    },
    fail(id: string, error: string) {
      const t = this.tasks.find((x) => x.id === id);
      if (t) {
        t.status = 'error';
        t.error = error;
        this.persist();
      }
    },
    remove(id: string) {
      const idx = this.tasks.findIndex((x) => x.id === id);
      if (idx >= 0) this.tasks.splice(idx, 1);
      this.persist();
    },
    clearFinished() {
      this.tasks = this.tasks.filter((t) => t.status === 'active');
      this.persist();
    },
    /** 登记一次下载（锚点/票据下载无法精确跟踪进度，短暂后置为完成） */
    addDownload(name: string, size = 0) {
      const id = this.nextId('d');
      this.tasks.unshift({ id, name, kind: 'download', size, percent: 100, status: 'active', startedAt: Date.now() });
      this.persist();
      setTimeout(() => this.finish(id), 1800);
      return id;
    },
  },
});
