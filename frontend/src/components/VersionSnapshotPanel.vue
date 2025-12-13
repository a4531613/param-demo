<template>
  <el-card>
    <template #header>
      <div class="cc-toolbar">
        <div class="toolbar__filters">
          <div class="filters__row">
            <el-select v-model="state.appId" placeholder="应用" class="cc-control--md" filterable>
              <el-option v-for="a in apps" :key="a.id" :label="`${a.app_name} (${a.app_code || a.id})`" :value="a.id" />
            </el-select>
            <el-select v-model="state.versionId" placeholder="选择版本" class="cc-control--lg" filterable>
              <el-option
                v-for="v in versionOptions"
                :key="v.id"
                :label="`${v.version_no || v.id} (${statusLabel(v.status)})`"
                :value="v.id"
              />
            </el-select>
            <el-switch v-model="showEnabledOnly" active-text="只看启用" inactive-text="全部" />
            <el-button @click="reload" :loading="loading" :disabled="!state.versionId">刷新</el-button>
          </div>

          <div class="filters__row">
            <div class="cc-tag-group" v-if="envOptions.length">
              <span class="cc-tag-label">环境</span>
              <el-check-tag
                v-for="e in envOptions"
                :key="e.id"
                :checked="state.envId === e.id"
                @click="state.envId = e.id"
              >
                {{ e.env_name }}
              </el-check-tag>
            </div>
          </div>
        </div>

        <div class="toolbar__actions">
          <el-tag type="info">总计 {{ stats.total }}</el-tag>
          <el-tag type="success">启用 {{ stats.enabled }}</el-tag>
          <el-tag type="warning">停用 {{ stats.disabled }}</el-tag>
        </div>
      </div>
    </template>

    <el-empty v-if="!state.versionId && !loading" description="请选择版本以查看配置清单。" />
    <el-skeleton v-else-if="loading" :rows="10" animated />
    <el-empty v-else-if="!filteredRows.length" :description="emptyDescription" />

    <div v-else class="snapshot">
      <div class="snapshot-board">
        <div v-for="t in visibleTypeTabs" :key="String(t.id)" class="board-col">
          <div class="board-col__head">
            <div class="board-col__title">
              <div class="board-col__name">{{ t.type_name || t.id }}</div>
              <el-tag size="small" type="info">{{ countsByType.get(t.id) || 0 }}</el-tag>
            </div>
          </div>

          <div class="board-col__list">
            <div
              v-for="r in rowsByType.get(t.id) || []"
              :key="r.id"
              class="board-card"
              role="button"
              tabindex="0"
              @click="openDetail(r)"
              @keyup.enter="openDetail(r)"
            >
              <div class="board-card__top">
                <div class="board-card__key" :title="r.key_value">{{ r.key_value }}</div>
                <el-tag size="small" :type="r.status === 'ENABLED' ? 'success' : 'info'">
                  {{ r.status === 'ENABLED' ? '启用' : '停用' }}
                </el-tag>
              </div>
              <div class="board-card__chips">
                <div v-for="p in previewPairs(r)" :key="p.k" class="chip">
                  <span class="chip__k">{{ p.k }}</span>
                  <span class="chip__v">{{ p.v }}</span>
                </div>
              </div>
              <div class="board-card__meta">
                <span class="board-card__muted">更新时间</span>
                <span>{{ r.update_time || '—' }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <el-drawer v-model="detail.visible" size="520px" :with-header="false">
      <div class="detail">
        <div class="detail__head">
          <div class="detail__title">{{ detail.row?.key_value || '—' }}</div>
          <div class="detail__meta">
            <el-tag :type="detail.row?.status === 'ENABLED' ? 'success' : 'info'">
              {{ detail.row?.status === 'ENABLED' ? '启用' : '停用' }}
            </el-tag>
            <el-tag type="info">{{ envLabel(detail.row?.env_id) }}</el-tag>
            <el-tag type="info">{{ typeLabel(detail.row?.type_id) }}</el-tag>
          </div>
        </div>
        <el-divider />
        <el-form label-width="120px" class="detail__form">
          <template v-for="f in fieldsForDetail" :key="f.id || f.field_code">
            <el-form-item>
              <template #label>
                <el-tooltip :content="f.description || f.field_name" placement="top" :show-after="300">
                  <span class="form-label-ellipsis">{{ f.field_name }}</span>
                </el-tooltip>
              </template>
              <div class="detail__value">
                <pre v-if="isObjectValue(detailData?.[f.field_code])" class="detail__json">{{ pretty(detailData?.[f.field_code]) }}</pre>
                <el-tag v-else type="info">{{ formatValue(detailData?.[f.field_code]) }}</el-tag>
              </div>
            </el-form-item>
          </template>
        </el-form>
      </div>
    </el-drawer>
  </el-card>
</template>

<script setup>
import { computed, inject, onMounted, reactive, ref, watch } from 'vue';
import { api } from '../api';
import { toastError } from '../ui/feedback';

const props = defineProps({
  types: { type: Array, default: () => [] },
  versions: { type: Array, default: () => [] }
});

const workspace = inject('workspace', null);
const apps = ref([]);
const envs = ref([]);

const state = reactive({ appId: null, envId: null, versionId: null });
const loading = ref(false);
const rows = ref([]);
const showEnabledOnly = ref(true);

const statusLabelMap = { PENDING_RELEASE: '待发布', RELEASED: '已发布', ARCHIVED: '已归档' };
const statusLabel = (s) => statusLabelMap[s] || s;

const envOptions = computed(() => envs.value.filter((e) => !state.appId || e.app_id === state.appId));

const versionOptions = computed(() =>
  props.versions.filter((v) => (!state.appId || v.app_id === state.appId) && ['RELEASED', 'ARCHIVED'].includes(v.status))
);

const envLabelById = computed(() => new Map(envs.value.map((e) => [e.id, `${e.env_name}`])));
const typeLabelById = computed(() => new Map(props.types.map((t) => [t.id, `${t.type_name}`])));
const envLabel = (envId) => envLabelById.value.get(envId) || (envId ? `Env ${envId}` : '—');
const typeLabel = (typeId) => typeLabelById.value.get(typeId) || (typeId ? `Type ${typeId}` : '—');

const filteredRows = computed(() => {
  const base = (rows.value || []).filter((r) => {
    if (showEnabledOnly.value && r.status !== 'ENABLED') return false;
    if (state.envId && r.env_id !== state.envId) return false;
    return true;
  });
  return base;
});

const stats = computed(() => {
  const list = filteredRows.value || [];
  return {
    total: list.length,
    enabled: list.filter((r) => r.status === 'ENABLED').length,
    disabled: list.filter((r) => r.status !== 'ENABLED').length
  };
});

const emptyDescription = computed(() => {
  return '该筛选条件下暂无配置。';
});

const rowsByType = computed(() => {
  const m = new Map();
  (filteredRows.value || []).forEach((r) => {
    if (!m.has(r.type_id)) m.set(r.type_id, []);
    m.get(r.type_id).push(r);
  });
  m.forEach((list) => list.sort((a, b) => String(a.key_value || '').localeCompare(String(b.key_value || ''))));
  return m;
});

const countsByType = computed(() => {
  const m = new Map();
  (filteredRows.value || []).forEach((r) => m.set(r.type_id, (m.get(r.type_id) || 0) + 1));
  return m;
});

const visibleTypeTabs = computed(() => {
  const typeIds = [...new Set((filteredRows.value || []).map((r) => r.type_id))];
  const set = new Set(typeIds);
  return props.types.filter((t) => set.has(t.id)).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id);
});

