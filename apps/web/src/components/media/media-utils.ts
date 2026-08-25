/**
 * 星云网盘 · 影视库工具集
 * 客户端海报抓取 / SRT·VTT 字幕解析 / 继续观看进度 / 通用辅助
 * 无第三方依赖，纯浏览器 API。
 */

export interface MediaItem {
  path: string; // 相对存储根，如 /7月18日(1).mp4
  name: string;
  size: number;
  mtime: number;
  ext: string;
  category: string;
  duration?: number; // 秒（海报抓取时获得）
  poster?: string; // dataURL（海报抓取后获得）
}

export interface ProgressEntry {
  time: number;
  duration: number;
  updatedAt: number;
}

export const VIDEO_EXTS = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'flv', 'wmv', 'm4v', 'ts', '3gp'];
export const DOC_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'txt', 'md'];
export const SUBTITLE_EXTS = ['srt', 'vtt'];

export function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

export function isVideoName(name: string): boolean {
  return VIDEO_EXTS.includes(extOf(name));
}

export function isSubtitleName(name: string): boolean {
  return SUBTITLE_EXTS.includes(extOf(name));
}

/** 取父目录名作为分类；根目录文件归入「未分类」 */
export function categoryOf(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 1) return '未分类';
  return parts[parts.length - 2] || '未分类';
}

export function baseName(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '');
}

/* ---------------- 预览 URL（?token= 支持原生 Range 拖动） ---------------- */

export function previewUrl(storageId: number, path: string, token: string): string {
  return `/api/v1/files/preview?storageId=${storageId}&path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`;
}

export function downloadUrl(storageId: number, path: string, token: string): string {
  return `/api/v1/files/download?storageId=${storageId}&path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`;
}

/* ---------------- 客户端海报抓取（seek ~8% → canvas → dataURL） ---------------- */

const POSTER_KEY = 'nebula_posters_v1';

interface PosterEntry {
  dataUrl: string;
  duration?: number;
  w?: number;
  h?: number;
  at: number;
}

type PosterCache = Record<string, PosterEntry>;

export function posterKey(storageId: number, path: string): string {
  return `${storageId}:${path}`;
}

export function getPosterCache(): PosterCache {
  try {
    return JSON.parse(localStorage.getItem(POSTER_KEY) || '{}') as PosterCache;
  } catch {
    return {};
  }
}

export function getCachedPoster(key: string): PosterEntry | null {
  return getPosterCache()[key] || null;
}

export function savePoster(key: string, entry: PosterEntry): void {
  const cache = getPosterCache();
  cache[key] = entry;
  persistPosterCache(cache);
}

function persistPosterCache(cache: PosterCache): void {
  try {
    localStorage.setItem(POSTER_KEY, JSON.stringify(cache));
  } catch {
    // 配额超限：按时间淘汰最旧的，直到能写入
    const keys = Object.keys(cache).sort((a, b) => cache[a].at - cache[b].at);
    while (keys.length) {
      delete cache[keys.shift() as string];
      try {
        localStorage.setItem(POSTER_KEY, JSON.stringify(cache));
        return;
      } catch {
        continue;
      }
    }
  }
}

/**
 * 抓取视频海报帧 + 时长。失败返回 null（调用方用渐变占位）。
 */
export function capturePoster(
  storageId: number,
  path: string,
  token: string,
  timeoutMs = 12000,
): Promise<PosterEntry | null> {
  const key = posterKey(storageId, path);
  const cached = getCachedPoster(key);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve) => {
    const video = document.createElement('video');
    let settled = false;
    const url = previewUrl(storageId, path, token);
    video.src = url;
    video.preload = 'metadata';
    video.muted = true; // 允许自动加载元数据

    const finish = (entry: PosterEntry | null) => {
      if (settled) return;
      settled = true;
      try {
        video.removeAttribute('src');
        video.load();
      } catch {
        /* ignore */
      }
      clearTimeout(timer);
      resolve(entry);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : undefined;
      // 目标时间点：8%，最少 1s，最多一半
      const target = duration ? Math.min(Math.max(duration * 0.08, 1), duration * 0.5) : 3;
      try {
        video.currentTime = target;
      } catch {
        finish(null);
      }
    };

    video.onseeked = () => {
      try {
        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 360;
        const scale = Math.min(1, 480 / Math.max(vw, vh));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(vw * scale));
        canvas.height = Math.max(1, Math.round(vh * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          finish(null);
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
        const duration = Number.isFinite(video.duration) ? video.duration : undefined;
        const entry: PosterEntry = {
          dataUrl,
          duration,
          w: video.videoWidth,
          h: video.videoHeight,
          at: Date.now(),
        };
        savePoster(key, entry);
        finish(entry);
      } catch {
        // canvas 被污染或绘制失败 → 无海报
        finish(null);
      }
    };

    video.onerror = () => finish(null);
  });
}

