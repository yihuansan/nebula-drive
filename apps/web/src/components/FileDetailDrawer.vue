<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, fmtSize, fmtTime, thumbnailUrl } from '../api';

/**
 * 文件详情抽屉：概览（属性 + 标签 + 缩略图）/ 版本历史 / 评论
 * 复用既有后端端点：/files/:path/meta|tags|versions|comments
 */
const props = defineProps<{
  modelValue: boolean;
  storageId: number;
  path: string;
  name: string;
  size?: number;
  mtime?: string | number;
  isImage?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'restored'): void;
}>();

const tab = ref('overview');
const loading = ref(false);

const thumbSrc = ref<string | null>(null);
const meta = ref<any>(null);
const tags = ref<string[]>([]);
const newTag = ref('');
const versions = ref<any[]>([]);
const versionsLoaded = ref(false);
const comments = ref<any[]>([]);
const commentsLoaded = ref(false);
const commentText = ref('');
const submitting = ref(false);

const encPath = computed(() => encodeURIComponent(props.path));

async function loadThumb() {
  thumbSrc.value = null;
  if (!props.isImage) return;
  thumbSrc.value = await thumbnailUrl(props.storageId, props.path, 480);
}

async function loadMeta() {
  meta.value = null;
  try {
    const r = await api(`/files/${encPath.value}/meta?storageId=${props.storageId}`);
    meta.value = r?.meta || r || null;
  } catch { /* 非本地存储可能不支持，忽略 */ }
}

async function loadTags() {
  try {
    const r = await api(`/files/${encPath.value}/tags?storageId=${props.storageId}`);
    tags.value = r.tags || [];
  } catch { /* 忽略 */ }
}

async function loadVersions() {
  if (versionsLoaded.value) return;
  try {
    const r = await api(`/files/${encPath.value}/versions?storageId=${props.storageId}`);
    versions.value = r.versions || [];
    versionsLoaded.value = true;
  } catch {
    versions.value = [];
  }
}

async function loadComments() {
  if (commentsLoaded.value) return;
  try {
    const r = await api(`/files/${encPath.value}/comments?storageId=${props.storageId}`);
    comments.value = r.comments || [];
    commentsLoaded.value = true;
  } catch {
    comments.value = [];
  }
}

watch(tab, (t) => {
  if (t === 'versions') loadVersions();
  if (t === 'comments') loadComments();
});

watch(
  () => props.modelValue,
  (open) => {
    if (!open || !props.path) return;
    tab.value = 'overview';
    versionsLoaded.value = false;
    commentsLoaded.value = false;
    loading.value = true;
    Promise.all([loadThumb(), loadMeta(), loadTags()]).finally(() => (loading.value = false));
  }
);

async function addTag() {
  const t = newTag.value.trim();
  if (!t) return;
  try {
    const r = await api(`/files/${encPath.value}/tags?storageId=${props.storageId}`, {
      method: 'POST',
      body: JSON.stringify({ tag: t }),
    });
    tags.value = r.tags || [...tags.value, t];
    newTag.value = '';
  } catch (e: any) {
    ElMessage.error(e.message || '添加标签失败');
  }
}

async function removeTag(tag: string) {
  try {
    const r = await api(`/files/${encPath.value}/tags/${encodeURIComponent(tag)}?storageId=${props.storageId}`, {
      method: 'DELETE',
    });
    tags.value = r.tags || tags.value.filter((x) => x !== tag);
  } catch (e: any) {
    ElMessage.error(e.message || '删除标签失败');
  }
}

async function restoreVersion(v: any) {
  try {
    await ElMessageBox.confirm(
      `将当前文件替换为版本 v${v.version}？当前内容会先存为新版本，可随时恢复。`,
      '恢复版本',
      { type: 'warning' }
    );
  } catch {
    return;
  }
  try {
    await api(`/files/${encPath.value}/versions/${v.version}/restore?storageId=${props.storageId}`, { method: 'POST' });
    ElMessage.success(`已恢复到版本 v${v.version}`);
    versionsLoaded.value = false;
    await loadVersions();
    emit('restored');
  } catch (e: any) {
    ElMessage.error(e.message || '恢复版本失败');
  }
}

