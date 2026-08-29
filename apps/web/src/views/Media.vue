<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api, downloadFile, fmtSize, fmtTime, loadThumbs } from '../api';
import MediaHero from '../components/media/MediaHero.vue';
import VideoCard from '../components/media/VideoCard.vue';
import VideoPlayer, { type SubtitleTrack } from '../components/media/VideoPlayer.vue';
import {
  baseName,
  categoryOf,
  extOf,
  getAllProgress,
  getCachedPoster,
  isSubtitleName,
  isVideoName,
  parseSubtitle,
  posterKey,
  previewUrl,
  capturePoster,
  type MediaItem,
  type ProgressEntry,
} from '../components/media/media-utils';
import '../components/media/media.css';

interface StorageInfo {
  id: number;
  name: string;
  type: string;
  enabled: boolean;
}
interface DocEntry {
  path: string;
  name: string;
  size: number;
  mtime: number;
}
interface MediaEntry extends DocEntry {
  ext: string;
}

const storages = ref<StorageInfo[]>([]);
const storageId = ref<number | null>(null);
const videos = ref<MediaItem[]>([]);
const docs = ref<DocEntry[]>([]);
const images = ref<MediaEntry[]>([]);
const audios = ref<MediaEntry[]>([]);
const loading = ref(false);
const mode = ref<'video' | 'document' | 'image' | 'audio'>('video');

const filterCategory = ref('');
const searchQuery = ref('');
const sortBy = ref<'name' | 'time' | 'size'>('time');
const sortOrder = ref<'asc' | 'desc'>('desc');

const progress = ref<Record<string, ProgressEntry>>(getAllProgress());
const token = computed(() => localStorage.getItem('nebula_token') || '');

const playingItem = ref<MediaItem | null>(null);
const playerSubtitles = ref<SubtitleTrack[]>([]);
const playerInitialTime = ref(0);
const subtitleBusy = ref(false);

let posterJobs = 0;
let posterQueue: MediaItem[] = [];
let posterRunning = false;

/* ---------------- 数据加载 ---------------- */

async function loadStorages() {
  const r = await api<any>('/storages?fast=1');
  storages.value = (r.storages || []).filter((s: StorageInfo) => s.enabled);
  storageId.value = storages.value[0]?.id ?? null;
  await loadMedia();
}

async function loadMedia() {
  if (storageId.value === null) return;
  loading.value = true;
  try {
    const [vRes, dRes, iRes, aRes] = await Promise.all([
      api<any>(`/files/by-type?storageId=${storageId.value}&type=video`),
      api<any>(`/files/by-type?storageId=${storageId.value}&type=document`),
      api<any>(`/files/by-type?storageId=${storageId.value}&type=image`),
      api<any>(`/files/by-type?storageId=${storageId.value}&type=audio`),
    ]);
    const sid = storageId.value;
    videos.value = (vRes.entries || [])
      .filter((e: any) => !e.isDir && isVideoName(e.name))
      .map((e: any) => {
        const key = posterKey(sid, e.path);
        const cached = getCachedPoster(key);
        return {
          path: e.path,
          name: e.name,
          size: e.size,
          mtime: e.mtime,
          ext: extOf(e.name),
          category: categoryOf(e.path),
          poster: cached?.dataUrl,
          duration: cached?.duration,
        } as MediaItem;
      });
    docs.value = (dRes.entries || [])
      .filter((e: any) => !e.isDir)
      .map((e: any) => ({ path: e.path, name: e.name, size: e.size, mtime: e.mtime }));
    images.value = (iRes.entries || [])
      .filter((e: any) => !e.isDir)
      .map((e: any) => ({ path: e.path, name: e.name, size: e.size, mtime: e.mtime, ext: extOf(e.name) }));
    audios.value = (aRes.entries || [])
      .filter((e: any) => !e.isDir)
      .map((e: any) => ({ path: e.path, name: e.name, size: e.size, mtime: e.mtime, ext: extOf(e.name) }));
    startImageThumbs();
    startPosterCapture();
  } finally {
    loading.value = false;
  }
}

/* ---------------- 图片库 ---------------- */

/* 缩略图修复：缩略图端点仅接受 Bearer 头，裸 <img src> 会 401；
   改走 loadThumbs（带鉴权 fetch → blob URL） */
