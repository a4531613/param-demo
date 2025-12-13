<template>
  <el-card>
    <template #header>
      <div class="cc-toolbar">
        <div class="cc-toolbar__group">
          <el-input v-model="filters.keyword" placeholder="筛code / 名称过滤" clearable class="cc-control--md" />
          <el-select v-model="filters.appId" placeholder="应用" class="cc-control--sm">
            <el-option v-for="a in apps" :key="a.id" :label="`${a.app_name} (${a.app_code})`" :value="a.id" />
          </el-select>
          <el-select v-if="activeTab === 'types'" v-model="filters.groupId" placeholder="大类" class="cc-control--sm" clearable>
            <el-option v-for="g in groupOptions" :key="g.id" :label="`${g.group_name} (${g.group_code})`" :value="g.id" />
          </el-select>
        </div>
        <div class="cc-toolbar__group">
          <el-button v-if="activeTab === 'groups'" type="primary" @click="openGroupModal()" :disabled="!capabilities.canWrite">新增大类</el-button>
          <el-button v-else type="primary" @click="openTypeModal()" :disabled="!capabilities.canWrite">新增小类</el-button>
        </div>
      </div>
    </template>

    <el-tabs v-model="activeTab">
      <el-tab-pane name="groups" label="大类">
        <el-empty v-if="!groupFiltered.length" description="暂无大类，请先创建大类。" />
        <el-table v-else :data="groupFiltered" border class="cc-table-full">
          <el-table-column prop="id" label="ID" width="80" />
          <el-table-column prop="group_code" label="GroupCode" width="140" />
          <el-table-column prop="group_name" label="大类名称" />
          <el-table-column prop="app_name" label="应用" />
          <el-table-column prop="description" label="描述" />
          <el-table-column prop="enabled" label="启用" width="90">
            <template #default="s"><el-tag :type="s.row.enabled ? 'success' : 'info'">{{ s.row.enabled ? '是' : '否' }}</el-tag></template>
          </el-table-column>
          <el-table-column width="180" label="操作">
            <template #default="scope">
              <el-button link type="primary" @click="openGroupModal(scope.row)" :disabled="!capabilities.canWrite">编辑</el-button>
              <el-button link type="danger" @click="removeGroup(scope.row)" :disabled="!capabilities.canWrite">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane name="types" label="小类">
        <el-empty v-if="!typeFiltered.length" description="暂无小类，请先创建小类。" />
        <el-table v-else :data="typeFiltered" border class="cc-table-full">
          <el-table-column prop="id" label="ID" width="80" />
          <el-table-column prop="type_code" label="TypeCode" width="140" />
          <el-table-column prop="type_name" label="小类名称" />
          <el-table-column label="大类" width="180">
            <template #default="s">{{ s.row.group_name ? `${s.row.group_name} (${s.row.group_code})` : '-' }}</template>
          </el-table-column>
          <el-table-column prop="app_name" label="应用" />
          <el-table-column prop="description" label="描述" />
          <el-table-column prop="enabled" label="启用" width="90">
            <template #default="s"><el-tag :type="s.row.enabled ? 'success' : 'info'">{{ s.row.enabled ? '是' : '否' }}</el-tag></template>
          </el-table-column>
          <el-table-column width="180" label="操作">
            <template #default="scope">
              <el-button link type="primary" @click="openTypeModal(scope.row)" :disabled="!capabilities.canWrite">编辑</el-button>
              <el-button link type="danger" @click="removeType(scope.row)" :disabled="!capabilities.canWrite">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </el-card>

  <el-dialog v-model="groupModal.visible" :title="groupModal.editId ? '编辑大类' : '新增大类'" width="520px">
    <el-form :model="groupModal.form" label-width="110px">
      <el-form-item label="Group Code"><el-input v-model="groupModal.form.groupCode" disabled placeholder="自动生成" /></el-form-item>
      <el-form-item label="大类名称"><el-input v-model="groupModal.form.groupName" /></el-form-item>
      <el-form-item label="应用">
        <el-select v-model="groupModal.form.appId" placeholder="请选择应用">
          <el-option v-for="a in apps" :key="a.id" :label="`${a.app_name} (${a.app_code})`" :value="a.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="启用"><el-switch v-model="groupModal.form.enabled" /></el-form-item>
      <el-form-item label="描述"><el-input v-model="groupModal.form.description" type="textarea" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="groupModal.visible = false">取消</el-button>
      <el-button type="primary" @click="saveGroup">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="typeModal.visible" :title="typeModal.editId ? '编辑小类' : '新增小类'" width="520px">
    <el-form :model="typeModal.form" label-width="110px">
      <el-form-item label="Type Code"><el-input v-model="typeModal.form.typeCode" disabled placeholder="自动生成" /></el-form-item>
      <el-form-item label="小类名称"><el-input v-model="typeModal.form.typeName" /></el-form-item>
      <el-form-item label="应用">
        <el-select v-model="typeModal.form.appId" placeholder="请选择应用">
          <el-option v-for="a in apps" :key="a.id" :label="`${a.app_name} (${a.app_code})`" :value="a.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="大类">
        <el-select v-model="typeModal.form.groupId" placeholder="请选择大类">
          <el-option v-for="g in groupOptionsForModal" :key="g.id" :label="`${g.group_name} (${g.group_code})`" :value="g.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="启用"><el-switch v-model="typeModal.form.enabled" /></el-form-item>
      <el-form-item label="描述"><el-input v-model="typeModal.form.description" type="textarea" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="typeModal.visible = false">取消</el-button>
      <el-button type="primary" @click="saveType">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { api } from '../api';
