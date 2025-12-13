import { reactive, watch } from 'vue';

const STORAGE_KEY = 'cc_workspace_v1';

function toNumOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function safeParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return fallback;
  }
}

export function createWorkspace() {
  const state = reactive({
    appId: null,
    envId: null,
    groupId: null,
    typeId: null,
    versionId: null
  });

  const saved = safeParse(localStorage.getItem(STORAGE_KEY) || '', null);
  if (saved && typeof saved === 'object') {
    state.appId = toNumOrNull(saved.appId);
    state.envId = toNumOrNull(saved.envId);
    state.groupId = toNumOrNull(saved.groupId);
    state.typeId = toNumOrNull(saved.typeId);
    state.versionId = toNumOrNull(saved.versionId);
  }

  watch(
    state,
    (next) => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          appId: toNumOrNull(next.appId),
          envId: toNumOrNull(next.envId),
          groupId: toNumOrNull(next.groupId),
          typeId: toNumOrNull(next.typeId),
          versionId: toNumOrNull(next.versionId)
        })
      );
    },
    { deep: true }
  );

  return state;
}

