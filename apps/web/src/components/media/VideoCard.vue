<script setup lang="ts">
import { computed } from 'vue';
import { fmtDuration, type MediaItem, type ProgressEntry } from './media-utils';

const props = defineProps<{
  item: MediaItem;
  progress?: ProgressEntry | null;
}>();

const emit = defineEmits<{
  (e: 'play', item: MediaItem): void;
}>();

const pct = computed(() => {
  const p = props.progress;
  if (!p || !p.duration) return 0;
  return Math.min(100, Math.round((p.time / p.duration) * 100));
});

const posterStyle = computed(() => {
  if (props.item.poster) return { backgroundImage: `url(${props.item.poster})` };
  return {};
});

const hasPoster = computed(() => !!props.item.poster);
</script>

<template>
  <div class="nd-card" @click="emit('play', item)">
    <div
      class="nd-card-poster"
      :class="{ 'is-fallback': !hasPoster }"
      :style="posterStyle"
    ></div>
    <div class="nd-card-scrim"></div>

    <div class="nd-card-info">
      <div class="nd-card-title" :title="item.name">{{ item.name }}</div>
      <div class="nd-card-meta">
        <span class="nd-card-cat" v-if="item.category !== '未分类'">{{ item.category }}</span>
        <span v-if="item.duration">{{ fmtDuration(item.duration) }}</span>
      </div>
    </div>

    <div class="nd-card-play">
      <span class="nd-play-icon"></span>
    </div>

    <span v-if="item.duration" class="nd-badge-dur">{{ fmtDuration(item.duration) }}</span>

    <div v-if="progress && pct > 0" class="nd-card-progress">
      <div class="nd-card-progress-fill" :style="{ width: pct + '%' }"></div>
    </div>
  </div>
</template>
