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
        <el-switch v-model="showEnabledOnly" active-text="只看启用" inactive-text="全部" />
      </div>
      <div v-if="meta" class="meta">
        <el-tag>版本ID: {{ meta.id }}</el-tag>
        <el-tag>版本号: {{ meta.version_no }}</el-tag>
        <el-tag>类型ID: {{ meta.type_id }}</el-tag>
        <el-tag>应用ID: {{ meta.app_id }}</el-tag>
        <el-tag>生效: {{ meta.effective_from || '—' }} ~ {{ meta.effective_to || '—' }}</el-tag>
      </div>
    </template>
    <el-table :data="displayedRows" border @selection-change="onSelectionChange">
      <el-table-column type="selection" width="50" />
      <el-table-column prop="id" label="数据ID" width="90" />
      <el-table-column prop="key_value" label="Key" width="200" />
      <el-table-column prop="status" label="启用" width="100">
        <template #default="scope">
          <el-switch
            :model-value="scope.row.status"
            active-value="ENABLED"
            inactive-value="DISABLED"
            disabled
          />
        </template>
      </el-table-column>
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
      <el-table-column label="操作" width="200">
        <template #default="scope">
          <el-button link type="info" @click="openPreview(scope.row)">预览</el-button>
          <el-button link type="primary" @click="openModal(scope.row)">编辑</el-button>
          <el-button link type="danger" @click="remove(scope.row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="modal.visible" title="配置项" width="820px">
    <el-form :model="modal.form" label-width="120px">
      <el-form-item label="Key"><el-input v-model="modal.form.keyValue" :disabled="!!modal.editId" /></el-form-item>
    </el-form>
    <div class="env-form-grid">
      <el-card v-for="ef in modal.envForms" :key="ef.envId" shadow="hover" class="env-card">
        <div class="env-card__header">
          <div class="env-card__title">{{ ef.envName }} ({{ ef.envCode }})</div>
          <div class="env-card__meta">
            <el-tag size="small" type="info">版本ID: {{ ef.versionId || '—' }}</el-tag>
            <el-tag size="small" :type="ef.versionStatus === 'ARCHIVED' ? 'info' : 'success'">
              {{ statusLabel(ef.versionStatus) || '未发布' }}
            </el-tag>
          </div>
        </div>
        <el-form label-width="110px" class="env-card__form">
          <el-form-item label="启用">
            <el-switch v-model="ef.status" active-value="ENABLED" inactive-value="DISABLED" :disabled="ef.disabled" />
          </el-form-item>
          <template v-for="f in fields" :key="f.field_code">
            <el-form-item :label="f.field_name">
              <component
                :is="componentOf(f)"
                v-model="ef.data[f.field_code]"
                v-bind="componentProps(f)"
                :disabled="ef.disabled"
              >
                <el-option v-for="opt in parseEnum(f.enum_options)" :key="opt" :label="opt" :value="opt" />
              </component>
            </el-form-item>
          </template>
          <div v-if="ef.disabled" class="env-card__disabled">该环境无可编辑版本或已归档</div>
        </el-form>
      </el-card>
    </div>
    <template #footer>
      <el-button @click="modal.visible=false">取消</el-button>
      <el-button type="primary" @click="save">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="preview.visible" title="数据预览" width="620px">
    <div class="preview">
      <div class="preview-header">
        <div class="preview-key">{{ preview.row?.key_value || '—' }}</div>
        <el-tag :type="preview.row?.status === 'ENABLED' ? 'success' : 'info'">
          {{ preview.row?.status === 'ENABLED' ? '启用' : '停用' }}
        </el-tag>
      </div>
      <el-descriptions :column="1" border v-if="preview.row">
        <el-descriptions-item label="数据ID">{{ preview.row.id }}</el-descriptions-item>
        <el-descriptions-item v-for="f in fields" :key="f.field_code" :label="f.field_name">
          {{ formatValue(preview.row.parsed?.[f.field_code]) }}
        </el-descriptions-item>
      </el-descriptions>
    </div>
    <template #footer>
      <el-button @click="preview.visible=false">关闭</el-button>
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
const showEnabledOnly = ref(true);
const displayedRows = computed(() =>
  showEnabledOnly.value ? rows.value.filter((r) => r.status === 'ENABLED') : rows.value
);
const modal = reactive({ visible: false, editId: null, form: { keyValue: '' }, envForms: [] });
const preview = reactive({
  visible: false,
  row: null
});
const importInput = ref(null);
const selected = ref([]);

const envOptions = computed(() => envs.value.filter((e) => !state.appId || e.app_id === state.appId));
const typeOptions = computed(() => props.types.filter((t) => !state.appId || t.app_id === state.appId));
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
const versionLabel = (v) => statusLabelMap[v?.status] || v?.status || '—';
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

async function openPreview(row) {
  preview.row = row;
  preview.visible = true;
}