const fieldsCache = reactive(new Map()); // typeId -> fields[]

async function ensureFieldsLoaded(typeId) {
  if (!typeId) return [];
  if (fieldsCache.has(typeId)) return fieldsCache.get(typeId);
  const list = await api.listFieldsAll({ appId: state.appId || undefined, typeId });
  const filtered = (list || []).filter((f) => String(f.field_code || '').toLowerCase() !== 'key');
  const sorted = [...filtered].sort(
    (a, b) => (a.is_common ? 0 : 1) - (b.is_common ? 0 : 1) || (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id
  );
  fieldsCache.set(typeId, sorted);
  return sorted;
}

const detail = reactive({ visible: false, row: null });
const detailData = computed(() => detail.row?.data || {});
const fieldsForDetail = computed(() => fieldsCache.get(detail.row?.type_id) || []);

function isEmptyValue(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

function previewPairs(row) {
  const fs = fieldsCache.get(row?.type_id) || [];
  const data = row?.data || {};
  const picked = [];
  for (const f of fs) {
    if (picked.length >= 3) break;
    const v = data?.[f.field_code];
    if (isEmptyValue(v)) continue;
    picked.push({ k: f.field_name || f.field_code, v: previewValue(v) });
  }
  if (picked.length >= 2) return picked;
  for (const f of fs) {
    if (picked.length >= 3) break;
    const v = data?.[f.field_code];
    if (picked.some((x) => x.k === (f.field_name || f.field_code))) continue;
    picked.push({ k: f.field_name || f.field_code, v: previewValue(v) });
  }
  return picked;
}

function isObjectValue(v) {
  return v && typeof v === 'object';
}
function pretty(v) {
  try {
    return JSON.stringify(v, null, 2);
  } catch (e) {
    return String(v ?? '');
  }
}
function formatValue(v) {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch (e) { return '—'; }
  }
  return String(v);
}

function previewValue(v) {
  const text = formatValue(v);
  const max = 68;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function openDetail(row) {
  if (!row) return;
  detail.row = row;
  detail.visible = true;
  try {
    await ensureFieldsLoaded(row.type_id);
  } catch (e) {
    toastError(e, '加载字段失败');
  }
}

function ensureDefaults() {
  if (!state.appId && workspace?.appId) state.appId = workspace.appId;
  if (!state.versionId && workspace?.versionId) state.versionId = workspace.versionId;
  if (!state.appId && apps.value.length) state.appId = apps.value[0].id;
  if (!envOptions.value.find((e) => e.id === state.envId)) {
    if (workspace?.envId && envOptions.value.find((e) => e.id === workspace.envId)) state.envId = workspace.envId;
    else state.envId = envOptions.value[0]?.id || null;
  }
  if (!versionOptions.value.find((v) => v.id === state.versionId)) state.versionId = versionOptions.value[0]?.id || null;
}

async function reload() {
  if (!state.versionId) return;
  loading.value = true;
  try {
    const list = await api.listVersionDataAll(state.versionId);
    rows.value = (list || []).map((r) => ({ ...r, data: safeParse(r.data_json) }));
    const typeIds = [...new Set(rows.value.map((r) => r.type_id).filter(Boolean))];
    await Promise.all(typeIds.map((tid) => ensureFieldsLoaded(tid)));

  } catch (e) {
    rows.value = [];
    toastError(e, '加载配置清单失败');
  } finally {
    loading.value = false;
  }
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return {};
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
    if (workspace) workspace.appId = state.appId;
    envs.value = await api.listEnvs(state.appId || undefined);
    if (workspace?.envId && envs.value.find((e) => e.id === workspace.envId)) state.envId = workspace.envId;
    if (workspace?.versionId && versionOptions.value.find((v) => v.id === workspace.versionId)) state.versionId = workspace.versionId;
    ensureDefaults();
    await reload();
  }
);

watch(
  () => state.envId,
  () => {
    if (workspace) workspace.envId = state.envId;
  }
);
watch(
  () => state.versionId,
  async () => {
    if (workspace) workspace.versionId = state.versionId;
    await reload();
  }
);

onMounted(async () => {
  await loadRefs();
  await reload();
});
</script>

<style scoped>
.cc-toolbar { align-items:flex-start; }
.toolbar__filters { display:flex; flex-direction:column; align-items:flex-start; gap:8px; flex: 1 1 520px; min-width: 360px; }
.filters__row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; width: 100%; }
.toolbar__actions { display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; align-items:center; }

