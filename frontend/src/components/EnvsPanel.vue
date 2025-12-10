<template>
  <el-card>
    <template #header>
      <div class="toolbar">
        <el-select v-model="filters.appId" placeholder="选择应用" style="width:220px;" clearable>
          <el-option v-for="a in apps" :key="a.id" :label="`${a.app_name} (${a.app_code})`" :value="a.id" />
        </el-select>
        <div>
          <el-switch v-model="filters.enabledOnly" active-text="仅启用" />
          <el-button type="primary" style="margin-left:10px;" @click="openModal()">新增环境</el-button>
        </div>
      </div>
    </template>
    <el-table :data="rowsFiltered" border>
      <el-table-column prop="id" label="环境ID" width="90" />
      <el-table-column prop="env_code" label="环境编码" width="140" />
      <el-table-column prop="env_name" label="环境名称" />
      <el-table-column prop="app_code" label="应用" width="140" />
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

  <el-dialog v-model="modal.visible" :title="modal.editId ? '编辑环境' : '新增环境'" width="520px">
    <el-form :model="modal.form" label-width="120px">
      <el-form-item label="所属应用">
        <el-select v-model="modal.form.appId" :disabled="!!modal.editId">
          <el-option v-for="a in apps" :key="a.id" :label="`${a.app_name} (${a.app_code})`" :value="a.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="环境编码"><el-input v-model="modal.form.envCode" :disabled="!!modal.editId" /></el-form-item>
      <el-form-item label="环境名称"><el-input v-model="modal.form.envName" /></el-form-item>
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

const apps = reactive([]);
const rows = reactive([]);
const filters = reactive({ appId: null, enabledOnly: false });
const modal = reactive({
  visible: false,
  editId: null,
  form: { appId: null, envCode: '', envName: '', description: '', enabled: true }
});

const rowsFiltered = computed(() => {
  return rows.filter((r) => {
    const okApp = !filters.appId || r.app_id === filters.appId;
    const okEnabled = !filters.enabledOnly || r.enabled;
    return okApp && okEnabled;
  });
});

async function loadApps() {
  const list = await api.listApps();
  apps.splice(0, apps.length, ...list);
}
async function loadEnvs() {
  const list = await api.listEnvs(filters.appId || undefined);
  rows.splice(0, rows.length, ...list);
}

function openModal(row) {
  if (row) {
    modal.editId = row.id;
    modal.form = { appId: row.app_id, envCode: row.env_code, envName: row.env_name, description: row.description || '', enabled: !!row.enabled };
  } else {
    modal.editId = null;
    modal.form = { appId: filters.appId || null, envCode: '', envName: '', description: '', enabled: true };
  }
  modal.visible = true;
}

async function save() {
  if (!modal.form.appId || !modal.form.envCode || !modal.form.envName) return ElMessage.warning('请填写必填项');
  if (modal.editId) {
    await api.updateEnv(modal.editId, { envName: modal.form.envName, description: modal.form.description, enabled: modal.form.enabled });
  } else {
    await api.createEnv(modal.form);
  }
  modal.visible = false;
  await loadEnvs();
}

async function remove(row) {
  await ElMessageBox.confirm('确认删除该环境？', '提示');
  await api.deleteEnv(row.id);
  await loadEnvs();
}

onMounted(async () => {
  await loadApps();
  await loadEnvs();
});
</script>

<style scoped>
.toolbar { display:flex; justify-content: space-between; align-items:center; }
</style>
