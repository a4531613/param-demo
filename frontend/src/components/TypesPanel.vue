<template>
  <el-card>
    <template #header>
      <div class="toolbar">
        <div>
          <el-input v-model="filters.keyword" placeholder="按 code / 名称过滤" style="width:220px;" clearable />
          <el-select v-model="filters.env" placeholder="环境" clearable style="width:120px; margin-left:8px;">
            <el-option label="dev" value="dev" />
            <el-option label="test" value="test" />
            <el-option label="pre" value="pre" />
            <el-option label="prod" value="prod" />
          </el-select>
        </div>
        <el-button type="primary" @click="openModal()">新增类型</el-button>
      </div>
    </template>
    <el-table :data="filtered" border style="width:100%;">
      <el-table-column prop="type_code" label="TypeCode" />
      <el-table-column prop="type_name" label="名称" />
      <el-table-column prop="app_code" label="应用" />
      <el-table-column prop="env" label="环境" />
      <el-table-column prop="description" label="描述" />
      <el-table-column width="180" label="操作">
        <template #default="scope">
          <el-button link type="primary" @click="openModal(scope.row)">编辑</el-button>
          <el-button link type="danger" @click="remove(scope.row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="modal.visible" :title="modal.editId ? '编辑类型' : '新增类型'" width="480px">
    <el-form :model="modal.form" label-width="110px">
      <el-form-item label="Type Code"><el-input v-model="modal.form.typeCode" :disabled="!!modal.editId" /></el-form-item>
      <el-form-item label="Type 名称"><el-input v-model="modal.form.typeName" /></el-form-item>
      <el-form-item label="应用"><el-input v-model="modal.form.appCode" /></el-form-item>
      <el-form-item label="环境">
        <el-select v-model="modal.form.env">
          <el-option label="dev" value="dev" />
          <el-option label="test" value="test" />
          <el-option label="pre" value="pre" />
          <el-option label="prod" value="prod" />
        </el-select>
      </el-form-item>
      <el-form-item label="描述"><el-input v-model="modal.form.description" type="textarea" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="modal.visible = false">取消</el-button>
      <el-button type="primary" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, watch } from 'vue';
import { ElMessageBox, ElMessage } from 'element-plus';
import { api } from '../api';

const props = defineProps({ types: { type: Array, default: () => [] } });
const emits = defineEmits(['refreshTypes']);

const filters = reactive({ keyword: '', env: '' });
const modal = reactive({
  visible: false,
  editId: null,
  form: { typeCode: '', typeName: '', appCode: '', env: 'prod', description: '' }
});

const filtered = computed(() => {
  return props.types.filter((t) => {
    const kw = filters.keyword.toLowerCase();
    const okKw = !kw || t.type_code.toLowerCase().includes(kw) || (t.type_name || '').toLowerCase().includes(kw);
    const okEnv = !filters.env || t.env === filters.env;
    return okKw && okEnv;
  });
});

function openModal(row) {
  if (row) {
    modal.editId = row.id;
    modal.form = { typeCode: row.type_code, typeName: row.type_name, appCode: row.app_code, env: row.env, description: row.description || '' };
  } else {
    modal.editId = null;
    modal.form = { typeCode: '', typeName: '', appCode: '', env: 'prod', description: '' };
  }
  modal.visible = true;
}

async function save() {
  if (!modal.form.typeCode || !modal.form.typeName) {
    ElMessage.warning('请填写必填项');
    return;
  }
  if (modal.editId) {
    await api.updateType(modal.editId, { typeName: modal.form.typeName, description: modal.form.description, enabled: true });
  } else {
    await api.createType(modal.form);
  }
  modal.visible = false;
  emits('refreshTypes');
}

async function remove(row) {
  await ElMessageBox.confirm('确认删除该类型？', '提示');
  await api.deleteType(row.id);
  emits('refreshTypes');
}

watch(
  () => props.types,
  () => {
    // keep filtered reactive
  }
);
</script>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>
