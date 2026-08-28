<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  cueAtTime,
  fmtClock,
  previewUrl,
  type MediaItem,
  type SubtitleCue,
} from './media-utils';

export interface SubtitleTrack {
  label: string;
  cues: SubtitleCue[];
}

const props = defineProps<{
  item: MediaItem;
  storageId: number;
  token: string;
  subtitles: SubtitleTrack[];
  initialTime?: number;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'progress', path: string, time: number, duration: number): void;
}>();

const rootRef = ref<HTMLElement | null>(null);
const videoRef = ref<HTMLVideoElement | null>(null);
const progressRef = ref<HTMLElement | null>(null);

// 原生流式播放：<video> 自动发 Range 请求（206 分片），配合服务端 faststart（moov 前置）边下边播。
// 注意：不要用 fetch 整包下载成 blob 再播——大视频会先下完全片才能开播，且撑爆浏览器内存。
const src = computed(() => previewUrl(props.storageId, props.item.path, props.token));

const currentTime = ref(0);
const duration = ref(0);
const buffered = ref(0);
const playing = ref(false);
const muted = ref(false);
const volume = ref(1);
const speed = ref(1);
const isFullscreen = ref(false);
const loading = ref(true);
const error = ref('');
const hovered = ref(false);
const showSpeedMenu = ref(false);
const showSubmenu = ref(false);
const showSubSettings = ref(false); // 字幕设置面板
const subIndex = ref(0); // 0 = 关闭字幕，1..n = 轨道
// 字幕样式（爱奇艺式可调）
const subSize = ref(2); // 1=小 2=中 3=大
const subColor = ref('#ffffff'); // 字幕颜色
const subPos = ref<'bottom' | 'top'>('bottom'); // 字幕位置
const subOffset = ref(0); // 字幕时间偏移（秒），正=延后 负=提前

let hideTimer: number | undefined;
let lastEmit = 0;

const activeTrack = computed<SubtitleTrack | null>(() =>
  subIndex.value > 0 ? props.subtitles[subIndex.value - 1] || null : null,
);

// 字幕字号（px），根据 subSize 和全屏状态自适应
const subSizePx = computed(() => {
  const base = [20, 26, 34][subSize.value - 1] || 26;
  // 全屏时放大
  return isFullscreen.value ? Math.round(base * 1.4) : base;
});

const currentCue = computed<SubtitleCue | null>(() => {
  if (!activeTrack.value) return null;
  // 应用时间偏移
  return cueAtTime(activeTrack.value.cues, currentTime.value + subOffset.value);
});

const pct = computed(() => (duration.value ? (currentTime.value / duration.value) * 100 : 0));
const bufferedPct = computed(() => (duration.value ? (buffered.value / duration.value) * 100 : 0));

/* ---------------- 播放控制 ---------------- */

function togglePlay() {
  const v = videoRef.value;
  if (!v) return;
  if (v.paused) v.play().catch(() => {});
  else v.pause();
}

function retry() {
  error.value = '';
  videoRef.value?.load();
}

function onLoadedMetadata() {
  loading.value = false;
  const v = videoRef.value;
  if (!v) return;
  if (props.initialTime && props.initialTime > 0 && props.initialTime < v.duration) {
    v.currentTime = props.initialTime;
  }
}

function onVideoError(e: Event) {
  const v = e.target as HTMLVideoElement;
  const code = v.error?.code;
  const msgs: Record<number, string> = {
    1: '媒体资源被中止',
    2: '网络下载错误',
    3: '解码失败（编码不支持）',
    4: '媒体资源未找到',
  };
  const detail = code ? msgs[code] || `错误码 ${code}` : '未知错误';
  error.value = `无法播放该视频（${detail}）`;
  // 同时输出到控制台方便诊断
  console.error('[VideoPlayer] error:', { code, msg: v.error?.message, src: v.src });
}

function onTimeUpdate() {
  const v = videoRef.value;
  if (!v) return;
  currentTime.value = v.currentTime;
  if (v.duration && Number.isFinite(v.duration)) duration.value = v.duration;
  // 缓冲
  if (v.buffered.length) buffered.value = v.buffered.end(v.buffered.length - 1);
  const now = Date.now();
  if (playing.value && now - lastEmit > 4000) {
    lastEmit = now;
    emit('progress', props.item.path, v.currentTime, v.duration);
  }
}

function onPlay() {
  playing.value = true;
  loading.value = false;
  scheduleHide();
}
function onPause() {
  playing.value = false;
  emit('progress', props.item.path, videoRef.value?.currentTime || 0, videoRef.value?.duration || 0);
  clearTimeoutHide();
}

function onVolume() {
  const v = videoRef.value;
  if (!v) return;
  v.volume = volume.value;
  v.muted = muted.value;
}

function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement;
}

function toggleFullscreen() {
  const el = rootRef.value;
  if (!el) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else el.requestFullscreen().catch(() => {});
}

function setSpeed(s: number) {
  speed.value = s;
  if (videoRef.value) videoRef.value.playbackRate = s;
  showSpeedMenu.value = false;
}

