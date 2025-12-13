const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:8000/api';

import { userContext } from './userContext';

function buildHeaders(extra = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-User': userContext.name || 'demo',
    'X-Role': userContext.role || 'viewer',
    ...extra
  };
  return Object.fromEntries(Object.entries(headers).filter(([, v]) => v != null));
}

async function request(path, options = {}) {
  const res = await fetch(`${apiBase}${path}`, {
    headers: buildHeaders(options.headers || {}),
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
  nextTypeCode: () => request('/types/next-code'),
  createType: (payload) => request('/types', { method: 'POST', body: JSON.stringify(payload) }),
  updateType: (id, payload) => request(`/types/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteType: (id) => request(`/types/${id}`, { method: 'DELETE' }),
  // versions
  listVersions: (typeId) => request(`/types/${typeId}/versions`),
  listVersionsAll: (params={}) => request(`/versions?${new URLSearchParams(params)}`),
  createVersionGlobal: (payload) => request(`/versions`, { method: 'POST', body: JSON.stringify(payload) }),
  createVersion: (typeId, payload) => request(`/types/${typeId}/versions`, { method: 'POST', body: JSON.stringify(payload) }),
  updateVersion: (id, payload) => request(`/versions/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteVersion: (id) => request(`/versions/${id}`, { method: 'DELETE' }),
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
  listData: (versionId, typeId, envId) => request(`/versions/${versionId}/data?${new URLSearchParams({ typeId, envId })}`),
  listVersionDataAll: (versionId) => request(`/versions/${versionId}/data/all`),
  upsertData: (versionId, payload) => request(`/versions/${versionId}/data`, { method: 'POST', body: JSON.stringify(payload) }),
  exportData: async (versionId, typeId, envId) => {
    const res = await fetch(`${apiBase}/versions/${versionId}/data/export?${new URLSearchParams({ typeId, envId })}`, { headers: buildHeaders({ 'Content-Type': null }) });
    if (!res.ok) throw new Error(await res.text());
    return res.text();
  },
  exportTemplate: async (versionId, typeId) => {
    const res = await fetch(`${apiBase}/versions/${versionId}/data/template?${new URLSearchParams({ typeId })}`, { headers: buildHeaders({ 'Content-Type': null }) });
    if (!res.ok) throw new Error(await res.text());
    return res.text();
  },
  exportAllHtml: async (appId, versionId, envId) => {
    const res = await fetch(`${apiBase}/export/html?${new URLSearchParams({ appId, versionId, envId })}`, { headers: buildHeaders({ 'Content-Type': null }) });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || '';
    const m = /filename=\"?([^\";]+)\"?/i.exec(cd);
    const filename = m?.[1] || `config_${appId}_${versionId}_${envId}.html`;
    return { blob, filename };
  },
  previewAllHtml: async (appId, versionId, envId) => {
    const res = await fetch(`${apiBase}/export/html?${new URLSearchParams({ appId, versionId, envId })}`, { headers: buildHeaders({ 'Content-Type': null }) });
    if (!res.ok) throw new Error(await res.text());
    const cd = res.headers.get('content-disposition') || '';
    const m = /filename=\"?([^\";]+)\"?/i.exec(cd);
    const filename = m?.[1] || `config_${appId}_${versionId}_${envId}.html`;
    const html = await res.text();
    return { html, filename };
  },
  importData: (versionId, rows, typeId, envId) => request(`/versions/${versionId}/data/import`, { method: 'POST', body: JSON.stringify({ rows, typeId, envId }) }),
  deleteData: (id) => request(`/data/${id}`, { method: 'DELETE' }),
  deleteDataByKey: (versionId, typeId, keyValue) => request(`/versions/${versionId}/data/by-key?${new URLSearchParams({ typeId, keyValue })}`, { method: 'DELETE' }),
  // config fetch
  fetchConfig: (appCode, typeCode, key, env) => request(`/config/${appCode}/${typeCode}/${key}?env=${env || 'prod'}`),
  fetchConfigList: (appCode, typeCode, env) => request(`/config/${appCode}/${typeCode}?env=${env || 'prod'}`),
  // audit
  audit: () => request('/audit')
};