/* ---------------- 继续观看进度（localStorage） ---------------- */

const PROGRESS_KEY = 'nebula_progress_v1';

export function getAllProgress(): Record<string, ProgressEntry> {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}') as Record<string, ProgressEntry>;
  } catch {
    return {};
  }
}

export function getProgressFor(path: string): ProgressEntry | null {
  return getAllProgress()[path] || null;
}

export function saveProgress(path: string, time: number, duration: number): void {
  const all = getAllProgress();
  all[path] = { time, duration, updatedAt: Date.now() };
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export function clearProgress(path: string): void {
  const all = getAllProgress();
  delete all[path];
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

/* ---------------- SRT / VTT 字幕解析 ---------------- */

export interface SubtitleCue {
  start: number; // 秒
  end: number;
  text: string;
}

/** 把 "00:01:23,456" 或 "01:23.456" 解析为秒 */
function parseSubtitleTimestamp(ts: string): number {
  const t = ts.trim().replace(',', '.');
  const parts = t.split(':');
  if (parts.length === 3) {
    return (+parts[0]) * 3600 + (+parts[1]) * 60 + parseFloat(parts[2]);
  }
  if (parts.length === 2) {
    return (+parts[0]) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(t) || 0;
}

export function parseSRT(text: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const blocks = text.replace(/\r/g, '').replace(/\u0000/g, '').trim().split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.replace(/\n$/, '')).filter((l) => l.trim() !== '');
    if (lines.length < 2) continue;
    let tsIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}/.test(lines[i])) {
        tsIdx = i;
        break;
      }
    }
    if (tsIdx === -1) continue;
    const [s, e] = lines[tsIdx].split('-->');
    const start = parseSubtitleTimestamp(s);
    const end = parseSubtitleTimestamp(e);
    const body = lines.slice(tsIdx + 1).join('\n').trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues;
}

export function parseVTT(text: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/-->/.test(line)) {
      const [s, e] = line.split('-->');
      const start = parseSubtitleTimestamp(s);
      const end = parseSubtitleTimestamp(e);
      i++;
      const textLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== '') {
        // 跳过 cue 标识 / 样式行（以数字开头或含 position/style）
        if (!/^\d+$/.test(lines[i].trim()) && !/(^|\s)(position|align|size|line)(\s|=|$)/i.test(lines[i])) {
          textLines.push(lines[i]);
        }
        i++;
      }
      const body = textLines.join('\n').trim();
      if (body) cues.push({ start, end, text: body });
    } else {
      i++;
    }
  }
  return cues;
}

export function parseSubtitle(text: string, ext: string): SubtitleCue[] {
  if (ext === 'vtt') return parseVTT(text);
  return parseSRT(text);
}

/** 找到当前时间应对应的字幕 cue（线性，量小） */
export function cueAtTime(cues: SubtitleCue[], t: number): SubtitleCue | null {
  for (const c of cues) {
    if (t >= c.start && t < c.end) return c;
  }
  return null;
}

/* ---------------- 渐变占位（无海报时） ---------------- */

/** 由字符串生成稳定的色相，作为占位海报的渐变基调 */
export function hueFor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

export interface FormatDuration {
  text: string;
}

export function fmtDuration(sec?: number): string {
  if (!sec || !Number.isFinite(sec)) return '';
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

export function fmtClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}
