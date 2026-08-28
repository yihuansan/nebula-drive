<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../../api';

interface PermDef { key: string; label: string; module: string }
interface ModuleDef { key: string; label: string }
interface RoleDef { key: string; label: string }

const permissions = ref<PermDef[]>([]);
const modules = ref<ModuleDef[]>([]);
const roles = ref<RoleDef[]>([]);
// roleKey -> Set of permission keys (checked)
const checked = ref<Record<string, string[]>>({});
const saving = ref<Record<string, boolean>>({});
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const meta = await api('/permissions');
    permissions.value = meta.permissions;
    modules.value = meta.modules;
    roles.value = meta.roles;
    const r = await api('/roles');
    for (const role of r.roles) {
      checked.value[role.key] = role.permissions;
    }
  } catch (e: any) {
    ElMessage.error(e.message || '加载角色权限失败');
  } finally {
    loading.value = false;
  }
}

onMounted(load);

// 按模块分组的权限点
const grouped = computed(() =>
  modules.value.map((m) => ({
    module: m,
    perms: permissions.value.filter((p) => p.module === m.key),
  }))
);

function isChecked(roleKey: string, permKey: string): boolean {
  return (checked.value[roleKey] || []).includes(permKey);
}

function toggle(roleKey: string, permKey: string) {
  const arr = checked.value[roleKey] || [];
  const idx = arr.indexOf(permKey);
  if (idx >= 0) arr.splice(idx, 1);
  else arr.push(permKey);
  checked.value[roleKey] = arr;
}

async function save(roleKey: string) {
  saving.value[roleKey] = true;
  try {
    await api(`/roles/${roleKey}`, {
      method: 'PUT',
      body: JSON.stringify({ permissions: checked.value[roleKey] || [] }),
    });
    ElMessage.success(`已保存「${roles.value.find((r) => r.key === roleKey)?.label}」的权限`);
  } catch (e: any) {
    ElMessage.error(e.message || '保存失败');
  } finally {
    saving.value[roleKey] = false;
  }
}

function count(roleKey: string): number {
  return (checked.value[roleKey] || []).length;
}
</script>

<template>
  <div class="page">
    <!-- 权限矩阵：每个角色一列，权限点按模块分组 -->
    <section class="panel glass-card" v-loading="loading">
      <div class="panel-head">
        <el-icon class="panel-icon"><Lock /></el-icon>
        <span class="panel-title">角色权限矩阵</span>
        <span class="hint">勾选 / 取消权限点后，点击对应角色的「保存」生效</span>
      </div>

      <div class="matrix-wrap">
        <table class="matrix">
          <thead>
            <tr>
              <th class="perm-col">权限点</th>
              <th v-for="role in roles" :key="role.key" class="role-col">
                <div class="role-head">
                  <span>{{ role.label }}</span>
                  <el-tag size="small" type="info">{{ count(role.key) }} 项</el-tag>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <template v-for="g in grouped" :key="g.module.key">
              <tr class="module-row">
                <td colspan="3" class="module-label">{{ g.module.label }}</td>
              </tr>
              <tr v-for="p in g.perms" :key="p.key">
                <td class="perm-cell" :title="p.label">{{ p.label }}</td>
                <td v-for="role in roles" :key="role.key" class="check-cell">
                  <el-checkbox
                    :model-value="isChecked(role.key, p.key)"
                    @change="toggle(role.key, p.key)"
                  />
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <!-- 保存按钮（每角色一个） -->
      <div class="save-row">
        <div v-for="role in roles" :key="role.key" class="save-item">
          <span class="save-label">{{ role.label }}</span>
          <el-button type="primary" size="small" :loading="saving[role.key]" @click="save(role.key)">
            保存{{ role.label }}权限
          </el-button>
        </div>
      </div>
    </section>

    <!-- 说明 -->
    <section class="panel glass-card note">
      <div class="note-head">
        <el-icon><InfoFilled /></el-icon>
        <span>说明</span>
      </div>
      <ul class="note-list">
        <li>权限点按功能模块分组，角色捆绑权限点，用户通过分配角色获得权限。</li>
        <li>「超级管理员」至少保留一个权限，否则系统无人可管理（防锁死）。</li>
        <li>修改权限后即时生效：用户下次操作即按新权限校验，无需重新登录。</li>
        <li>普通用户默认拥有文件 + 回收站的数据操作权限，无管理端权限。</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.panel {
  border-radius: 18px;
  padding: 20px 22px;
}
.panel:hover {
  transform: none;
}
.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.panel-icon {
  color: var(--accent);
  font-size: 18px;
}
.panel-title {
  font-size: 15px;
  font-weight: 600;
}
.hint {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-secondary);
}

.matrix-wrap {
  overflow-x: auto;
}
.matrix {
  width: 100%;
  border-collapse: collapse;
  min-width: 560px;
}
.matrix th,
.matrix td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid var(--glass-border);
}
.perm-col {
  width: 40%;
  font-weight: 600;
  font-size: 13px;
  color: var(--text-secondary);
}
.role-col {
  width: 30%;
  font-weight: 600;
  font-size: 13px;
}
.role-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.module-row .module-label {
  font-weight: 700;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--accent);
  background: var(--accent-soft);
  padding: 8px 12px;
}
.perm-cell {
  font-size: 13px;
  color: var(--text);
}
.check-cell {
  text-align: center;
}

.save-row {
  display: flex;
  gap: 24px;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--glass-border);
  flex-wrap: wrap;
}
.save-item {
  display: flex;
  align-items: center;
  gap: 10px;
}
.save-label {
  font-size: 13px;
  font-weight: 600;
}

.note {
  background: var(--glass-bg);
}
.note-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 10px;
}
.note-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.7;
}
</style>
