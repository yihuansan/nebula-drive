<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, fmtSize, loadThumbs } from '../api';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';

/**
 * 标签页：左侧全部标签（带文件计数），右侧按标签浏览文件（跨存储）。
 * 后端：/tags（列表+计数）、/files-by-tag、DELETE /tags/:tag
 */
const router = useRouter();

const tags = ref<string[]>([]);
const counts = ref<Record<string, number>>({});
const activeTag = ref('');
const loading = ref(false);
const filesLoading = ref(false);
const files = ref<any[]>([]);
const storageNames = ref<Record<number, string>>({});

async function loadTags(selectFirst = false) {
  loading.value = true;
  try {
    const r = await api('/tags');
    tags.value = r.tags || [];
    counts.value = r.counts || {};
    if (selectFirst && tags.value.length && !activeTag.value) {
      selectTag(tags.value[0]);
    } else if (activeTag.value && !tags.value.includes(activeTag.value)) {
      activeTag.value = '';
      files.value = [];
    }
  } catch (e: any) {
    ElMessage.error(e.message || '加载标签失败');
  } finally {
    loading.value = false;
  }
}

async function loadStorages() {
  try {
    const r = await api('/storages?fast=1');
    const map: Record<number, string> = {};
    for (const s of r.storages || []) map[s.id] = s.name;
    storageNames.value = map;
  } catch { /* 忽略 */ }
}

async function selectTag(tag: string) {
  activeTag.value = tag;
  filesLoading.value = true;
  try {
    const r = await api(`/files-by-tag?tag=${encodeURIComponent(tag)}`);
    files.value = (r.files || []).map((f: any) => ({
      ...f,
      name: f.path.split('/').filter(Boolean).pop() || f.path,
    }));
    startThumbs();
  } catch (e: any) {
    ElMessage.error(e.message || '加载标签文件失败');
  } finally {
    filesLoading.value = false;
  }
}

/* 图片文件缩略图（带鉴权拉取，失败回退图标） */
const thumbs = ref<Record<string, string>>({});
let abortThumbs: (() => void) | null = null;
function startThumbs() {
  abortThumbs?.();
  thumbs.value = {};
  abortThumbs = loadThumbs(
    files.value.map((f) => ({ storageId: f.storage_id, path: f.path })),
    (path, url) => {
      thumbs.value[path] = url;
    },
    200
  );
}

