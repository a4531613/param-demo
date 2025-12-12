<template>
  <el-card>
    <template #header>
      <div class="cc-toolbar">
        <div class="cc-toolbar__group">
          <el-select v-model="state.a" placeholder="版本A" class="cc-control--lg">
          <el-option v-for="v in versions" :key="v.id" :label="`${v.version_no} (${v.status})`" :value="v.id" />
          </el-select>
          <el-select v-model="state.b" placeholder="版本B" class="cc-control--lg">
          <el-option v-for="v in versions" :key="v.id" :label="`${v.version_no} (${v.status})`" :value="v.id" />
          </el-select>
          <el-button type="primary" @click="load">对比</el-button>
        </div>
      </div>
    </template>
    <el-row :gutter="12">
      <el-col :span="12">
        <h4>字段变化</h4>
        <el-descriptions title="新增字段" v-if="diff.fields.added.length">
          <el-descriptions-item v-for="f in diff.fields.added" :key="f.field_code" :label="f.field_code">{{ f.data_type }}</el-descriptions-item>
        </el-descriptions>
        <el-descriptions title="删除字段" v-if="diff.fields.removed.length">
          <el-descriptions-item v-for="f in diff.fields.removed" :key="f.field_code" :label="f.field_code">{{ f.data_type }}</el-descriptions-item>
        </el-descriptions>
      </el-col>
      <el-col :span="12">
        <h4>数据变化</h4>
        <el-descriptions title="新增记录" v-if="diff.data.added.length">
          <el-descriptions-item v-for="f in diff.data.added" :key="f.key_value" :label="f.key_value">新增</el-descriptions-item>
        </el-descriptions>
        <el-descriptions title="删除记录" v-if="diff.data.removed.length">
          <el-descriptions-item v-for="f in diff.data.removed" :key="f.key_value" :label="f.key_value">删除</el-descriptions-item>
        </el-descriptions>
      </el-col>
    </el-row>
  </el-card>
</template>

<script setup>
import { reactive } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';

const props = defineProps({ versions: { type: Array, default: () => [] } });
const diff = reactive({ fields: { added: [], removed: [], changed: [] }, data: { added: [], removed: [], changed: [] } });
const state = reactive({ a: null, b: null });

async function load() {
  if (!state.a || !state.b) return ElMessage.warning('请选择两个版本');
  const res = await api.diffVersions(state.a, state.b);
  diff.fields = res.fields;
  diff.data = res.data;
}
</script>
