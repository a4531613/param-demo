import { computed, reactive } from 'vue';

const STORAGE_KEY = 'cc_user_context_v1';

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveToStorage(payload) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

const defaults = { name: 'demo', role: 'admin' };
const stored = loadFromStorage();

export const userContext = reactive({
  name: stored?.name || defaults.name,
  role: stored?.role || defaults.role
});

export const roles = [
  { value: 'admin', label: '管理员' },
  { value: 'editor', label: '配置维护' },
  { value: 'viewer', label: '只读' },
  { value: 'auditor', label: '审计' }
];

export function setUserContext(patch) {
  if (patch?.name != null) userContext.name = String(patch.name || '').trim() || defaults.name;
  if (patch?.role != null) userContext.role = String(patch.role || '').trim() || defaults.role;
  saveToStorage({ name: userContext.name, role: userContext.role });
}

export const capabilities = computed(() => {
  const role = userContext.role;
  const readOnly = role === 'viewer' || role === 'auditor';
  const canWrite = !readOnly;
  const canAudit = role === 'admin' || role === 'auditor';
  return { readOnly, canWrite, canAudit };
});