async function deleteVersion(v: any) {
  try {
    await ElMessageBox.confirm(`确定删除版本 v${v.version}？该操作不可撤销。`, '删除版本', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await api(`/files/${encPath.value}/versions/${v.version}?storageId=${props.storageId}`, { method: 'DELETE' });
    ElMessage.success('版本已删除');
    versions.value = versions.value.filter((x) => x.version !== v.version);
  } catch (e: any) {
    ElMessage.error(e.message || '删除版本失败');
  }
}

async function submitComment() {
  const content = commentText.value.trim();
  if (!content || submitting.value) return;
  submitting.value = true;
  try {
    const r = await api(`/files/${encPath.value}/comments?storageId=${props.storageId}`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    comments.value = r.comments || [];
    commentsLoaded.value = true;
    commentText.value = '';
  } catch (e: any) {
    ElMessage.error(e.message || '发表评论失败');
  } finally {
    submitting.value = false;
  }
}

async function deleteComment(c: any) {
  try {
    await api(`/files/${encPath.value}/comments/${c.id}?storageId=${props.storageId}`, { method: 'DELETE' });
    comments.value = comments.value.filter((x) => x.id !== c.id);
  } catch (e: any) {
    ElMessage.error(e.message || '删除评论失败');
  }
}
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    :title="name ? `详情 · ${name}` : '文件详情'"
    size="440px"
    direction="rtl"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <div v-loading="loading" class="fd-wrap">
      <el-tabs v-model="tab" class="fd-tabs">
        <!-- 概览：缩略图 + 属性 + 标签 -->
        <el-tab-pane label="概览" name="overview">
          <div v-if="thumbSrc" class="fd-thumb">
            <img :src="thumbSrc" :alt="name" />
          </div>
          <div class="fd-rows">
            <div class="fd-row"><span class="fd-label">名称</span><span class="fd-value">{{ name }}</span></div>
            <div class="fd-row"><span class="fd-label">路径</span><span class="fd-value">{{ path }}</span></div>
            <div class="fd-row"><span class="fd-label">大小</span><span class="fd-value">{{ meta?.size != null ? fmtSize(meta.size) : size != null ? fmtSize(size) : '-' }}</span></div>
            <div v-if="meta?.ext" class="fd-row"><span class="fd-label">类型</span><span class="fd-value">{{ meta.ext }}</span></div>
            <div class="fd-row"><span class="fd-label">修改时间</span><span class="fd-value">{{ fmtTime(meta?.mtime ?? mtime) }}</span></div>
            <div v-if="meta?.width" class="fd-row"><span class="fd-label">尺寸</span><span class="fd-value">{{ meta.width }} × {{ meta.height }}</span></div>
          </div>

          <div class="fd-section-title">标签</div>
          <div class="fd-tags">
            <span v-for="t in tags" :key="t" class="fd-tag">
              {{ t }}
              <el-icon class="fd-tag-x" @click="removeTag(t)"><Close /></el-icon>
            </span>
            <span v-if="!tags.length" class="fd-tags-empty">暂无标签</span>
          </div>
          <div class="fd-tag-input">
            <el-input v-model="newTag" size="small" placeholder="添加标签，回车确认" @keyup.enter="addTag" />
            <el-button size="small" :disabled="!newTag.trim()" @click="addTag">添加</el-button>
          </div>
        </el-tab-pane>

        <!-- 版本历史 -->
        <el-tab-pane label="版本" name="versions">
          <div v-if="versions.length" class="fd-versions">
            <div v-for="v in versions" :key="v.version" class="fd-version">
              <span class="fd-version-badge">v{{ v.version }}</span>
              <div class="fd-version-info">
                <span class="fd-version-size">{{ fmtSize(v.size || 0) }}</span>
                <span class="fd-version-time">{{ fmtTime(v.mtime) }}</span>
              </div>
              <el-button size="small" type="primary" link @click="restoreVersion(v)">恢复</el-button>
              <el-button size="small" type="danger" link @click="deleteVersion(v)">删除</el-button>
            </div>
          </div>
          <div v-else class="fd-empty">
            <el-icon :size="34"><Clock /></el-icon>
            <p>暂无历史版本</p>
            <p class="fd-empty-sub">覆盖上传同名文件时，旧内容会自动保存为版本</p>
          </div>
        </el-tab-pane>

        <!-- 评论 -->
        <el-tab-pane label="评论" name="comments">
          <div v-if="comments.length" class="fd-comments">
            <div v-for="c in comments" :key="c.id" class="fd-comment">
              <div class="fd-comment-head">
                <span class="fd-comment-user">{{ c.username || '用户' }}</span>
                <span class="fd-comment-time">{{ fmtTime(c.created_at) }}</span>
                <el-button class="fd-comment-del" size="small" link @click="deleteComment(c)">删除</el-button>
              </div>
              <div class="fd-comment-body">{{ c.content }}</div>
            </div>
          </div>
          <div v-else class="fd-empty">
            <el-icon :size="34"><ChatLineRound /></el-icon>
            <p>还没有评论</p>
            <p class="fd-empty-sub">为文件添加备注，方便团队协作</p>
          </div>
          <div class="fd-comment-input">
            <el-input
              v-model="commentText"
              type="textarea"
              :rows="2"
              placeholder="写点备注…"
              @keydown.ctrl.enter="submitComment"
            />
            <el-button size="small" type="primary" :loading="submitting" :disabled="!commentText.trim()" @click="submitComment">
              发表（Ctrl+Enter）
            </el-button>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </el-drawer>
</template>

<style scoped>
.fd-wrap {
  padding: 0 4px;
}
.fd-tabs :deep(.el-tabs__item) {
  font-size: 14px;
}

.fd-thumb {
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 14px;
  border: 1px solid var(--glass-border);
}
.fd-thumb img {
  display: block;
  width: 100%;
  max-height: 240px;
  object-fit: contain;
  background: var(--glass-bg);
}

.fd-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.fd-row {
  display: flex;
  gap: 10px;
  font-size: 13px;
  line-height: 1.6;
}
.fd-label {
  flex-shrink: 0;
  width: 64px;
  opacity: 0.6;
}
.fd-value {
  word-break: break-all;
}

.fd-section-title {
  margin: 18px 0 8px;
  font-size: 13px;
  font-weight: 600;
  opacity: 0.85;
}
.fd-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 26px;
}
.fd-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: var(--accent-soft);
  color: var(--accent);
}
.fd-tag-x {
  font-size: 11px;
  cursor: pointer;
  opacity: 0.7;
}
.fd-tag-x:hover {
  opacity: 1;
}
.fd-tags-empty {
  font-size: 12px;
  opacity: 0.5;
}
.fd-tag-input {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.fd-versions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.fd-version {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}
.fd-version-badge {
  flex-shrink: 0;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  background: var(--accent-soft);
  color: var(--accent);
}
.fd-version-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  font-size: 12px;
  min-width: 0;
}
.fd-version-time {
  opacity: 0.6;
}

.fd-comments {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
}
.fd-comment {
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
}
.fd-comment-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.fd-comment-user {
  font-weight: 600;
  color: var(--accent);
}
.fd-comment-time {
  opacity: 0.55;
}
.fd-comment-del {
  margin-left: auto;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.fd-comment:hover .fd-comment-del {
  opacity: 1;
}
.fd-comment-body {
  margin-top: 6px;
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
  white-space: pre-wrap;
}

.fd-comment-input {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}
.fd-comment-input .el-button {
  align-self: flex-end;
}

.fd-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 36px 0 20px;
  opacity: 0.75;
}
.fd-empty .el-icon {
  opacity: 0.4;
}
.fd-empty p {
  margin: 0;
  font-size: 14px;
}
.fd-empty-sub {
  font-size: 12px;
  opacity: 0.6;
}
</style>
