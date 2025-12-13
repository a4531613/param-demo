<template>
  <el-card>
    <template #header>
      <div class="cc-toolbar">
        <div class="toolbar__filters">
          <div class="filters__row">
            <el-select v-model="state.appId" placeholder="应用" class="cc-control--md">
              <el-option v-for="a in apps" :key="a.id" :label="`${a.app_name}`" :value="a.id" />
            </el-select>
            <el-input
              v-model="state.q"
              placeholder="关键字（Key 或 值）"
              clearable
              class="cc-control--lg"
              @keyup.enter="search"
            />
            <el-button type="primary" :loading="loading" :disabled="!state.appId || !state.q" @click="search">搜索</el-button>
            <el-button :disabled="loading" @click="reset">重置</el-button>
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
                {{ `${e.env_name}` }}
              </el-check-tag>
              <el-button link type="info" v-if="state.envId" @click="state.envId=null">清除</el-button>
            </div>
            <div class="cc-tag-group" v-if="groupOptions.length">
              <span class="cc-tag-label">大类</span>
              <el-check-tag
                v-for="g in groupOptions"
                :key="g.id"
                :checked="state.groupId === g.id"
                @click="state.groupId = g.id"
              >
                {{ `${g.group_name}` }}
              </el-check-tag>
              <el-button link type="info" v-if="state.groupId" @click="state.groupId=null">清除</el-button>
            </div>
            <div class="cc-tag-group" v-if="typeOptions.length">
              <span class="cc-tag-label">小类</span>
              <el-check-tag
                v-for="t in typeOptions"
                :key="t.id"
                :checked="state.typeId === t.id"
                @click="state.typeId = t.id"
              >
                {{ `${t.type_name}` }}
              </el-check-tag>
              <el-button link type="info" v-if="state.typeId" @click="state.typeId=null">清除</el-button>
            </div>
          </div>
        </div>
      </div>
      <div class="meta" v-if="summary">
        <el-tag>结果: {{ summary.count }}</el-tag>
        <el-tag type="info">范围: 已发布/已归档</el-tag>
      </div>
    </template>

    <el-empty v-if="!rows.length && !loading" description="请输入关键字并搜索。" />
    <el-skeleton v-else-if="loading" :rows="8" animated />
    <div v-else class="data-form-list">
      <el-card v-for="r in rows" :key="r.id" shadow="hover" class="data-card">
        <template #header>
          <div class="data-card__header">
            <div class="data-card__left">
              <el-button link type="info" @click="toggleExpanded(r)" class="data-card__fold">
                <el-icon><component :is="r.expanded ? CaretBottom : CaretRight" /></el-icon>
                {{ r.expanded ? '收起' : '展开' }}
              </el-button>
              <div class="data-card__key">{{ r.key_value }}</div>
              <el-tag size="small" :type="r.status === 'ENABLED' ? 'success' : 'info'">{{ r.status === 'ENABLED' ? '启用' : '未启用' }}</el-tag>
              <el-tag size="small" :type="r.version_status === 'ARCHIVED' ? 'info' : 'success'">{{ statusLabel(r.version_status) }}</el-tag>
            </div>
            <div class="data-card__actions">
              <el-tag size="small" type="info">{{ r.env_name || '—' }}</el-tag>
              <el-tag size="small" type="info">{{ r.group_name || '—' }}</el-tag>
              <el-tag size="small" type="info">{{ r.type_name || '—' }}</el-tag>
              <el-tag size="small">{{ r.version_no || r.version_id }}</el-tag>
            </div>
          </div>
        </template>
        <el-collapse-transition>
          <div v-show="r.expanded">
            <el-form label-width="110px" class="data-card__form">
              <template v-for="f in fieldsForRow(r)" :key="f.id || f.field_code">
                <el-form-item>
                  <template #label>
                    <el-tooltip :content="f.description || f.field_name" placement="top" :show-after="300">
                      <span class="form-label-ellipsis">{{ f.field_name }}</span>
                    </el-tooltip>
                  </template>
                  <component
                    :is="componentOf(f)"
                    v-model="r.data[f.field_code]"
                    v-bind="componentProps(f)"
                    :disabled="true"
                  >
                    <template v-if="usesSelectOptions(f)">
                      <el-option v-for="opt in parseEnum(f.enum_options)" :key="opt" :label="opt" :value="opt" />
                    </template>
                    <template v-else-if="usesRadioOptions(f)">
                      <el-radio v-for="opt in parseEnum(f.enum_options)" :key="opt" :label="opt">{{ opt }}</el-radio>
                    </template>
                    <template v-else-if="usesCheckboxOptions(f)">
                      <el-checkbox v-for="opt in parseEnum(f.enum_options)" :key="opt" :label="opt">{{ opt }}</el-checkbox>
                    </template>
                  </component>
                </el-form-item>
              </template>
              <div class="row-meta">
                <el-tag type="info">更新时间: {{ r.update_time || '—' }}</el-tag>
              </div>
            </el-form>
          </div>
        </el-collapse-transition>
      </el-card>
      <div class="pager" v-if="total">
        <el-pagination
          background
          layout="total, sizes, prev, pager, next, jumper"
          :total="total"
          :page-size="state.pageSize"
          :current-page="state.page"
          :page-sizes="[10, 20, 50, 100]"
          @update:current-page="onPageChange"
          @update:page-size="onPageSizeChange"
        />
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch, inject } from 'vue';
import { CaretBottom, CaretRight } from '@element-plus/icons-vue';
import { api } from '../api';
import { toastError, toastWarning } from '../ui/feedback';

