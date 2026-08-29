<script setup lang="ts">
/**
 * 环形进度图（纯 SVG，无依赖）：渐变描边 + 中心文字
 * percent 为 0-100；超过 100 自动截断显示。
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    percent: number | null;
    centerText?: string;
    centerSub?: string;
    size?: number;
  }>(),
  { size: 148 },
);

const gradId = 'ring-grad-' + Math.random().toString(36).slice(2, 9);

const R = 54;
const C = 2 * Math.PI * R;
const pct = computed(() => (props.percent == null ? 0 : Math.max(0, Math.min(100, props.percent))));
const dashOffset = computed(() => C * (1 - pct.value / 100));
</script>

<template>
  <div class="ring" :style="{ width: size + 'px', height: size + 'px' }">
    <svg :viewBox="`0 0 128 128`" width="100%" height="100%" aria-hidden="true">
      <defs>
        <linearGradient :id="gradId" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color: var(--accent)" />
          <stop offset="100%" style="stop-color: var(--accent-2, var(--accent))" />
        </linearGradient>
      </defs>
      <circle class="ring-track" cx="64" cy="64" :r="R" />
      <circle
        class="ring-fill"
        cx="64"
        cy="64"
        :r="R"
        :stroke="`url(#${gradId})`"
        :stroke-dasharray="C"
        :stroke-dashoffset="dashOffset"
      />
    </svg>
    <div class="ring-center">
      <div class="ring-value">{{ percent == null ? centerText || '-' : Math.round(pct) + '%' }}</div>
      <div v-if="centerSub" class="ring-sub">{{ centerSub }}</div>
    </div>
  </div>
</template>

<style scoped>
.ring {
  position: relative;
  flex-shrink: 0;
}
.ring svg {
  transform: rotate(-90deg);
  display: block;
}
.ring-track {
  fill: none;
  stroke: var(--surface);
  stroke-width: 10;
}
.ring-fill {
  fill: none;
  stroke-width: 10;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.8s var(--ease-smooth);
}
.ring-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  pointer-events: none;
}
.ring-value {
  font-size: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}
.ring-sub {
  font-size: 11.5px;
  color: var(--text-secondary);
  max-width: 80%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
