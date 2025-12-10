<template>
  <el-card>
    <template #header>
      <div class="toolbar">
        <el-select v-model="filters.appId" placeholder="应用" clearable style="width:160px;">
          <el-option v-for="a in apps" :key="a.id" :label="`${a.app_name} (${a.app_code})`" :value="a.id" />
        </el-select>
        <el-select v-model="filters.envId" placeholder="环境" clearable style="width:160px;">
          <el-option v-for="e in envs" :key="e.id" :label="`${e.env_name} (${e.env_code})`" :value="e.id" />
        </el-select>
        <el-input v-model="filters.keyword" placeholder="按字段Key/名称过滤" clearable style="width:200px;" />
        <el-button type="primary" @click="openModal()">新增字段</el-button>
      </div>
    </template>
    <el-table :data="rowsFiltered" border style="width:100%;">
      <el-table-column prop="id" label="字段ID" width="90" />
      <el-table-column prop="field_code" label="字段Key" width="140" />
      <el-table-column prop="field_name" label="字段名称" />
      <el-table-column prop="data_type" label="类型" width="120" />
      <el-table-column prop="max_length" label="长度" width="80" />
      <el-table-column prop="required" label="必填" width="70">
        <template #default="s"><el-tag :type="s.row.required ? 'danger' : 'info'">{{ s.row.required ? '是' : '否' }}</el-tag></template>
      </el-table-column>
      <el-table-column prop="validate_rule" label="正则约束" />
      <el-table-column prop="app_id" label="应用ID" width="90" />
      <el-table-column prop="env_id" label="环境ID" width="90" />
      <el-table-column prop="type_id" label="类型ID" width="90" />
      <el-table-column prop="enabled" label="启用" width="80">
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

  <el-dialog v-model="modal.visible" :title="modal.editId ? '编辑字段' : '新增字段'" width="540px">
    <el-form :model="modal.form" label-width="130px">
      <el-form-item label="所属应用">
        <el-select v-model="modal.form.appId">
          <el-option v-for="a in apps" :key="a.id" :label="`${a.app_name} (${a.app_code})`" :value="a.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="所属环境">
        <el-select v-model="modal.form.envId">
          <el-option v-for="e in envs" :key="e.id" :label="`${e.env_name} (${e.env_code})`" :value="e.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="类型ID"><el-input-number v-model="modal.form.typeId" :min="1" /></el-form-item>
      <el-form-item label="版本ID"><el-input-number v-model="modal.form.versionId" :min="1" /></el-form-item>
      <el-form-item label="字段Key"><el-input v-model="modal.form.fieldCode" :disabled="!!modal.editId" /></el-form-item>
      <el-form-item label="字段名称"><el-input v-model="modal.form.fieldName" /></el-form-item>
      <el-form-item label="字段类型">
        <el-select v-model="modal.form.dataType">
          <el-option label="string" value="string" /><el-option label="number" value="number" />
          <el-option label="boolean" value="boolean" /><el-option label="date" value="date" />
          <el-option label="datetime" value="datetime" /><el-option label="enum" value="enum" />
          <el-option label="json" value="json" />
        </el-select>
      </el-form-item>
      <el-form-item label="长度"><el-input-number v-model="modal.form.maxLength" :min="0" /></el-form-item>
      <el-form-item label="必填"><el-switch v-model="modal.form.required" /></el-form-item>
      <el-form-item label="正则约束"><el-input v-model="modal.form.validateRule" /></el-form-item>
      <el-form-item label="枚举值(JSON)">
        <el-input v-model="modal.form.enumOptions" type="textarea" placeholder='["A","B"]' />
      </el-form-item>
      <el-form-item label="启用"><el-switch v-model="modal.form.enabled" /></el-form-item>
      <el-form-item label="描述"><el-input v-model="modal.form.description" type="textarea" /></el-form-item>
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
const envs = reactive([]);
const rows = reactive([]);
const filters = reactive({ appId: null, envId: null, keyword: '' });
const modal = reactive({
  visible: false,
  editId: null,
  form: { appId: null, envId: null, typeId: null, versionId: null, fieldCode: '', fieldName: '', dataType: 'string', maxLength: null, required: true, validateRule: '', enumOptions: '', enabled: true, description: '' }
});

const rowsFiltered = computed(() => {
  const kw = filters.keyword.toLowerCase();
  return rows.filter((r) => {
    const okApp = !filters.appId || r.app_id === filters.appId;
    const okEnv = !filters.envId || r.env_id === filters.envId;
    const okKw = !kw || r.field_code.toLowerCase().includes(kw) || (r.field_name || '').toLowerCase().includes(kw);
    return okApp && okEnv && okKw;
  });
});

async function loadRefs() {
  apps.splice(0, apps.length, ...(await api.listApps()));
  envs.splice(0, envs.length, ...(await api.listEnvs()));
}

async function loadFields() {
  const params = {};
  if (filters.appId) params.appId = filters.appId;
  if (filters.envId) params.envId = filters.envId;
  const list = await api.listFieldsAll(params);
  rows.splice(0, rows.length, ...list);
}

function openModal(row) {
  if (row) {
    modal.editId = row.id;
    modal.form = {
      appId: row.app_id,
      envId: row.env_id,
      typeId: row.type_id,
      versionId: row.version_id,
      fieldCode: row.field_code,
      fieldName: row.field_name,
      dataType: row.data_type,
      maxLength: row.max_length,
      required: !!row.required,
      validateRule: row.validate_rule || '',
      enumOptions: row.enum_options || '',
      enabled: !!row.enabled,
      description: row.description || ''
    };
  } else {
    modal.editId = null;
    modal.form = { appId: filters.appId || null, envId: filters.envId || null, typeId: null, versionId: null, fieldCode: '', fieldName: '', dataType: 'string', maxLength: null, required: true, validateRule: '', enumOptions: '', enabled: true, description: '' };
  }
  modal.visible = true;
}

async function save() {
  if (!modal.form.versionId || !modal.form.typeId || !modal.form.fieldCode || !modal.form.fieldName) {
    return ElMessage.warning('请填写必填项（类型/版本/字段标识/名称）');
  }
  const payload = { ...modal.form };
  if (payload.enumOptions) {
    try { payload.enumOptions = JSON.parse(payload.enumOptions); } catch (e) { return ElMessage.error('枚举值需为 JSON'); }
  }
  if (modal.editId) {
    await api.updateField(modal.editId, payload);
  } else {
    await api.createFieldGlobal(payload);
  }
  modal.visible = false;
  await loadFields();
}

async function remove(row) {
  await ElMessageBox.confirm('确认删除该字段？', '提示');
  await api.deleteField(row.id);
  await loadFields();
}

onMounted(async () => {
  await loadRefs();
  await loadFields();
});
</script>

<style scoped>
.toolbar { display:flex; align-items:center; gap:10px; }
</style>
