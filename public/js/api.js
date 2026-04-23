function flashReconnectDot() {
  const dot = document.querySelector('#statusBadge .status-dot');
  if (dot) {
    dot.classList.remove('flash');
    void dot.offsetWidth;
    dot.classList.add('flash');
    dot.addEventListener('animationend', () => dot.classList.remove('flash'), { once: true });
  }
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onmessage = (e) => {
    try {
      const newState = JSON.parse(e.data);
      state = newState;
      render();
      if (state.status === 'connected') {
        hasBeenConnected = true;
        clearTimeout(autoReconnectTimer);
      } else if (state.status === 'disconnected') {
        scheduleAutoReconnect();
      }
    } catch (_) {}
  };

  ws.onclose = () => {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = setTimeout(connectWS, 3000);
  };

  ws.onerror = () => ws.close();
}

function scheduleAutoReconnect() {
  clearTimeout(autoReconnectTimer);
  const cfg = state.config || {};
  if (!cfg.serverIp || !cfg.appPort || !cfg.steamId || !cfg.playerToken) return;
  autoReconnectTimer = setTimeout(() => {
    if (state.status === 'disconnected') {
      flashReconnectDot();
      api('POST', '/api/connect').catch(() => {});
    }
  }, RECONNECT_INTERVAL);
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

let _refreshInterval = null;

async function apiRefresh() {
  const btn = document.getElementById('refreshBtn');
  const ring = document.getElementById('refreshRing');
  const circumference = 100.53; // 2 * π * 16
  btn.disabled = true;
  btn.classList.add('refreshing');

  // Snapshot which monitors existed before refresh
  const total = Object.keys(state.monitors || {}).length;
  const beforeTimes = {};
  for (const [id, m] of Object.entries(state.monitors || {})) {
    beforeTimes[id] = m.lastUpdated || '';
  }

  function updateProgress() {
    if (total === 0) return;
    let updated = 0;
    for (const [id, before] of Object.entries(beforeTimes)) {
      const m = (state.monitors || {})[id];
      if (m && m.lastUpdated && m.lastUpdated !== before) updated++;
    }
    const pct = Math.min(updated / total, 1);
    ring.style.strokeDashoffset = circumference * (1 - pct);
  }

  _refreshInterval = setInterval(updateProgress, 200);

  try {
    await api('POST', '/api/refresh');
    // Final update
    ring.style.strokeDashoffset = '0';
    await new Promise(r => setTimeout(r, 400));
  } catch (e) {
    console.error('Refresh failed:', e.message);
  } finally {
    clearInterval(_refreshInterval);
    _refreshInterval = null;
    ring.style.strokeDashoffset = circumference;
    btn.classList.remove('refreshing');
    btn.disabled = state.status !== 'connected';
  }
}

async function saveConfig() {
  const token = document.getElementById('cfgToken').value;
  const gcmId = document.getElementById('cfgGcmId').value.trim();
  const gcmTok = document.getElementById('cfgGcmToken').value.trim();
  const body = {
    serverIp: document.getElementById('cfgIp').value.trim(),
    appPort: parseInt(document.getElementById('cfgPort').value) || 28082,
    steamId: document.getElementById('cfgSteamId').value.trim(),
    gcmAndroidId: gcmId,
  };
  if (!token.includes('•')) body.playerToken = token;
  if (!gcmTok.includes('•')) body.gcmSecurityToken = gcmTok;
  const res = await api('POST', '/api/config', body);
  if (res.success) closeConfigModal();
}

function exportMonitors() {
  const cfg = state.config || {};
  const data = {
    serverIp: cfg.serverIp || '',
    appPort: cfg.appPort || 28082,
    steamId: cfg.steamId || '',
    entityIds: cfg.entityIds || [],
    entityLabels: cfg.entityLabels || {},
    entityGroups: cfg.entityGroups || {},
    switchIds: cfg.switchIds || [],
    switchLabels: cfg.switchLabels || {},
  };
  const text = JSON.stringify(data, null, 2);
  navigator.clipboard.writeText(text).then(() => {
    const monitors = (data.entityIds).length;
    const switches = (data.switchIds).length;
    alert(`Copied config to clipboard (${monitors} monitor${monitors !== 1 ? 's' : ''}, ${switches} switch${switches !== 1 ? 'es' : ''}).`);
  }).catch(() => {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    alert('Copied config to clipboard.');
  });
}

async function importMonitors() {
  const text = prompt('Paste exported config (JSON):');
  if (!text) return;
  try {
    const data = JSON.parse(text);
    if (!data.entityIds || !Array.isArray(data.entityIds)) {
      alert('Invalid format — must contain an entityIds array.');
      return;
    }
    const monitors = data.entityIds.length;
    const switches = (data.switchIds || []).length;
    if (!confirm(`This will replace your current config with ${monitors} monitor${monitors !== 1 ? 's' : ''} and ${switches} switch${switches !== 1 ? 'es' : ''}. Continue?`)) return;
    const body = {
      entityIds: data.entityIds,
      entityLabels: data.entityLabels || {},
      entityGroups: data.entityGroups || {},
      switchIds: data.switchIds || [],
      switchLabels: data.switchLabels || {},
    };
    if (data.serverIp) body.serverIp = data.serverIp;
    if (data.appPort) body.appPort = data.appPort;
    if (data.steamId) body.steamId = data.steamId;
    await api('POST', '/api/config', body);
    alert(`Imported ${monitors} monitor${monitors !== 1 ? 's' : ''} and ${switches} switch${switches !== 1 ? 'es' : ''}.`);
  } catch (e) {
    alert('Failed to import: ' + e.message);
  }
}

async function toggleSwitch(entityId) {
  try {
    await api('POST', `/api/switch/${entityId}/toggle`);
  } catch (e) {
    console.error('Switch toggle failed:', e.message);
  }
}

async function removeSwitch(entityId) {
  await api('DELETE', `/api/switch/${entityId}`);
  promptedIds.delete(entityId);
}

async function refreshMonitor(event, entityId) {
  event.stopPropagation();
  const btn = document.getElementById(`modalRefreshBtn-${entityId}`);
  if (btn) { btn.disabled = true; btn.classList.add('refreshing'); }
  try {
    await api('POST', `/api/refresh/${entityId}`);
  } catch (e) {
    console.error('Monitor refresh failed:', e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('refreshing'); }
  }
}

async function loadConfig() {
  try {
    const [cfg, initialState, itemsList] = await Promise.all([
      api('GET', '/api/config'),
      api('GET', '/api/state'),
      api('GET', '/api/items'),
    ]);

    // Build item lookup map
    for (const item of (itemsList || [])) {
      allItems[String(item.itemId)] = item;
    }

    document.getElementById('cfgIp').value = cfg.serverIp || '';
    document.getElementById('cfgPort').value = cfg.appPort || 28082;
    document.getElementById('cfgSteamId').value = cfg.steamId || '';
    document.getElementById('cfgToken').value = cfg.playerToken || '';
    document.getElementById('cfgGcmId').value = cfg.gcmAndroidId || '';
    document.getElementById('cfgGcmToken').value = cfg.gcmSecurityToken || '';

    // Render actual server state immediately so the page doesn't flash "Disconnected"
    // while the WebSocket is still being established
    state = initialState;
    render();

    // Pre-populate promptedIds so existing monitors don't trigger the naming modal on load
    (cfg.entityIds || []).forEach(id => promptedIds.add(String(id)));
    monitorsInitialized = true;
  } catch (e) {
    console.error('Failed to load config:', e.message);
    showBanner('Failed to load configuration from server.');
  }
}
