<template>
  <el-card>
    <template #header>
      <div class="cc-toolbar">
        <div class="cc-toolbar__group">
          <el-input v-model="filters.keyword" placeholder="按名称过滤" clearable class="cc-control--xl" />
        </div>
        <div class="cc-toolbar__group">
          <el-switch v-model="filters.enabledOnly" active-text="仅启用" />
          <el-button type="primary" @click="openModal()" :disabled="!capabilities.canWrite">新增应用</el-button>
        </div>
      </div>
    </template>

    <el-empty v-if="!filtered.length" description="暂无应用，请先创建应用。" />
    <el-table v-else :data="filtered" border :row-key="(row) => row.id">
      <el-table-column prop="app_name" label="应用名称" />
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

  <el-dialog v-model="modal.visible" :title="modal.editId ? '编辑应用' : '新增应用'" width="520px">
    <el-form :model="modal.form" label-width="120px">
      <el-form-item label="应用名称"><el-input v-model="modal.form.appName" /></el-form-item>
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
import { computed, onMounted, reactive } from 'vue';
import { api } from '../api';
import { capabilities } from '../userContext';
import { confirmAction, toastError, toastSuccess, toastWarning } from '../ui/feedback';

const filters = reactive({ keyword: '', enabledOnly: false });
const modal = reactive({ visible: false, editId: null, form: { appName: '', description: '', enabled: true } });
const state = reactive({ rows: [] });

const filtered = computed(() => {
  const kw = (filters.keyword || '').trim().toLowerCase();
  return (state.rows || []).filter((r) => {
    const okKw = !kw || String(r.id).includes(kw) || String(r.app_name || '').toLowerCase().includes(kw);
    const okEnabled = !filters.enabledOnly || r.enabled;
    return okKw && okEnabled;
  });
});

function openModal(row) {
  if (row) {
    modal.editId = row.id;
    modal.form = { appName: row.app_name, description: row.description || '', enabled: !!row.enabled };
  } else {
    modal.editId = null;
    modal.form = { appName: '', description: '', enabled: true };
  }
  modal.visible = true;
}

async function load() {
  try {
    state.rows = await api.listApps();
  } catch (e) {
    toastError(e, '加载应用失败');
  }
}

async function save() {
  if (!capabilities.value.canWrite) return toastWarning('当前角色为只读，无法操作');
  if (!modal.form.appName) return toastWarning('请填写应用名称');
  try {
    if (modal.editId) {
      await api.updateApp(modal.editId, { appName: modal.form.appName, description: modal.form.description, enabled: modal.form.enabled });
      toastSuccess('应用已更新');
    } else {
      await api.createApp({ appName: modal.form.appName, description: modal.form.description, enabled: modal.form.enabled });
      toastSuccess('应用已创建');
    }
    modal.visible = false;
    await load();
  } catch (e) {
    toastError(e, '保存失败');
  }
}

async function remove(row) {
  if (!capabilities.value.canWrite) return toastWarning('当前角色为只读，无法操作');
  try {
    await confirmAction('确认删除该应用？', '提示');
    await api.deleteApp(row.id);
    toastSuccess('应用已删除');
    await load();
  } catch (e) {
    toastError(e, '删除失败');
  }
}

onMounted(load);
</script>
