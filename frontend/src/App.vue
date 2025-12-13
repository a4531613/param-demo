<template>
  <el-container class="cc-app">
    <el-header height="60px" class="cc-app__header">
      <div class="cc-app__logo">参数配置中心</div>
      <div class="cc-toolbar cc-toolbar--start">
        <div class="cc-toolbar__group">
          <span class="cc-app__header-label">用户</span>
          <el-input v-model="userName" placeholder="用户名" class="cc-control--sm" />
        </div>
        <div class="cc-toolbar__group">
          <span class="cc-app__header-label">角色</span>
          <el-select v-model="userRole" placeholder="角色" class="cc-control--sm">
            <el-option v-for="r in roles" :key="r.value" :label="r.label" :value="r.value" />
          </el-select>
        </div>
        <el-tag type="info">{{ userName }} · {{ roleLabel }}</el-tag>
      </div>
    </el-header>
    <el-container>
      <el-aside width="220px" class="cc-app__aside">
        <el-menu :default-active="active" @select="onSelect">
          <el-menu-item index="overview">概览</el-menu-item>
          <el-sub-menu index="setup">
            <template #title>基础配置</template>
            <el-menu-item index="apps">应用</el-menu-item>
            <el-menu-item index="envs">环境</el-menu-item>
            <el-menu-item index="types">配置类型</el-menu-item>
            <el-menu-item index="fieldsManage">字段管理</el-menu-item>
          </el-sub-menu>
          <el-sub-menu index="release">
            <template #title>版本与发布</template>
            <el-menu-item index="versions">版本管理</el-menu-item>
            <el-menu-item index="diff">版本对比</el-menu-item>
          </el-sub-menu>
          <el-sub-menu index="ops">
            <template #title>配置操作</template>
            <el-menu-item index="data">配置数据</el-menu-item>
          </el-sub-menu>
          <el-menu-item index="audit">审计日志</el-menu-item>
        </el-menu>
      </el-aside>
      <el-main class="cc-app__main">
        <div class="cc-page">
          <div class="cc-page__header">
            <div class="cc-page__title">{{ pageMeta.title }}</div>
            <div class="cc-page__desc">{{ pageMeta.desc }}</div>
          </div>
        <component :is="currentComp"
                   :types="types"
                   :versions="versions"
                   @refreshTypes="loadTypes"
                   @refreshVersions="loadVersions"
                   @navigate="onSelect" />
        </div>
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { api } from './api';
import { roles, setUserContext, userContext } from './userContext';
import OverviewPanel from './components/OverviewPanel.vue';
import AppsPanel from './components/AppsPanel.vue';
import EnvsPanel from './components/EnvsPanel.vue';
import TypesPanel from './components/TypesPanel.vue';
import VersionsPanel from './components/VersionsPanel.vue';
import FieldsManagePanel from './components/FieldsManagePanel.vue';
import DataPanel from './components/DataPanel.vue';
import DiffPanel from './components/DiffPanel.vue';
import AuditPanel from './components/AuditPanel.vue';

const ACTIVE_KEY = 'cc_active_panel_v1';
const active = ref(localStorage.getItem(ACTIVE_KEY) || 'overview');
const types = ref([]);
const versions = ref([]);
const currentTypeId = ref(null);
const currentVersionsFilterType = ref(null);

const compMap = { overview: OverviewPanel, apps: AppsPanel, envs: EnvsPanel, types: TypesPanel, versions: VersionsPanel, fieldsManage: FieldsManagePanel, data: DataPanel, diff: DiffPanel, audit: AuditPanel };
const currentComp = computed(() => compMap[active.value] || TypesPanel);

const userName = ref(userContext.name);
const userRole = ref(userContext.role);
const roleLabel = computed(() => roles.find((r) => r.value === userRole.value)?.label || userRole.value);

function onSelect(key) {
  active.value = key;
}

const pageMetaMap = {
  overview: { title: '概览', desc: '按“应用 → 环境 → 类型 → 版本 → 字段 → 数据”的路径完成配置发布。' },
  apps: { title: '应用', desc: '维护应用基础信息，作为类型/版本/环境的归属。' },
  envs: { title: '环境', desc: '按应用维护环境（dev/test/prod 等），用于数据隔离与预览导出。' },
  types: { title: '配置类型', desc: '定义配置类别与编码，后续用于字段与数据管理。' },
  versions: { title: '版本管理', desc: '创建版本、发布/归档，并作为配置变更的载体。' },
  fieldsManage: { title: '字段管理', desc: '定义字段结构（动态字段），影响数据录入、预览与导出。' },
  data: { title: '配置数据', desc: '在选定版本/环境/类型下维护 Key 与字段值，并支持预览与导出。' },
  diff: { title: '版本对比', desc: '对比两个版本的字段与数据差异。' },
  audit: { title: '审计日志', desc: '查看关键操作轨迹，满足审计与追责需求。' }
};
const pageMeta = computed(() => pageMetaMap[active.value] || pageMetaMap.overview);

function toNumOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function loadTypes() {
  const list = await api.listTypes();
  types.value = (list || []).map((t) => ({
    ...t,
    id: toNumOrNull(t.id),
    app_id: toNumOrNull(t.app_id),
    env_id: toNumOrNull(t.env_id),
    group_id: toNumOrNull(t.group_id)
  }));
}
async function loadVersions(typeId) {
  const tId = typeId || currentTypeId.value || null;
  currentTypeId.value = tId;
  const list = tId ? await api.listVersions(tId) : await api.listVersionsAll();
  versions.value = list;
}

watch(userName, (v) => setUserContext({ name: v }));
watch(userRole, (v) => setUserContext({ role: v }));
watch(active, (v) => localStorage.setItem(ACTIVE_KEY, v));

onMounted(async () => {
  await loadTypes();
  await loadVersions();
});
</script>
