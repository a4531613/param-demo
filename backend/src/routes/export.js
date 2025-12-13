const express = require('express');
const { wrap } = require('../middleware/wrap');
const { HttpError } = require('../utils/errors');
const { safeParseJson } = require('../utils/safeJson');
const { escapeHtml, escapeHtmlAttr, shortenText, safeFilename, toCellText } = require('../utils/html');

function createExportRouter({ db }) {
  const router = express.Router();

  router.get(
    '/export/pdf',
    wrap((_req, res) => {
      res.status(410).json({ error: 'PDF export deprecated; use /api/export/html' });
    })
  );

  router.get(
    '/export/html',
    wrap((req, res) => {
      const appId = Number(req.query.appId);
      const versionId = Number(req.query.versionId);
      const envId = Number(req.query.envId);
      const enabledOnly = String(req.query.enabledOnly || '') === '1' || String(req.query.enabledOnly || '').toLowerCase() === 'true';
      if (!appId) throw new HttpError(400, 'appId required');
      if (!versionId) throw new HttpError(400, 'versionId required');
      if (!envId) throw new HttpError(400, 'envId required');

      const appRow = db.prepare(`SELECT id, app_code, app_name FROM applications WHERE id = ?`).get(appId);
      if (!appRow) throw new HttpError(404, 'app not found');
      const versionRow = db.prepare(`SELECT id, app_id, version_no, status, release_time FROM config_versions WHERE id = ?`).get(versionId);
      if (!versionRow) throw new HttpError(404, 'version not found');
      if ((versionRow.app_id ?? null) !== appRow.id) throw new HttpError(400, 'version not belong to app');
      const envRow = db.prepare(`SELECT id, app_id, env_code, env_name FROM environments WHERE id = ?`).get(envId);
      if (!envRow) throw new HttpError(404, 'env not found');
      if ((envRow.app_id ?? null) !== appRow.id) throw new HttpError(400, 'env not belong to app');

      const types = db
        .prepare(
          `SELECT id, type_code, type_name, sort_order
           FROM config_types
           WHERE app_id = ? AND (env_id = ? OR env_id IS NULL)
           ORDER BY sort_order, id`
        )
        .all(appRow.id, envRow.id);

      const fieldsByTypeId = new Map();
      types.forEach((t) => {
        const fields = db
          .prepare(
            `SELECT field_code, field_name, field_type, data_type, enum_options
             FROM config_fields
             WHERE type_id = ?
             ORDER BY sort_order, id`
          )
          .all(t.id);
        fieldsByTypeId.set(t.id, fields);
      });
      const dataByTypeId = new Map(types.map((t) => [t.id, []]));
      const dataRows = db
        .prepare(
          `SELECT cd.type_id, cd.key_value, cd.data_json, cd.status
           FROM config_data cd
           JOIN config_types t ON cd.type_id = t.id
           WHERE cd.version_id = ? AND cd.env_id = ? AND t.app_id = ?
             AND (? = 0 OR cd.status = 'ENABLED')
           ORDER BY t.sort_order, t.id, cd.key_value`
        )
        .all(versionRow.id, envRow.id, appRow.id, enabledOnly ? 1 : 0);
      dataRows.forEach((r) => {
        if (!dataByTypeId.has(r.type_id)) dataByTypeId.set(r.type_id, []);
        dataByTypeId.get(r.type_id).push(r);
      });

      const fileBase = safeFilename(`config_${appRow.app_code || appRow.id}_v${versionRow.version_no || versionRow.id}_env${envRow.env_code || envRow.id}`);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.html"`);

      const nowIso = new Date().toISOString();
      const maxCellLen = 96;
      const maxTipLen = 8000;
      const maxFieldLabelLen = 28;
      const maxJsonPrettyLen = 1800;

      function parseEnumOptions(text) {
        if (!text) return [];
        try {
          const parsed = JSON.parse(text);
          return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
          return [];
        }
      }

      function normalizeArrayValue(v) {
        if (Array.isArray(v)) return v;
        if (typeof v === 'string') {
          try {
            const parsed = JSON.parse(v);
            return Array.isArray(parsed) ? parsed : null;
          } catch (e) {
            return null;
          }
        }
        return null;
      }

      function maskPassword(v) {
        const text = String(v ?? '');
        if (!text) return '';
        const len = Math.min(Math.max(text.length, 6), 12);
        return '•'.repeat(len);
      }

      function jsonPrettyShort(v) {
        try {
          const pretty = JSON.stringify(v ?? {}, null, 2);
          return pretty.length > maxJsonPrettyLen ? `${pretty.slice(0, maxJsonPrettyLen)}…` : pretty;
        } catch (e) {
          return String(v ?? '');
        }
      }

      function renderValueHtml(field, valueObj) {
        const fieldType = field?.field_type || '';
        const dataType = field?.data_type || '';
        const enums = parseEnumOptions(field?.enum_options);
        const raw = valueObj?.[field.field_code];

        if (fieldType === 'MultiSelect' || fieldType === 'Checkbox') {
          const arr = normalizeArrayValue(raw) || [];
          if (!arr.length) return `<div class="value-box value-box--muted">-</div>`;
          const items = arr
            .map((x) => `<span class="chip">${escapeHtml(shortenText(toCellText(x), maxCellLen))}</span>`)
            .join('');
          return `<div class="chips">${items}</div>`;
        }

        if (fieldType === 'Select' || fieldType === 'Radio' || dataType === 'enum') {
          const text = toCellText(raw);
          if (!text) return `<div class="value-box value-box--muted">-</div>`;
          const ok = enums.length ? enums.includes(text) : true;
          return `<span class="pill ${ok ? 'pill--ok' : 'pill--warn'}" title="${escapeHtmlAttr(text)}">${escapeHtml(shortenText(text, maxCellLen))}</span>`;
        }

        if (fieldType === 'Password') {
          const masked = maskPassword(raw);
          return masked ? `<div class="value-box mono">${escapeHtml(masked)}</div>` : `<div class="value-box value-box--muted">-</div>`;
        }

        if (fieldType === 'Textarea') {
          const text = toCellText(raw);
          if (!text) return `<div class="value-box value-box--muted">-</div>`;
          const tipText = shortenText(text, maxTipLen) + (text.length > maxTipLen ? '（已截断）' : '');
          return `<div class="value-box value-box--multiline mono" title="${escapeHtmlAttr(tipText)}">${escapeHtml(tipText)}</div>`;
        }

        if (dataType === 'boolean') {
          const v = raw === true || raw === 1 || raw === '1' || raw === 'true';
          return `<span class="pill ${v ? 'pill--ok' : 'pill--muted'}">${v ? '是' : '否'}</span>`;
        }

        if (dataType === 'json' && raw && typeof raw === 'object') {
          const pretty = jsonPrettyShort(raw);
          return `<pre class="json-box mono">${escapeHtml(pretty)}</pre>`;
        }

        const text = toCellText(raw);
        if (!text) return `<div class="value-box value-box--muted">-</div>`;
        const short = shortenText(text, maxCellLen);
        const tipText = shortenText(text, maxTipLen) + (text.length > maxTipLen ? '（已截断）' : '');
        return `<div class="value-box mono" title="${escapeHtmlAttr(tipText)}">${escapeHtml(short)}</div>`;
      }

      const html = [];
      html.push(`<!doctype html>`);
      html.push(`<html lang="zh-CN">`);
      html.push(`<head>`);
      html.push(`<meta charset="utf-8" />`);
      html.push(`<meta name="viewport" content="width=device-width, initial-scale=1" />`);
      html.push(`<title>${escapeHtml(fileBase)}</title>`);
      html.push(`<style>
        :root {
          --bg: #ffffff;
          --card: #ffffff;
          --text: #111827;
          --muted: #6b7280;
          --border: #e6e8ec;
          --head: #f6f7f9;
          --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji"; background: #fafafa; color: var(--text); }
        .wrap { max-width: 980px; margin: 22px auto; padding: 0 16px; }
        .header { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 16px; }
        .title { font-size: 18px; font-weight: 650; margin: 0 0 6px 0; letter-spacing: 0.2px; }
        .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; color: var(--muted); font-size: 12px; }
        .meta div { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .section { margin-top: 16px; background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 14px; }
        .section h2 { margin: 0 0 10px 0; font-size: 14px; font-weight: 650; }
        .hint { color: var(--muted); font-size: 12px; margin: 6px 0 10px 0; }
        .cell { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; vertical-align: bottom; }
        .mono { font-family: var(--mono); }
        .record { border: 1px solid var(--border); border-radius: 14px; padding: 12px; margin-top: 10px; background: #fff; }
        .record__head { display:flex; align-items:center; justify-content:space-between; gap: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
        .record__key { font-weight: 650; font-size: 13px; min-width: 0; }
        .pill { font-size: 11px; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--border); background: #fff; color: var(--muted); flex: 0 0 auto; }
        .pill--ok { background: #ecfdf5; border-color: #a7f3d0; color: #065f46; }
        .pill--warn { background: #fff7ed; border-color: #fed7aa; color: #9a3412; }
        .pill--muted { background: var(--head); border-color: var(--border); color: var(--muted); }
        .form-grid { display:grid; grid-template-columns: 1fr; gap: 10px; padding-top: 10px; }
        .form-item { display:flex; flex-direction: column; gap: 4px; }
        .form-label { color: var(--muted); font-size: 11px; letter-spacing: 0.2px; }
        .form-value { font-size: 12px; min-width: 0; }
        .value-box { padding: 8px 10px; border: 1px solid var(--border); border-radius: 12px; background: var(--head); }
        .value-box--muted { color: var(--muted); }
        .value-box--multiline { white-space: pre-wrap; word-break: break-word; }
        .chips { display:flex; flex-wrap:wrap; gap:6px; }
        .chip { display:inline-flex; align-items:center; padding: 4px 8px; border-radius: 999px; border: 1px solid var(--border); background: #fff; font-size: 11px; color: var(--text); }
        .json-box { margin:0; padding: 8px 10px; border: 1px solid var(--border); border-radius: 12px; background: var(--head); white-space: pre-wrap; overflow:auto; max-height: 220px; font-size: 11px; line-height: 1.4; }
        .empty { color: var(--muted); font-size: 12px; padding: 10px 0 2px 0; }
        @media (max-width: 720px) { .meta { grid-template-columns: 1fr; } }
      </style>`);
      html.push(`</head>`);
      html.push(`<body>`);
      html.push(`<div class="wrap">`);
      html.push(`<div class="header">`);
      html.push(`<div class="title">配置导出（HTML）</div>`);
      html.push(`<div class="meta">`);
      html.push(`<div title="${escapeHtmlAttr(`${appRow.app_name || ''} (${appRow.app_code || appRow.id})`)}">应用：${escapeHtml(appRow.app_name || '')} (${escapeHtml(appRow.app_code || appRow.id)})</div>`);
      html.push(`<div title="${escapeHtmlAttr(`${versionRow.version_no || versionRow.id}`)}">版本：${escapeHtml(versionRow.version_no || versionRow.id)}（${escapeHtml(versionRow.status || '-') }）</div>`);
      html.push(`<div title="${escapeHtmlAttr(`${envRow.env_name || ''} (${envRow.env_code || envRow.id})`)}">环境：${escapeHtml(envRow.env_name || '')} (${escapeHtml(envRow.env_code || envRow.id)})</div>`);
      html.push(`<div title="${escapeHtmlAttr(nowIso)}">导出时间：${escapeHtml(nowIso)}</div>`);
      html.push(`</div>`);
      html.push(`</div>`);

      types.forEach((t) => {
        const typeTitle = `${t.type_name || ''} (${t.type_code || t.id})`;
        html.push(`<div class="section">`);
        html.push(`<h2 title="${escapeHtmlAttr(typeTitle)}">${escapeHtml(typeTitle)}</h2>`);

        const list = dataByTypeId.get(t.id) || [];
        if (!list.length) {
          html.push(`<div class="hint">暂无配置</div>`);
          html.push(`</div>`);
          return;
        }

        const fields = fieldsByTypeId.get(t.id) || [];
        const parsed = list.map((r) => {
          const obj = safeParseJson(r.data_json, {}) || {};
          return { key_value: r.key_value, status: r.status, obj };
        });

        parsed.forEach((r) => {
          const keyShort = shortenText(r.key_value, maxCellLen);
          const keyTip = shortenText(r.key_value, maxTipLen) + (String(r.key_value || '').length > maxTipLen ? '（已截断）' : '');
          html.push(`<div class="record">`);
          html.push(`<div class="record__head">`);
          html.push(`<div class="record__key mono"><span class="cell" title="${escapeHtmlAttr(keyTip)}">${escapeHtml(keyShort)}</span></div>`);
          html.push(`<div class="pill" title="${escapeHtmlAttr(r.status || '')}">${escapeHtml(r.status || '')}</div>`);
          html.push(`</div>`);

          const renderFields = fields.length
            ? fields
            : Object.keys(r.obj || {}).sort().map((k) => ({ field_code: k, field_name: k }));

          if (!renderFields.length) {
            html.push(`<div class="empty">无字段定义</div>`);
            html.push(`</div>`);
            return;
          }

          html.push(`<div class="form-grid">`);
          renderFields.forEach((f) => {
            const labelFull = `${f.field_name || f.field_code} (${f.field_code})`;
            const labelShort = shortenText(f.field_name || f.field_code, maxFieldLabelLen);
            const raw = toCellText(r.obj?.[f.field_code]);
            const tipText = shortenText(raw, maxTipLen) + (raw.length > maxTipLen ? '（已截断）' : '');
            html.push(`<div class="form-item">`);
            html.push(`<div class="form-label"><span class="cell" title="${escapeHtmlAttr(labelFull)}">${escapeHtml(labelShort)}</span></div>`);
            html.push(`<div class="form-value">${renderValueHtml(f, r.obj)}</div>`);
            html.push(`</div>`);
          });
          html.push(`</div>`);
          html.push(`</div>`);
        });

        html.push(`</div>`);
      });

      html.push(`</div>`);
      html.push(`</body>`);
      html.push(`</html>`);
      res.send(html.join('\n'));
    })
  );

  return router;
}

module.exports = { createExportRouter };
