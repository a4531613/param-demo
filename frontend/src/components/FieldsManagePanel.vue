<template>
  <el-card>
    <template #header>
      <div class="toolbar">
        <el-select v-model="filters.appId" placeholder="应用" style="width:160px;">
          <el-option v-for="a in apps" :key="a.id" :label="`${a.app_name} (${a.app_code})`" :value="a.id" />
        </el-select>
        <div class="env-tags" v-if="envOptions.length">
          <span class="tag-label">环境</span>
          <el-check-tag
            v-for="e in envOptions"
            :key="e.id"
            :checked="filters.envId === e.id"
            @click="filters.envId = e.id"
          >
            {{ `${e.env_name} (${e.env_code})` }}
          </el-check-tag>
        </div>
        <div class="type-tags" v-if="typeOptions.length">
          <span class="tag-label">配置类型</span>
          <el-check-tag
            v-for="t in typeOptions"
            :key="t.id"
            :checked="filters.typeId === t.id"
            @click="filters.typeId = t.id"
          >
            {{ `${t.type_name} (${t.type_code})` }}
          </el-check-tag>
        </div>
        <el-input v-model="filters.keyword" placeholder="按字段Key/名称过滤" clearable style="width:200px;" />
        <el-button type="primary" @click="openModal()">新增字段</el-button>
      </div>
    </template>
    <el-table :data="rowsFiltered" border style="width:100%;">
      <el-table-column prop="id" label="字段ID" width="90" />
      <el-table-column prop="field_code" label="字段Key" width="140" />
      <el-table-column prop="field_name" label="字段名称" />
      <el-table-column prop="type_id" label="配置类型ID" width="110" />
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
      <el-form-item label="类型"><el-select v-model="modal.form.typeId" filterable>
        <el-option v-for="t in types" :key="t.id" :label="`${t.type_name} (${t.type_code})`" :value="t.id" />
      </el-select></el-form-item>
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
import { computed, onMounted, reactive, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';

const apps = reactive([]);
const envs = reactive([]);
const types = reactive([]);
const rows = reactive([]);
const filters = reactive({ appId: null, envId: null, typeId: null, keyword: '' });
const modal = reactive({
  visible: false,
  editId: null,
  form: { appId: null, envId: null, typeId: null, fieldCode: '', fieldName: '', dataType: 'string', maxLength: null, required: true, validateRule: '', enumOptions: '', enabled: true, description: '' }
});

const envOptions = computed(() => envs.filter((e) => !filters.appId || e.app_id === filters.appId));
const typeOptions = computed(() => types.filter((t) => !filters.appId || t.app_id === filters.appId));
const modalEnvOptions = computed(() => envs.filter((e) => !modal.form.appId || e.app_id === modal.form.appId));
const modalTypeOptions = computed(() => types.filter((t) => !modal.form.appId || t.app_id === modal.form.appId));

const rowsFiltered = computed(() => {
  const kw = filters.keyword.toLowerCase();
  return rows.filter((r) => {
    const okApp = !filters.appId || r.app_id === filters.appId;
    const okEnv = !filters.envId || r.env_id === filters.envId;
    const okType = !filters.typeId || r.type_id === filters.typeId;
    const okKw = !kw || r.field_code.toLowerCase().includes(kw) || (r.field_name || '').toLowerCase().includes(kw);
    return okApp && okEnv && okType && okKw;
  });
});

function ensureDefaults() {
  if (!filters.appId && apps.length) filters.appId = apps[0].id;
  if (!envOptions.value.find((e) => e.id === filters.envId)) {
    filters.envId = envOptions.value[0]?.id || null;
  }
  if (!typeOptions.value.find((t) => t.id === filters.typeId)) {
    filters.typeId = typeOptions.value[0]?.id || null;
  }
}

async function loadRefs() {
  apps.splice(0, apps.length, ...(await api.listApps()));
  envs.splice(0, envs.length, ...(await api.listEnvs()));
  types.splice(0, types.length, ...(await api.listTypes()));
  ensureDefaults();
}

async function loadFields() {
  const params = {};
  if (filters.appId) params.appId = filters.appId;
  if (filters.envId) params.envId = filters.envId;
  if (filters.typeId) params.typeId = filters.typeId;
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
    modal.form = {
      appId: filters.appId || (apps[0] && apps[0].id) || null,
      envId: filters.envId || null,
      typeId: filters.typeId || null,
      fieldCode: '',
      fieldName: '',
      dataType: 'string',
      maxLength: null,
      required: true,
      validateRule: '',
      enumOptions: '',
      enabled: true,
      description: ''
    };
  }
  ensureModalDefaults();
  modal.visible = true;
}

async function save() {
  if (!modal.form.typeId || !modal.form.fieldCode || !modal.form.fieldName) {
    return ElMessage.warning('请填写必填项（类型/字段标识/名称）');
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

watch(
  () => filters.appId,
  async () => {
    ensureDefaults();
    await loadFields();
  }
);

watch(
  () => filters.envId,
  async () => {
    await loadFields();
  }
);

watch(
  () => filters.typeId,
  async () => {
    await loadFields();
  }
);

function ensureModalDefaults() {
  if (!modal.form.appId && apps.length) modal.form.appId = apps[0].id;
  if (!modalEnvOptions.value.find((e) => e.id === modal.form.envId)) {
    modal.form.envId = modalEnvOptions.value[0]?.id || null;
  }
  if (!modalTypeOptions.value.find((t) => t.id === modal.form.typeId)) {
    modal.form.typeId = modalTypeOptions.value[0]?.id || null;
  }
}
</script>

<style scoped>
.toolbar { display:flex; align-items:center; gap:10px; flex-wrap: wrap; }
.env-tags, .type-tags { display:flex; align-items:center; gap:6px; }
.tag-label { color:#6b7280; font-size:12px; }
</style>