const props = defineProps({ types: { type: Array, default: () => [] } });
const workspace = inject('workspace', null);

const apps = ref([]);
const envs = ref([]);
const rows = ref([]);
const loading = ref(false);
const summary = ref(null);
const total = ref(0);

const state = reactive({ appId: null, envId: null, groupId: null, typeId: null, q: '', page: 1, pageSize: 10 });

const envOptions = computed(() => envs.value.filter((e) => !state.appId || e.app_id === state.appId));
const groupOptions = computed(() => {
  const list = props.types.filter((t) => !state.appId || t.app_id === state.appId);
  const m = new Map();
  list.forEach((t) => {
    if (!t.group_id) return;
    if (!m.has(t.group_id)) m.set(t.group_id, { id: t.group_id, group_name: t.group_name || '未命名', group_code: t.group_code || t.group_id });
  });
  return [...m.values()];
});
const typeOptions = computed(() =>
  props.types.filter((t) => (!state.appId || t.app_id === state.appId) && (!state.groupId || t.group_id === state.groupId))
);

const statusLabelMap = { PENDING_RELEASE: '待发布', RELEASED: '已发布', ARCHIVED: '已归档' };
const statusLabel = (s) => statusLabelMap[s] || s;

const fieldsCache = reactive(new Map()); // typeId -> fields[]

function isMultiValueField(f) {
  return f.field_type === 'MultiSelect' || f.field_type === 'Checkbox';
}

function normalizeFieldValue(f, value) {
  if (!isMultiValueField(f)) return value;
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      return [];
    }
  }
  return [];
}

function normalizeDataByFields(fields, data) {
  const next = { ...(data || {}) };
  (fields || []).forEach((f) => {
    next[f.field_code] = normalizeFieldValue(f, next[f.field_code]);
  });
  return next;
}

function usesSelectOptions(f) {
  return f.field_type === 'Select' || f.field_type === 'MultiSelect' || (!f.field_type && f.data_type === 'enum');
}
function usesRadioOptions(f) {
  return f.field_type === 'Radio';
}
function usesCheckboxOptions(f) {
  return f.field_type === 'Checkbox';
}

function componentOf(f) {
  if (f.field_type === 'NumberInput') return 'el-input-number';
  if (f.field_type === 'Textarea') return 'el-input';
  if (f.field_type === 'Password') return 'el-input';
  if (f.field_type === 'Select' || f.field_type === 'MultiSelect') return 'el-select';
  if (f.field_type === 'Radio') return 'el-radio-group';
  if (f.field_type === 'Checkbox') return 'el-checkbox-group';
  if (f.data_type === 'number') return 'el-input-number';
  if (f.data_type === 'boolean') return 'el-switch';
  if (f.data_type === 'date') return 'el-date-picker';
  if (f.data_type === 'datetime') return 'el-date-picker';
  if (f.data_type === 'enum') return 'el-select';
  return 'el-input';
}