import { capabilities } from '../userContext';
import { confirmAction, toastError, toastSuccess, toastWarning } from '../ui/feedback';

const props = defineProps({ types: { type: Array, default: () => [] } });
const emits = defineEmits(['refreshTypes']);

const activeTab = ref('types');
const apps = reactive([]);
const groups = reactive([]);
const filters = reactive({ keyword: '', appId: null, groupId: null });

const groupModal = reactive({
  visible: false,
  editId: null,
  form: { groupCode: '', groupName: '', appId: null, enabled: true, description: '' }
});

const typeModal = reactive({
  visible: false,
  editId: null,
  form: { typeCode: '', typeName: '', appId: null, groupId: null, enabled: true, description: '' }
});

const groupOptions = computed(() => groups.filter((g) => !filters.appId || g.app_id === filters.appId));
const groupOptionsForModal = computed(() => {
  const appId = typeModal.form.appId || filters.appId;
  return groups.filter((g) => !appId || g.app_id === appId);
});

const groupFiltered = computed(() => {
  const kw = filters.keyword.toLowerCase();
  return groups.filter((g) => {
    const okKw = !kw || String(g.group_code || '').toLowerCase().includes(kw) || String(g.group_name || '').toLowerCase().includes(kw);
    const okApp = !filters.appId || g.app_id === filters.appId;
    return okKw && okApp;
  });
});

const typeFiltered = computed(() => {
  const kw = filters.keyword.toLowerCase();
  return props.types.filter((t) => {
    const okKw = !kw || String(t.type_code || '').toLowerCase().includes(kw) || String(t.type_name || '').toLowerCase().includes(kw);
    const okApp = !filters.appId || t.app_id === filters.appId;
    const okGroup = !filters.groupId || t.group_id === filters.groupId;
    return okKw && okApp && okGroup;
  });
});

function ensureDefaults() {
  if (!filters.appId && apps.length) filters.appId = apps[0].id;
  if (!groupModal.form.appId && apps.length) groupModal.form.appId = apps[0].id;
  if (!typeModal.form.appId && apps.length) typeModal.form.appId = apps[0].id;
  if (filters.groupId && !groupOptions.value.some((g) => g.id === filters.groupId)) filters.groupId = null;
  if (typeModal.form.appId && typeModal.form.groupId && !groupOptionsForModal.value.some((g) => g.id === typeModal.form.groupId)) {
    typeModal.form.groupId = groupOptionsForModal.value[0]?.id || null;
  }
}

async function loadApps() {
  apps.splice(0, apps.length, ...(await api.listApps()));
  ensureDefaults();
}

async function loadGroups() {
  const params = filters.appId ? { appId: filters.appId } : {};
  groups.splice(0, groups.length, ...(await api.listTypeGroups(params)));
  ensureDefaults();
}