async function openModal(row) {
  if (!state.versionId) return ElMessage.warning('请选择版本');
  if (!state.envId || !state.typeId) return ElMessage.warning('请选择环境和配置类型');
  // 归档版本禁止新增，但允许读取已存在记录
  if (!row && isArchivedVersion.value) return ElMessage.warning('归档版本不可新增配置');
  modal.editId = row?.id || null;
  modal.form = { keyValue: row?.key_value || '' };
  await buildEnvForms(row);
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
  const keyValue = (modal.form.keyValue || '').trim();
  if (!keyValue) return ElMessage.error('Key不能为空');
  const duplicate = rows.value.some((r) => r.key_value === keyValue && r.id !== modal.editId);
  if (duplicate) return ElMessage.error('当前环境下已存在相同Key');
  modal.form.keyValue = keyValue;
  const tasks = [];
  for (const ef of modal.envForms) {
    if (!ef.versionId || ef.disabled) continue;
    tasks.push(api.upsertData(ef.versionId, { typeId: state.typeId, keyValue, status: ef.status, dataJson: ef.data }));
  }
  await Promise.all(tasks);
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
  const list = await api.listFieldsAll(params);
  fields.value = [...list].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id);
}

async function buildEnvForms(row) {
  const key = row?.key_value || '';
  const baseDefault = defaultData();
  const envForms = [];
  for (const env of envOptions.value) {
    const version = resolveVersionForEnv(env.id);
    const disabled = !version || version.status === 'ARCHIVED';
    let data = { ...baseDefault };
    let status = 'ENABLED';
    if (version) {
      if (env.id === state.envId && row) {
        data = { ...baseDefault, ...(row.parsed || {}) };
        status = row.status;
      } else if (key) {
        const list = await api.listData(version.id, state.typeId);
        const match = list.find((item) => item.key_value === key);
        if (match) {
          data = { ...baseDefault, ...(safeParse(match.data_json) || {}) };
          status = match.status || 'ENABLED';
        }
      }
    }
    envForms.push({
      envId: env.id,
      envName: env.env_name,
      envCode: env.env_code,
      versionId: version?.id || null,
      versionStatus: version?.status || null,
      status,
      data,
      defaultData: { ...baseDefault },
      originalData: { ...data },
      originalStatus: status,
      hasRecord: !!row || (!!key && data && JSON.stringify(data) !== JSON.stringify(baseDefault)),
      disabled
    });
  }
  modal.envForms = envForms;
}

function resolveVersionForEnv(envId) {
  if (envId === state.envId) return selectedVersion.value;
  const candidates = props.versions
    .filter((v) => v.type_id === state.typeId && v.app_id === state.appId && v.env_id === envId)
    .filter((v) => ['RELEASED', 'ARCHIVED'].includes(v.status))
    .sort((a, b) => b.id - a.id);
  return candidates[0] || null;
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
  const importedRows = csvToRows(text).map((r) => ({
    ...r,
    key_value: (r.key_value || r.key || '').trim(),
    status: r.status || 'ENABLED'
  })).filter((r) => r.key_value);
  if (!importedRows.length) return ElMessage.warning('导入文件无有效数据');
  // ensure only current-field columns sent
  const fieldCodes = new Set(fields.value.map((f) => f.field_code));
  const trimmed = importedRows.map((r) => {
    const data = {};
    fieldCodes.forEach((fc) => { if (r[fc] !== undefined) data[fc] = r[fc]; });
    return { key_value: r.key_value, status: r.status, ...data };
  });
  const existingKeys = new Set(rows.value.map((r) => r.key_value));
  const seenInFile = new Set();
  const duplicateKeys = new Set();
  trimmed.forEach((r) => {
    const key = r.key_value;
    if (seenInFile.has(key)) duplicateKeys.add(key);
    seenInFile.add(key);
  });
  const conflicts = [...seenInFile].filter((k) => existingKeys.has(k));
  if (duplicateKeys.size || conflicts.length) {
    const messages = [];
    if (duplicateKeys.size) messages.push(`文件内存在重复Key: ${[...duplicateKeys].join(', ')}`);
    if (conflicts.length) messages.push(`与当前环境已存在的Key冲突: ${conflicts.join(', ')}`);
    return ElMessage.error(messages.join('；'));
  }
  await api.importData(state.versionId, trimmed, state.typeId);
  ElMessage.success(`已导入${trimmed.length}条`);
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
.preview { display:flex; flex-direction:column; gap:12px; }
.preview-header { display:flex; align-items:center; gap:10px; }
.preview-key { font-size:18px; font-weight:600; color:#111827; }
.env-form-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:12px; margin-top:8px; }
.env-card__header { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }
.env-card__title { font-weight:600; color:#111827; }
.env-card__meta { display:flex; gap:6px; align-items:center; }
.env-card__form { padding-top:4px; }
.env-card__disabled { color:#9ca3af; font-size:12px; margin-top:4px; }
</style>
