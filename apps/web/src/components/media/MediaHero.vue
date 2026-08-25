<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { fmtDuration, type MediaItem, type ProgressEntry } from './media-utils';

const props = defineProps<{
  items: MediaItem[];
  progress: Record<string, ProgressEntry>;
}>();

const emit = defineEmits<{
  (e: 'play', item: MediaItem): void;
}>();

const current = ref(0);
const paused = ref(false);
let timer: number | undefined;

const featured = computed(() => props.items.slice(0, 6));
const active = computed<MediaItem | null>(() => featured.value[current.value] || null);

function intro(item: MediaItem): string {
  const bits: string[] = [];
  if (item.category && item.category !== '未分类') bits.push(item.category);
  if (item.duration) bits.push(fmtDuration(item.duration));
  bits.push(`${(item.size / 1024 / 1024).toFixed(1)} MB`);
  return bits.join(' · ');
}

function tags(item: MediaItem): string[] {
  const t: string[] = [];
  if (item.category && item.category !== '未分类') t.push(item.category);
  if (item.ext) t.push(item.ext.toUpperCase());
  const p = props.progress[item.path];
  if (p && p.duration) t.push(`已看 ${Math.round((p.time / p.duration) * 100)}%`);
  return t;
}

function go(i: number) {
  const n = featured.value.length;
  if (!n) return;
  current.value = ((i % n) + n) % n;
  restart();
}

function next() {
  go(current.value + 1);
}
function prev() {
  go(current.value - 1);
}

function restart() {
  if (timer) window.clearInterval(timer);
  timer = window.setInterval(() => {
    if (!paused.value && featured.value.length > 1) next();
  }, 6000);
}

onMounted(restart);
onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
});

watch(
  () => props.items.length,
  () => restart(),
);
</script>

<template>
  <div class="nd-hero" @mouseenter="paused = true" @mouseleave="paused = false">
    <template v-if="active">
      <div
        class="nd-hero-bg is-active"
        :style="active.poster ? { backgroundImage: `url(${active.poster})` } : { background: `linear-gradient(135deg, var(--accent) 0%, var(--bg) 130%)` }"
      ></div>
      <div class="nd-hero-scrim"></div>
      <div class="nd-hero-scrim-v"></div>

      <div class="nd-hero-content">
        <span class="nd-hero-kicker">
          <i class="nd-play-icon"></i>
          精选 · {{ featured.length ? `第 ${current + 1} / ${featured.length} 部` : '' }}
        </span>
        <h1 class="nd-hero-title">{{ active.name }}</h1>
        <p class="nd-hero-intro">{{ intro(active) }}</p>
        <div class="nd-hero-tags">
          <span v-for="t in tags(active)" :key="t" class="nd-hero-tag">{{ t }}</span>
        </div>
        <div class="nd-hero-actions">
          <button class="nd-hero-play" @click.stop="emit('play', active)">
            <span class="nd-play-icon"></span>
            立即播放
          </button>
        </div>
      </div>

      <button class="nd-hero-arrow is-left" @click.stop="prev" title="上一部">
        <el-icon><ArrowLeft /></el-icon>
      </button>
      <button class="nd-hero-arrow is-right" @click.stop="next" title="下一部">
        <el-icon><ArrowRight /></el-icon>
      </button>

      <div class="nd-hero-dots">
        <button
          v-for="(it, i) in featured"
          :key="it.path"
          class="nd-hero-dot"
          :class="{ 'is-active': i === current }"
          @click.stop="go(i)"
          :title="it.name"
        ></button>
      </div>
    </template>

    <div v-else class="nd-hero-empty">
      <p>暂无视频内容</p>
    </div>
  </div>
</template>

<style scoped>
.nd-hero-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.7);
  font-size: 18px;
}
</style>
