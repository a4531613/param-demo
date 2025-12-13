<template>
  <el-card>
    <template #header>
      <div class="cc-toolbar">
        <div class="cc-toolbar__group">
          <el-select v-model="filters.appId" placeholder="应用" clearable class="cc-control--sm">
            <el-option v-for="a in apps" :key="a.id" :label="a.app_name" :value="a.id" />
          </el-select>
          <el-select v-model="filters.status" placeholder="状态" clearable class="cc-control--xs">
            <el-option label="待发布" value="PENDING_RELEASE" />
            <el-option label="已发布" value="RELEASED" />
            <el-option label="已归档" value="ARCHIVED" />
          </el-select>
        </div>
        <el-button type="primary" @click="openModal()" :disabled="!capabilities.canWrite">新增版本</el-button>
      </div>
    </template>

    <el-empty v-if="!versions.length" description="暂无版本，请先创建版本。" />
    <el-table v-else :data="versions" border :row-key="(row) => row.id">
      <el-table-column prop="version_no" label="版本号" width="160" />
      <el-table-column label="应用" width="200">
        <template #default="s">{{ appLabel(s.row.app_id) }}</template>
      </el-table-column>
      <el-table-column label="状态" min-width="360">
        <template #default="scope">
          <el-radio-group
            :model-value="scope.row.status"
            size="small"
            @change="(v) => onStatusToggle(scope.row, v)"
          >
            <el-radio-button value="PENDING_RELEASE" :disabled="!canGo(scope.row.status, 'PENDING_RELEASE') && scope.row.status !== 'PENDING_RELEASE'">待发布</el-radio-button>
            <el-radio-button value="RELEASED" :disabled="!canGo(scope.row.status, 'RELEASED') && scope.row.status !== 'RELEASED'">已发布</el-radio-button>
            <el-radio-button value="ARCHIVED" :disabled="!canGo(scope.row.status, 'ARCHIVED') && scope.row.status !== 'ARCHIVED'">已归档</el-radio-button>
          </el-radio-group>
        </template>
      </el-table-column>
      <el-table-column prop="enabled" label="启用" width="80">
        <template #default="s"><el-tag :type="s.row.enabled ? 'success' : 'info'">{{ s.row.enabled ? '是' : '否' }}</el-tag></template>
      </el-table-column>
      <el-table-column prop="effective_from" label="开始时间" width="180" />
      <el-table-column prop="effective_to" label="结束时间" width="180" />
      <el-table-column prop="description" label="描述" />
      <el-table-column prop="create_user" label="创建人" width="120" />
      <el-table-column prop="create_time" label="创建时间" width="180" />
      <el-table-column prop="update_user" label="更新人" width="120" />
      <el-table-column prop="update_time" label="更新时间" width="180" />
      <el-table-column label="更多" width="160">
        <template #default="scope">
          <el-button link type="primary" @click="openModal(scope.row)" :disabled="!capabilities.canWrite || scope.row.status !== 'PENDING_RELEASE'">编辑</el-button>
          <el-button link type="danger" @click="remove(scope.row)" :disabled="!capabilities.canWrite || scope.row.status !== 'PENDING_RELEASE'">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="modal.visible" :title="modal.editId ? '编辑版本' : '新增版本'" width="520px">
    <el-form :model="modal.form" label-width="120px">
      <el-form-item label="应用">
        <el-select v-model="modal.form.appId" filterable :disabled="!!modal.editId">
          <el-option v-for="a in apps" :key="a.id" :label="a.app_name" :value="a.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="版本号"><el-input v-model="modal.form.versionNo" /></el-form-item>
      <el-form-item label="描述"><el-input v-model="modal.form.description" type="textarea" /></el-form-item>
      <el-form-item label="开始时间"><el-date-picker v-model="modal.form.effectiveFrom" type="datetime" class="cc-control--full" /></el-form-item>
      <el-form-item label="结束时间"><el-date-picker v-model="modal.form.effectiveTo" type="datetime" class="cc-control--full" /></el-form-item>
      <el-form-item label="启用"><el-switch v-model="modal.form.enabled" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="modal.visible = false">取消</el-button>
      <el-button type="primary" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, onMounted, watch } from 'vue';
import { api } from '../api';
import { capabilities } from '../userContext';
import { confirmAction, toastError, toastSuccess, toastWarning } from '../ui/feedback';

const emit = defineEmits(['refreshVersions']);

const apps = reactive([]);
const versions = reactive([]);
const filters = reactive({ appId: null, status: '' });
const modal = reactive({ visible: false, editId: null, form: { appId: null, versionNo: '', description: '', effectiveFrom: '', effectiveTo: '', enabled: true } });

