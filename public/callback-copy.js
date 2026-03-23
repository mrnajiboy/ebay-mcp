document.addEventListener('DOMContentLoaded', () => {
  const clearTimers = new WeakMap();

  const setStatus = (statusEl, message, timeoutMs) => {
    if (!statusEl) return;
    statusEl.textContent = message;

    const existingTimer = clearTimers.get(statusEl);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }

    const timer = window.setTimeout(() => {
      statusEl.textContent = '';
      clearTimers.delete(statusEl);
    }, timeoutMs);

    clearTimers.set(statusEl, timer);
  };

  const fallbackCopy = (text) => {
    const temp = document.createElement('textarea');
    temp.value = text;
    temp.setAttribute('readonly', '');
    temp.style.position = 'fixed';
    temp.style.opacity = '0';
    temp.style.pointerEvents = 'none';
    temp.style.left = '-9999px';
    document.body.appendChild(temp);
    temp.focus();
    temp.select();

    let copied = false;
    try {
      copied = document.execCommand('copy');
    } finally {
      document.body.removeChild(temp);
    }

    if (!copied) {
      throw new Error('execCommand copy failed');
    }
  };

  const copyText = async (text) => {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    fallbackCopy(text);
  };

  document.querySelectorAll('[data-copy-source]').forEach((button) => {
    button.addEventListener('click', async () => {
      const sourceId = button.getAttribute('data-copy-source');
      const statusId = button.getAttribute('data-copy-status');
      const sourceEl = sourceId ? document.getElementById(sourceId) : null;
      const statusEl = statusId ? document.getElementById(statusId) : null;

      if (!sourceEl) {
        setStatus(statusEl, 'Copy failed — select manually', 2500);
        return;
      }

      const text = sourceEl.textContent ?? '';

      try {
        await copyText(text);
        setStatus(statusEl, 'Copied!', 1800);
      } catch {
        setStatus(statusEl, 'Copy failed — select manually', 2500);
      }
    });
  });
});