const mediaThumbs = ref<Record<string, string>>({});
let abortThumbs: (() => void) | null = null;
function startImageThumbs() {
  abortThumbs?.();
  mediaThumbs.value = {};
  const sid = storageId.value;
  if (sid === null) return;
  abortThumbs = loadThumbs(
    images.value.map((e) => ({ storageId: sid, path: e.path })),
    (path, url) => {
      if (storageId.value === sid) mediaThumbs.value[path] = url;
    },
    400
  );
}
const bigPreview = ref<MediaEntry | null>(null);
function openImagePreview(e: MediaEntry) {
  bigPreview.value = e;
}

/* ---------------- 音频库 ---------------- */

const audioPlaying = ref<MediaEntry | null>(null);
function playAudio(e: MediaEntry) {
  audioPlaying.value = e;
}
function closeAudio() {
  audioPlaying.value = null;
}

const filteredImages = computed(() => {
  let list = images.value;
  const q = searchQuery.value.trim().toLowerCase();
  if (q) list = list.filter((e) => e.name.toLowerCase().includes(q));
  return [...list].sort((a, b) => {
    let r = 0;
    if (sortBy.value === 'name') r = a.name.localeCompare(b.name, 'zh');
    else if (sortBy.value === 'time') r = a.mtime - b.mtime;
    else r = a.size - b.size;
    return sortOrder.value === 'asc' ? r : -r;
  });
});

/* 按修改时间分组（对标相册类产品：今天 / 本周 / 更早），写法对齐 Recent.vue 分组助手 */
const groupByTime = ref(true);
const imageGroups = computed(() => {
  if (!groupByTime.value) return [{ title: '', items: filteredImages.value }];
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startWeek = startToday - 6 * 86400000;
  const today: MediaEntry[] = [];
  const week: MediaEntry[] = [];
  const earlier: MediaEntry[] = [];
  for (const e of filteredImages.value) {
    const t = e.mtime || 0;
    if (t >= startToday) today.push(e);
    else if (t >= startWeek) week.push(e);
    else earlier.push(e);
  }
  return [
    { title: '今天', items: today },
    { title: '本周', items: week },
    { title: '更早', items: earlier },
  ].filter((s) => s.items.length);
});

const filteredAudios = computed(() => {
  let list = audios.value;
  const q = searchQuery.value.trim().toLowerCase();
  if (q) list = list.filter((e) => e.name.toLowerCase().includes(q));
  return [...list].sort((a, b) => {
    let r = 0;
    if (sortBy.value === 'name') r = a.name.localeCompare(b.name, 'zh');
    else if (sortBy.value === 'time') r = a.mtime - b.mtime;
    else r = a.size - b.size;
    return sortOrder.value === 'asc' ? r : -r;
  });
});

/* ---------------- 海报抓取（后台，并发 2） ---------------- */

function startPosterCapture() {
  const need = videos.value.filter((v) => !v.poster).slice(0, 20);
  posterQueue = need;
  pumpPosters();
}

async function pumpPosters() {
  if (posterRunning) return;
  posterRunning = true;
  while (posterQueue.length && posterJobs < 2) {
    const item = posterQueue.shift() as MediaItem;
    posterJobs++;
    capturePoster(storageId.value!, item.path, token.value)
      .then((entry) => {
        if (entry) {
          item.poster = entry.dataUrl;
          item.duration = entry.duration;
        }
      })
      .catch(() => {})
      .finally(() => {
        posterJobs--;
        if (posterQueue.length) pumpPosters();
        else posterRunning = false;
      });
  }
  if (!posterQueue.length) posterRunning = false;
}

/* ---------------- 筛选 / 排序 ---------------- */

const categories = computed(() => {
  const set = new Set(videos.value.map((v) => v.category));
  return [...set].sort((a, b) => a.localeCompare(b, 'zh'));
});

const filteredVideos = computed(() => {
  let list = videos.value;
  if (filterCategory.value) list = list.filter((v) => v.category === filterCategory.value);
  const q = searchQuery.value.trim().toLowerCase();
  if (q) list = list.filter((v) => v.name.toLowerCase().includes(q));
  return [...list].sort((a, b) => {
    let r = 0;
    if (sortBy.value === 'name') r = a.name.localeCompare(b.name, 'zh');
    else if (sortBy.value === 'time') r = a.mtime - b.mtime;
    else r = a.size - b.size;
    return sortOrder.value === 'asc' ? r : -r;
  });
});

