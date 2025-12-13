<template>
  <el-card>
    <template #header>
      <div class="cc-toolbar cc-toolbar--start">
        <div class="cc-toolbar__group">
          <el-tag type="info">主路径</el-tag>
          <span class="cc-overview__hint">建议按顺序完成初始化，减少后续返工。</span>
        </div>
      </div>
    </template>

    <el-steps direction="vertical" :active="activeStep" finish-status="success" class="cc-overview__steps">
      <el-step title="创建应用" description="建立应用归属，用于隔离类型/环境/版本。">
        <template #description>
          <div class="cc-overview__desc">
            <div>建立应用归属，用于隔离类型/环境/版本。</div>
            <el-button type="primary" @click="go('apps')">去创建应用</el-button>
          </div>
        </template>
      </el-step>
      <el-step title="创建环境" description="为应用添加 dev/test/prod 等环境。">
        <template #description>
          <div class="cc-overview__desc">
            <div>为应用添加 dev/test/prod 等环境。</div>
            <el-button @click="go('envs')">去创建环境</el-button>
          </div>
        </template>
      </el-step>
      <el-step title="创建配置类型" description="定义类型名称，作为字段与数据承载。">
        <template #description>
          <div class="cc-overview__desc">
            <div>定义类型名称，作为字段与数据承载。</div>
            <el-button @click="go('types')">去创建类型</el-button>
          </div>
        </template>
      </el-step>
      <el-step title="创建版本并发布" description="版本是变更载体，支持发布/归档。">
        <template #description>
          <div class="cc-overview__desc">
            <div>版本是变更载体，支持发布/归档。</div>
            <el-button @click="go('versions')">去版本管理</el-button>
          </div>
        </template>
      </el-step>
      <el-step title="维护字段" description="字段结构决定录入/预览/导出的展示与校验。">
        <template #description>
          <div class="cc-overview__desc">
            <div>字段结构决定录入/预览/导出的展示与校验。</div>
            <el-button @click="go('fieldsManage')">去字段管理</el-button>
          </div>
        </template>
      </el-step>
      <el-step title="维护配置数据" description="在指定版本/环境/类型下维护 Key 与字段值。">
        <template #description>
          <div class="cc-overview__desc">
            <div>在指定版本/环境/类型下维护 Key 与字段值。</div>
            <el-button @click="go('data')">去配置数据</el-button>
          </div>
        </template>
      </el-step>
      <el-step title="对比与审计" description="通过版本对比与审计日志完成闭环。">
        <template #description>
          <div class="cc-overview__desc">
            <div>通过版本对比与审计日志完成闭环。</div>
            <div class="cc-overview__cta">
              <el-button @click="go('diff')">去版本对比</el-button>
              <el-button @click="go('audit')">去审计日志</el-button>
            </div>
          </div>
        </template>
      </el-step>
    </el-steps>
  </el-card>
</template>

<script setup>
import { computed } from 'vue';

const emit = defineEmits(['navigate']);

function go(key) {
  emit('navigate', key);
}

const activeStep = computed(() => 1);
</script>

<style scoped>
.cc-overview__hint {
  font-size: var(--cc-font-size-12);
  color: var(--cc-color-muted);
}

.cc-overview__steps {
  max-width: 760px;
}

.cc-overview__desc {
  display: grid;
  gap: var(--cc-space-2);
  margin-top: var(--cc-space-1);
}

.cc-overview__cta {
  display: flex;
  gap: var(--cc-space-2);
  flex-wrap: wrap;
}
</style>
