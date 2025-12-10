<template>
  <el-card>
    <template #header>
      <div class="toolbar">
        <el-input v-model="filters.keyword" placeholder="按名称/ID过滤" clearable style="width:240px;" />
        <div>
          <el-switch v-model="filters.enabledOnly" active-text="仅启用" />
          <el-button type="primary" style="margin-left:10px;" @click="openModal()">新增应用</el-button>
        </div>
      </div>
    </template>
    <el-table :data="filtered" border>
      <el-table-column prop="id" label="应用ID" width="90" />
      <el-table-column prop="app_code" label="应用编码" width="160" />
      <el-table-column prop="app_name" label="应用名称" />
      <el-table-column prop="description" label="描述" />
      <el-table-column prop="enabled" label="启用" width="90">
        <template #default="s"><el-tag :type="s.row.enabled ? 'success' : 'info'">{{ s.row.enabled ? '是' : '否' }}</el-tag></template>
      </el-table-column>
      <el-table-column prop="create_user" label="创建人" width="120" />
      <el-table-column prop="create_time" label="创建时间" width="180" />
      <el-table-column prop="update_user" label="更新人" width="120" />
      <el-table-column prop="update_time" label="更新时间" width="180" />
      <el-table-column label="操作" width="160">
        <template #default="scope">
          <el-button link type="primary" @click="openModal(scope.row)">编辑</el-button>
          <el-button link type="danger" @click="remove(scope.row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="modal.visible" :title="modal.editId ? '编辑应用' : '新增应用'" width="520px">
    <el-form :model="modal.form" label-width="120px">
      <el-form-item label="应用编码"><el-input v-model="modal.form.appCode" :disabled="!!modal.editId" /></el-form-item>
      <el-form-item label="应用名称"><el-input v-model="modal.form.appName" /></el-form-item>
      <el-form-item label="描述"><el-input v-model="modal.form.description" type="textarea" /></el-form-item>
      <el-form-item label="启用"><el-switch v-model="modal.form.enabled" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="modal.visible=false">取消</el-button>
      <el-button type="primary" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, onMounted, reactive } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';

const filters = reactive({ keyword: '', enabledOnly: false });
const modal = reactive({
  visible: false,
  editId: null,
  form: { appCode: '', appName: '', description: '', enabled: true }
});
const state = reactive({ rows: [] });

const filtered = computed(() => {
  const kw = filters.keyword.toLowerCase();
  return state.rows.filter((r) => {
    const okKw = !kw || r.app_name.toLowerCase().includes(kw) || String(r.id).includes(kw);
    const okEnabled = !filters.enabledOnly || r.enabled;
    return okKw && okEnabled;
  });
});

function openModal(row) {
  if (row) {
    modal.editId = row.id;
    modal.form = { appCode: row.app_code, appName: row.app_name, description: row.description || '', enabled: !!row.enabled };
  } else {
    modal.editId = null;
    modal.form = { appCode: '', appName: '', description: '', enabled: true };
  }
  modal.visible = true;
}

async function load() {
  state.rows = await api.listApps();
}

async function save() {
  if (!modal.form.appCode || !modal.form.appName) return ElMessage.warning('请填写编码和名称');
  if (modal.editId) {
    await api.updateApp(modal.editId, { appName: modal.form.appName, description: modal.form.description, enabled: modal.form.enabled });
  } else {
    await api.createApp(modal.form);
  }
  modal.visible = false;
  await load();
}

async function remove(row) {
  await ElMessageBox.confirm('确认删除该应用？', '提示');
  await api.deleteApp(row.id);
  await load();
}

onMounted(load);
</script>

<style scoped>
.toolbar { display:flex; justify-content: space-between; align-items: center; }
</style>