const heroItems = computed(() => [...videos.value].sort((a, b) => b.size - a.size).slice(0, 6));

const continueItems = computed(() =>
  videos.value
    .map((v) => ({ item: v, p: progress.value[v.path] }))
    .filter((x) => x.p && x.p.time > 3 && x.p.time < x.p.duration * 0.95)
    .sort((a, b) => b.p.updatedAt - a.p.updatedAt)
    .slice(0, 8),
);

/* ---------------- 播放 ---------------- */

function play(item: MediaItem) {
  const p = progress.value[item.path];
  playerInitialTime.value = p && p.time > 0 && p.time < p.duration * 0.9 ? p.time : 0;
  playerSubtitles.value = [];
  playingItem.value = item;
  detectSubtitles(item);
}

async function detectSubtitles(item: MediaItem) {
  subtitleBusy.value = true;
  try {
    const dir = item.path.split('/').slice(0, -1).join('/') || '/';
    const base = baseName(item.name);
    const r = await api<any>(`/files?storageId=${storageId.value}&path=${encodeURIComponent(dir)}`);
    const subs = (r.entries || [])
      .filter((e: any) => !e.isDir && isSubtitleName(e.name) && baseName(e.name) === base)
      .map((e: any) => e.name as string);
    const tracks: SubtitleTrack[] = [];
    for (const subName of subs) {
      const subPath = (dir === '/' ? '' : dir) + '/' + subName;
      const text = await fetchText(subPath);
      const cues = parseSubtitle(text, extOf(subName));
      if (cues.length) tracks.push({ label: baseName(subName), cues });
    }
    playerSubtitles.value = tracks;
  } catch {
    /* 无字幕或探测失败 */
  } finally {
    subtitleBusy.value = false;
  }
}

async function fetchText(path: string): Promise<string> {
  const res = await fetch(previewUrl(storageId.value!, path, token.value));
  if (!res.ok) throw new Error('fetch failed');
  return res.text();
}

function onSubtitleFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result as string;
    const cues = parseSubtitle(text, extOf(file.name));
    playerSubtitles.value = [...playerSubtitles.value, { label: baseName(file.name), cues }];
  };
  reader.readAsText(file);
  input.value = '';
}

function onProgress(path: string, time: number, duration: number) {
  if (!Number.isFinite(duration) || !Number.isFinite(time)) return;
  progress.value[path] = { time, duration, updatedAt: Date.now() };
}

function closePlayer() {
  playingItem.value = null;
  playerSubtitles.value = [];
}

/* ---------------- 文档模式 ---------------- */

const filteredDocs = computed(() => {
  let list = docs.value;
  const q = searchQuery.value.trim().toLowerCase();
  if (q) list = list.filter((d) => d.name.toLowerCase().includes(q));
  return [...list].sort((a, b) => {
    let r = 0;
    if (sortBy.value === 'name') r = a.name.localeCompare(b.name, 'zh');
    else if (sortBy.value === 'time') r = a.mtime - b.mtime;
    else r = a.size - b.size;
    return sortOrder.value === 'asc' ? r : -r;
  });
});

async function downloadDoc(d: DocEntry) {
  await downloadFile('/files/download', { storageId: String(storageId.value), path: d.path }, d.name);
}

/* ---------------- 生命周期 ---------------- */

watch(storageId, () => {
  filterCategory.value = '';
  loadMedia();
});

onMounted(() => {
  loadStorages();
});

onBeforeUnmount(() => {
  posterRunning = false;
  abortThumbs?.();
});
</script>

