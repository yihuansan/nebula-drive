<script setup lang="ts">
/**
 * 迷你柱状趋势图（纯 CSS，无依赖）
 * data 为数值序列，自动按最大值归一；最后一根柱高亮。
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    data: number[];
    labels?: string[];
    height?: number;
  }>(),
  { height: 48 },
);

const max = computed(() => Math.max(...props.data, 1));
const bars = computed(() =>
  props.data.map((v, i) => ({
    value: v,
    pct: Math.max(6, Math.round((v / max.value) * 100)),
    label: props.labels?.[i] ?? '',
    last: i === props.data.length - 1,
  })),
);
</script>

<template>
  <div class="mini-bars" :style="{ height: height + 'px' }">
    <div v-for="(b, i) in bars" :key="i" class="mb-col" :title="b.label ? `${b.label}: ${b.value}` : String(b.value)">
      <div class="mb-bar" :class="{ last: b.last }" :style="{ height: b.pct + '%' }" />
    </div>
  </div>
</template>

<style scoped>
.mini-bars {
  display: flex;
  align-items: flex-end;
  gap: 5px;
  width: 100%;
}
.mb-col {
  flex: 1;
  min-width: 6px;
  height: 100%;
  display: flex;
  align-items: flex-end;
}
.mb-bar {
  width: 100%;
  border-radius: 4px 4px 2px 2px;
  background: color-mix(in srgb, var(--accent) 34%, transparent);
  transition: background 0.25s var(--ease-smooth), height 0.6s var(--ease-smooth);
}
.mb-col:hover .mb-bar {
  background: color-mix(in srgb, var(--accent) 62%, transparent);
}
.mb-bar.last {
  background: linear-gradient(180deg, var(--accent), var(--accent-2, var(--accent)));
}
</style>
