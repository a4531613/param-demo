<template>
  <el-card>
    <template #header>
      <div class="toolbar">
        <el-select v-model="state.typeId" placeholder="选择类型" style="width:260px;" @change="load">
          <el-option v-for="t in types" :key="t.id" :label="`${t.type_code} (${t.env})`" :value="t.id" />
        </el-select>
        <el-button type="primary" @click="openNew">新建待发布版本</el-button>
      </div>
    </template>
    <el-table :data="versions" border>
      <el-table-column prop="version_no" label="版本号" width="140" />
      <el-table-column prop="status" label="状态" width="160">
        <template #default="s"><el-tag :type="tagType(s.row.status)">{{ s.row.status }}</el-tag></template>
      </el-table-column>
      <el-table-column prop="description" label="描述" />
      <el-table-column prop="create_user" label="创建人" width="120" />
      <el-table-column prop="create_time" label="创建时间" width="180" />
      <el-table-column label="操作" width="220">
        <template #default="scope">
          <el-button link type="success" @click="publish(scope.row)" :disabled="scope.row.status !== 'PENDING_RELEASE'">发布</el-button>
          <el-button link type="primary" @click="selectVersion(scope.row)">选择</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<script setup>
import { reactive } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';

const props = defineProps({ types: { type: Array, default: () => [] }, versions: { type: Array, default: () => [] } });
const emits = defineEmits(['refreshVersions']);

const state = reactive({ typeId: null });

const tagType = (status) => (status === 'RELEASED' ? 'success' : status === 'PENDING_RELEASE' ? 'warning' : 'info');

function load() {
  if (!state.typeId) return;
  emits('refreshVersions', state.typeId);
}

async function openNew() {
  if (!state.typeId) return ElMessage.warning('请先选择类型');
  await api.createVersion(state.typeId, { versionNo: `v${Date.now()}` });
  ElMessage.success('已创建待发布版本');
  load();
}

async function publish(row) {
  await api.publishVersion(row.id);
  ElMessage.success('已发布');
  load();
}

function selectVersion(row) {
  ElMessage.success(`当前选择版本 ${row.version_no}`);
}
</script>

<style scoped>
.toolbar { display:flex; justify-content: space-between; align-items:center; }
</style>
