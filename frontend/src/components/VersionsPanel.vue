<template>
  <el-card>
    <template #header>
      <div class="toolbar">
        <el-select v-model="filters.appId" placeholder="应用" clearable style="width:180px;">
          <el-option v-for="a in apps" :key="a.id" :label="`${a.app_name} (${a.app_code})`" :value="a.id" />
        </el-select>
        <el-select v-model="filters.envId" placeholder="环境" clearable style="width:180px;">
          <el-option v-for="e in envs" :key="e.id" :label="`${e.env_name} (${e.env_code})`" :value="e.id" />
        </el-select>
        <el-select v-model="filters.typeId" placeholder="配置类型" clearable filterable style="width:220px;">
          <el-option v-for="t in types" :key="t.id" :label="`${t.type_name} (${t.type_code})`" :value="t.id" />
        </el-select>
        <el-select v-model="filters.status" placeholder="状态" clearable style="width:140px;">
          <el-option label="DRAFT" value="DRAFT" />
          <el-option label="PENDING_RELEASE" value="PENDING_RELEASE" />
          <el-option label="RELEASED" value="RELEASED" />
          <el-option label="ARCHIVED" value="ARCHIVED" />
        </el-select>
        <el-button type="primary" @click="openModal()">新增版本</el-button>
      </div>
    </template>
    <el-table :data="versions" border>
      <el-table-column prop="id" label="版本ID" width="90" />
      <el-table-column prop="version_no" label="版本号" width="140" />
      <el-table-column prop="type_id" label="类型ID" width="90" />
      <el-table-column prop="app_id" label="应用ID" width="90" />
      <el-table-column prop="env_id" label="环境ID" width="90" />
      <el-table-column prop="status" label="状态" width="140">
        <template #default="s"><el-tag :type="tagType(s.row.status)">{{ s.row.status }}</el-tag></template>
      </el-table-column>
      <el-table-column prop="enabled" label="启用" width="80">
        <template #default="s"><el-tag :type="s.row.enabled ? 'success' : 'info'">{{ s.row.enabled ? '是' : '否' }}</el-tag></template>
      </el-table-column>
      <el-table-column prop="effective_from" label="开始时间" width="180" />
      <el-table-column prop="effective_to" label="结束时间" width="180" />
      <el-table-column prop="description" label="描述" />
      <el-table-column prop="create_user" label="创建人" width="120" />
      <el-table-column prop="create_time" label="创建时间" width="180" />
      <el-table-column prop="update_user" label="更新人" width="120" />
      <el-table-column prop="update_time" label="更新时间" width="180" />
      <el-table-column label="操作" width="220">
        <template #default="scope">
          <el-button link type="primary" @click="openModal(scope.row)">编辑</el-button>
          <el-button link type="success" @click="publish(scope.row)" :disabled="scope.row.status !== 'PENDING_RELEASE'">发布</el-button>
          <el-button link type="danger" @click="remove(scope.row)" :disabled="scope.row.status === 'RELEASED'">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="modal.visible" :title="modal.editId ? '编辑版本' : '新增版本'" width="520px">
    <el-form :model="modal.form" label-width="120px">
      <el-form-item label="配置类型">
        <el-select v-model="modal.form.typeId" filterable>
          <el-option v-for="t in types" :key="t.id" :label="`${t.type_name} (${t.type_code})`" :value="t.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="版本号"><el-input v-model="modal.form.versionNo" /></el-form-item>
      <el-form-item label="描述"><el-input v-model="modal.form.description" type="textarea" /></el-form-item>
      <el-form-item label="开始时间"><el-date-picker v-model="modal.form.effectiveFrom" type="datetime" style="width:100%;" /></el-form-item>
      <el-form-item label="结束时间"><el-date-picker v-model="modal.form.effectiveTo" type="datetime" style="width:100%;" /></el-form-item>
      <el-form-item label="启用"><el-switch v-model="modal.form.enabled" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="modal.visible=false">取消</el-button>
      <el-button type="primary" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';

const props = defineProps({ types: { type: Array, default: () => [] } });

const apps = reactive([]);
const envs = reactive([]);
const types = reactive([]);
const versions = reactive([]);
const filters = reactive({ appId: null, envId: null, typeId: null, status: '' });
const modal = reactive({
  visible: false,
  editId: null,
  form: { typeId: null, versionNo: '', description: '', effectiveFrom: '', effectiveTo: '', enabled: true }
});

const tagType = (s) => (s === 'RELEASED' ? 'success' : s === 'PENDING_RELEASE' ? 'warning' : s === 'ARCHIVED' ? 'info' : '');

async function loadRefs() {
  apps.splice(0, apps.length, ...(await api.listApps()));
  envs.splice(0, envs.length, ...(await api.listEnvs()));
  types.splice(0, types.length, ...(await api.listTypes()));
}

async function loadVersions() {
  const params = {};
  if (filters.appId) params.appId = filters.appId;
  if (filters.envId) params.envId = filters.envId;
  if (filters.typeId) params.typeId = filters.typeId;
  if (filters.status) params.status = filters.status;
  const list = await api.listVersionsAll(params);
  versions.splice(0, versions.length, ...list);
}

function openModal(row) {
  if (row) {
    modal.editId = row.id;
    modal.form = {
      typeId: row.type_id,
      versionNo: row.version_no,
      description: row.description || '',
      effectiveFrom: row.effective_from || '',
      effectiveTo: row.effective_to || '',
      enabled: !!row.enabled
    };
  } else {
    modal.editId = null;
    modal.form = { typeId: filters.typeId || null, versionNo: '', description: '', effectiveFrom: '', effectiveTo: '', enabled: true };
  }
  modal.visible = true;
}

async function save() {
  if (!modal.form.typeId || !modal.form.versionNo) return ElMessage.warning('请填写类型与版本号');
  if (modal.editId) {
    await api.updateVersion(modal.editId, {
      versionNo: modal.form.versionNo,
      description: modal.form.description,
      effectiveFrom: modal.form.effectiveFrom,
      effectiveTo: modal.form.effectiveTo,
      enabled: modal.form.enabled
    });
  } else {
    await api.createVersionGlobal({
      typeId: modal.form.typeId,
      versionNo: modal.form.versionNo,
      description: modal.form.description,
      enabled: modal.form.enabled
    });
  }
  modal.visible = false;
  await loadVersions();
}

async function publish(row) {
  await api.publishVersion(row.id);
  ElMessage.success('已发布');
  await loadVersions();
}

async function remove(row) {
  await ElMessageBox.confirm('确认删除该版本？', '提示');
  await api.deleteVersion(row.id);
  await loadVersions();
}

onMounted(async () => {
  await loadRefs();
  await loadVersions();
});
</script>

<style scoped>
.toolbar { display:flex; align-items: center; gap:10px; flex-wrap: wrap; }
</style>
