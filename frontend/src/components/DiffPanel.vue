<template>
  <el-card>
    <template #header>
      <div class="cc-toolbar">
        <div class="cc-toolbar__group">
          <el-select v-model="state.a" placeholder="版本A（当前）" class="cc-control--lg" filterable>
            <el-option v-for="v in versionOptions" :key="v.id" :label="`${v.version_no || v.id} (${statusLabel(v.status)})`" :value="v.id" />
          </el-select>
          <el-select v-model="state.b" placeholder="版本B（基线）" class="cc-control--lg" filterable>
            <el-option v-for="v in versionOptions" :key="v.id" :label="`${v.version_no || v.id} (${statusLabel(v.status)})`" :value="v.id" />
          </el-select>
          <el-button @click="swap" :disabled="!state.a || !state.b">交换</el-button>
          <el-button type="primary" @click="load" :disabled="!state.a || !state.b">对比</el-button>
        </div>
      </div>
    </template>
    <el-empty v-if="!versionOptions.length" description="暂无可对比版本，请先创建并发布版本。" />
    <div v-else>
      <div class="meta" v-if="loaded">
        <el-tag type="info">字段：新增 {{ diff.fields.added.length }} / 删除 {{ diff.fields.removed.length }}</el-tag>
        <el-tag type="info">数据：新增 {{ diff.data.added.length }} / 删除 {{ diff.data.removed.length }}</el-tag>
      </div>
    <el-row :gutter="12">
      <el-col :span="12">
        <h4>字段变化</h4>
        <el-descriptions title="新增字段" v-if="diff.fields.added.length">
          <el-descriptions-item v-for="f in diff.fields.added" :key="f.field_code" :label="f.field_code">{{ f.data_type }}</el-descriptions-item>
        </el-descriptions>
        <el-descriptions title="删除字段" v-if="diff.fields.removed.length">
          <el-descriptions-item v-for="f in diff.fields.removed" :key="f.field_code" :label="f.field_code">{{ f.data_type }}</el-descriptions-item>
        </el-descriptions>
      </el-col>
      <el-col :span="12">
        <h4>数据变化</h4>
        <el-descriptions title="新增记录" v-if="diff.data.added.length">
          <el-descriptions-item v-for="f in diff.data.added" :key="f.key_value" :label="f.key_value">新增</el-descriptions-item>
        </el-descriptions>
        <el-descriptions title="删除记录" v-if="diff.data.removed.length">
          <el-descriptions-item v-for="f in diff.data.removed" :key="f.key_value" :label="f.key_value">删除</el-descriptions-item>
        </el-descriptions>
      </el-col>
    </el-row>
    </div>
  </el-card>
</template>

<script setup>
import { computed, inject, onMounted, reactive, ref, watch } from 'vue';
import { api } from '../api';
import { toastError, toastWarning } from '../ui/feedback';

const props = defineProps({ versions: { type: Array, default: () => [] } });
const workspace = inject('workspace', null);
const diff = reactive({ fields: { added: [], removed: [], changed: [] }, data: { added: [], removed: [], changed: [] } });
const state = reactive({ a: null, b: null });
const loaded = ref(false);

const statusLabelMap = { PENDING_RELEASE: '待发布', RELEASED: '已发布', ARCHIVED: '已归档' };
const statusLabel = (s) => statusLabelMap[s] || s;

const versionOptions = computed(() => {
  const base = props.versions || [];
  if (workspace?.appId) return base.filter((v) => v.app_id === workspace.appId);
  return base;
});

function ensureDefaults() {
  if (!state.a && workspace?.versionId && versionOptions.value.some((v) => v.id === workspace.versionId)) state.a = workspace.versionId;
  if (state.a && state.b === state.a) state.b = null;
  if (!state.b) state.b = versionOptions.value.find((v) => v.id !== state.a)?.id || null;
}

function swap() {
  const t = state.a;
  state.a = state.b;
  state.b = t;
}

async function load() {
  if (!state.a || !state.b) return toastWarning('请选择两个版本');
  try {
    const res = await api.diffVersions(state.a, state.b);
    diff.fields = res.fields;
    diff.data = res.data;
    loaded.value = true;
  } catch (e) {
    toastError(e, '加载对比结果失败');
  }
}

watch(
  () => workspace?.appId,
  () => {
    state.a = null;
    state.b = null;
    loaded.value = false;
    ensureDefaults();
  }
);

onMounted(() => {
  ensureDefaults();
});
</script>

<style scoped>
.meta { margin-bottom: 10px; display:flex; gap:6px; flex-wrap:wrap; }
</style>