async function fillNextGroupCode() {
  try {
    const res = await api.nextTypeGroupCode({ appId: groupModal.form.appId || '' });
    groupModal.form.groupCode = res.next;
  } catch {
    groupModal.form.groupCode = '';
  }
}

async function fillNextTypeCode() {
  try {
    const res = await api.nextTypeCode();
    typeModal.form.typeCode = res.next;
  } catch {
    typeModal.form.typeCode = '';
  }
}

async function openGroupModal(row) {
  if (row) {
    groupModal.editId = row.id;
    groupModal.form = {
      groupCode: row.group_code,
      groupName: row.group_name,
      appId: row.app_id,
      enabled: !!row.enabled,
      description: row.description || ''
    };
  } else {
    groupModal.editId = null;
    groupModal.form = { groupCode: '', groupName: '', appId: filters.appId || apps[0]?.id || null, enabled: true, description: '' };
    await fillNextGroupCode();
  }
  ensureDefaults();
  groupModal.visible = true;
}

async function openTypeModal(row) {
  if (row) {
    typeModal.editId = row.id;
    typeModal.form = {
      typeCode: row.type_code,
      typeName: row.type_name,
      appId: row.app_id,
      groupId: row.group_id || null,
      enabled: !!row.enabled,
      description: row.description || ''
    };
  } else {
    typeModal.editId = null;
    typeModal.form = {
      typeCode: '',
      typeName: '',
      appId: filters.appId || apps[0]?.id || null,
      groupId: filters.groupId || null,
      enabled: true,
      description: ''
    };
    await fillNextTypeCode();
  }
  ensureDefaults();
  if (!typeModal.form.groupId) typeModal.form.groupId = groupOptionsForModal.value[0]?.id || null;
  typeModal.visible = true;
}

async function saveGroup() {
  if (!capabilities.value.canWrite) return toastWarning('当前角色为只读，无法操作');
  if (!groupModal.form.groupName || !groupModal.form.appId) return toastWarning('请填写大类名称并选择应用');
  const payload = { groupName: groupModal.form.groupName, description: groupModal.form.description, enabled: groupModal.form.enabled, appId: groupModal.form.appId };
  try {
    if (groupModal.editId) {
      await api.updateTypeGroup(groupModal.editId, payload);
      toastSuccess('大类已更新');
    } else {
      await api.createTypeGroup(payload);
      toastSuccess('大类已创建');
    }
    groupModal.visible = false;
    await loadGroups();
    emits('refreshTypes');
  } catch (e) {
    toastError(e, '保存失败');
  }
}

async function saveType() {
  if (!capabilities.value.canWrite) return toastWarning('当前角色为只读，无法操作');
  if (!typeModal.form.typeName || !typeModal.form.appId || !typeModal.form.groupId) return toastWarning('请填写小类名称并选择应用与大类');
  const payload = { typeName: typeModal.form.typeName, description: typeModal.form.description, enabled: typeModal.form.enabled, appId: typeModal.form.appId, groupId: typeModal.form.groupId };
  try {
    if (typeModal.editId) {
      await api.updateType(typeModal.editId, payload);
      toastSuccess('小类已更新');
    } else {
      await api.createType(payload);
      toastSuccess('小类已创建');
    }
    typeModal.visible = false;
    emits('refreshTypes');
  } catch (e) {
    toastError(e, '保存失败');
  }
}

async function removeGroup(row) {
  if (!capabilities.value.canWrite) return toastWarning('当前角色为只读，无法操作');
  try {
    await confirmAction('确认删除该大类？（已关联的小类将显示为未分组）', '提示');
    await api.deleteTypeGroup(row.id);
    toastSuccess('大类已删除');
    await loadGroups();
    emits('refreshTypes');
  } catch (e) {
    toastError(e, '删除失败');
  }
}

async function removeType(row) {
  if (!capabilities.value.canWrite) return toastWarning('当前角色为只读，无法操作');
  try {
    await confirmAction('确认删除该小类？', '提示');
    await api.deleteType(row.id);
    toastSuccess('小类已删除');
    emits('refreshTypes');
  } catch (e) {
    toastError(e, '删除失败');
  }
}

watch(
  () => filters.appId,
  () => {
    filters.groupId = null;
    ensureDefaults();
    loadGroups();
  }
);

loadApps().then(loadGroups);
</script>

