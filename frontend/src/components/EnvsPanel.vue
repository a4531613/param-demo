<template>
  <el-card>
    <template #header>
      <div class="cc-toolbar">
        <div class="cc-toolbar__group">
          <el-select v-model="filters.appId" placeholder="选择应用" class="cc-control--lg">
            <el-option v-for="a in apps" :key="a.id" :label="`${a.app_name}`" :value="a.id" />
          </el-select>
        </div>
        <div class="cc-toolbar__group">
          <el-switch v-model="filters.enabledOnly" active-text="仅启用" />
          <el-button type="primary" @click="openModal()" :disabled="!capabilities.canWrite">新增环境</el-button>
        </div>
      </div>
    </template>

    <el-empty v-if="!rowsFiltered.length" description="暂无环境，请先创建环境。" />
    <el-table v-else :data="rowsFiltered" border :row-key="(row) => row.id">
      <el-table-column prop="env_name" label="环境名称" />
      <el-table-column label="所属应用" width="200">
        <template #default="s">{{ appLabel(s.row.app_id) }}</template>
      </el-table-column>
      <el-table-column prop="description" label="描述" />
      <el-table-column prop="enabled" label="启用" width="90">
        <template #default="s">
          <el-tag :type="s.row.enabled ? 'success' : 'info'">{{ s.row.enabled ? '是' : '否' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="create_user" label="创建人" width="120" />
      <el-table-column prop="create_time" label="创建时间" width="180" />
      <el-table-column prop="update_user" label="更新人" width="120" />
      <el-table-column prop="update_time" label="更新时间" width="180" />
      <el-table-column label="操作" width="160">
        <template #default="scope">
          <el-button link type="primary" @click="openModal(scope.row)" :disabled="!capabilities.canWrite">编辑</el-button>
          <el-button link type="danger" @click="remove(scope.row)" :disabled="!capabilities.canWrite">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="modal.visible" :title="modal.editId ? '编辑环境' : '新增环境'" width="520px">
    <el-form :model="modal.form" label-width="120px">
      <el-form-item label="所属应用">
        <el-select v-model="modal.form.appId" :disabled="!!modal.editId">
          <el-option v-for="a in apps" :key="a.id" :label="`${a.app_name}`" :value="a.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="环境名称"><el-input v-model="modal.form.envName" /></el-form-item>
      <el-form-item label="描述"><el-input v-model="modal.form.description" type="textarea" /></el-form-item>
      <el-form-item label="启用"><el-switch v-model="modal.form.enabled" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="modal.visible = false">取消</el-button>
      <el-button type="primary" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, onMounted, reactive, watch } from 'vue';
import { api } from '../api';
import { capabilities } from '../userContext';
import { confirmAction, toastError, toastSuccess, toastWarning } from '../ui/feedback';

const apps = reactive([]);
const rows = reactive([]);
const filters = reactive({ appId: null, enabledOnly: false });
const modal = reactive({ visible: false, editId: null, form: { appId: null, envName: '', description: '', enabled: true } });

const appById = computed(() => new Map(apps.map((a) => [a.id, a])));
const appLabel = (appId) => {
  const a = appById.value.get(appId);
  if (!a) return `App ${appId}`;
  return `${a.app_name}`;
};

const rowsFiltered = computed(() => {
  return rows.filter((r) => {
    const okApp = !filters.appId || r.app_id === filters.appId;
    const okEnabled = !filters.enabledOnly || r.enabled;
    return okApp && okEnabled;
  });
});

function ensureAppDefault() {
  if (!filters.appId && apps.length) filters.appId = apps[0].id;
}

async function loadApps() {
  try {
    const list = await api.listApps();
    apps.splice(0, apps.length, ...list);
    ensureAppDefault();
  } catch (e) {
    toastError(e, '加载应用失败');
  }
}

async function loadEnvs() {
  try {
    const list = await api.listEnvs(filters.appId || undefined);
    rows.splice(0, rows.length, ...list);
  } catch (e) {
    toastError(e, '加载环境失败');
  }
}

function openModal(row) {
  if (row) {
    modal.editId = row.id;
    modal.form = { appId: row.app_id, envName: row.env_name, description: row.description || '', enabled: !!row.enabled };
  } else {
    modal.editId = null;
    modal.form = { appId: filters.appId || apps[0]?.id || null, envName: '', description: '', enabled: true };
  }
  modal.visible = true;
}

async function save() {
  if (!capabilities.value.canWrite) return toastWarning('当前角色为只读，无法操作');
  if (!modal.form.appId || !modal.form.envName) return toastWarning('请填写必填项');
  try {
    if (modal.editId) {
      await api.updateEnv(modal.editId, { envName: modal.form.envName, description: modal.form.description, enabled: modal.form.enabled });
      toastSuccess('环境已更新');
    } else {
      await api.createEnv({ appId: modal.form.appId, envName: modal.form.envName, description: modal.form.description, enabled: modal.form.enabled });
      toastSuccess('环境已创建');
    }
    modal.visible = false;
    await loadEnvs();
  } catch (e) {
    toastError(e, '保存失败');
  }
}

async function remove(row) {
  if (!capabilities.value.canWrite) return toastWarning('当前角色为只读，无法操作');
  try {
    await confirmAction('确认删除该环境？', '提示');
    await api.deleteEnv(row.id);
    toastSuccess('环境已删除');
    await loadEnvs();
  } catch (e) {
    toastError(e, '删除失败');
  }
}

onMounted(async () => {
  await loadApps();
  await loadEnvs();
});

watch(
  () => filters.appId,
  async () => {
    ensureAppDefault();
    await loadEnvs();
  }
);
</script>
