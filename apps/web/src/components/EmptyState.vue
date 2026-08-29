<script setup lang="ts">
/**
 * 空状态组件：主题自适应线性插画 + 标题 + 说明 + 操作插槽
 * 插画使用 currentColor / CSS 变量，自动适配全部主题。
 */
defineProps<{
  title: string;
  description?: string;
}>();
</script>

<template>
  <div class="empty-wrap page-enter">
    <svg class="empty-art" viewBox="0 0 160 120" fill="none" aria-hidden="true">
      <!-- 光斑 -->
      <circle cx="128" cy="26" r="16" class="art-blob" />
      <circle cx="30" cy="92" r="10" class="art-blob b2" />
      <!-- 文件夹主体 -->
      <path
        class="art-line"
        d="M34 44c0-3.3 2.7-6 6-6h22l8 9h50c3.3 0 6 2.7 6 6v38c0 3.3-2.7 6-6 6H40c-3.3 0-6-2.7-6-6V44Z"
      />
      <!-- 开口折线 -->
      <path class="art-line soft" d="M34 56h92" />
      <!-- 星点 -->
      <path class="art-accent" d="M118 30l1.6 3.6 3.6 1.6-3.6 1.6-1.6 3.6-1.6-3.6-3.6-1.6 3.6-1.6 1.6-3.6Z" />
      <circle cx="52" cy="30" r="2.4" class="art-accent" />
      <!-- 底部投影 -->
      <ellipse cx="80" cy="108" rx="38" ry="5" class="art-shadow" />
    </svg>
    <h3>{{ title }}</h3>
    <p v-if="description">{{ description }}</p>
    <div class="empty-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.empty-wrap {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 56px 20px;
  text-align: center;
}
.empty-art {
  width: 150px;
  height: auto;
  margin-bottom: 10px;
}
.empty-art .art-line {
  stroke: color-mix(in srgb, var(--text) 42%, transparent);
  stroke-width: 2.4;
  stroke-linejoin: round;
  fill: var(--glass-bg);
}
.empty-art .art-line.soft {
  stroke: color-mix(in srgb, var(--text) 22%, transparent);
  stroke-width: 2;
  fill: none;
}
.empty-art .art-blob {
  fill: color-mix(in srgb, var(--accent) 18%, transparent);
}
.empty-art .art-blob.b2 {
  fill: color-mix(in srgb, var(--accent-2, var(--accent)) 16%, transparent);
}
.empty-art .art-accent {
  fill: var(--accent);
  opacity: 0.85;
}
.empty-art .art-shadow {
  fill: color-mix(in srgb, var(--text) 8%, transparent);
}
.empty-wrap h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.empty-wrap p {
  margin: 8px 0 0;
  max-width: 380px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--text-secondary);
}
.empty-actions {
  margin-top: 16px;
  display: flex;
  gap: 10px;
}
.empty-actions:empty {
  display: none;
}
</style>
