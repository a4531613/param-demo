<template>
  <el-card>
    <template #header>
      <div class="toolbar">
        <el-select v-model="state.appId" placeholder="应用" style="width:200px;">
          <el-option v-for="a in apps" :key="a.id" :label="`${a.app_name} (${a.app_code})`" :value="a.id" />
        </el-select>
        <div class="tag-group" v-if="envOptions.length">
          <span class="tag-label">环境</span>
          <el-check-tag v-for="e in envOptions" :key="e.id" :checked="state.envId === e.id" @click="onEnvSelect(e.id)">
            {{ `${e.env_name} (${e.env_code})` }}
          </el-check-tag>
        </div>
        <div class="tag-group" v-if="typeOptions.length">
          <span class="tag-label">配置类型</span>
          <el-check-tag v-for="t in typeOptions" :key="t.id" :checked="state.typeId === t.id" @click="onTypeSelect(t.id)">
            {{ `${t.type_name} (${t.type_code})` }}
          </el-check-tag>
        </div>
        <el-select v-model="state.versionId" placeholder="选择版本" style="width:220px;" @change="load">
          <el-option v-for="v in versionOptions" :key="v.id" :label="`${v.version_no} (${statusLabel(v.status)})`" :value="v.id" />
        </el-select>
        <el-button type="primary" @click="openModal()">新增配置</el-button>
      </div>
      <div v-if="meta" class="meta">
        <el-tag>版本ID: {{ meta.id }}</el-tag>
        <el-tag>版本号: {{ meta.version_no }}</el-tag>
        <el-tag>类型ID: {{ meta.type_id }}</el-tag>
        <el-tag>应用ID: {{ meta.app_id }}</el-tag>
        <el-tag>环境ID: {{ meta.env_id }}</el-tag>
        <el-tag>生效: {{ meta.effective_from || '—' }} ~ {{ meta.effective_to || '—' }}</el-tag>
      </div>
    </template>
    <el-table :data="rows" border>
      <el-table-column prop="id" label="数据ID" width="90" />
      <el-table-column prop="key_value" label="Key" width="200" />
      <el-table-column prop="status" label="状态" width="100" />
      <el-table-column prop="create_user" label="创建人" width="120" />
      <el-table-column prop="create_time" label="创建时间" width="180" />
      <el-table-column prop="update_user" label="更新人" width="120" />
      <el-table-column prop="update_time" label="更新时间" width="180" />
      <el-table-column label="内容">
        <template #default="scope">
          <el-tag type="info">{{ short(scope.row.data_json) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160">
        <template #default="scope">
          <el-button link type="primary" @click="openModal(scope.row)">编辑</el-button>
          <el-button link type="danger" @click="remove(scope.row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="modal.visible" title="配置项" width="580px">
    <el-form :model="modal.form" label-width="130px">
      <el-form-item label="Key"><el-input v-model="modal.form.keyValue" /></el-form-item>
      <el-form-item label="状态">
        <el-select v-model="modal.form.status">
          <el-option label="ENABLED" value="ENABLED" /><el-option label="DISABLED" value="DISABLED" />
        </el-select>
      </el-form-item>
      <template v-for="f in fields" :key="f.field_code">
        <el-form-item :label="f.field_name">
          <component :is="componentOf(f)"
                     v-model="modal.form.data[f.field_code]"
                     v-bind="componentProps(f)">
            <el-option v-for="opt in parseEnum(f.enum_options)" :key="opt" :label="opt" :value="opt" />
          </component>
        </el-form-item>
      </template>
    </el-form>
    <template #footer>
      <el-button @click="modal.visible=false">取消</el-button>
      <el-button type="primary" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';

const props = defineProps({ versions: { type: Array, default: () => [] }, types: { type: Array, default: () => [] } });
const rows = ref([]);
const fields = ref([]);
const meta = ref(null);
const apps = ref([]);
const envs = ref([]);
const state = reactive({ appId: null, envId: null, typeId: null, versionId: null });
const modal = reactive({ visible: false, editId: null, form: { keyValue: '', status: 'ENABLED', data: {} } });

const short = (text) => (text.length > 60 ? text.slice(0, 60) + '...' : text);

const envOptions = computed(() => envs.value.filter((e) => !state.appId || e.app_id === state.appId));
const typeOptions = computed(() =>
  props.types.filter(
    (t) =>
      (!state.appId || t.app_id === state.appId) &&
      (!state.envId || !t.env_id || t.env_id === state.envId)
  )
);
const versionOptions = computed(() =>
  props.versions.filter(
    (v) =>
      (!state.appId || v.app_id === state.appId) &&
      ['RELEASED', 'ARCHIVED'].includes(v.status)
  )
);
const selectedVersion = computed(() => versionOptions.value.find((v) => v.id === state.versionId) || null);
const isArchivedVersion = computed(() => selectedVersion.value?.status === 'ARCHIVED');
const statusLabelMap = { PENDING_RELEASE: '待发布', RELEASED: '已发布', ARCHIVED: '已归档' };
const statusLabel = (s) => statusLabelMap[s] || s;

async function load() {
  if (!state.versionId) return;
  meta.value = versionOptions.value.find((v) => v.id === state.versionId) || null;
  rows.value = await api.listData(state.versionId);
  fields.value = await api.listFields(state.versionId);
}

function onTypeChange() {
  state.versionId = null;
  rows.value = [];
  fields.value = [];
  meta.value = null;
}

function onEnvSelect(id) {
  state.envId = id;
}
function onTypeSelect(id) {
  state.typeId = id;
}

function openModal() {
  if (!state.versionId) return ElMessage.warning('请选择版本');
  if (isArchivedVersion.value) return ElMessage.warning('归档版本不可新增配置');
  modal.editId = null;
  modal.form = { keyValue: '', status: 'ENABLED', data: defaultData() };
  modal.visible = true;
}

function defaultData() {
  const d = {};
  fields.value.forEach((f) => { d[f.field_code] = f.default_value || ''; });
  return d;
}

function componentOf(f) {
  if (f.data_type === 'number') return 'el-input-number';
  if (f.data_type === 'boolean') return 'el-switch';
  if (f.data_type === 'date') return 'el-date-picker';
  if (f.data_type === 'datetime') return 'el-date-picker';
  if (f.data_type === 'enum') return 'el-select';
  return 'el-input';
}

function componentProps(f) {
  if (f.data_type === 'date') return { type: 'date', style: 'width:100%' };
  if (f.data_type === 'datetime') return { type: 'datetime', style: 'width:100%' };
  if (f.data_type === 'enum') return { clearable: true };
  if (f.data_type === 'number') return { controls: true, style: 'width:100%' };
  return {};
}

function parseEnum(text) {
  if (!text) return [];
  try { return JSON.parse(text); } catch (e) { return []; }
}

async function save() {
  if (!state.versionId) return;
  await api.upsertData(state.versionId, { keyValue: modal.form.keyValue, status: modal.form.status, dataJson: modal.form.data });
  modal.visible = false;
  await load();
}

async function remove(row) {
  await ElMessageBox.confirm('确认删除该记录？', '提示');
  await api.deleteData(row.id);
  await load();
}

function ensureDefaults() {
  if (!state.appId && apps.value.length) state.appId = apps.value[0].id;
  if (!envOptions.value.find((e) => e.id === state.envId)) {
    state.envId = envOptions.value[0]?.id || null;
  }
  if (!typeOptions.value.find((t) => t.id === state.typeId)) {
    state.typeId = typeOptions.value[0]?.id || null;
  }
  if (!versionOptions.value.find((v) => v.id === state.versionId)) {
    state.versionId = versionOptions.value[0]?.id || null;
  }
}

async function loadRefs() {
  apps.value = await api.listApps();
  envs.value = await api.listEnvs(state.appId || undefined);
  ensureDefaults();
}

watch(
  () => state.appId,
  async () => {
    envs.value = await api.listEnvs(state.appId || undefined);
    ensureDefaults();
    await load();
  }
);

watch(
  () => state.envId,
  () => {
    ensureDefaults();
    onTypeChange();
  }
);

watch(
  () => state.typeId,
  () => {
    ensureDefaults();
    onTypeChange();
  }
);

watch(
  () => versionOptions.value,
  () => {
    if (!versionOptions.value.find((v) => v.id === state.versionId)) {
      state.versionId = versionOptions.value[0]?.id || null;
    }
  }
);

loadRefs();
</script>

<style scoped>
.toolbar { display:flex; align-items:center; gap:8px; flex-wrap: wrap; }
.meta { margin-top:8px; display:flex; gap:6px; flex-wrap:wrap; }
.tag-group { display:flex; align-items:center; gap:6px; }
.tag-label { color:#6b7280; font-size:12px; }
</style>