function selectSub(i: number) {
  subIndex.value = i;
  showSubmenu.value = false;
}

/* ---------------- 进度条拖动 ---------------- */

let dragging = false;

function seekFromEvent(e: PointerEvent | MouseEvent) {
  const el = progressRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  const v = videoRef.value;
  if (v && duration.value) {
    v.currentTime = ratio * duration.value;
    currentTime.value = v.currentTime;
  }
}

function onProgressDown(e: PointerEvent) {
  dragging = true;
  seekFromEvent(e);
  const move = (ev: PointerEvent) => {
    if (dragging) seekFromEvent(ev);
  };
  const up = () => {
    dragging = false;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/* ---------------- 控制条显隐 ---------------- */

function scheduleHide() {
  clearTimeoutHide();
  hideTimer = window.setTimeout(() => {
    if (playing.value) hovered.value = false;
  }, 3000);
}
function clearTimeoutHide() {
  if (hideTimer) window.clearTimeout(hideTimer);
}
function onMove() {
  hovered.value = true;
  scheduleHide();
}

/* ---------------- 键盘 ---------------- */

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else emit('close');
  } else if (e.key === ' ' || e.key === 'k') {
    e.preventDefault();
    togglePlay();
  } else if (e.key === 'f') {
    toggleFullscreen();
  } else if (e.key === 'm') {
    muted.value = !muted.value;
    onVolume();
  } else if (e.key === 'ArrowLeft') {
    seekBy(-5);
  } else if (e.key === 'ArrowRight') {
    seekBy(5);
  }
}

function seekBy(delta: number) {
  const v = videoRef.value;
  if (!v) return;
  v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
}

/* ---------------- 生命周期 ---------------- */

onMounted(() => {
  const v = videoRef.value;
  if (v) {
    v.volume = volume.value;
    v.playbackRate = speed.value;
  }
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('keydown', onKey);
});

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  document.removeEventListener('keydown', onKey);
  clearTimeoutHide();
  const v = videoRef.value;
  if (v) {
    v.pause();
    v.src = '';
  }
});

const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 2];
</script>