.snapshot-board {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 6px;
}
.board-col {
  flex: 0 0 340px;
  min-width: 340px;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  padding: 10px;
}
.board-col__head { display:flex; align-items:center; justify-content:space-between; gap: 8px; padding-bottom: 8px; }
.board-col__title { display:flex; align-items:center; gap: 8px; min-width: 0; }
.board-col__name { font-weight: 700; color: #111827; white-space: nowrap; overflow:hidden; text-overflow: ellipsis; max-width: 250px; }
.board-col__list { display:flex; flex-direction:column; gap: 10px; max-height: calc(100vh - 260px); overflow: auto; padding-right: 2px; }

.board-card {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  padding: 10px 12px;
  cursor: pointer;
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
}
.board-card:hover { border-color: #cbd5e1; box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04); }
.board-card:focus { outline: none; border-color: #93c5fd; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15); }
.board-card__top { display:flex; align-items:flex-start; justify-content:space-between; gap: 10px; }
.board-card__key { font-weight: 650; color: #111827; min-width: 0; overflow:hidden; text-overflow: ellipsis; white-space: nowrap; }
.board-card__chips { margin-top: 8px; display:flex; flex-direction:column; gap: 6px; }
.chip { display:flex; align-items: baseline; gap: 8px; }
.chip__k { font-size: 12px; color: #6b7280; flex: 0 0 auto; max-width: 120px; overflow:hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip__v { font-size: 12px; color: #111827; overflow:hidden; text-overflow: ellipsis; white-space: nowrap; }
.board-card__meta { margin-top: 10px; font-size: 12px; color: #111827; display:flex; gap: 8px; }
.board-card__muted { color: #6b7280; }

.detail__head { display:flex; flex-direction: column; gap: 10px; }
.detail__title { font-size: 18px; font-weight: 700; color: #111827; word-break: break-word; }
.detail__meta { display:flex; gap: 6px; flex-wrap: wrap; }
.detail__json { margin: 0; padding: 10px; border: 1px solid #e5e7eb; border-radius: 10px; background: #f8fafc; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.4; }
.detail__value { min-width: 0; }
</style>
