<template>
  <el-card>
    <template #header>
      <div class="cc-toolbar">
        <div class="cc-toolbar__group">
        <el-select v-model="filters.appId" placeholder="应用" class="cc-control--sm">
          <el-option v-for="a in apps" :key="a.id" :label="`${a.app_name} (${a.app_code})`" :value="a.id" />
        </el-select>
        <div class="cc-tag-group" v-if="typeOptions.length">
          <span class="cc-tag-label">配置类型</span>
          <el-check-tag
            v-for="t in typeOptions"
            :key="t.id"
            :checked="filters.typeId === t.id"
            @click="filters.typeId = t.id"
          >
            {{ `${t.type_name} (${t.type_code})` }}
          </el-check-tag>
        </div>
        <el-input v-model="filters.keyword" placeholder="按字段Key/名称过滤" clearable class="cc-control--md" />
        </div>
        <el-button type="primary" @click="openModal()" :disabled="!capabilities.canWrite">新增字段</el-button>
      </div>
    </template>
    <el-empty v-if="!rowsFiltered.length" description="暂无字段，请先创建字段。" />
    <el-table v-else :data="rowsFiltered" border class="cc-table-full" :row-key="row => row.id" ref="tableRef">
      <el-table-column label="排序" width="80">
        <template #default="scope">
          <span class="drag-handle">☰</span> {{ scope.row.sort_order ?? '-' }}
        </template>
      </el-table-column>
      <el-table-column prop="id" label="字段ID" width="90" />
      <el-table-column prop="field_code" label="字段Key" width="140" />
      <el-table-column prop="field_name" label="字段名称" />
      <!-- 配置类型ID隐藏 -->
      <el-table-column label="字段类型" width="140">
        <template #default="s">{{ fieldTypeLabel(s.row) }}</template>
      </el-table-column>
      <el-table-column prop="max_length" label="长度" width="80" />
      <el-table-column prop="required" label="必填" width="70">
        <template #default="s"><el-tag :type="s.row.required ? 'danger' : 'info'">{{ s.row.required ? '是' : '否' }}</el-tag></template>
      </el-table-column>
      <el-table-column prop="validate_rule" label="正则约束" />
      <!-- 应用ID、类型ID隐藏 -->
      <el-table-column prop="enabled" label="启用" width="80">
        <template #default="s"><el-tag :type="s.row.enabled ? 'success' : 'info'">{{ s.row.enabled ? '是' : '否' }}</el-tag></template>
      </el-table-column>
      <el-table-column prop="create_user" label="创建人" width="120" />
      <el-table-column prop="create_time" label="创建时间" width="180" />
      <el-table-column prop="update_user" label="更新人" width="120" />
      <el-table-column prop="update_time" label="更新时间" width="180" />
      <el-table-column label="操作" width="160">
        <template #default="scope">
          <el-button link type="primary" @click="openModal(scope.row)" :disabled="!capabilities.canWrite">编辑</el-button>
          <el-button link type="danger" @click="remove(scope.row)" :disabled="!capabilities.canWrite">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="modal.visible" :title="modal.editId ? '编辑字段' : '新增字段'" width="540px">
    <el-form :model="modal.form" label-width="130px">
      <el-form-item label="所属应用">
        <el-select v-model="modal.form.appId" :disabled="true">
          <el-option v-for="a in apps" :key="a.id" :label="`${a.app_name} (${a.app_code})`" :value="a.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="类型"><el-select v-model="modal.form.typeId" filterable :disabled="true">
        <el-option v-for="t in modalTypeOptions" :key="t.id" :label="`${t.type_name} (${t.type_code})`" :value="t.id" />
      </el-select></el-form-item>
      <el-form-item label="字段Key"><el-input v-model="modal.form.fieldCode" :disabled="!!modal.editId" /></el-form-item>
      <el-form-item label="字段名称"><el-input v-model="modal.form.fieldName" /></el-form-item>
      <el-form-item label="字段类型">
        <el-select v-model="modal.form.fieldType" placeholder="请选择">
          <el-option label="自动(按数据类型)" value="" />
          <el-option-group label="输入类">
            <el-option label="Input：单行输入框" value="Input" />
            <el-option label="Textarea：多行输入" value="Textarea" />
            <el-option label="NumberInput：数字输入" value="NumberInput" />
            <el-option label="Password：密码输入" value="Password" />
          </el-option-group>
          <el-option-group label="选择类">
            <el-option label="Select：下拉单选" value="Select" />
            <el-option label="MultiSelect：下拉多选" value="MultiSelect" />
            <el-option label="Radio：单选按钮" value="Radio" />
            <el-option label="Checkbox：多选框" value="Checkbox" />
          </el-option-group>
        </el-select>
      </el-form-item>
      <el-form-item label="数据类型" v-if="!modal.form.fieldType">
        <el-select v-model="modal.form.dataType">
          <el-option label="string" value="string" />
          <el-option label="number" value="number" />
          <el-option label="boolean" value="boolean" />
          <el-option label="date" value="date" />
          <el-option label="datetime" value="datetime" />
          <el-option label="enum" value="enum" />
          <el-option label="json" value="json" />
        </el-select>
      </el-form-item>
      <el-form-item label="数据类型" v-else>
        <el-input :model-value="derivedDataType" disabled />
      </el-form-item>
      <el-form-item label="长度"><el-input-number v-model="modal.form.maxLength" :min="0" /></el-form-item>
      <el-form-item label="必填"><el-switch v-model="modal.form.required" /></el-form-item>
      <el-form-item label="正则约束"><el-input v-model="modal.form.validateRule" /></el-form-item>
      <el-form-item label="枚举值(JSON)" v-if="needsEnumOptions(modal.form.fieldType) || modal.form.dataType === 'enum'">
        <el-input v-model="modal.form.enumOptions" type="textarea" placeholder='["A","B"]' />
      </el-form-item>
      <el-form-item label="启用"><el-switch v-model="modal.form.enabled" /></el-form-item>
      <el-form-item label="描述"><el-input v-model="modal.form.description" type="textarea" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="modal.visible=false">取消</el-button>
      <el-button type="primary" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, onMounted, reactive, watch, nextTick, ref } from 'vue';
