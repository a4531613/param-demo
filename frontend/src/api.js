const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:8000/api';

async function request(path, options = {}) {
  const res = await fetch(`${apiBase}${path}`, {
    headers: { 'Content-Type': 'application/json', 'X-User': 'demo', 'X-Role': 'admin' },
    ...options
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

export const api = {
  // applications
  listApps: () => request('/apps'),
  createApp: (payload) => request('/apps', { method: 'POST', body: JSON.stringify(payload) }),
  updateApp: (id, payload) => request(`/apps/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteApp: (id) => request(`/apps/${id}`, { method: 'DELETE' }),
  // environments
  listEnvs: (appId) => request(`/envs${appId ? `?appId=${appId}` : ''}`),
  createEnv: (payload) => request('/envs', { method: 'POST', body: JSON.stringify(payload) }),
  updateEnv: (id, payload) => request(`/envs/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteEnv: (id) => request(`/envs/${id}`, { method: 'DELETE' }),
  // types
  listTypes: (params = {}) => request(`/types?${new URLSearchParams(params)}`),
  createType: (payload) => request('/types', { method: 'POST', body: JSON.stringify(payload) }),
  updateType: (id, payload) => request(`/types/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteType: (id) => request(`/types/${id}`, { method: 'DELETE' }),
  // versions
  listVersions: (typeId) => request(`/types/${typeId}/versions`),
  createVersion: (typeId, payload) => request(`/types/${typeId}/versions`, { method: 'POST', body: JSON.stringify(payload) }),
  publishVersion: (id) => request(`/versions/${id}/publish`, { method: 'PATCH' }),
  diffVersions: (a, b) => request(`/versions/${a}/diff/${b}`),
  // fields
  listFields: (versionId) => request(`/versions/${versionId}/fields`),
  listFieldsAll: (params={}) => request(`/fields?${new URLSearchParams(params)}`),
  createField: (versionId, payload) => request(`/versions/${versionId}/fields`, { method: 'POST', body: JSON.stringify(payload) }),
  createFieldGlobal: (payload) => request(`/fields`, { method: 'POST', body: JSON.stringify(payload) }),
  updateField: (id, payload) => request(`/fields/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteField: (id) => request(`/fields/${id}`, { method: 'DELETE' }),
  // data
  listData: (versionId) => request(`/versions/${versionId}/data`),
  upsertData: (versionId, payload) => request(`/versions/${versionId}/data`, { method: 'POST', body: JSON.stringify(payload) }),
  // config fetch
  fetchConfig: (appCode, typeCode, key, env) => request(`/config/${appCode}/${typeCode}/${key}?env=${env || 'prod'}`),
  fetchConfigList: (appCode, typeCode, env) => request(`/config/${appCode}/${typeCode}?env=${env || 'prod'}`),
  // audit
  audit: () => request('/audit')
};