<template>
  <div
    class="nd-player"
    :class="{ 'is-hover': hovered, 'is-paused': !playing }"
    ref="rootRef"
    @mousemove="onMove"
    @mouseleave="hovered = false"
  >
    <div class="nd-player-stage">
      <video
        ref="videoRef"
        class="nd-player-video"
        :src="src"
        autoplay
        @loadedmetadata="onLoadedMetadata"
        @timeupdate="onTimeUpdate"
        @play="onPlay"
        @pause="onPause"
        @ended="onPause"
        @canplay="loading = false"
        @waiting="loading = true"
        @error="onVideoError"
      ></video>

      <!-- 字幕（爱奇艺式：字号/颜色/位置可调） -->
      <div
        v-if="currentCue"
        class="nd-player-subtitle"
        :class="{ 'is-top': subPos === 'top' }"
        :style="{ fontSize: subSizePx + 'px', color: subColor }"
      >{{ currentCue.text }}</div>

      <!-- 顶部信息 -->
      <div class="nd-player-topbar">
        <div class="nd-player-title">
          <el-icon><VideoCamera /></el-icon>
          {{ item.name }}
        </div>
        <button class="nd-player-close" @click="emit('close')" title="关闭 (Esc)">
          <el-icon><Close /></el-icon>
        </button>
      </div>

      <!-- 中央大播放按钮（暂停时显示） -->
      <button class="nd-player-bigplay" @click="togglePlay" title="播放">
        <span class="nd-play-icon"></span>
      </button>

      <!-- 加载中 -->
      <div v-if="loading" class="nd-player-loading">
        <el-icon class="nd-spin" :size="42"><Loading /></el-icon>
        <span>加载中…</span>
      </div>

      <!-- 错误 -->
      <div v-if="error" class="nd-player-error">
        <el-icon :size="48"><VideoCamera /></el-icon>
        <span>{{ error }}</span>
        <button @click="retry">重试</button>
      </div>
    </div>

    <!-- 控制条 -->
    <div class="nd-player-bar">
      <button class="nd-player-btn" @click="togglePlay" :title="playing ? '暂停 (空格)' : '播放 (空格)'">
        <el-icon>
          <component :is="playing ? 'VideoPause' : 'VideoPlay'" />
        </el-icon>
      </button>

      <span class="nd-player-time">{{ fmtClock(currentTime) }} / {{ fmtClock(duration) }}</span>

      <div class="nd-player-progress" ref="progressRef" @pointerdown="onProgressDown">
        <div class="nd-player-progress-track">
          <div class="nd-player-progress-buffered" :style="{ width: bufferedPct + '%' }"></div>
          <div class="nd-player-progress-fill" :style="{ width: pct + '%' }"></div>
          <div class="nd-player-progress-knob" :style="{ left: pct + '%' }"></div>
        </div>
      </div>

      <div class="nd-player-volume">
        <button class="nd-player-btn" @click="muted = !muted; onVolume()" :title="muted ? '取消静音' : '静音'">
          <el-icon>
            <component :is="muted ? 'Mute' : 'Headset'" />
          </el-icon>
        </button>
        <input
          class="nd-player-volume-slider"
          type="range"
          min="0"
          max="1"
          step="0.05"
          :value="muted ? 0 : volume"
          @input="volume = +($event.target as HTMLInputElement).value; onVolume()"
        />
      </div>

      <button class="nd-player-btn" title="倍速" @click="showSpeedMenu = !showSpeedMenu; showSubmenu = false">
        <span style="font-size: 13px; font-weight: 700">{{ speed }}x</span>
      </button>

      <button
        class="nd-player-btn"
        title="字幕"
        :disabled="subtitles.length === 0"
        @click="showSubmenu = !showSubmenu; showSpeedMenu = false"
      >
        <el-icon><Document /></el-icon>
      </button>

      <button class="nd-player-btn" @click="toggleFullscreen" title="全屏 (F)">
        <el-icon>
          <component :is="isFullscreen ? 'Remove' : 'FullScreen'" />
        </el-icon>
      </button>
    </div>

    <!-- 倍速菜单 -->
    <div v-if="showSpeedMenu" class="nd-player-submenu">
      <div class="nd-player-submenu-label">倍速</div>
      <div
        v-for="s in speedOptions"
        :key="s"
        class="nd-player-submenu-item"
        :class="{ 'is-active': s === speed }"
        @click="setSpeed(s)"
      >
        {{ s }}x
      </div>
    </div>

    <!-- 字幕菜单 -->
    <div v-if="showSubmenu && !showSubSettings" class="nd-player-submenu">
      <div class="nd-player-submenu-label">字幕</div>
      <div class="nd-player-submenu-item" :class="{ 'is-active': subIndex === 0 }" @click="selectSub(0)">
        关闭
      </div>
      <div
        v-for="(t, i) in subtitles"
        :key="t.label"
        class="nd-player-submenu-item"
        :class="{ 'is-active': subIndex === i + 1 }"
        @click="selectSub(i + 1)"
      >
        {{ t.label }}
      </div>
      <!-- 字幕设置入口 -->
      <div class="nd-player-submenu-item nd-player-submenu-more" @click="showSubSettings = true">
        字幕设置 <span class="nd-player-submenu-arrow">›</span>
      </div>
    </div>

    <!-- 字幕设置面板（字号/颜色/位置/时间偏移） -->
    <div v-if="showSubSettings" class="nd-player-submenu nd-player-subsettings">
      <div class="nd-player-submenu-label">字幕设置</div>
      <!-- 字号 -->
      <div class="nd-player-subsettings-row">
        <span class="nd-player-subsettings-label">字号</span>
        <div class="nd-player-subsettings-opts">
          <button
            v-for="(label, i) in ['小', '中', '大']"
            :key="i"
            class="nd-player-subsettings-opt"
            :class="{ 'is-active': subSize === i + 1 }"
            @click="subSize = i + 1"
          >{{ label }}</button>
        </div>
      </div>
      <!-- 颜色 -->
      <div class="nd-player-subsettings-row">
        <span class="nd-player-subsettings-label">颜色</span>
        <div class="nd-player-subsettings-opts">
          <button
            v-for="c in ['#ffffff', '#fffd3f', '#00e676', '#ff5252']"
            :key="c"
            class="nd-player-subsettings-opt nd-player-subsettings-color"
            :class="{ 'is-active': subColor === c }"
            :style="{ background: c }"
            @click="subColor = c"
          ></button>
        </div>
      </div>
      <!-- 位置 -->
      <div class="nd-player-subsettings-row">
        <span class="nd-player-subsettings-label">位置</span>
        <div class="nd-player-subsettings-opts">
          <button class="nd-player-subsettings-opt" :class="{ 'is-active': subPos === 'bottom' }" @click="subPos = 'bottom'">底部</button>
          <button class="nd-player-subsettings-opt" :class="{ 'is-active': subPos === 'top' }" @click="subPos = 'top'">顶部</button>
        </div>
      </div>
      <!-- 时间偏移 -->
      <div class="nd-player-subsettings-row">
        <span class="nd-player-subsettings-label">时间</span>
        <div class="nd-player-subsettings-opts">
          <button class="nd-player-subsettings-opt" @click="subOffset = Math.max(-30, subOffset - 1)">-1s</button>
          <button class="nd-player-subsettings-opt" :class="{ 'is-active': subOffset === 0 }" @click="subOffset = 0">{{ subOffset === 0 ? '正常' : (subOffset > 0 ? `+${subOffset}s` : `${subOffset}s`) }}</button>
          <button class="nd-player-subsettings-opt" @click="subOffset = Math.min(30, subOffset + 1)">+1s</button>
        </div>
      </div>
      <!-- 返回 -->
      <div class="nd-player-subsettings-back" @click="showSubSettings = false">‹ 返回字幕列表</div>
    </div>
  </div>
</template>

<style scoped>
.nd-spin {
  animation: nd-rotate 1.2s linear infinite;
}
@keyframes nd-rotate {
  to {
    transform: rotate(360deg);
  }
}
.nd-player-volume-slider {
  accent-color: var(--accent);
}
</style>
