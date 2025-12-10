<template>
  <el-card>
    <template #header>
      <div class="toolbar">
        <el-select v-model="state.versionId" placeholder="选择版本" style="width:260px;" @change="load">
          <el-option v-for="v in versions" :key="v.id" :label="`${v.version_no} (${v.status})`" :value="v.id" />
        </el-select>
        <el-button type="primary" @click="openModal">新增配置</el-button>
      </div>
    </template>
    <el-table :data="rows" border>
      <el-table-column prop="key_value" label="Key" width="220" />
      <el-table-column prop="status" label="状态" width="120" />
      <el-table-column label="内容">
        <template #default="scope">
          <el-tag type="info">{{ short(scope.row.data_json) }}</el-tag>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="modal.visible" title="配置项" width="520px">
    <el-form :model="modal.form" label-width="120px">
      <el-form-item label="Key"><el-input v-model="modal.form.keyValue" /></el-form-item>
      <el-form-item label="状态">
        <el-select v-model="modal.form.status">
          <el-option label="ENABLED" value="ENABLED" /><el-option label="DISABLED" value="DISABLED" />
        </el-select>
      </el-form-item>
      <el-form-item label="数据JSON">
        <el-input v-model="modal.form.dataJson" type="textarea" :rows="6" placeholder='{"field":"value"}' />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="modal.visible=false">取消</el-button>
      <el-button type="primary" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';

const props = defineProps({ versions: { type: Array, default: () => [] } });
const rows = ref([]);
const state = reactive({ versionId: null });
const modal = reactive({ visible: false, form: { keyValue: '', status: 'ENABLED', dataJson: '{}' } });

const short = (text) => (text.length > 60 ? text.slice(0, 60) + '...' : text);

async function load() {
  if (!state.versionId) return;
  rows.value = await api.listData(state.versionId);
}

function openModal() {
  if (!state.versionId) return ElMessage.warning('请选择版本');
  modal.form = { keyValue: '', status: 'ENABLED', dataJson: '{}' };
  modal.visible = true;
}

async function save() {
  if (!state.versionId) return;
  try {
    const parsed = JSON.parse(modal.form.dataJson || '{}');
    await api.upsertData(state.versionId, { keyValue: modal.form.keyValue, status: modal.form.status, dataJson: parsed });
    modal.visible = false;
    await load();
  } catch (e) {
    ElMessage.error('JSON 格式不正确');
  }
}
</script>

<style scoped>
.toolbar { display:flex; justify-content: space-between; align-items:center; }
</style>