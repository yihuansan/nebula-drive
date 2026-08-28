<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';

const props = defineProps<{
  srcUrl: string;
  fileName: string;
  storageId: number | null;
  dirPath: string;
}>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>();

const canvasRef = ref<HTMLCanvasElement>();
const img = new Image();
img.crossOrigin = 'anonymous';
img.onload = () => {
  const c = canvasRef.value;
  if (!c) return;
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.drawImage(img, 0, 0);
};
img.src = props.srcUrl;

/* ---------- 裁剪区域（拖拽框选） ---------- */
const crop = ref({ x: 0, y: 0, w: 0, h: 0 });
const hasCrop = ref(false);
const dragging = ref(false);
const dragStart = { x: 0, y: 0 };

function toCanvas(e: MouseEvent) {
  const c = canvasRef.value!;
  const r = c.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(c.width, ((e.clientX - r.left) / r.width) * c.width)),
    y: Math.max(0, Math.min(c.height, ((e.clientY - r.top) / r.height) * c.height)),
  };
}
function onDown(e: MouseEvent) {
  dragging.value = true;
  const p = toCanvas(e);
  dragStart.x = p.x;
  dragStart.y = p.y;
}
function onUp(e: MouseEvent) {
  if (!dragging.value) return;
  dragging.value = false;
  const p = toCanvas(e);
  const x = Math.min(dragStart.x, p.x);
  const y = Math.min(dragStart.y, p.y);
  const w = Math.abs(p.x - dragStart.x);
  const h = Math.abs(p.y - dragStart.y);
  if (w < 8 || h < 8) return; // 过小视为放弃
  crop.value = { x, y, w, h };
  hasCrop.value = true;
}
function resetCrop() {
  hasCrop.value = false;
  crop.value = { x: 0, y: 0, w: 0, h: 0 };
}

/* ---------- 压缩参数 ---------- */
const format = ref<'jpeg' | 'png' | 'webp'>('jpeg');
const quality = ref(80);
const processing = ref(false);
const processedBlob = ref<Blob | null>(null);
const processedSize = ref(0);

const MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const baseName = () => {
  const n = props.fileName;
  const i = n.lastIndexOf('.');
  return i > 0 ? n.slice(0, i) : n;
};
const resultName = () => `${baseName()}.${format.value}`;

async function process() {
  const c = canvasRef.value;
  if (!c) return;
  processing.value = true;
  try {
    // canvas 端裁剪
    const sw = hasCrop.value ? crop.value.w : c.width;
    const sh = hasCrop.value ? crop.value.h : c.height;
    const sx = hasCrop.value ? crop.value.x : 0;
    const sy = hasCrop.value ? crop.value.y : 0;
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(sw));
    out.height = Math.max(1, Math.round(sh));
    out.getContext('2d')!.drawImage(c, sx, sy, sw, sh, 0, 0, out.width, out.height);
    const blob = await new Promise<Blob | null>((res) =>
      out.toBlob(res, MIME[format.value], quality.value / 100),
    );
    if (!blob) throw new Error('Canvas 导出失败');
    // 服务端 ffmpeg 重编码压缩
    const fd = new FormData();
    fd.append('file', blob, resultName());
    fd.append('format', format.value);
    fd.append('quality', String(quality.value));
    const token = localStorage.getItem('nebula_token') || '';
    const res = await fetch('/api/v1/media/image/compress', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`压缩失败 (HTTP ${res.status})`);
    }
    const outBlob = await res.blob();
    processedBlob.value = outBlob;
    processedSize.value = outBlob.size;
    ElMessage.success('处理完成');
  } catch (e: any) {
    ElMessage.error(e?.message || '处理失败');
  } finally {
    processing.value = false;
  }
}

function download() {
  if (!processedBlob.value) return;
  const url = URL.createObjectURL(processedBlob.value);
  const a = document.createElement('a');
  a.href = url;
  a.download = resultName();
  a.click();
  URL.revokeObjectURL(url);
}

async function uploadResult() {
  if (!processedBlob.value || props.storageId === null) return;
  const fd = new FormData();
  fd.append('storageId', String(props.storageId));
  fd.append('path', props.dirPath);
  fd.append('name', resultName());
  const f = new File([processedBlob.value], resultName(), { type: MIME[format.value] });
  fd.append('file', f);
  await api('/upload/direct', { method: 'POST', body: fd });
  ElMessage.success('已上传到当前目录');
  emit('saved');
}

onMounted(() => {
  /* 图片由 img.onload 自动绘制 */
});
</script>

<template>
  <el-dialog
    :model-value="true"
    title="图片编辑器（裁剪 / 压缩）"
    width="880px"
    :close-on-click-modal="false"
    @close="emit('close')"
  >
    <div class="ie-wrap">
      <div class="ie-canvas-box">
        <canvas
          ref="canvasRef"
          class="ie-canvas"
          :class="{ 'ie-cropping': hasCrop }"
          @mousedown="onDown"
          @mouseup="onUp"
          @mouseleave="onUp"
        />
        <div
          v-if="hasCrop"
          class="ie-crop-box"
          :style="{
            left: `${(crop.x / (canvasRef?.width || 1)) * 100}%`,
            top: `${(crop.y / (canvasRef?.height || 1)) * 100}%`,
            width: `${(crop.w / (canvasRef?.width || 1)) * 100}%`,
            height: `${(crop.h / (canvasRef?.height || 1)) * 100}%`,
          }"
        ></div>
      </div>
      <div class="ie-controls">
        <el-form label-width="80px" size="small">
          <el-form-item label="输出格式">
            <el-select v-model="format" style="width: 120px">
              <el-option label="JPEG" value="jpeg" />
              <el-option label="PNG" value="png" />
              <el-option label="WebP" value="webp" />
            </el-select>
          </el-form-item>
          <el-form-item label="质量">
            <el-slider v-model="quality" :min="10" :max="100" :disabled="format === 'png'" />
          </el-form-item>
          <el-form-item label="裁剪">
            <el-button size="small" @click="resetCrop" :disabled="!hasCrop">重置裁剪</el-button>
            <span class="ie-hint">在图片上拖拽框选裁剪区域</span>
          </el-form-item>
        </el-form>
        <div class="ie-actions">
          <el-button type="primary" :loading="processing" @click="process">处理</el-button>
          <el-button :disabled="!processedBlob" @click="download">下载</el-button>
          <el-button :disabled="!processedBlob || storageId === null" @click="uploadResult">
            上传到当前目录
          </el-button>
        </div>
        <div v-if="processedBlob" class="ie-result">
          处理后大小：{{ processedSize }} 字节
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.ie-wrap {
  display: flex;
  gap: 16px;
}
.ie-canvas-box {
  flex: 1;
  position: relative;
  max-height: 70vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
}
.ie-canvas {
  max-width: 100%;
  max-height: 70vh;
  cursor: crosshair;
  user-select: none;
}
.ie-crop-box {
  position: absolute;
  border: 2px solid #409eff;
  background: rgba(64, 158, 255, 0.15);
  pointer-events: none;
}
.ie-controls {
  width: 240px;
  flex-shrink: 0;
}
.ie-hint {
  font-size: 12px;
  color: #909399;
  margin-left: 8px;
}
.ie-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
.ie-result {
  margin-top: 10px;
  font-size: 12px;
  color: #67c23a;
}
</style>
