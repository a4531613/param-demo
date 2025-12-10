<template>
  <el-card>
    <template #header>
      <div class="toolbar">
        <el-select v-model="state.versionId" placeholder="选择版本" style="width:260px;" @change="load">
          <el-option v-for="v in versions" :key="v.id" :label="`${v.version_no} (${v.status})`" :value="v.id" />
        </el-select>
        <el-button type="primary" @click="openModal">新增字段</el-button>
      </div>
    </template>
    <el-table :data="fields" border>
      <el-table-column prop="field_code" label="字段标识" />
      <el-table-column prop="field_name" label="名称" />
      <el-table-column prop="data_type" label="类型" width="120" />
      <el-table-column prop="required" label="必填" width="80">
        <template #default="s"><el-tag :type="s.row.required ? 'danger' : 'info'">{{ s.row.required ? '是' : '否' }}</el-tag></template>
      </el-table-column>
      <el-table-column prop="validate_rule" label="校验规则" />
    </el-table>
  </el-card>

  <el-dialog v-model="modal.visible" title="新增字段" width="520px">
    <el-form :model="modal.form" label-width="120px">
      <el-form-item label="字段标识"><el-input v-model="modal.form.fieldCode" /></el-form-item>
      <el-form-item label="字段名称"><el-input v-model="modal.form.fieldName" /></el-form-item>
      <el-form-item label="数据类型">
        <el-select v-model="modal.form.dataType">
          <el-option label="string" value="string" /><el-option label="number" value="number" />
          <el-option label="boolean" value="boolean" /><el-option label="date" value="date" />
          <el-option label="datetime" value="datetime" /><el-option label="enum" value="enum" />
          <el-option label="json" value="json" />
        </el-select>
      </el-form-item>
      <el-form-item label="必填"><el-switch v-model="modal.form.required" /></el-form-item>
      <el-form-item label="最大长度"><el-input-number v-model="modal.form.maxLength" :min="0" /></el-form-item>
      <el-form-item label="校验规则"><el-input v-model="modal.form.validateRule" placeholder="正则/范围" /></el-form-item>
      <el-form-item label="枚举值(JSON)"><el-input v-model="modal.form.enumOptions" type="textarea" placeholder='["A","B"]' /></el-form-item>
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
const fields = ref([]);
const state = reactive({ versionId: null });
const modal = reactive({
  visible: false,
  form: { fieldCode: '', fieldName: '', dataType: 'string', required: true, maxLength: null, validateRule: '', enumOptions: '' }
});

async function load() {
  if (!state.versionId) return;
  fields.value = await api.listFields(state.versionId);
}

function openModal() {
  if (!state.versionId) return ElMessage.warning('请选择版本');
  modal.form = { fieldCode: '', fieldName: '', dataType: 'string', required: true, maxLength: null, validateRule: '', enumOptions: '' };
  modal.visible = true;
}

async function save() {
  if (!state.versionId) return;
  if (!modal.form.fieldCode || !modal.form.fieldName) {
    ElMessage.warning('请填写字段标识/名称');
    return;
  }
  const payload = { ...modal.form };
  if (payload.enumOptions) {
    try { payload.enumOptions = JSON.parse(payload.enumOptions); } catch (e) { ElMessage.error('枚举值需为 JSON'); return; }
  }
  await api.createField(state.versionId, payload);
  modal.visible = false;
  await load();
}
</script>

<style scoped>
.toolbar { display:flex; justify-content: space-between; align-items:center; }
</style>
