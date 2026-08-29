<script setup lang="ts">
/**
 * 统一页头组件：图标圆底 + 标题 + 副标题 + 右侧操作区
 * icon 传 Element Plus 图标组件名（字符串），图标已全局注册。
 */
defineProps<{
  icon?: string;
  title: string;
  subtitle?: string;
}>();
</script>

<template>
  <div class="page-head glass page-enter">
    <div v-if="icon" class="page-head-icon">
      <el-icon :size="22"><component :is="icon" /></el-icon>
    </div>
    <div class="page-head-text">
      <h2>{{ title }}</h2>
      <p v-if="subtitle">{{ subtitle }}</p>
    </div>
    <div class="page-head-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 20px;
  margin-bottom: 16px;
  border-radius: var(--card-radius, 18px);
}
.page-head-icon {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  color: var(--accent);
  background: linear-gradient(
    135deg,
    var(--accent-soft),
    color-mix(in srgb, var(--accent) 26%, transparent)
  );
  border: 1px solid var(--glass-border);
  box-shadow: inset 0 1px 0 var(--glass-highlight);
}
.page-head-text {
  flex: 1;
  min-width: 0;
}
.page-head-text h2 {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--text);
}
.page-head-text p {
  margin: 3px 0 0;
  font-size: 12.5px;
  color: var(--text-secondary);
}
.page-head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
</style>