import { api } from '../api';
import { capabilities } from '../userContext';
import { confirmAction, toastError, toastSuccess, toastWarning } from '../ui/feedback';

const apps = reactive([]);
const types = reactive([]);
const rows = reactive([]);
const tableRef = ref(null);
const filters = reactive({ appId: null, typeId: null, keyword: '' });
const modal = reactive({
  visible: false,
  editId: null,
  form: { appId: null, typeId: null, fieldCode: '', fieldName: '', fieldType: 'Input', dataType: 'string', maxLength: null, required: true, validateRule: '', enumOptions: '', enabled: true, description: '' }
});

function inferDataTypeByFieldType(fieldType) {
  if (fieldType === 'NumberInput') return 'number';
  if (fieldType === 'Select' || fieldType === 'Radio') return 'enum';
  if (fieldType === 'MultiSelect' || fieldType === 'Checkbox') return 'json';
  if (fieldType === 'Input' || fieldType === 'Textarea' || fieldType === 'Password') return 'string';
  return null;
}

function needsEnumOptions(fieldType) {
  return fieldType === 'Select' || fieldType === 'MultiSelect' || fieldType === 'Radio' || fieldType === 'Checkbox';
}

function fieldTypeLabel(row) {
  if (row.field_type) return row.field_type;
  if (row.data_type === 'string') return 'Input';
  if (row.data_type === 'number') return 'NumberInput';
  if (row.data_type === 'enum') return 'Select';
  return row.data_type || '-';
}

