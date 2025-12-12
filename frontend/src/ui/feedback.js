import { ElMessage, ElMessageBox } from 'element-plus';

function normalizeError(err) {
  if (!err) return '未知错误';
  if (typeof err === 'string') return err;
  const message = err?.message || err?.toString?.() || '未知错误';
  if (typeof message !== 'string') return '未知错误';

  const firstLine = message.split('\n')[0].trim();
  if (!firstLine) return '未知错误';

  try {
    const parsed = JSON.parse(firstLine);
    if (parsed?.message) return String(parsed.message);
  } catch {
    // ignore
  }
  return firstLine;
}

export function toastSuccess(text) {
  ElMessage.success({ message: text, duration: 1800, showClose: true });
}

export function toastWarning(text) {
  ElMessage.warning({ message: text, duration: 2200, showClose: true });
}

export function toastError(err, fallback = '操作失败') {
  const msg = normalizeError(err);
  ElMessage.error({ message: msg || fallback, duration: 3600, showClose: true });
}

export async function confirmAction(message, title = '提示') {
  return ElMessageBox.confirm(message, title, {
    confirmButtonText: '确认',
    cancelButtonText: '取消',
    type: 'warning',
    distinguishCancelAndClose: true
  });
}

