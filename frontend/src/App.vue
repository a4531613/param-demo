<template>
  <el-container style="height: 100vh;">
    <el-header height="60px" class="header">
      <div class="logo">参数配置中心</div>
      <el-tag type="info">Demo 用户: admin</el-tag>
    </el-header>
    <el-container>
      <el-aside width="220px" class="aside">
        <el-menu :default-active="active" @select="active = $event">
          <el-menu-item index="apps">应用管理</el-menu-item>
          <el-menu-item index="envs">环境管理</el-menu-item>
          <el-menu-item index="types">配置类型</el-menu-item>
          <el-menu-item index="versions">版本管理</el-menu-item>
          <el-menu-item index="fieldsManage">字段管理</el-menu-item>
          <el-menu-item index="data">配置数据</el-menu-item>
          <el-menu-item index="diff">版本对比</el-menu-item>
          <el-menu-item index="audit">审计日志</el-menu-item>
        </el-menu>
      </el-aside>
      <el-main class="main">
        <component :is="currentComp"
                   :types="types"
                   :versions="versions"
                   @refreshTypes="loadTypes"
                   @refreshVersions="loadVersions" />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from './api';
import AppsPanel from './components/AppsPanel.vue';
import EnvsPanel from './components/EnvsPanel.vue';
import TypesPanel from './components/TypesPanel.vue';
import VersionsPanel from './components/VersionsPanel.vue';
import FieldsManagePanel from './components/FieldsManagePanel.vue';
import DataPanel from './components/DataPanel.vue';
import DiffPanel from './components/DiffPanel.vue';
import AuditPanel from './components/AuditPanel.vue';

const active = ref('types');
const types = ref([]);
const versions = ref([]);
const currentTypeId = ref(null);

const compMap = { apps: AppsPanel, envs: EnvsPanel, types: TypesPanel, versions: VersionsPanel, fieldsManage: FieldsManagePanel, data: DataPanel, diff: DiffPanel, audit: AuditPanel };
const currentComp = computed(() => compMap[active.value] || TypesPanel);

async function loadTypes() {
  types.value = await api.listTypes();
}
async function loadVersions(typeId) {
  const tId = typeId || currentTypeId.value || (types.value[0]?.id || null);
  currentTypeId.value = tId;
  if (!tId) { versions.value = []; return; }
  versions.value = await api.listVersions(tId);
}

onMounted(async () => {
  await loadTypes();
  await loadVersions();
});
</script>

<style scoped>
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #0f172a;
  color: #e2e8f0;
}
.logo { font-weight: 700; font-size: 16px; }
.aside { border-right: 1px solid #e5e7eb; }
.main { background: #f5f6fb; }
</style>
