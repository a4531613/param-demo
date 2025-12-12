<template>
  <el-card>
    <div class="cc-toolbar cc-toolbar--start">
      <div class="cc-toolbar__group">
        <el-button @click="load">刷新</el-button>
      </div>
    </div>
    <el-empty v-if="!rows.length" description="暂无审计记录。" />
    <el-table v-else :data="rows" border>
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="actor" label="操作者" width="120" />
      <el-table-column prop="action" label="动作" width="160" />
      <el-table-column prop="target_type" label="对象" width="140" />
      <el-table-column prop="target_id" label="对象ID" width="100" />
      <el-table-column prop="details" label="详情" />
      <el-table-column prop="created_at" label="时间" width="180" />
    </el-table>
  </el-card>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api';
import { toastError } from '../ui/feedback';

const rows = ref([]);
async function load() {
  try {
    rows.value = await api.audit();
  } catch (e) {
    toastError(e, '加载审计日志失败');
  }
}
onMounted(load);
</script>