<template>
  <div class="nd-library">
    <!-- 页头 -->
    <div class="nd-pagehead">
      <h2>媒体库</h2>
      <div class="nd-controls">
        <el-select
          v-model="storageId"
          style="width: 200px"
          :loading="loading"
          @change="loadMedia"
        >
          <el-option v-for="s in storages" :key="s.id" :label="s.name" :value="s.id" />
        </el-select>
        <el-radio-group v-model="mode">
          <el-radio-button value="video">视频<span class="mode-count">{{ videos.length }}</span></el-radio-button>
          <el-radio-button value="image">图片<span class="mode-count">{{ images.length }}</span></el-radio-button>
          <el-radio-button value="audio">音频<span class="mode-count">{{ audios.length }}</span></el-radio-button>
          <el-radio-button value="document">文档<span class="mode-count">{{ docs.length }}</span></el-radio-button>
        </el-radio-group>
      </div>
    </div>

    <!-- 视频模式 -->
    <template v-if="mode === 'video'">
      <MediaHero :items="heroItems" :progress="progress" @play="play" />

      <!-- 继续观看 -->
      <div class="nd-section" v-if="continueItems.length">
        <div class="nd-section-head">
          <h3 class="nd-section-title">继续观看</h3>
        </div>
        <div class="nd-continue-row">
          <div
            v-for="c in continueItems"
            :key="c.item.path"
            class="nd-continue-card"
            @click="play(c.item)"
          >
            <div
              class="nd-continue-thumb"
              :style="c.item.poster
                ? { backgroundImage: `url(${c.item.poster})` }
                : { background: `linear-gradient(135deg, var(--accent) 0%, var(--bg) 130%)` }"
            ></div>
            <div class="nd-continue-scrim"></div>
            <div class="nd-continue-name">{{ c.item.name }}</div>
            <span class="nd-continue-remain">
              {{ Math.max(0, Math.round((c.p.duration - c.p.time) / 60)) }} 分钟剩余
            </span>
            <div class="nd-continue-bar">
              <div
                class="nd-continue-fill"
                :style="{ width: Math.min(100, (c.p.time / c.p.duration) * 100) + '%' }"
              ></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 工具栏 -->
      <div class="nd-toolbar">
        <div class="nd-chips">
          <button class="nd-chip" :class="{ 'is-active': filterCategory === '' }" @click="filterCategory = ''">
            全部
          </button>
          <button
            v-for="cat in categories"
            :key="cat"
            class="nd-chip"
            :class="{ 'is-active': filterCategory === cat }"
            @click="filterCategory = cat"
          >
            {{ cat }}
          </button>
        </div>
        <div class="nd-spacer"></div>
        <el-input
          v-model="searchQuery"
          placeholder="搜索视频…"
          clearable
          style="width: 220px"
          :prefix-icon="'Search'"
        />
        <el-select v-model="sortBy" style="width: 110px">
          <el-option label="按时间" value="time" />
          <el-option label="按名称" value="name" />
          <el-option label="按大小" value="size" />
        </el-select>
        <el-button @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'">
          {{ sortOrder === 'asc' ? '升序' : '降序' }}
        </el-button>
        <span class="nd-count">{{ filteredVideos.length }} 部</span>
      </div>

      <!-- 影视墙 -->
      <div class="nd-wall" v-if="filteredVideos.length">
        <VideoCard
          v-for="v in filteredVideos"
          :key="v.path"
          :item="v"
          :progress="progress[v.path]"
          @play="play"
        />
      </div>
      <div class="nd-empty" v-else>
        <el-icon :size="48"><VideoCamera /></el-icon>
        <h3>暂无视频内容</h3>
        <p>该存储下还没有视频文件，上传后即可在此浏览和播放</p>
      </div>
    </template>

    <!-- 图片模式 -->
    <template v-if="mode === 'image'">
      <div class="nd-toolbar">
        <div class="nd-spacer"></div>
        <el-input
          v-model="searchQuery"
          placeholder="搜索图片…"
          clearable
          style="width: 220px"
          :prefix-icon="'Search'"
        />
        <el-select v-model="sortBy" style="width: 110px">
          <el-option label="按时间" value="time" />
          <el-option label="按名称" value="name" />
          <el-option label="按大小" value="size" />
        </el-select>
        <el-button @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'">
          {{ sortOrder === 'asc' ? '升序' : '降序' }}
        </el-button>
        <el-button :type="groupByTime ? 'primary' : undefined" plain @click="groupByTime = !groupByTime">
          时间分组
        </el-button>
        <span class="nd-count">{{ filteredImages.length }} 张</span>
      </div>

      <!-- 时间分组视图（今天 / 本周 / 更早） -->
      <template v-if="filteredImages.length && groupByTime">
        <div v-for="sec in imageGroups" :key="sec.title" class="nd-image-group">
          <div class="nd-group-title">{{ sec.title }}<span class="nd-group-count">{{ sec.items.length }}</span></div>
          <div class="nd-image-grid">
            <div
              v-for="img in sec.items"
              :key="img.path"
              class="nd-image-card"
              @click="openImagePreview(img)"
            >
              <img v-if="mediaThumbs[img.path]" :src="mediaThumbs[img.path]" :alt="img.name" loading="lazy" />
              <div v-else class="nd-image-ph">
                <el-icon :size="40"><Picture /></el-icon>
              </div>
              <div class="nd-image-name">{{ img.name }}</div>
              <div class="nd-image-meta">{{ fmtSize(img.size) }}</div>
            </div>
          </div>
        </div>
      </template>
      <div class="nd-image-grid" v-else-if="filteredImages.length">
        <div
          v-for="img in filteredImages"
          :key="img.path"
          class="nd-image-card"
          @click="openImagePreview(img)"
        >
          <img v-if="mediaThumbs[img.path]" :src="mediaThumbs[img.path]" :alt="img.name" loading="lazy" />
          <div v-else class="nd-image-ph">
            <el-icon :size="40"><Picture /></el-icon>
          </div>
          <div class="nd-image-name">{{ img.name }}</div>
          <div class="nd-image-meta">{{ fmtSize(img.size) }}</div>
        </div>
      </div>
      <div class="nd-empty" v-else>
        <el-icon :size="48"><Picture /></el-icon>
        <h3>暂无图片</h3>
        <p>该存储下还没有图片文件，上传后即可在此浏览</p>
      </div>
    </template>

    <!-- 音频模式 -->
    <template v-if="mode === 'audio'">
      <div class="nd-toolbar">
        <div class="nd-spacer"></div>
        <el-input
          v-model="searchQuery"
          placeholder="搜索音频…"
          clearable
          style="width: 220px"
          :prefix-icon="'Search'"
        />
        <el-select v-model="sortBy" style="width: 110px">
          <el-option label="按时间" value="time" />
          <el-option label="按名称" value="name" />
          <el-option label="按大小" value="size" />
        </el-select>
        <el-button @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'">
          {{ sortOrder === 'asc' ? '升序' : '降序' }}
        </el-button>
        <span class="nd-count">{{ filteredAudios.length }} 个</span>
      </div>

      <div class="nd-audio-list" v-if="filteredAudios.length">
        <div v-for="a in filteredAudios" :key="a.path" class="nd-audio-card">
          <button class="nd-audio-play" @click="playAudio(a)" title="播放">
            <el-icon><CaretRight /></el-icon>
          </button>
          <div class="nd-audio-info">
            <div class="nd-audio-name" :title="a.name">{{ a.name }}</div>
            <div class="nd-audio-meta">
              <span>{{ a.ext.toUpperCase() }}</span>
              <span>{{ fmtSize(a.size) }}</span>
              <span>{{ fmtTime(a.mtime) }}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="nd-empty" v-else>
        <el-icon :size="48"><Headset /></el-icon>
        <h3>暂无音频</h3>
        <p>该存储下还没有音频文件</p>
      </div>
    </template>

    <!-- 文档模式 -->
    <template v-if="mode === 'document'">
      <div class="nd-toolbar">
        <div class="nd-spacer"></div>
        <el-input
          v-model="searchQuery"
          placeholder="搜索文档…"
          clearable
          style="width: 220px"
          :prefix-icon="'Search'"
        />
        <el-select v-model="sortBy" style="width: 110px">
          <el-option label="按时间" value="time" />
          <el-option label="按名称" value="name" />
          <el-option label="按大小" value="size" />
        </el-select>
        <el-button @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'">
          {{ sortOrder === 'asc' ? '升序' : '降序' }}
        </el-button>
        <span class="nd-count">{{ filteredDocs.length }} 个</span>
      </div>

      <div class="nd-doc-grid">
        <div v-for="d in filteredDocs" :key="d.path" class="nd-doc-card">
          <div class="nd-doc-icon">
            <el-icon :size="40"><Document /></el-icon>
          </div>
          <div class="nd-doc-info">
            <div class="nd-doc-name" :title="d.name">{{ d.name }}</div>
            <div class="nd-doc-meta">
              <span>{{ fmtSize(d.size) }}</span>
              <span>{{ fmtTime(d.mtime) }}</span>
            </div>
          </div>
          <button class="nd-doc-download" @click="downloadDoc(d)" title="下载">
            <el-icon><Download /></el-icon>
          </button>
        </div>
      </div>
      <div class="nd-empty" v-if="!filteredDocs.length">
        <el-icon :size="48"><Document /></el-icon>
        <h3>暂无文档</h3>
        <p>该存储下还没有文档文件</p>
      </div>
    </template>

    <!-- 大图预览 -->
    <el-dialog
      v-model="bigPreview"
      :title="bigPreview?.name"
      width="90%"
      :show-close="true"
      @close="bigPreview = null"
    >
      <img
        v-if="bigPreview"
        :src="previewUrl(storageId!, bigPreview.path, token)"
        :alt="bigPreview.name"
        class="nd-big-image"
      />
      <div v-if="bigPreview" class="nd-big-meta">
        <span>{{ fmtSize(bigPreview.size) }}</span>
        <span>{{ fmtTime(bigPreview.mtime) }}</span>
      </div>
    </el-dialog>

    <!-- 音频播放器 -->
    <el-dialog
      v-model="audioPlaying"
      :title="audioPlaying?.name"
      width="480px"
      @close="closeAudio"
    >
      <div v-if="audioPlaying" class="nd-audio-player">
        <audio :src="previewUrl(storageId!, audioPlaying.path, token)" controls autoplay />
        <div class="nd-audio-player-meta">
          <span>{{ audioPlaying.ext.toUpperCase() }}</span>
          <span>{{ fmtSize(audioPlaying.size) }}</span>
        </div>
      </div>
    </el-dialog>

    <!-- 播放器 -->
    <VideoPlayer
      v-if="playingItem"
      :item="playingItem"
      :storageId="storageId"
      :token="token"
      :subtitles="playerSubtitles"
      :initialTime="playerInitialTime"
      @close="closePlayer"
      @progress="onProgress"
    />
  </div>