const statusLabelMap = { PENDING_RELEASE: '待发布', RELEASED: '已发布', ARCHIVED: '已归档' };
const tagType = (s) => (s === 'RELEASED' ? 'success' : s === 'PENDING_RELEASE' ? 'warning' : s === 'ARCHIVED' ? 'info' : '');
const statusLabel = (s) => statusLabelMap[s] || s;

const appById = computed(() => new Map(apps.map((a) => [a.id, a.app_name])));
const appLabel = (appId) => appById.value.get(appId) || '';

function stepIndex(status) {
  if (status === 'PENDING_RELEASE') return 0;
  if (status === 'RELEASED') return 1;
  if (status === 'ARCHIVED') return 2;
  return 0;
}

function canGo(current, target) {
  if (!capabilities.value.canWrite) return false;
  if (!current || !target) return false;
  if (current === target) return false;
  if (current === 'PENDING_RELEASE' && target === 'RELEASED') return true;
  if (current === 'RELEASED' && (target === 'ARCHIVED' || target === 'PENDING_RELEASE')) return true;
  if (current === 'ARCHIVED' && target === 'RELEASED') return true;
  return false;
}

async function onStatusToggle(row, targetStatus) {
  if (!targetStatus || row.status === targetStatus) return;
  if (!canGo(row.status, targetStatus)) return;
  const from = statusLabel(row.status);
  const to = statusLabel(targetStatus);
  try {
    await confirmAction(`确认将版本状态从“${from}”调整为“${to}”？`, '提示');
    await api.updateVersion(row.id, { status: targetStatus });
    toastSuccess(`状态已更新为 ${to}`);
    await loadVersions();
  } catch (e) {
    toastError(e, '状态更新失败');
  }
}

async function loadRefs() {
  try {
    apps.splice(0, apps.length, ...(await api.listApps()));
    if (!filters.appId && apps.length) filters.appId = apps[0].id;
  } catch (e) {
    toastError(e, '加载应用失败');
  }
}

async function loadVersions() {
  try {
    const params = {};
    if (filters.appId) params.appId = filters.appId;
    if (filters.status) params.status = filters.status;
    const list = await api.listVersionsAll(params);
    versions.splice(0, versions.length, ...(list || []));
    emit('refreshVersions');
  } catch (e) {
    toastError(e, '加载版本失败');
  }
}

function openModal(row) {
  if (row) {
    modal.editId = row.id;
    modal.form = {
      appId: row.app_id,
      versionNo: row.version_no,
      description: row.description || '',
      effectiveFrom: row.effective_from || '',
      effectiveTo: row.effective_to || '',
      enabled: !!row.enabled
    };
  } else {
    modal.editId = null;
    modal.form = { appId: filters.appId || apps[0]?.id || null, versionNo: '', description: '', effectiveFrom: '', effectiveTo: '', enabled: true };
  }
  modal.visible = true;
}

async function save() {
  if (!capabilities.value.canWrite) return toastWarning('当前角色为只读，无法操作');
  if (!modal.form.appId || !modal.form.versionNo) return toastWarning('请填写应用与版本号');
  try {
    if (modal.editId) {
      await api.updateVersion(modal.editId, {
        versionNo: modal.form.versionNo,
        description: modal.form.description,
        effectiveFrom: modal.form.effectiveFrom,
        effectiveTo: modal.form.effectiveTo,
        enabled: modal.form.enabled
      });
      toastSuccess('版本已更新');
    } else {
      await api.createVersionGlobal({
        appId: modal.form.appId,
        versionNo: modal.form.versionNo,
        description: modal.form.description,
        enabled: modal.form.enabled
      });
      toastSuccess('版本已创建');
    }
    modal.visible = false;
    await loadVersions();
  } catch (e) {
    toastError(e, '保存失败');
  }
}

async function setStatus(row, status) {
  if (!capabilities.value.canWrite) return toastWarning('当前角色为只读，无法操作');
  try {
    await api.updateVersion(row.id, { status });
    toastSuccess(`状态已更新为 ${statusLabel(status)}`);
    await loadVersions();
  } catch (e) {
    toastError(e, '状态更新失败');
  }
}

async function remove(row) {
  if (!capabilities.value.canWrite) return toastWarning('当前角色为只读，无法操作');
  try {
    await confirmAction('确认删除该版本？', '提示');
    await api.deleteVersion(row.id);
    toastSuccess('版本已删除');
    await loadVersions();
  } catch (e) {
    toastError(e, '删除失败');
  }
}

onMounted(async () => {
  await loadRefs();
  await loadVersions();
});

watch(() => filters.appId, loadVersions);
watch(() => filters.status, loadVersions);
</script>