const derivedDataType = computed(() => {
  if (!modal.form.fieldType) return modal.form.dataType;
  return inferDataTypeByFieldType(modal.form.fieldType) || modal.form.dataType;
});

const typeOptions = computed(() =>
  types.filter(
    (t) =>
      (!filters.appId || t.app_id === filters.appId)
  )
);
const modalTypeOptions = computed(() =>
  types.filter(
    (t) =>
      (!modal.form.appId || t.app_id === modal.form.appId)
  )
);

const rowsFiltered = computed(() => {
  const kw = filters.keyword.toLowerCase();
  return rows.filter((r) => {
    const okApp = !filters.appId || r.app_id === filters.appId;
    const okType = !filters.typeId || r.type_id === filters.typeId;
    const okKw = !kw || r.field_code.toLowerCase().includes(kw) || (r.field_name || '').toLowerCase().includes(kw);
    return okApp && okType && okKw;
  });
});

function ensureDefaults() {
  if (!filters.appId && apps.length) filters.appId = apps[0].id;
  if (!typeOptions.value.find((t) => t.id === filters.typeId)) {
    filters.typeId = typeOptions.value[0]?.id || null;
  }
}

async function loadRefs() {
  try {
    apps.splice(0, apps.length, ...(await api.listApps()));
  } catch (e) {
    toastError(e, 'Failed to load apps');
  }
  try {
    types.splice(0, types.length, ...(await api.listTypes()));
  } catch (e) {
    toastError(e, 'Failed to load types');
  }
  ensureDefaults();
}

async function loadFields() {
  const params = {};
  if (filters.appId) params.appId = filters.appId;
  if (filters.typeId) params.typeId = filters.typeId;
  const list = await api.listFieldsAll(params);
  rows.splice(0, rows.length, ...list.map((r, idx) => ({ ...r, sort_order: r.sort_order ?? idx })));
  nextTick(applyRowDrag);
}

function openModal(row) {
  if (row) {
    modal.editId = row.id;
    modal.form = {
      appId: row.app_id,
      typeId: row.type_id,
      fieldCode: row.field_code,
      fieldName: row.field_name,
      fieldType: row.field_type || '',
      dataType: row.data_type,
      maxLength: row.max_length,
      required: !!row.required,
      validateRule: row.validate_rule || '',
      enumOptions: row.enum_options || '',
      enabled: !!row.enabled,
      description: row.description || ''
    };
  } else {
    modal.editId = null;
    modal.form = {
      appId: filters.appId || (apps[0] && apps[0].id) || null,
      typeId: filters.typeId || (typeOptions.value[0] && typeOptions.value[0].id) || null,
      fieldCode: '',
      fieldName: '',
      fieldType: 'Input',
      dataType: 'string',
      maxLength: null,
      required: true,
      validateRule: '',
      enumOptions: '',
      enabled: true,
      description: ''
    };
  }
  ensureModalDefaults();
  modal.visible = true;
}

async function save() {
  if (!capabilities.value.canWrite) return toastWarning('当前角色为只读，无法操作');
  if (!modal.form.typeId || !modal.form.fieldCode || !modal.form.fieldName) return toastWarning('请填写必填项（类型/字段标识/名称）');
  const payload = { ...modal.form };
  payload.fieldType = payload.fieldType || null;
  payload.dataType = payload.fieldType ? (inferDataTypeByFieldType(payload.fieldType) || payload.dataType) : payload.dataType;
  const shouldHaveEnums = needsEnumOptions(payload.fieldType) || payload.dataType === 'enum';
  if (shouldHaveEnums && !payload.enumOptions) return toastWarning('Enum options required');
  if (payload.enumOptions) {
    try { payload.enumOptions = JSON.parse(payload.enumOptions); } catch (e) { return toastWarning('枚举值需为 JSON'); }
  }
  if (shouldHaveEnums && (!Array.isArray(payload.enumOptions) || !payload.enumOptions.length)) {
    return toastWarning('Enum options must be a non-empty JSON array');
  }
  try {
    if (modal.editId) {
      await api.updateField(modal.editId, payload);
      toastSuccess('字段已更新');
    } else {
      await api.createFieldGlobal(payload);
      toastSuccess('字段已创建');
    }
    modal.visible = false;
    await loadFields();
  } catch (e) {
    toastError(e, '保存失败');
  }
}

