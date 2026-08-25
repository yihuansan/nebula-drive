<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api, downloadFile, fmtSize, fmtTime } from '../api';
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

const storages = ref<StorageInfo[]>([]);
const storageId = ref<number | null>(null);
const videos = ref<MediaItem[]>([]);
const docs = ref<DocEntry[]>([]);
const loading = ref(false);
const mode = ref<'video' | 'document'>('video');

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
    const [vRes, dRes] = await Promise.all([
      api<any>(`/files/by-type?storageId=${storageId.value}&type=video`),
      api<any>(`/files/by-type?storageId=${storageId.value}&type=document`),
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
    startPosterCapture();
  } finally {
    loading.value = false;
  }
}

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
});
</script>

<template>
  <div class="nd-library">
    <!-- 页头 -->
    <div class="nd-pagehead">
      <h2>影视库</h2>
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
          <el-radio-button value="video">视频</el-radio-button>
          <el-radio-button value="document">文档</el-radio-button>
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
        <p>暂无视频内容</p>
      </div>
    </template>

    <!-- 文档模式 -->
    <template v-else>
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
        <p>暂无文档</p>
      </div>
    </template>

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
</style>