</template>

<style scoped>
/* 图片时间分组标题 */
.nd-image-group + .nd-image-group {
  margin-top: 8px;
}
.nd-group-title {
  margin: 18px 24px 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 8px;
}
.nd-group-count {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  background: color-mix(in srgb, currentColor 10%, transparent);
  border: 1px solid var(--glass-border);
  padding: 1px 8px;
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
}
.nd-image-group .nd-image-grid {
  margin-top: 12px;
}

.nd-image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
  margin: 20px 24px 0;
}
.nd-image-card {
  border-radius: 14px;
  overflow: hidden;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow);
  cursor: pointer;
  transition: transform 0.25s var(--ease-smooth),
    box-shadow 0.25s var(--ease-smooth),
    background 0.25s var(--ease-smooth);
}
.nd-image-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-hover);
  background: var(--glass-bg-hover);
}
.nd-image-card:active {
  transform: translateY(0) scale(0.98);
}
.nd-image-card img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  display: block;
}
/* 缩略图加载前/失败时的图标底（保持 1:1 占位，避免卡片跳变） */
.nd-image-ph {
  width: 100%;
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  color: var(--accent);
  background: linear-gradient(
    135deg,
    var(--accent-soft),
    color-mix(in srgb, var(--accent) 10%, transparent)
  );
}
.nd-image-name {
  font-size: 13px;
  color: var(--text);
  padding: 8px 12px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nd-image-meta {
  font-size: 12px;
  color: var(--text-secondary);
  padding: 4px 12px 12px;
}
.nd-big-image {
  max-width: 100%;
  max-height: 78vh;
  object-fit: contain;
  display: block;
  margin: 0 auto;
}
.nd-big-meta {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}
.nd-audio-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
  margin: 20px 24px 0;
}
.nd-audio-info {
  flex: 1;
  min-width: 0;
}
.nd-audio-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nd-audio-meta {
  display: flex;
  gap: 10px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
}
.nd-audio-player audio {
  width: 100%;
}
.nd-audio-player-meta {
  display: flex;
  gap: 12px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-secondary);
}
.nd-doc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
  margin: 20px 24px 0;
}
.nd-doc-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  backdrop-filter: blur(var(--blur, 12px));
}
.nd-doc-icon {
  color: var(--accent);
  flex-shrink: 0;
}
.nd-doc-info {
  flex: 1;
  min-width: 0;
}
.nd-doc-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nd-doc-meta {
  display: flex;
  gap: 10px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
}
.nd-doc-download {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  background: var(--accent-soft, rgba(0, 0, 0, 0.06));
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
}
.nd-doc-download:hover {
  background: var(--accent);
  color: #fff;
}

/* 媒体模式切换计数徽章 */
.mode-count {
  display: inline-block;
  margin-left: 6px;
  padding: 0 6px;
  font-size: 11px;
  line-height: 1.6;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 14%, transparent);
  font-variant-numeric: tabular-nums;
}
</style>
