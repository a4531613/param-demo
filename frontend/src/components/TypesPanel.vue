<template>
  <el-card>
    <template #header>
      <div class="toolbar">
        <div class="filters">
          <el-input v-model="filters.keyword" placeholder="筛code / 名称过滤" style="width:200px;" clearable />
          <el-select v-model="filters.appId" placeholder="应用" style="width:160px;">
            <el-option v-for="a in apps" :key="a.id" :label="`${a.app_name} (${a.app_code})`" :value="a.id" />
          </el-select>
        </div>
        <el-button type="primary" @click="openModal()">新增类型</el-button>
      </div>
    </template>
    <el-table :data="filtered" border style="width:100%;">
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="type_code" label="TypeCode" width="160" />
      <el-table-column prop="type_name" label="名称" />
      <el-table-column prop="app_name" label="应用" />
      <el-table-column prop="description" label="描述" />
      <el-table-column prop="create_user" label="创建人" width="120" />
      <el-table-column prop="create_time" label="创建时间" width="180" />
      <el-table-column prop="update_user" label="更新人" width="120" />
      <el-table-column prop="update_time" label="更新时间" width="180" />
      <el-table-column prop="enabled" label="启用" width="90">
        <template #default="s"><el-tag :type="s.row.enabled ? 'success' : 'info'">{{ s.row.enabled ? '是' : '否' }}</el-tag></template>
      </el-table-column>
      <el-table-column width="180" label="操作">
        <template #default="scope">
          <el-button link type="primary" @click="openModal(scope.row)">编辑</el-button>
          <el-button link type="danger" @click="remove(scope.row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="modal.visible" :title="modal.editId ? '编辑类型' : '新增类型'" width="480px">
    <el-form :model="modal.form" label-width="110px">
      <el-form-item label="Type Code"><el-input v-model="modal.form.typeCode" disabled placeholder="自动生成" /></el-form-item>
      <el-form-item label="Type 名称"><el-input v-model="modal.form.typeName" /></el-form-item>
      <el-form-item label="应用">
        <el-select v-model="modal.form.appId" placeholder="请选择应用">
          <el-option v-for="a in apps" :key="a.id" :label="`${a.app_name} (${a.app_code})`" :value="a.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="启用"><el-switch v-model="modal.form.enabled" /></el-form-item>
      <el-form-item label="描述"><el-input v-model="modal.form.description" type="textarea" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="modal.visible = false">取消</el-button>
      <el-button type="primary" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive } from 'vue';
import { ElMessageBox, ElMessage } from 'element-plus';
import { api } from '../api';

const props = defineProps({ types: { type: Array, default: () => [] } });
const apps = reactive([]);
const emits = defineEmits(['refreshTypes']);

const filters = reactive({ keyword: '', appId: null });
const modal = reactive({
  visible: false,
  editId: null,
  form: { typeCode: '', typeName: '', appId: null, enabled: true, description: '' }
});

const filtered = computed(() => {
  return props.types.filter((t) => {
    const kw = filters.keyword.toLowerCase();
    const okKw = !kw || t.type_code.toLowerCase().includes(kw) || (t.type_name || '').toLowerCase().includes(kw);
    const okApp = !filters.appId || t.app_id === filters.appId;
    return okKw && okApp;
  });
});

function ensureDefaults() {
  if (!filters.appId && apps.length) filters.appId = apps[0].id;
  if (!modal.form.appId && apps.length) modal.form.appId = apps[0].id;
}

async function fillNextTypeCode() {
  try {
    const res = await api.nextTypeCode();
    modal.form.typeCode = res.next;
  } catch (err) {
    modal.form.typeCode = '';
  }
}

async function openModal(row) {
  if (row) {
    modal.editId = row.id;
    modal.form = {
      typeCode: row.type_code,
      typeName: row.type_name,
      appId: row.app_id,
      enabled: !!row.enabled,
      description: row.description || ''
    };
  } else {
    modal.editId = null;
    modal.form = { typeCode: '', typeName: '', appId: filters.appId || (apps[0] && apps[0].id) || null, enabled: true, description: '' };
    await fillNextTypeCode();
  }
  ensureDefaults();
  modal.visible = true;
}

async function save() {
  if (!modal.form.typeName || !modal.form.appId) {
    ElMessage.warning('请填写名称并选择应用');
    return;
  }
  const payload = { typeName: modal.form.typeName, description: modal.form.description, enabled: modal.form.enabled, appId: modal.form.appId };
  if (modal.editId) {
    await api.updateType(modal.editId, payload);
  } else {
    await api.createType(payload);
  }
  modal.visible = false;
  emits('refreshTypes');
}

async function remove(row) {
  await ElMessageBox.confirm('确认删除该类型？', '提示');
  await api.deleteType(row.id);
  emits('refreshTypes');
}

async function loadRefs() {
  apps.splice(0, apps.length, ...(await api.listApps()));
  ensureDefaults();
}

loadRefs();
</script>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.filters {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
