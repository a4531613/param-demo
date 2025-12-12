<template>
  <el-card>
    <template #header>
      <div class="toolbar">
        <div class="toolbar__filters">
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
          <el-switch v-model="showEnabledOnly" active-text="只看启用" inactive-text="全部" />
        </div>

        <div class="toolbar__actions">
          <el-button type="primary" @click="openModal()" :disabled="isArchivedVersion || !state.envId || !state.typeId">新增配置</el-button>
          <el-button type="danger" @click="batchRemove" :disabled="!selected.length || isArchivedVersion">批量删除</el-button>
          <el-dropdown trigger="click">
            <el-button>
              更多
              <el-icon class="el-icon--right"><MoreFilled /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item :disabled="!state.versionId" @click="downloadTemplate">下载模板</el-dropdown-item>
                <el-dropdown-item :disabled="!state.versionId" @click="downloadData">导出</el-dropdown-item>
                <el-dropdown-item :disabled="!state.appId || !state.versionId || !state.envId" @click="downloadAllPdf">导出PDF</el-dropdown-item>
                <el-dropdown-item :disabled="!state.versionId" @click="openVersionPreview">一键预览</el-dropdown-item>
                <el-dropdown-item divided :disabled="isArchivedVersion || !state.versionId" @click="triggerImport">导入</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>

        <input type="file" ref="importInput" style="display:none;" accept=".csv,text/csv" @change="handleImport" />
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
        :min-width="120"
      >
        <template #header>
          <el-tooltip :content="f.field_name" placement="top" :show-after="300">
            <span class="table-header-ellipsis">{{ f.field_name }}</span>
          </el-tooltip>
        </template>
        <template #default="scope">
          <el-tag type="info">{{ formatValue(scope.row.parsed?.[f.field_code]) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="scope">
          <el-button link type="info" @click="openPreview(scope.row)">预览</el-button>
          <el-button link type="primary" @click="openModal(scope.row)">编辑</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="modal.visible" title="配置项" width="80vw">
    <el-form :model="modal.form" label-width="120px">
      <el-form-item label="Key"><el-input v-model="modal.form.keyValue" :disabled="!!modal.editId" /></el-form-item>
    </el-form>
    <div class="env-carousel">
      <div class="env-carousel__header">
        <div class="env-carousel__title">配置环境</div>
        <div class="env-carousel__controls" v-if="modal.envForms.length > envCarousel.pageSize">
          <el-button circle size="small" @click="slideEnv(-1)" :disabled="!canSlidePrev">
            <el-icon><ArrowLeft /></el-icon>
          </el-button>
          <el-button circle size="small" @click="slideEnv(1)" :disabled="!canSlideNext">
            <el-icon><ArrowRight /></el-icon>
          </el-button>
        </div>
      </div>
      <div class="env-form-grid">
        <el-card v-for="ef in visibleEnvForms" :key="ef.envId" shadow="hover" class="env-card">
          <div class="env-card__header">
            <div class="env-card__title">{{ ef.envName }} ({{ ef.envCode }})</div>
            <div class="env-card__meta">
              <el-tag size="small" type="info">版本ID: {{ ef.versionId || '–' }}</el-tag>
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
              <el-form-item>
                <template #label>
                  <el-tooltip :content="f.field_name" placement="top" :show-after="300">
                    <span class="form-label-ellipsis">{{ f.field_name }}</span>
                  </el-tooltip>
                </template>
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
    </div>
    <template #footer>
      <el-button type="danger" v-if="modal.editId" @click="deleteAcrossEnvs">删除</el-button>
      <el-button @click="modal.visible=false">取消</el-button>
      <el-button type="primary" @click="save">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="preview.visible" title="数据预览" width="80vw">
    <div class="preview">
      <div class="preview-header">
        <div class="preview-key">{{ preview.row?.key_value || '—' }}</div>
      </div>
      <div class="env-carousel">
        <div class="env-carousel__header">
          <div class="env-carousel__title">配置环境</div>
          <div class="env-carousel__controls" v-if="preview.envForms.length > previewCarousel.pageSize">
            <el-button circle size="small" @click="slidePreviewEnv(-1)" :disabled="!canPreviewSlidePrev">
              <el-icon><ArrowLeft /></el-icon>
            </el-button>
            <el-button circle size="small" @click="slidePreviewEnv(1)" :disabled="!canPreviewSlideNext">
              <el-icon><ArrowRight /></el-icon>
            </el-button>
          </div>
        </div>
        <div class="env-form-grid">
          <el-card v-for="ef in visiblePreviewEnvForms" :key="ef.envId" shadow="hover" class="env-card">
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
                <el-tag :type="ef.status === 'ENABLED' ? 'success' : 'info'">
                  {{ ef.status === 'ENABLED' ? '启用' : '停用' }}
                </el-tag>
              </el-form-item>
              <template v-for="f in fields" :key="f.field_code">
                <el-form-item>
                  <template #label>
                    <el-tooltip :content="f.field_name" placement="top" :show-after="300">
                      <span class="form-label-ellipsis">{{ f.field_name }}</span>
                    </el-tooltip>
                  </template>
                  <el-tag type="info">{{ formatValue(ef.data?.[f.field_code]) }}</el-tag>
                </el-form-item>
              </template>
              <div v-if="!ef.hasRecord" class="env-card__disabled">暂无配置</div>
            </el-form>
          </el-card>
        </div>
      </div>
    </div>
    <template #footer>
      <el-button @click="preview.visible=false">关闭</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="versionPreview.visible" title="版本配置预览" width="80vw">
    <div class="version-preview">
      <div class="version-preview__toolbar">
        <el-tag type="info">当前版本：{{ selectedVersion?.version_no || '—' }}</el-tag>
        <el-select v-model="versionPreview.baseId" placeholder="对比基线版本（可选）" style="width:280px" @change="loadVersionPreview">
          <el-option :value="null" label="无对比（只看当前）" />
          <el-option
            v-for="v in baselineVersionOptions"
            :key="v.id"
            :label="`${v.version_no} (${statusLabel(v.status)})`"
            :value="v.id"
          />
        </el-select>
        <el-input v-model="versionPreview.filter" clearable placeholder="搜索 Key/环境/类型" style="width:260px" />
        <el-button @click="loadVersionPreview" :loading="versionPreview.loading" :disabled="!versionPreview.targetId">刷新</el-button>
      </div>

      <div class="version-preview__envtags" v-if="versionPreviewEnvOptions.length">
        <span class="tag-label">环境</span>
        <el-check-tag
          v-for="e in versionPreviewEnvOptions"
          :key="String(e.envId)"
          :checked="versionPreview.envId === e.envId"
          @click="versionPreview.envId = e.envId"
        >
          {{ e.envLabel }}
        </el-check-tag>
      </div>

      <div class="version-preview__stats">
        <el-tag type="success">新增 {{ versionPreviewCounts.added }}</el-tag>
        <el-tag type="warning">修改 {{ versionPreviewCounts.changed }}</el-tag>
        <el-tag type="info">全部 {{ versionPreviewCounts.current }}</el-tag>
        <el-tag v-if="versionPreview.baseId" type="danger">删除 {{ versionPreviewCounts.removed }}</el-tag>
      </div>

      <el-tabs v-model="versionPreview.tab" class="version-preview__tabs">
        <el-tab-pane name="changed" label="变更">
          <div v-for="tg in versionPreviewChangedTypeGroups" :key="tg.typeKey" class="version-preview__subgroup">
            <div class="version-preview__subgroup-title">类型：{{ tg.typeLabel }}</div>
            <el-table :data="tg.rows" border v-loading="versionPreview.loading" row-key="diffKey">
              <el-table-column type="expand">
                <template #default="scope">
                  <div class="version-preview__expand">
                    <div v-if="scope.row.changeType === 'changed'" class="version-preview__diffgrid">
                      <div>
                        <div class="version-preview__diff-title">之前</div>
                        <pre class="json-block">{{ scope.row.beforePretty }}</pre>
                      </div>
                      <div>
                        <div class="version-preview__diff-title">现在</div>
                        <pre class="json-block">{{ scope.row.afterPretty }}</pre>
                      </div>
                      <el-table v-if="scope.row.changedFields?.length" :data="scope.row.changedFields" size="small" class="version-preview__fielddiff">
                        <el-table-column prop="field" label="字段" width="200" />
                        <el-table-column prop="before" label="之前" />
                        <el-table-column prop="after" label="现在" />
                      </el-table>
                    </div>
                    <div v-else>
                      <pre class="json-block">{{ scope.row.afterPretty }}</pre>
                    </div>
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="key" label="Key" min-width="220" />
              <el-table-column label="变更" width="110">
                <template #default="scope">
                  <el-tag v-if="scope.row.changeType === 'added'" type="success">新增</el-tag>
                  <el-tag v-else-if="scope.row.changeType === 'changed'" type="warning">修改</el-tag>
                  <el-tag v-else type="info">—</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="变化字段" width="110">
                <template #default="scope">{{ scope.row.changedFields?.length || '—' }}</template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>

        <el-tab-pane name="added" label="新增">
          <div v-for="tg in versionPreviewAddedTypeGroups" :key="tg.typeKey" class="version-preview__subgroup">
            <div class="version-preview__subgroup-title">类型：{{ tg.typeLabel }}</div>
            <el-table :data="tg.rows" border v-loading="versionPreview.loading" row-key="diffKey">
              <el-table-column type="expand">
                <template #default="scope">
                  <pre class="json-block">{{ scope.row.afterPretty }}</pre>
                </template>
              </el-table-column>
              <el-table-column prop="key" label="Key" min-width="220" />
            </el-table>
          </div>
        </el-tab-pane>

        <el-tab-pane name="updated" label="修改">
          <div v-for="tg in versionPreviewOnlyChangedTypeGroups" :key="tg.typeKey" class="version-preview__subgroup">
            <div class="version-preview__subgroup-title">类型：{{ tg.typeLabel }}</div>
            <el-table :data="tg.rows" border v-loading="versionPreview.loading" row-key="diffKey">
              <el-table-column type="expand">
                <template #default="scope">
                  <div class="version-preview__expand version-preview__diffgrid">
                    <div>
                      <div class="version-preview__diff-title">之前</div>
                      <pre class="json-block">{{ scope.row.beforePretty }}</pre>
                    </div>
                    <div>
                      <div class="version-preview__diff-title">现在</div>
                      <pre class="json-block">{{ scope.row.afterPretty }}</pre>
                    </div>
                    <el-table v-if="scope.row.changedFields?.length" :data="scope.row.changedFields" size="small" class="version-preview__fielddiff">
                      <el-table-column prop="field" label="字段" width="200" />
                      <el-table-column prop="before" label="之前" />
                      <el-table-column prop="after" label="现在" />
                    </el-table>
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="key" label="Key" min-width="220" />
              <el-table-column label="变化字段" width="110">
                <template #default="scope">{{ scope.row.changedFields?.length || '—' }}</template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>

        <el-tab-pane name="all" label="全部">
          <div v-for="tg in versionPreviewCurrentTypeGroups" :key="tg.typeKey" class="version-preview__subgroup">
            <div class="version-preview__subgroup-title">类型：{{ tg.typeLabel }}</div>
            <el-table :data="tg.rows" border v-loading="versionPreview.loading" row-key="diffKey">
              <el-table-column type="expand">
                <template #default="scope">
                  <pre class="json-block">{{ scope.row.afterPretty }}</pre>
                </template>
              </el-table-column>
              <el-table-column prop="key" label="Key" min-width="220" />
              <el-table-column label="标记" width="110">
                <template #default="scope">
                  <el-tag v-if="scope.row.changeType === 'added'" type="success">新增</el-tag>
                  <el-tag v-else-if="scope.row.changeType === 'changed'" type="warning">修改</el-tag>
                  <el-tag v-else type="info">无变化</el-tag>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>

        <el-tab-pane v-if="versionPreview.baseId" name="removed" label="删除">
          <div v-for="tg in versionPreviewRemovedTypeGroups" :key="tg.typeKey" class="version-preview__subgroup">
            <div class="version-preview__subgroup-title">类型：{{ tg.typeLabel }}</div>
            <el-table :data="tg.rows" border v-loading="versionPreview.loading" row-key="diffKey">
              <el-table-column type="expand">
                <template #default="scope">
                  <pre class="json-block">{{ scope.row.beforePretty }}</pre>
                </template>
              </el-table-column>
              <el-table-column prop="key" label="Key" min-width="220" />
            </el-table>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
    <template #footer>
      <el-button @click="versionPreview.visible=false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft, ArrowRight, MoreFilled } from '@element-plus/icons-vue';
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
const preview = reactive({ visible: false, row: null, envForms: [] });
const versionPreview = reactive({
  visible: false,
  loading: false,
  targetId: null,
  baseId: null,
  envId: null,
  tab: 'changed',
  filter: '',
  rows: []
});
const importInput = ref(null);
const selected = ref([]);
const envCarousel = reactive({ start: 0, pageSize: 3 });
const previewCarousel = reactive({ start: 0, pageSize: 3 });

const envOptions = computed(() => envs.value.filter((e) => !state.appId || e.app_id === state.appId));
const typeOptions = computed(() => props.types.filter((t) => !state.appId || t.app_id === state.appId));
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
const versionLabel = (v) => statusLabelMap[v?.status] || v?.status || '—';
const baselineVersionOptions = computed(() =>
  versionOptions.value.filter((v) => v.id !== state.versionId)
);
const visibleEnvForms = computed(() =>
  modal.envForms.slice(envCarousel.start, envCarousel.start + envCarousel.pageSize)
);
const canSlidePrev = computed(() => envCarousel.start > 0);
const canSlideNext = computed(
  () => envCarousel.start + envCarousel.pageSize < modal.envForms.length
);
const visiblePreviewEnvForms = computed(() =>
  preview.envForms.slice(previewCarousel.start, previewCarousel.start + previewCarousel.pageSize)
);
const canPreviewSlidePrev = computed(() => previewCarousel.start > 0);
const canPreviewSlideNext = computed(
  () => previewCarousel.start + previewCarousel.pageSize < preview.envForms.length
);
const safeParse = (text) => {
  try { return JSON.parse(text); } catch (e) { return {}; }
};
const envLabelById = computed(() => new Map(envs.value.map((e) => [e.id, `${e.env_name} (${e.env_code})`])));
const typeLabelById = computed(() => new Map(props.types.map((t) => [t.id, `${t.type_name} (${t.type_code})`])));
const envLabelOf = (envId) => (envId === null || envId === undefined ? '全局（无环境）' : envLabelById.value.get(envId) || `Env ${envId}`);
const typeLabelOf = (typeId) => (typeId === null || typeId === undefined ? '未知类型' : typeLabelById.value.get(typeId) || `Type ${typeId}`);

const versionPreviewCounts = computed(() => {
  const rows = versionPreview.rows || [];
  return {
    added: rows.filter((r) => r.changeType === 'added').length,
    changed: rows.filter((r) => r.changeType === 'changed').length,
    removed: rows.filter((r) => r.changeType === 'removed').length,
    current: rows.filter((r) => r.changeType !== 'removed').length
  };
});

const versionPreviewFilteredRows = computed(() => {
  const q = (versionPreview.filter || '').trim().toLowerCase();
  if (!q) return versionPreview.rows;
  return versionPreview.rows.filter((r) => {
    const key = (r.key || '').toLowerCase();
    const envLabel = (r.envLabel || '').toLowerCase();
    const typeLabel = (r.typeLabel || '').toLowerCase();
    return key.includes(q) || envLabel.includes(q) || typeLabel.includes(q);
  });
});

const versionPreviewEnvOptions = computed(() => {
  const presentEnvIds = new Set((versionPreview.rows || []).map((r) => (r.envId ?? null)));
  const list = [];
  if (presentEnvIds.has(null)) list.push({ envId: null, envLabel: envLabelOf(null) });
  envOptions.value.forEach((e) => {
    if (presentEnvIds.has(e.id)) list.push({ envId: e.id, envLabel: envLabelOf(e.id) });
  });
  [...presentEnvIds]
    .filter((id) => id !== null && !envOptions.value.some((e) => e.id === id))
    .sort((a, b) => Number(a) - Number(b))
    .forEach((id) => list.push({ envId: id, envLabel: envLabelOf(id) }));
  return list;
});

const versionPreviewEnvScopedRows = computed(() => {
  const envId = versionPreview.envId;
  if (envId === null) return versionPreviewFilteredRows.value.filter((r) => (r.envId ?? null) === null);
  return versionPreviewFilteredRows.value.filter((r) => r.envId === envId);
});

const versionPreviewChangedRows = computed(() =>
  versionPreviewFilteredRows.value.filter((r) => r.changeType === 'added' || r.changeType === 'changed')
);
const versionPreviewAddedRows = computed(() =>
  versionPreviewFilteredRows.value.filter((r) => r.changeType === 'added')
);
const versionPreviewOnlyChangedRows = computed(() =>
  versionPreviewFilteredRows.value.filter((r) => r.changeType === 'changed')
);
const versionPreviewCurrentRows = computed(() =>
  versionPreviewFilteredRows.value.filter((r) => r.changeType !== 'removed')
);
const versionPreviewRemovedRows = computed(() =>
  versionPreviewFilteredRows.value.filter((r) => r.changeType === 'removed')
);

function groupPreviewRowsByType(rowsList) {
  const typeMap = new Map();
  rowsList.forEach((r) => {
    const typeId = r.typeId ?? null;
    const typeKey = String(typeId);
    if (!typeMap.has(typeKey)) {
      typeMap.set(typeKey, { typeId, typeKey, typeLabel: typeLabelOf(typeId), rows: [] });
    }
    typeMap.get(typeKey).rows.push(r);
  });

  const typeGroups = [...typeMap.values()].sort((a, b) => (a.typeId ?? -1) - (b.typeId ?? -1));
  typeGroups.forEach((tg) => tg.rows.sort((a, b) => String(a.key).localeCompare(String(b.key))));
  return typeGroups;
}

const versionPreviewChangedTypeGroups = computed(() =>
  groupPreviewRowsByType(versionPreviewEnvScopedRows.value.filter((r) => r.changeType === 'added' || r.changeType === 'changed'))
);
const versionPreviewAddedTypeGroups = computed(() =>
  groupPreviewRowsByType(versionPreviewEnvScopedRows.value.filter((r) => r.changeType === 'added'))
);
const versionPreviewOnlyChangedTypeGroups = computed(() =>
  groupPreviewRowsByType(versionPreviewEnvScopedRows.value.filter((r) => r.changeType === 'changed'))
);
const versionPreviewCurrentTypeGroups = computed(() =>
  groupPreviewRowsByType(versionPreviewEnvScopedRows.value.filter((r) => r.changeType !== 'removed'))
);
const versionPreviewRemovedTypeGroups = computed(() =>
  groupPreviewRowsByType(versionPreviewEnvScopedRows.value.filter((r) => r.changeType === 'removed'))
);

const formatValue = (v) => {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

async function load() {
  if (!state.versionId || !state.typeId) return;
  meta.value = versionOptions.value.find((v) => v.id === state.versionId) || null;
  await loadFieldsForSelection();
  const list = await api.listData(state.versionId, state.typeId, state.envId);
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
  await buildPreviewEnvForms(row);
  preview.visible = true;
}

function guessBaseVersionId(targetId) {
  const sorted = [...versionOptions.value].sort((a, b) => a.id - b.id);
  const idx = sorted.findIndex((v) => v.id === targetId);
  if (idx > 0) return sorted[idx - 1].id;
  const fallback = sorted.find((v) => v.id !== targetId);
  return fallback?.id || null;
}

function jsonPretty(obj) {
  try { return JSON.stringify(obj ?? {}, null, 2); } catch { return String(obj ?? ''); }
}

function makeDiffKey(row) {
  const typeId = row?.type_id ?? row?.typeId ?? '';
  const envId = row?.env_id ?? row?.envId ?? '';
  const key = row?.key_value ?? row?.keyValue ?? row?.key ?? '';
  return `${typeId}|${envId}|${key}`;
}

function toComparable(v) {
  if (v === undefined) return '__undefined__';
  if (v === null) return '__null__';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function computeFieldDiff(beforeObj, afterObj) {
  const before = beforeObj || {};
  const after = afterObj || {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys
    .map((field) => ({ field, before: before[field], after: after[field] }))
    .filter((x) => toComparable(x.before) !== toComparable(x.after))
    .map((x) => ({ field: x.field, before: formatValue(x.before), after: formatValue(x.after) }));
}

async function openVersionPreview() {
  if (!state.versionId) return ElMessage.warning('请选择版本');
  versionPreview.targetId = state.versionId;
  versionPreview.baseId = guessBaseVersionId(state.versionId);
  versionPreview.envId = null;
  versionPreview.tab = 'changed';
  versionPreview.filter = '';
  versionPreview.visible = true;
  await loadVersionPreview();
}

async function loadVersionPreview() {
  if (!versionPreview.targetId) return;
  try {
    versionPreview.loading = true;
    const targetId = versionPreview.targetId;
    const baseId = versionPreview.baseId;
    const [currentAll, diffRes] = await Promise.all([
      api.listVersionDataAll(targetId),
      baseId ? api.diffVersions(baseId, targetId) : Promise.resolve({ data: { added: [], removed: [], changed: [] } })
    ]);

    const currentMap = new Map();
    currentAll.forEach((r) => {
      const diffKey = makeDiffKey(r);
      const afterObj = safeParse(r.data_json);
      currentMap.set(diffKey, {
        diffKey,
        typeId: r.type_id,
        envId: r.env_id,
        envLabel: envLabelOf(r.env_id),
        typeLabel: typeLabelOf(r.type_id),
        key: r.key_value,
        status: r.status,
        changeType: 'unchanged',
        beforeObj: null,
        afterObj,
        beforePretty: '',
        afterPretty: jsonPretty(afterObj),
        changedFields: []
      });
    });

    (diffRes?.data?.added || []).forEach((r) => {
      const diffKey = r.diff_key || makeDiffKey(r);
      const afterObj = safeParse(r.data_json);
      const row = currentMap.get(diffKey) || {
        diffKey,
        typeId: r.type_id,
        envId: r.env_id,
        envLabel: envLabelOf(r.env_id),
        typeLabel: typeLabelOf(r.type_id),
        key: r.key_value,
        status: r.status,
        beforeObj: null
      };
      currentMap.set(diffKey, {
        ...row,
        changeType: 'added',
        afterObj,
        afterPretty: jsonPretty(afterObj),
        changedFields: []
      });
    });

    (diffRes?.data?.changed || []).forEach((pair) => {
      const beforeRow = pair.before || {};
      const afterRow = pair.after || {};
      const diffKey = afterRow.diff_key || beforeRow.diff_key || makeDiffKey(afterRow) || makeDiffKey(beforeRow);
      const beforeObj = safeParse(beforeRow.data_json);
      const afterObj = safeParse(afterRow.data_json);
      const row = currentMap.get(diffKey) || {
        diffKey,
        typeId: afterRow.type_id ?? beforeRow.type_id,
        envId: afterRow.env_id ?? beforeRow.env_id,
        envLabel: envLabelOf(afterRow.env_id ?? beforeRow.env_id),
        typeLabel: typeLabelOf(afterRow.type_id ?? beforeRow.type_id),
        key: afterRow.key_value ?? beforeRow.key_value,
        status: afterRow.status ?? beforeRow.status
      };
      currentMap.set(diffKey, {
        ...row,
        changeType: 'changed',
        beforeObj,
        afterObj,
        beforePretty: jsonPretty(beforeObj),
        afterPretty: jsonPretty(afterObj),
        changedFields: computeFieldDiff(beforeObj, afterObj)
      });
    });

    (diffRes?.data?.removed || []).forEach((r) => {
      const diffKey = r.diff_key || makeDiffKey(r);
      const beforeObj = safeParse(r.data_json);
      if (currentMap.has(diffKey)) return;
      currentMap.set(diffKey, {
        diffKey,
        typeId: r.type_id,
        envId: r.env_id,
        envLabel: envLabelOf(r.env_id),
        typeLabel: typeLabelOf(r.type_id),
        key: r.key_value,
        status: r.status,
        changeType: 'removed',
        beforeObj,
        afterObj: null,
        beforePretty: jsonPretty(beforeObj),
        afterPretty: '',
        changedFields: []
      });
    });

    versionPreview.rows = [...currentMap.values()].sort((a, b) => (a.envId ?? 0) - (b.envId ?? 0) || String(a.key).localeCompare(String(b.key)));
    if (!versionPreviewEnvOptions.value.length) {
      versionPreview.envId = null;
    } else if (!versionPreviewEnvOptions.value.some((e) => e.envId === versionPreview.envId)) {
      versionPreview.envId = versionPreviewEnvOptions.value[0].envId;
    }
  } catch (e) {
    ElMessage.error(e?.message || '加载失败');
  } finally {
    versionPreview.loading = false;
  }
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
    tasks.push(api.upsertData(ef.versionId, { typeId: state.typeId, envId: ef.envId, keyValue, status: ef.status, dataJson: ef.data }));
  }
  await Promise.all(tasks);
  modal.visible = false;
  await load();
}

async function deleteAcrossEnvs() {
  if (!modal.form.keyValue) return;
  await ElMessageBox.confirm('确认删除该Key在所有环境的数据？', '提示');
  const deletes = modal.envForms
    .map((ef) => ef.recordId)
    .filter(Boolean)
    .map((id) => api.deleteData(id));
  if (deletes.length) {
    await Promise.all(deletes);
  }
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
  const keysToDelete = [...new Set(selected.value.map((r) => r.key_value))];
  const ids = await collectIdsAcrossEnvs(keysToDelete);
  for (const id of ids) {
    await api.deleteData(id);
  }
  selected.value = [];
  await load();
}

async function collectIdsAcrossEnvs(keys) {
  if (!keys?.length || !state.versionId || !state.typeId) return [];
  const keySet = new Set(keys);
  const envIds = envOptions.value.map((e) => e.id).filter(Boolean);
  if (!envIds.length) return [];
  const all = await Promise.all(
    envIds.map(async (envId) => {
      const list = await api.listData(state.versionId, state.typeId, envId);
      return list.filter((item) => keySet.has(item.key_value)).map((item) => item.id);
    })
  );
  return [...new Set(all.flat())];
}

function slideEnv(step) {
  const maxStart = Math.max(0, modal.envForms.length - envCarousel.pageSize);
  envCarousel.start = Math.min(Math.max(0, envCarousel.start + step), maxStart);
}

function slidePreviewEnv(step) {
  const maxStart = Math.max(0, preview.envForms.length - previewCarousel.pageSize);
  previewCarousel.start = Math.min(Math.max(0, previewCarousel.start + step), maxStart);
}

function adjustEnvCarouselStart(envForms) {
  const size = envCarousel.pageSize;
  const total = envForms.length;
  if (!total) { envCarousel.start = 0; return; }
  if (total <= size) { envCarousel.start = 0; return; }
  const idx = envForms.findIndex((ef) => ef.envId === state.envId);
  const center = Math.floor((size - 1) / 2);
  const desiredStart = (idx >= 0 ? idx - center : 0);
  const maxStart = Math.max(0, total - size);
  envCarousel.start = Math.min(Math.max(0, desiredStart), maxStart);
}

function adjustPreviewCarouselStart(envForms) {
  const size = previewCarousel.pageSize;
  const total = envForms.length;
  if (!total) { previewCarousel.start = 0; return; }
  if (total <= size) { previewCarousel.start = 0; return; }
  const idx = envForms.findIndex((ef) => ef.envId === state.envId);
  const center = Math.floor((size - 1) / 2);
  const desiredStart = (idx >= 0 ? idx - center : 0);
  const maxStart = Math.max(0, total - size);
  previewCarousel.start = Math.min(Math.max(0, desiredStart), maxStart);
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
    const version = selectedVersion.value;
    const disabled = !version || version.status === 'ARCHIVED';
    let data = { ...baseDefault };
    let status = 'ENABLED';
    let match = null;
    if (version) {
      if (env.id === state.envId && row) {
        data = { ...baseDefault, ...(row.parsed || {}) };
        status = row.status;
      } else if (key) {
        const list = await api.listData(version.id, state.typeId, env.id);
        match = list.find((item) => item.key_value === key) || null;
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
      hasRecord: !!row || (!!match),
      recordId: match?.id || (env.id === state.envId ? row?.id || null : null),
      disabled
    });
  }
  adjustEnvCarouselStart(envForms);
  modal.envForms = envForms;
}

async function buildPreviewEnvForms(row) {
  const key = row?.key_value || '';
  const baseDefault = defaultData();
  const envForms = [];
  for (const env of envOptions.value) {
    const version = selectedVersion.value;
    let data = { ...baseDefault };
    let status = 'ENABLED';
    let match = null;
    if (version) {
      if (env.id === state.envId && row) {
        data = { ...baseDefault, ...(row.parsed || {}) };
        status = row.status;
      } else if (key) {
        const list = await api.listData(version.id, state.typeId, env.id);
        match = list.find((item) => item.key_value === key) || null;
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
      hasRecord: !!row || (!!match),
      recordId: match?.id || (env.id === state.envId ? row?.id || null : null)
    });
  }
  adjustPreviewCarouselStart(envForms);
  preview.envForms = envForms;
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
  if (!state.envId) return;
  const text = await api.exportData(state.versionId, state.typeId, state.envId);
  await downloadText(`version_${state.versionId}_data.csv`, text);
}

async function downloadAllPdf() {
  if (!state.appId || !state.versionId || !state.envId) return;
  const { blob, filename } = await api.exportAllPdf(state.appId, state.versionId, state.envId);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
  await api.importData(state.versionId, trimmed, state.typeId, state.envId);
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
.toolbar { display:flex; align-items:flex-start; gap:10px; flex-wrap: wrap; }
.toolbar__filters { display:flex; align-items:center; gap:8px; flex-wrap:wrap; flex: 1 1 520px; min-width: 360px; }
.toolbar__actions { display:flex; align-items:center; gap:8px; flex: 0 0 auto; }
@media (max-width: 900px) {
  .toolbar__filters { min-width: 100%; }
  .toolbar__actions { width: 100%; }
}
.meta { margin-top:8px; display:flex; gap:6px; flex-wrap:wrap; }
.tag-group { display:flex; align-items:center; gap:6px; }
.tag-label { color:#6b7280; font-size:12px; }
.preview { display:flex; flex-direction:column; gap:12px; }
.preview-header { display:flex; align-items:center; gap:10px; }
.preview-key { font-size:18px; font-weight:600; color:#111827; }
.env-carousel { margin-top:8px; display:flex; flex-direction:column; gap:8px; }
.env-carousel__header { display:flex; align-items:center; justify-content:space-between; }
.env-carousel__title { font-weight:600; color:#111827; }
.env-carousel__controls { display:flex; gap:6px; }
.env-form-grid { display:flex; flex-wrap:nowrap; gap:12px; margin-top:8px; overflow:hidden; }
.env-card { flex:1 1 0; min-width:0; }
.env-card__header { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }
.env-card__title { font-weight:600; color:#111827; }
.env-card__meta { display:flex; gap:6px; align-items:center; }
.env-card__form { padding-top:4px; }
.env-card__disabled { color:#9ca3af; font-size:12px; margin-top:4px; }
.table-header-ellipsis { display:inline-block; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:bottom; }
.form-label-ellipsis { display:inline-block; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:bottom; }
.version-preview { display:flex; flex-direction:column; gap:10px; }
.version-preview__toolbar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.version-preview__envtags { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.version-preview__stats { display:flex; gap:8px; flex-wrap:wrap; }
.version-preview__subgroup { display:flex; flex-direction:column; gap:8px; padding:10px; border:1px solid #e5e7eb; border-radius:10px; background:#ffffff; }
.version-preview__subgroup-title { font-size:12px; color:#6b7280; }
.version-preview__expand { padding:10px 0; }
.version-preview__diffgrid { display:grid; grid-template-columns: 1fr 1fr; gap:12px; align-items:start; }
.version-preview__diff-title { font-size:12px; color:#6b7280; margin-bottom:6px; }
.version-preview__fielddiff { margin-top:10px; }
.json-block { background:#f8fafc; border:1px solid #e5e7eb; border-radius:8px; padding:10px; margin:0; max-height:320px; overflow:auto; font-size:12px; line-height:1.4; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
</style>
