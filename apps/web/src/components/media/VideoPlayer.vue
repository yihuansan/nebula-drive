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
const subIndex = ref(0); // 0 = 关闭字幕，1..n = 轨道

let hideTimer: number | undefined;
let lastEmit = 0;

const activeTrack = computed<SubtitleTrack | null>(() =>
  subIndex.value > 0 ? props.subtitles[subIndex.value - 1] || null : null,
);

const currentCue = computed<SubtitleCue | null>(() => {
  if (!activeTrack.value) return null;
  return cueAtTime(activeTrack.value.cues, currentTime.value);
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

function onLoadedMetadata() {
  loading.value = false;
  const v = videoRef.value;
  if (!v) return;
  if (props.initialTime && props.initialTime > 0 && props.initialTime < v.duration) {
    v.currentTime = props.initialTime;
  }
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
        @error="error = '无法播放该视频'"
      ></video>

      <!-- 字幕 -->
      <div v-if="currentCue" class="nd-player-subtitle">{{ currentCue.text }}</div>

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
        <button @click="error = ''; videoRef && (videoRef.src = src)">重试</button>
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
    <div v-if="showSubmenu" class="nd-player-submenu">
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