async function removeTag(tag: string) {
  try {
    await ElMessageBox.confirm(`删除标签「${tag}」？将从所有文件上移除该标签（文件本身不受影响）。`, '删除标签', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await api(`/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' });
    ElMessage.success('标签已删除');
    if (activeTag.value === tag) {
      activeTag.value = '';
      files.value = [];
    }
    loadTags();
  } catch (e: any) {
    ElMessage.error(e.message || '删除失败');
  }
}

/** 打开文件所在目录（深链到文件管理页） */
function openFile(f: any) {
  const dir = f.path.replace(/\/[^/]*$/, '') || '/';
  router.push({ path: '/', query: { storage: String(f.storage_id), path: dir } });
}

function fileIcon(name: string): { icon: string; color: string } {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'].includes(ext)) return { icon: 'Picture', color: '#ec4899' };
  if (['mp4', 'avi', 'mkv', 'mov', 'flv', 'wmv', 'webm'].includes(ext)) return { icon: 'VideoPlay', color: '#ef4444' };
  if (['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a'].includes(ext)) return { icon: 'Headset', color: '#f59e0b' };
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return { icon: 'Files', color: '#ca8a04' };
  return { icon: 'Document', color: '#2563eb' };
}

const totalFiles = computed(() => Object.values(counts.value).reduce((a, b) => a + b, 0));

onMounted(() => {
  loadTags(true);
  loadStorages();
});
onUnmounted(() => abortThumbs?.());
</script>

<template>
  <div class="tags-page">
    <PageHeader
      icon="PriceTag"
      title="标签"
      :subtitle="`共 ${tags.length} 个标签 · ${totalFiles} 个文件被打标，在文件上右键「标签」即可管理`"
    >
      <template #actions>
        <el-button :loading="loading" @click="loadTags()">
          <el-icon style="margin-right: 4px"><Refresh /></el-icon>刷新
        </el-button>
      </template>
    </PageHeader>

    <div class="tags-body">
      <!-- 左侧：标签列表 -->
      <div v-loading="loading" class="tag-list glass page-enter">
        <div class="tag-list-title">全部标签</div>
        <div
          v-for="t in tags"
          :key="t"
          class="tag-item"
          :class="{ active: activeTag === t }"
          @click="selectTag(t)"
        >
          <el-icon class="tag-item-icon"><PriceTag /></el-icon>
          <span class="tag-item-name">{{ t }}</span>
          <span class="tag-count">{{ counts[t] || 0 }}</span>
          <el-button class="tag-del" link size="small" title="删除标签" @click.stop="removeTag(t)">
            <el-icon><Close /></el-icon>
          </el-button>
        </div>
        <EmptyState
          v-if="!loading && !tags.length"
          title="还没有标签"
          description="在文件管理中右键文件选择「标签」，即可为文件打标签分类"
        />
      </div>

      <!-- 右侧：标签文件网格 -->
      <div class="tag-files">
        <template v-if="activeTag">
          <div class="tag-files-head page-enter">
            <span class="tag-files-label">
              <el-icon><PriceTag /></el-icon>
              {{ activeTag }}
              <span class="tag-files-count">{{ files.length }} 个文件</span>
            </span>
          </div>
          <div v-loading="filesLoading" class="tag-grid page-enter-stagger">
            <div v-for="f in files" :key="f.storage_id + ':' + f.path" class="tag-file-card glass hover-lift" @click="openFile(f)">
              <div class="tag-file-icon">
                <img v-if="thumbs[f.path]" :src="thumbs[f.path]" class="tag-file-thumb" :alt="f.name" loading="lazy" />
                <el-icon v-else :size="30" :color="fileIcon(f.name).color">
                  <component :is="fileIcon(f.name).icon" />
                </el-icon>
              </div>
              <div class="tag-file-name" :title="f.name">{{ f.name }}</div>
              <div class="tag-file-meta">
                <span v-if="storageNames[f.storage_id]" class="tag-file-storage">{{ storageNames[f.storage_id] }}</span>
                <span class="tag-file-path" :title="f.path">{{ f.path }}</span>
              </div>
            </div>
            <EmptyState
              v-if="!filesLoading && !files.length"
              title="该标签下暂无文件"
              description="可能文件已被删除，可在文件管理中重新打标"
            />
          </div>
        </template>
        <div v-else class="tag-placeholder glass page-enter">
          <el-icon :size="42"><PriceTag /></el-icon>
          <p>选择左侧标签，查看被打标的文件</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tags-page {
  padding: 4px;
}
.tags-body {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 16px;
  align-items: start;
}

/* ---------- 左侧标签列表 ---------- */
.tag-list {
  border-radius: var(--card-radius, 18px);
  padding: 12px;
  max-height: calc(100vh - 200px);
  overflow-y: auto;
}
.tag-list-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 4px 10px 8px;
}
.tag-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border-radius: 12px;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-secondary);
  transition: background 0.15s ease, color 0.15s ease;
}
.tag-item:hover {
  background: var(--glass-bg-hover);
  color: var(--text);
}
.tag-item.active {
  background: var(--accent-soft);
  color: var(--text);
}
.tag-item.active .tag-item-icon {
  color: var(--accent);
}
.tag-item-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tag-count {
  font-size: 11.5px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  opacity: 0.85;
}
.tag-del {
  opacity: 0;
  transition: opacity 0.15s ease;
}
.tag-item:hover .tag-del {
  opacity: 0.8;
}

/* ---------- 右侧文件网格 ---------- */
.tag-files-head {
  margin-bottom: 12px;
}
.tag-files-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 600;
}
.tag-files-label .el-icon {
  color: var(--accent);
}
.tag-files-count {
  font-size: 12px;
  font-weight: 400;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
}
.tag-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 14px;
}
.tag-file-card {
  border-radius: var(--card-radius, 16px);
  padding: 16px 14px;
  cursor: pointer;
  text-align: center;
}
.tag-file-icon {
  height: 56px;
  display: grid;
  place-items: center;
}
.tag-file-thumb {
  width: 56px;
  height: 56px;
  border-radius: 10px;
  object-fit: cover;
  border: 1px solid var(--glass-border);
}
.tag-file-name {
  font-size: 14px;
  font-weight: 500;
  margin-top: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tag-file-meta {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11.5px;
  color: var(--text-secondary);
}
.tag-file-storage {
  align-self: center;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}
.tag-file-path {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.7;
}

.tag-placeholder {
  border-radius: var(--card-radius, 18px);
  padding: 72px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--text-secondary);
}
.tag-placeholder .el-icon {
  opacity: 0.4;
}
.tag-placeholder p {
  margin: 0;
  font-size: 14px;
}

@media (max-width: 900px) {
  .tags-body {
    grid-template-columns: 1fr;
  }
  .tag-list {
    max-height: 260px;
  }
}
</style>