function componentProps(f) {
  if (f.field_type === 'Textarea') return { type: 'textarea', autosize: { minRows: 2, maxRows: 6 } };
  if (f.field_type === 'Password') return { type: 'password', showPassword: true };
  if (f.field_type === 'Select') return { clearable: true, filterable: true, style: 'width:100%' };
  if (f.field_type === 'MultiSelect') return { multiple: true, collapseTags: true, collapseTagsTooltip: true, maxCollapseTags: 8, clearable: true, filterable: true, style: 'width:100%' };
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

function safeParse(text) {
  try { return JSON.parse(text); } catch (e) { return {}; }
}

async function loadRefs() {
  apps.value = await api.listApps();
  if (!state.appId && workspace?.appId && apps.value.find((a) => a.id === workspace.appId)) state.appId = workspace.appId;
  envs.value = await api.listEnvs(state.appId || undefined);
  if (!state.envId && workspace?.envId && envs.value.find((e) => e.id === workspace.envId)) state.envId = workspace.envId;
  if (!state.appId && apps.value.length) state.appId = apps.value[0].id;
}

watch(
  () => state.appId,
  async () => {
    if (workspace) workspace.appId = state.appId;
    envs.value = await api.listEnvs(state.appId || undefined);
    if (workspace?.envId && envs.value.find((e) => e.id === workspace.envId)) state.envId = workspace.envId;
    rows.value = [];
    summary.value = null;
    total.value = 0;
    fieldsCache.clear();
    state.page = 1;
  }
);

watch(
  () => state.groupId,
  () => {
    if (workspace) workspace.groupId = state.groupId;
    if (state.typeId && !typeOptions.value.some((t) => t.id === state.typeId)) state.typeId = null;
  }
);

watch(
  () => state.envId,
  () => {
    if (workspace) workspace.envId = state.envId;
  }
);

watch(
  () => state.typeId,
  () => {
    if (workspace) workspace.typeId = state.typeId;
  }
);

function toggleExpanded(r) {
  r.expanded = !r.expanded;
}

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

function fieldsForRow(r) {
  const list = fieldsCache.get(r.type_id) || [];
  return list;
}

function expandFirst() {
  rows.value.forEach((r) => { r.expanded = false; });
  if (rows.value[0]) rows.value[0].expanded = true;
}

function onPageChange(p) {
  state.page = p;
  search();
}

function onPageSizeChange(ps) {
  state.pageSize = ps;
  state.page = 1;
  search();
}

async function search() {
  if (!state.appId) return toastWarning('请先选择应用');
  const q = String(state.q || '').trim();
  if (!q) return toastWarning('请输入关键字');
  try {
    loading.value = true;
    const params = { appId: String(state.appId), q, page: String(state.page), pageSize: String(state.pageSize) };
    if (state.envId) params.envId = String(state.envId);
    if (state.groupId) params.groupId = String(state.groupId);
    if (state.typeId) params.typeId = String(state.typeId);
    const res = await api.searchData(params);
    const list = res?.rows || [];
    total.value = Number(res?.total || 0);
    const normalized = (list || []).map((r) => ({ ...r, data: safeParse(r.data_json), expanded: false }));
    rows.value = normalized;

    const typeIds = [...new Set(rows.value.map((r) => r.type_id).filter(Boolean))];
    await Promise.all(typeIds.map((tid) => ensureFieldsLoaded(tid)));
    rows.value = rows.value.map((r) => {
      const fields = fieldsCache.get(r.type_id) || [];
      return { ...r, data: normalizeDataByFields(fields, r.data) };
    });
    summary.value = { count: total.value };
    expandFirst();
  } catch (e) {
    toastError(e, '搜索失败');
  } finally {
    loading.value = false;
  }
}

function reset() {
  state.q = '';
  state.page = 1;
  state.pageSize = 10;
  rows.value = [];
  summary.value = null;
  total.value = 0;
}

onMounted(loadRefs);
</script>

<style scoped>
.cc-toolbar { align-items:flex-start; }
.toolbar__filters { display:flex; flex-direction:column; align-items:flex-start; gap:8px; flex: 1 1 520px; min-width: 360px; }
.filters__row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; width: 100%; }
.meta { margin-top:8px; display:flex; gap:6px; flex-wrap:wrap; }
.data-form-list { margin-top:10px; display:flex; flex-direction:column; gap:12px; }
.data-card__header { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.data-card__left { display:flex; align-items:center; gap:10px; min-width:0; flex: 1 1 auto; }
.data-card__fold { padding: 0; }
.data-card__key { font-weight:600; color:#111827; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:520px; }
.data-card__actions { display:flex; align-items:center; gap:8px; flex: 0 0 auto; flex-wrap:wrap; justify-content:flex-end; }
.data-card__form { padding-top:4px; }
.row-meta { margin-top: 8px; display:flex; gap:6px; flex-wrap:wrap; }
.pager { display:flex; justify-content:flex-end; padding: 8px 0 0; }
</style>