async function remove(row) {
  if (!capabilities.value.canWrite) return toastWarning('当前角色为只读，无法操作');
  try {
    await confirmAction('确认删除该字段？', '提示');
    await api.deleteField(row.id);
    toastSuccess('字段已删除');
    await loadFields();
  } catch (e) {
    toastError(e, '删除失败');
  }
}

onMounted(async () => {
  await loadRefs();
  await loadFields();
  nextTick(applyRowDrag);
});

watch(
  () => filters.appId,
  async () => {
    ensureDefaults();
    await loadFields();
    nextTick(applyRowDrag);
  }
);

watch(
  () => filters.typeId,
  async () => {
    await loadFields();
    nextTick(applyRowDrag);
  }
);

watch(
  () => modal.form.appId,
  () => {
    ensureModalDefaults();
  }
);

watch(
  () => modal.form.fieldType,
  (v) => {
    if (!v) return;
    const inferred = inferDataTypeByFieldType(v);
    if (inferred) modal.form.dataType = inferred;
  }
);

watch(
  () => rowsFiltered.value.length,
  () => nextTick(applyRowDrag)
);

function ensureModalDefaults() {
  if (!modal.form.appId && apps.length) modal.form.appId = apps[0].id;
  if (!modalTypeOptions.value.find((t) => t.id === modal.form.typeId)) {
    modal.form.typeId = modalTypeOptions.value[0]?.id || null;
  }
}

function applyRowDrag() {
  const table = tableRef.value?.$el?.querySelector('.el-table__body-wrapper tbody');
  const data = tableRef.value?.store?.states?.data?.value || tableRef.value?.store?.states?.data || [];
  if (!table || !data.length) return;
  const trs = Array.from(table.querySelectorAll('tr'));
  trs.forEach((tr, idx) => {
    tr.draggable = true;
    const row = data[idx];
    if (!row) return;
    tr.setAttribute('data-row-key', row.id);
    tr.ondragstart = (e) => {
      e.dataTransfer.effectAllowed = 'move';
      dragState.fromId = row.id;
      dragState.fromIndex = idx;
    };
    tr.ondragover = (e) => e.preventDefault();
    tr.ondrop = (e) => {
      e.preventDefault();
      const toIndex = idx;
      if (dragState.fromIndex === null || dragState.fromIndex === toIndex) return;
      reorderRows(dragState.fromIndex, toIndex, data);
      dragState.fromId = null;
      dragState.fromIndex = null;
    };
  });
}

const dragState = reactive({ fromId: null, fromIndex: null });

function reorderRows(fromIndex, toIndex, currentData) {
  const current = currentData.slice();
  const [moved] = current.splice(fromIndex, 1);
  current.splice(toIndex, 0, moved);
  const beforeSort = new Map(rows.map((r) => [r.id, r.sort_order ?? 0]));
  current.forEach((r, idx) => { r.sort_order = idx; });
  // apply new sort back to master list
  current.forEach((item) => {
    const target = rows.find((r) => r.id === item.id);
    if (target) target.sort_order = item.sort_order;
  });
  rows.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  persistSortOrder(current, beforeSort);
}

async function persistSortOrder(list, beforeSort) {
  const changed = list.filter((r) => beforeSort.get(r.id) !== r.sort_order);
  for (const r of changed) {
    await api.updateField(r.id, { sortOrder: r.sort_order });
  }
}
</script>

<style scoped>
.drag-handle { cursor:grab; user-select:none; }
</style>
