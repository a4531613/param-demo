<template>
  <el-card>
    <template #header>
      <div class="toolbar">
        <el-select v-model="state.appId" placeholder="应用" style="width:200px;">
          <el-option v-for="a in apps" :key="a.id" :label="`${a.app_name} (${a.app_code})`" :value="a.id" />
        </el-select>
        <el-select v-model="state.versionId" placeholder="选择版本" style="width:220px;" @change="load">
          <el-option v-for="v in versionOptions" :key="v.id" :label="`${v.version_no} (${statusLabel(v.status)})`" :value="v.id" />
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
        <el-button type="primary" @click="openModal()" :disabled="isArchivedVersion || !state.envId || !state.typeId">新增配置</el-button>
        <el-button type="danger" @click="batchRemove" :disabled="!selected.length || isArchivedVersion">批量删除</el-button>
        <el-button @click="downloadTemplate" :disabled="!state.versionId">下载模板</el-button>
        <el-button @click="downloadData" :disabled="!state.versionId">导出</el-button>
        <input type="file" ref="importInput" style="display:none;" accept=".csv,text/csv" @change="handleImport" />
        <el-button @click="triggerImport" :disabled="isArchivedVersion || !state.versionId">导入</el-button>
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
    <el-table :data="rows" border @selection-change="onSelectionChange">
      <el-table-column type="selection" width="50" />
      <el-table-column prop="id" label="数据ID" width="90" />
      <el-table-column prop="key_value" label="Key" width="200" />
      <el-table-column prop="status" label="状态" width="100" />
      <el-table-column prop="create_user" label="创建人" width="120" />
      <el-table-column prop="create_time" label="创建时间" width="180" />
      <el-table-column prop="update_user" label="更新人" width="120" />
      <el-table-column prop="update_time" label="更新时间" width="180" />
      <el-table-column
        v-for="f in fields"
        :key="f.field_code"
        :label="f.field_name"
        :min-width="120"
      >
        <template #default="scope">
          <el-tag type="info">{{ formatValue(scope.row.parsed?.[f.field_code]) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="内容" min-width="160">
        <template #default="scope">
          <el-tag type="info">{{ short(JSON.stringify(scope.row.parsed || {})) }}</el-tag>
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
const importInput = ref(null);
const selected = ref([]);

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
      (!state.envId || v.env_id === state.envId || v.env_id == null) &&
      ['RELEASED', 'ARCHIVED'].includes(v.status)
  )
);
const selectedVersion = computed(() => versionOptions.value.find((v) => v.id === state.versionId) || null);
const isArchivedVersion = computed(() => selectedVersion.value?.status === 'ARCHIVED');
const statusLabelMap = { PENDING_RELEASE: '待发布', RELEASED: '已发布', ARCHIVED: '已归档' };
const statusLabel = (s) => statusLabelMap[s] || s;
const safeParse = (text) => {
  try { return JSON.parse(text); } catch (e) { return {}; }
};
const formatValue = (v) => {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

async function load() {
  if (!state.versionId || !state.typeId) return;
  meta.value = versionOptions.value.find((v) => v.id === state.versionId) || null;
  await loadFieldsForSelection();
  const list = await api.listData(state.versionId, state.typeId);
  rows.value = list.map((item) => ({
    ...item,
    parsed: safeParse(item.data_json)
  }));
}

function onEnvSelect(id) {
  state.envId = id;
  load();
}
function onTypeSelect(id) {
  state.typeId = id;
  load();
}

function openModal(row) {
  if (!state.versionId) return ElMessage.warning('请选择版本');
  if (!state.envId || !state.typeId) return ElMessage.warning('请选择环境和配置类型');
  // 归档版本禁止新增，但允许读取已存在记录
  if (!row && isArchivedVersion.value) return ElMessage.warning('归档版本不可新增配置');
  if (row) {
    modal.editId = row.id;
    modal.form = {
      keyValue: row.key_value,
      status: row.status,
      data: { ...defaultData(), ...(row.parsed || {}) }
    };
  } else {
    modal.editId = null;
    modal.form = { keyValue: '', status: 'ENABLED', data: defaultData() };
  }
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
  if (!state.versionId || !state.typeId) return;
  await api.upsertData(state.versionId, { typeId: state.typeId, keyValue: modal.form.keyValue, status: modal.form.status, dataJson: modal.form.data });
  modal.visible = false;
  await load();
}

async function remove(row) {
  await ElMessageBox.confirm('确认删除该记录？', '提示');
  await api.deleteData(row.id);
  await load();
}

async function batchRemove() {
  if (!selected.value.length) return;
  await ElMessageBox.confirm(`确认删除选中的 ${selected.value.length} 条记录？`, '提示');
  for (const row of selected.value) {
    await api.deleteData(row.id);
  }
  selected.value = [];
  await load();
}

function onSelectionChange(list) {
  selected.value = list || [];
}

async function loadFieldsForSelection() {
  const params = {};
  if (state.appId) params.appId = state.appId;
  if (state.envId) params.envId = state.envId;
  if (state.typeId) params.typeId = state.typeId;
  fields.value = await api.listFieldsAll(params);
}

function csvToRows(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = cols[idx]; });
    return obj;
  });
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { result.push(current); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

async function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function downloadTemplate() {
  if (!state.versionId || !state.typeId) return;
  const text = await api.exportTemplate(state.versionId, state.typeId);
  await downloadText(`version_${state.versionId}_template.csv`, text);
}

async function downloadData() {
  if (!state.versionId || !state.typeId) return;
  const text = await api.exportData(state.versionId, state.typeId);
  await downloadText(`version_${state.versionId}_data.csv`, text);
}

function triggerImport() {
  if (!state.versionId || isArchivedVersion.value) return;
  importInput.value && importInput.value.click();
}

async function handleImport(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const text = await file.text();
  const rows = csvToRows(text).map((r) => ({
    ...r,
    key_value: r.key_value || r.key,
    status: r.status || 'ENABLED'
  })).filter((r) => r.key_value);
  if (!rows.length) return ElMessage.warning('导入文件无有效数据');
  // ensure only current-field columns sent
  const fieldCodes = new Set(fields.value.map((f) => f.field_code));
  const trimmed = rows.map((r) => {
    const data = {};
    fieldCodes.forEach((fc) => { if (r[fc] !== undefined) data[fc] = r[fc]; });
    return { key_value: r.key_value, status: r.status, ...data };
  });
  await api.importData(state.versionId, trimmed, state.typeId);
  ElMessage.success(`已导入 ${trimmed.length} 条`);
  await load();
}

function ensureDefaults() {
  if (!state.appId && apps.value.length) state.appId = apps.value[0].id;
  if (!envOptions.value.find((e) => e.id === state.envId)) {
    state.envId = envOptions.value[0]?.id || null;
  }
  if (!typeOptions.value.find((t) => t.id === state.typeId) && typeOptions.value.length) {
    state.typeId = typeOptions.value[0].id;
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
    load();
  }
);

watch(
  () => state.typeId,
  () => {
    ensureDefaults();
    load();
  }
);

watch(
  () => versionOptions.value,
  () => {
    if (!versionOptions.value.find((v) => v.id === state.versionId)) {
      state.versionId = versionOptions.value[0]?.id || null;
      load();
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
