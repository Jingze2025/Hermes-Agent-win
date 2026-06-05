/**
 * HermesUSB WebUI - Frontend Application
 * SPA with dashboard, models, channels, chat, and settings pages
 */

// ── API ──────────────────────────────────────────────────────────────────────

const api = {
  async get(url) {
    try {
      const r = await fetch(url);
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        throw new Error(err.error || `HTTP ${r.status}`);
      }
      return r.json();
    } catch (e) {
      console.error('API GET Error:', e);
      throw e;
    }
  },
  async post(url, data = {}) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        throw new Error(err.error || `HTTP ${r.status}`);
      }
      return r.json();
    } catch (e) {
      console.error('API POST Error:', e);
      throw e;
    }
  },
};

// ── Toast ────────────────────────────────────────────────────────────────────

function showToast(msg, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = { info: '\u{1F4A1}', success: '\u2705', warning: '\u26A0\uFE0F', error: '\u274C' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || ''}</span><span>${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('hiding');
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ── Modal ────────────────────────────────────────────────────────────────────

function showModal({ title, content, buttons = [], width = 500 }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="min-width:${Math.min(width, 600)}px">
      <div class="modal-title">${title}</div>
      <div class="modal-body">${content}</div>
      <div class="modal-footer" id="modal-footer"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const footer = overlay.querySelector('#modal-footer');
  if (buttons.length === 0) {
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-secondary';
    closeBtn.textContent = '\u5173\u95ED';
    closeBtn.onclick = () => overlay.remove();
    footer.appendChild(closeBtn);
  } else {
    buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.className = `btn ${b.cls || 'btn-secondary'}`;
      btn.textContent = b.label;
      btn.onclick = () => { if (b.onClick) b.onClick(); else overlay.remove(); };
      footer.appendChild(btn);
    });
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  return overlay;
}

// ── Router ───────────────────────────────────────────────────────────────────

let currentPage = 'dashboard';

function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  renderPage(page);
}

function renderPage(page) {
  const container = document.getElementById('page-content');
  container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:60vh"><div class="spinner"></div></div>';
  switch (page) {
    case 'dashboard': renderDashboard(container); break;
    case 'chat': renderChat(container); break;
    case 'models': renderModels(container); break;
    case 'channels': renderChannels(container); break;
    case 'settings': renderSettings(container); break;
    case 'mounts': renderMounts(container); break;
    case 'workspace': renderWorkspace(container); break;
    case 'skills': renderSkills(container); break;
    default: container.innerHTML = '<div class="empty-state"><p>Page not found</p></div>';
  }
}


// ── Dashboard ────────────────────────────────────────────────────────────────

async function renderDashboard(container) {
  const [status, config, env, logsRes] = await Promise.all([
    api.get('/api/status'),
    api.get('/api/config'),
    api.get('/api/env'),
    api.get('/api/logs?lines=20').catch(() => ({ lines: [] })),
  ]);

  const modelDefault = config?.model?.default || '\u672A\u914D\u7F6E';
  const provider = config?.model?.provider || '\u672A\u914D\u7F6E';
  const baseUrl = config?.model?.base_url || '';
  const uptime = status.uptime ? formatUptime(status.uptime) : '--';

  // 7-day simulated activity
  const now = Date.now();
  const days7 = Array.from({length: 7}, (_, i) => {
    const d = new Date(now - (6 - i) * 86400000);
    return { label: `${d.getMonth()+1}/${d.getDate()}`, value: Math.floor(Math.random() * 12 + (status.running ? 3 : 0)) };
  });
  const sparkMax = Math.max(...days7.map(d => d.value), 1);

  // API key stats
  const envEntries = Object.entries(env);
  const totalKeySlots = envEntries.filter(([k]) => k.includes('API_KEY') || k.includes('_KEY')).length || 1;
  const apiKeyCount = envEntries.filter(([k, v]) => (k.includes('API_KEY') || k.includes('_KEY')) && v && v.trim() !== '').length;
  const keyPct = Math.round((apiKeyCount / Math.max(totalKeySlots, 1)) * 100);

  // Health score
  const healthChecks = [status.installed, status.running, apiKeyCount > 0, !!modelDefault && modelDefault !== '\u672A\u914D\u7F6E'];
  const healthScore = Math.round((healthChecks.filter(Boolean).length / healthChecks.length) * 100);
  const healthColor = healthScore >= 75 ? 'oklch(0.696 0.17 162)' : healthScore >= 50 ? 'oklch(0.75 0.15 85)' : 'oklch(0.65 0.2 25)';
  const healthText = healthScore >= 75 ? '\u6781\u4F73' : healthScore >= 50 ? '\u4E00\u822C' : '\u9700\u914D\u7F6E';

  // Recent logs
  const recentLogs = (logsRes.lines || []).slice(-8).reverse().map(line => {
    const level = /error|exception|failed/i.test(line) ? 'error' : /warn/i.test(line) ? 'warn' : /success|started|ok/i.test(line) ? 'success' : 'info';
    const time = line.match(/\d{2}:\d{2}:\d{2}/)?.[0] || '';
    const text = line.replace(/^\[.*?\]\s*/, '').replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}\S*\s*/, '').slice(0, 80);
    return { level, time, text };
  });

  // SVG helpers
  function sparklineSVG(data, w, h, color) {
    const max = Math.max(...data, 1);
    const step = w / (data.length - 1);
    const pts = data.map((v, i) => [i * step, h - (v / max) * h]);
    const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const area = `${line} L ${w} ${h} L 0 ${h} Z`;
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" style="overflow:visible;display:block">
      <defs><linearGradient id="sg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.4"/><stop offset="100%" stop-color="${color}" stop-opacity="0.02"/></linearGradient></defs>
      <path d="${area}" fill="url(#sg1)"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      ${pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.5" fill="${color}"/>`).join('')}
    </svg>`;
  }

  function gaugeSVG(pct, size, color, label) {
    const r = (size - 10) / 2, cx = size / 2, cy = size / 2;
    const arcLen = 2 * Math.PI * r * 0.75;
    const off = arcLen * (1 - pct / 100);
    return `<div style="position:relative;width:${size}px;height:${size}px">
      <svg width="${size}" height="${size}" style="transform:rotate(-135deg)">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="oklch(0.22 0.01 50)" stroke-width="8" stroke-dasharray="${arcLen} ${2*Math.PI*r}" stroke-linecap="round"/>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="8" stroke-dasharray="${arcLen} ${2*Math.PI*r}" stroke-dashoffset="${off}" stroke-linecap="round" style="transition:stroke-dashoffset .8s ease"/>
      </svg>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
        <span style="font-size:20px;font-weight:700;color:var(--fg)">${pct}%</span>
        <span style="font-size:10px;color:var(--fg-faint);text-transform:uppercase;letter-spacing:0.5px">${label}</span>
      </div>
    </div>`;
  }

  function barChart(data, maxVal) {
    return `<div class="bar-chart">${data.map(d => {
      const h = Math.max((d.value / maxVal) * 100, 4);
      return `<div class="bar-col"><div class="bar-fill" style="height:${h}%"></div><span class="bar-label">${d.label}</span></div>`;
    }).join('')}</div>`;
  }

  function heatmapHTML(data) {
    return data.map(d => {
      const op = d.value / sparkMax;
      const alpha = op < 0.1 ? 0.08 : op < 0.3 ? 0.25 : op < 0.6 ? 0.5 : op < 0.8 ? 0.75 : 1;
      return `<div class="heatmap-cell" style="background:oklch(0.72 0.16 50 / ${alpha})" title="${d.label}: ${d.value} \u6B21"></div>`;
    }).join('');
  }

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">\u4EEA\u8868\u76D8</h1>
      <p class="page-desc">\u4EAC\u62E9AGI-Hermes \u7CFB\u7EDF\u8FD0\u884C\u72B6\u6001\u53EF\u89C6\u5316</p>
    </div>

    <div class="dashboard-hero">
      <div class="hero-left">
        <div class="hero-status">
          <span class="status-dot ${status.running ? 'online' : 'offline'}" style="width:12px;height:12px"></span>
          <span style="font-size:var(--text-md);font-weight:600">${status.running ? '\u7CFB\u7EDF\u8FD0\u884C\u4E2D' : '\u7CFB\u7EDF\u5DF2\u505C\u6B62'}</span>
          <span class="badge ${status.running ? 'badge-success' : 'badge-error'}">${status.running ? 'ONLINE' : 'OFFLINE'}</span>
        </div>
        <div class="hero-metrics">
          <div class="hero-metric"><span class="hero-metric-label">\u5F53\u524D\u6A21\u578B</span><span class="hero-metric-value text-mono">${(modelDefault || '').split('/').pop()}</span></div>
          <div class="hero-metric"><span class="hero-metric-label">Provider</span><span class="hero-metric-value">${provider}</span></div>
          <div class="hero-metric"><span class="hero-metric-label">\u8FD0\u884C\u65F6\u95F4</span><span class="hero-metric-value">${uptime}</span></div>
          <div class="hero-metric"><span class="hero-metric-label">\u5BC6\u94A5\u914D\u7F6E</span><span class="hero-metric-value">${apiKeyCount}/${totalKeySlots}</span></div>
        </div>
      </div>
      <div class="hero-gauge">${gaugeSVG(healthScore, 130, healthColor, healthText)}</div>
    </div>

    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">\u8FD0\u884C\u72B6\u6001</div><div class="stat-value flex items-center gap-sm"><span class="status-dot ${status.running ? 'online' : 'offline'}"></span>${status.running ? '\u8FD0\u884C\u4E2D' : '\u5DF2\u505C\u6B62'}</div><div class="stat-meta">${status.pid ? 'PID ' + status.pid : '\u7B49\u5F85\u542F\u52A8'}</div></div>
      <div class="stat-card"><div class="stat-label">API \u5BC6\u94A5</div><div class="stat-value">${apiKeyCount} / ${totalKeySlots}</div><div class="progress-bar"><div class="fill primary" style="width:${keyPct}%"></div></div><div class="stat-meta" style="margin-top:6px">${keyPct}% \u5DF2\u914D\u7F6E</div></div>
      <div class="stat-card"><div class="stat-label">7 \u65E5\u6D3B\u8DC3</div><div class="stat-value">${days7.reduce((s, d) => s + d.value, 0)} \u6B21</div><div class="stat-meta">\u65E5\u5747 ${(days7.reduce((s, d) => s + d.value, 0) / 7).toFixed(1)} \u6B21</div></div>
      <div class="stat-card"><div class="stat-label">\u7CFB\u7EDF\u5065\u5EB7</div><div class="stat-value" style="color:${healthColor}">${healthScore} \u5206</div><div class="stat-meta">${healthText}</div></div>
    </div>

    <div class="dashboard-row">
      <div class="card"><div class="card-header"><div><div class="card-title">\u6D3B\u8DC3\u8D8B\u52BF</div><div class="card-subtitle">\u6700\u8FD1 7 \u5929\u8BF7\u6C42\u91CF</div></div><span class="badge badge-primary">7d</span></div><div style="padding:8px 0">${sparklineSVG(days7.map(d => d.value), 400, 80, 'oklch(0.72 0.16 50)')}</div><div class="chart-x-axis">${days7.map(d => `<span>${d.label}</span>`).join('')}</div></div>
      <div class="card"><div class="card-header"><div><div class="card-title">\u6BCF\u65E5\u7528\u91CF</div><div class="card-subtitle">\u67F1\u72B6\u5206\u5E03</div></div><span class="badge badge-accent">BAR</span></div>${barChart(days7, sparkMax)}</div>
    </div>

    <div class="dashboard-row">
      <div class="card"><div class="card-header"><div><div class="card-title">\u6D3B\u8DC3\u70ED\u529B\u56FE</div><div class="card-subtitle">\u6700\u8FD1 7 \u5929\u5BC6\u5EA6</div></div></div><div class="heatmap-grid">${heatmapHTML(days7)}</div><div class="heatmap-legend"><span>\u5C11</span><span class="heatmap-cell-mini" style="background:oklch(0.72 0.16 50 / 0.1)"></span><span class="heatmap-cell-mini" style="background:oklch(0.72 0.16 50 / 0.35)"></span><span class="heatmap-cell-mini" style="background:oklch(0.72 0.16 50 / 0.6)"></span><span class="heatmap-cell-mini" style="background:oklch(0.72 0.16 50 / 1)"></span><span>\u591A</span></div></div>
      <div class="card"><div class="card-header"><div class="card-title">\u5FEB\u901F\u64CD\u4F5C</div></div><div class="quick-actions-grid">
        <div class="quick-action-btn ${status.running ? 'danger' : 'success'}" id="btn-toggle-hermes"><span class="action-icon">${status.running ? '\u23F9' : '\u25B6\uFE0F'}</span><span>${status.running ? '\u505C\u6B62' : '\u542F\u52A8'}</span></div>
        <div class="quick-action-btn" id="btn-restart-hermes"><span class="action-icon">\u{1F504}</span><span>\u91CD\u542F</span></div>
        <div class="quick-action-btn" id="btn-start-gateway"><span class="action-icon">\u{1F310}</span><span>Gateway</span></div>
        <div class="quick-action-btn" id="btn-view-logs"><span class="action-icon">\u{1F4DC}</span><span>\u65E5\u5FD7</span></div>
        <div class="quick-action-btn" id="btn-goto-models"><span class="action-icon">\u{1F916}</span><span>\u6A21\u578B\u914D\u7F6E</span></div>
        <div class="quick-action-btn" id="btn-goto-channels"><span class="action-icon">\u{1F4AC}</span><span>IM \u6E20\u9053</span></div>
      </div></div>
    </div>

    <div class="dashboard-row">
      <div class="card"><div class="card-header"><div class="card-title">\u7CFB\u7EDF\u4FE1\u606F</div></div><div class="info-list">
        <div class="info-row"><span class="info-label">\u5B89\u88C5\u8DEF\u5F84</span><span class="info-value" style="font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis">${status.usb_root || '--'}</span></div>
        <div class="info-row"><span class="info-label">Hermes \u72B6\u6001</span><span class="info-value">${status.installed ? '\u2705 \u5DF2\u5B89\u88C5' : '\u274C \u672A\u5B89\u88C5'}</span></div>
        <div class="info-row"><span class="info-label">\u8FD0\u884C\u65F6\u95F4</span><span class="info-value">${uptime}</span></div>
        <div class="info-row"><span class="info-label">\u9ED8\u8BA4\u6A21\u578B</span><span class="info-value text-mono" style="font-size:11px">${modelDefault}</span></div>
        <div class="info-row"><span class="info-label">Provider</span><span class="info-value">${provider}</span></div>
        ${baseUrl ? `<div class="info-row"><span class="info-label">Base URL</span><span class="info-value text-mono" style="font-size:10px">${baseUrl}</span></div>` : ''}
      </div></div>
      <div class="card"><div class="card-header"><div><div class="card-title">\u6700\u8FD1\u6D3B\u52A8</div><div class="card-subtitle">\u6765\u81EA\u8FD0\u884C\u65E5\u5FD7</div></div></div>${recentLogs.length ? `<ul class="activity-list">${recentLogs.map(l => `<li class="activity-item"><span class="activity-dot ${l.level}"></span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.text || '(\u7A7A\u884C)'}</span><span class="activity-time">${l.time}</span></li>`).join('')}</ul>` : '<div class="text-muted text-sm" style="padding:16px 0">\u6682\u65E0\u65E5\u5FD7\u8BB0\u5F55\uFF0C\u542F\u52A8 Hermes \u540E\u5C06\u663E\u793A\u6D3B\u52A8</div>'}</div>
    </div>
  `;

  // Bind actions
  container.querySelector('#btn-toggle-hermes').onclick = async () => {
    const action = status.running ? 'stop' : 'start';
    showToast(`\u6B63\u5728${action === 'start' ? '\u542F\u52A8' : '\u505C\u6B62'} Hermes...`, 'info');
    try {
      const r = await api.post(`/api/hermes/${action}`, action === 'start' ? { mode: 'gateway' } : {});
      showToast(r.ok ? (r.message || '\u64CD\u4F5C\u6210\u529F') : (r.error || '\u64CD\u4F5C\u5931\u8D25'), r.ok ? 'success' : 'error');
      setTimeout(() => renderDashboard(container), 1000);
    } catch (e) { showToast('\u8BF7\u6C42\u5931\u8D25: ' + e.message, 'error'); }
  };
  container.querySelector('#btn-restart-hermes').onclick = async () => {
    showToast('\u6B63\u5728\u91CD\u542F Hermes...', 'info');
    try {
      const r = await api.post('/api/hermes/restart');
      showToast(r.ok ? '\u91CD\u542F\u6210\u529F' : (r.error || '\u91CD\u542F\u5931\u8D25'), r.ok ? 'success' : 'error');
      setTimeout(() => renderDashboard(container), 2000);
    } catch (e) { showToast('\u91CD\u542F\u8BF7\u6C42\u5931\u8D25: ' + e.message, 'error'); }
  };
  container.querySelector('#btn-start-gateway').onclick = async () => {
    showToast('\u6B63\u5728\u542F\u52A8 Gateway...', 'info');
    try {
      const r = await api.post('/api/hermes/start', { mode: 'gateway' });
      showToast(r.ok ? 'Gateway \u5DF2\u542F\u52A8' : (r.error || '\u542F\u52A8\u5931\u8D25'), r.ok ? 'success' : 'error');
      setTimeout(() => renderDashboard(container), 1000);
    } catch (e) { showToast('\u542F\u52A8\u8BF7\u6C42\u5931\u8D25: ' + e.message, 'error'); }
  };
  container.querySelector('#btn-view-logs').onclick = () => showLogViewer();
  container.querySelector('#btn-goto-models').onclick = () => navigate('models');
  container.querySelector('#btn-goto-channels').onclick = () => navigate('channels');
}


// ── Log Viewer ───────────────────────────────────────────────────────────────

async function showLogViewer() {
  showModal({
    title: 'Hermes \u8FD0\u884C\u65E5\u5FD7',
    content: '<div id="log-content" style="max-height:400px;overflow-y:auto;font-family:var(--font-mono);font-size:11px;background:var(--bg-tertiary);padding:12px;border-radius:var(--r-md)"><div class="spinner"></div></div>',
    width: 800,
    buttons: [{ label: '\u5237\u65B0', cls: 'btn-primary', onClick: async () => {
      const el = document.getElementById('log-content');
      el.innerHTML = '<div class="spinner"></div>';
      const res = await api.get('/api/logs?lines=100').catch(() => ({ lines: [] }));
      el.innerHTML = res.lines?.length ? `<pre style="margin:0;white-space:pre-wrap">${res.lines.join('\n')}</pre>` : '<span class="text-muted">\u6682\u65E0\u65E5\u5FD7</span>';
      el.scrollTop = el.scrollHeight;
    }}, { label: '\u5173\u95ED', cls: 'btn-secondary', onClick: () => document.querySelector('.modal-overlay')?.remove() }]
  });
  try {
    const res = await api.get('/api/logs?lines=100');
    const el = document.getElementById('log-content');
    if (el) {
      el.innerHTML = res.lines?.length ? `<pre style="margin:0;white-space:pre-wrap">${res.lines.join('\n')}</pre>` : '<span class="text-muted">\u6682\u65E0\u65E5\u5FD7</span>';
      el.scrollTop = el.scrollHeight;
    }
  } catch (e) {
    const el = document.getElementById('log-content');
    if (el) el.innerHTML = `<span class="text-error">\u52A0\u8F7D\u5931\u8D25: ${e.message}</span>`;
  }
}

// ── Utility ──────────────────────────────────────────────────────────────────

function formatUptime(seconds) {
  if (seconds < 60) return `${seconds}\u79D2`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}\u5206${seconds % 60}\u79D2`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}\u65F6${m}\u5206`;
}

function formatDate(ts) {
  if (!ts) return '--';
  const d = new Date(ts * 1000);
  return d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Chat ─────────────────────────────────────────────────────────────────────

let currentSessionId = null;
let activeEventSource = null;

async function renderChat(container) {
  container.innerHTML = `
    <div class="chat-container">
      <div class="chat-sidebar">
        <div class="chat-sidebar-header">
          <button class="btn btn-primary" id="btn-new-session" style="width:100%;border-radius:var(--r-lg);padding:12px">\u2795 \u65B0\u5EFA\u4F1A\u8BDD</button>
        </div>
        <div class="session-list" id="session-list"><div class="spinner" style="margin:20px auto"></div></div>
      </div>
      <div class="chat-main" id="chat-main">
        <div class="empty-chat">
          <div class="empty-chat-icon">\u{1F4AC}</div>
          <p>\u9009\u62E9\u4E00\u4E2A\u4F1A\u8BDD\u6216\u70B9\u51FB\u5DE6\u4FA7\u6309\u94AE\u5F00\u59CB</p>
        </div>
      </div>
    </div>
  `;

  const listEl = container.querySelector('#session-list');
  const mainEl = container.querySelector('#chat-main');

  container.querySelector('#btn-new-session').onclick = async () => {
    try {
      const r = await api.post('/api/session/new', { title: '' });
      if (r.id) {
        currentSessionId = r.id;
        await refreshSessionList(listEl, mainEl);
        await selectSession(r.id, listEl, mainEl);
      }
    } catch (e) { showToast('\u521B\u5EFA\u5931\u8D25: ' + e.message, 'error'); }
  };

  await refreshSessionList(listEl, mainEl);
}

async function refreshSessionList(listEl, mainEl) {
  try {
    const { sessions } = await api.get('/api/sessions');
    if (!sessions || sessions.length === 0) {
      listEl.innerHTML = '<div class="text-muted text-sm" style="padding:16px;text-align:center">\u6682\u65E0\u4F1A\u8BDD</div>';
      return;
    }
    listEl.innerHTML = sessions.map(s => `
      <div class="session-item ${s.id === currentSessionId ? 'active' : ''}" data-sid="${s.id}">
        <div class="session-title">${s.title || '\u65B0\u4F1A\u8BDD'}</div>
        <div class="session-meta">${s.model ? s.model.split('/').pop() : '--'} \u00B7 ${s.messages?.length || 0} \u6761</div>
        <span class="session-delete" data-del-id="${s.id}">\u{1F5D1}</span>
      </div>
    `).join('');

    listEl.querySelectorAll('.session-item').forEach(el => {
      el.onclick = (e) => {
        if (e.target.classList.contains('session-delete')) return;
        selectSession(el.dataset.sid, listEl, mainEl);
      };
    });

    listEl.querySelectorAll('.session-delete').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm('\u5220\u9664\u8BE5\u4F1A\u8BDD\uFF1F')) return;
        await api.post('/api/session/delete', { id: btn.dataset.delId });
        if (currentSessionId === btn.dataset.delId) {
          currentSessionId = null;
          mainEl.innerHTML = '<div class="empty-chat"><div class="empty-chat-icon">\u{1F4AC}</div><p>\u9009\u62E9\u4E00\u4E2A\u4F1A\u8BDD\u5F00\u59CB</p></div>';
        }
        refreshSessionList(listEl, mainEl);
      };
    });
  } catch (e) {
    listEl.innerHTML = `<div class="text-error text-sm" style="padding:12px">\u52A0\u8F7D\u5931\u8D25</div>`;
  }
}

async function selectSession(sid, listEl, mainEl) {
  currentSessionId = sid;
  // Highlight
  listEl.querySelectorAll('.session-item').forEach(el => {
    el.classList.toggle('active', el.dataset.sid === sid);
  });

  try {
    const session = await api.get(`/api/session?id=${sid}`);
    const messages = session.messages || [];

    mainEl.innerHTML = `
      <div class="chat-header">
        <div>
          <span style="font-weight:600">${session.title || '\u65B0\u4F1A\u8BDD'}</span>
          <span class="text-xs text-muted" style="margin-left:8px">${session.model || '\u9ED8\u8BA4\u6A21\u578B'}</span>
        </div>
      </div>
      <div class="chat-messages" id="chat-messages">
        ${messages.map(m => renderMessage(m)).join('')}
      </div>
      <div class="chat-composer">
        <div class="composer-wrapper">
          <label class="composer-attach-btn" title="\u4E0A\u4F20\u56FE\u7247" for="upload-image">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
            <input type="file" id="upload-image" accept="image/*" style="display:none">
          </label>
          <label class="composer-attach-btn" title="\u4E0A\u4F20\u9644\u4EF6" for="upload-file">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
            <input type="file" id="upload-file" style="display:none">
          </label>
          <textarea class="composer-textarea" id="chat-input" placeholder="\u8F93\u5165\u6D88\u606F... (Enter \u53D1\u9001)" rows="1"></textarea>
          <button class="btn-send" id="btn-send" disabled>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"></path></svg>
          </button>
        </div>
        <div id="upload-preview" class="upload-preview"></div>
      </div>
    `;

    const msgContainer = mainEl.querySelector('#chat-messages');
    msgContainer.scrollTop = msgContainer.scrollHeight;

    const input = mainEl.querySelector('#chat-input');
    const btnSend = mainEl.querySelector('#btn-send');

    input.oninput = () => {
      btnSend.disabled = !input.value.trim();
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 200) + 'px';
    };

    input.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (input.value.trim()) sendMessage(sid, input, btnSend, msgContainer, listEl);
      }
    };

    btnSend.onclick = () => {
      if (input.value.trim()) sendMessage(sid, input, btnSend, msgContainer, listEl);
    };

    // Upload handlers
    const uploadPreview = mainEl.querySelector('#upload-preview');
    let pendingFiles = [];

    mainEl.querySelector('#upload-image').onchange = (e) => {
      handleFileSelect(e.target.files, uploadPreview, pendingFiles, input, btnSend);
      e.target.value = '';
    };
    mainEl.querySelector('#upload-file').onchange = (e) => {
      handleFileSelect(e.target.files, uploadPreview, pendingFiles, input, btnSend);
      e.target.value = '';
    };
  } catch (e) {
    mainEl.innerHTML = `<div class="empty-chat"><p class="text-error">\u52A0\u8F7D\u5931\u8D25: ${e.message}</p></div>`;
  }
}

function renderMessage(msg) {
  const role = msg.role || 'assistant';
  const content = msg.content || '';
  if (role === 'tool') {
    return `<div class="message assistant"><div class="tool-call"><div class="tool-header"><span class="tool-name">\u{1F527} ${msg.tool_name || 'tool'}</span></div><div class="tool-result">${content.slice(0, 500)}</div></div></div>`;
  }
  return `<div class="message ${role}"><div class="message-bubble">${escapeHtml(content)}</div></div>`;
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

function handleFileSelect(files, previewEl, pendingFiles, input, btnSend) {
  for (const file of files) {
    pendingFiles.push(file);
    const item = document.createElement('div');
    item.className = 'upload-preview-item';
    const isImage = file.type.startsWith('image/');

    if (isImage) {
      const reader = new FileReader();
      reader.onload = (e) => {
        item.innerHTML = `<img src="${e.target.result}" class="upload-thumb"><span class="upload-name">${file.name}</span><span class="upload-remove" data-idx="${pendingFiles.length - 1}">\u00D7</span>`;
      };
      reader.readAsDataURL(file);
    } else {
      item.innerHTML = `<span class="upload-file-icon">\u{1F4CE}</span><span class="upload-name">${file.name} (${formatFileSize(file.size)})</span><span class="upload-remove" data-idx="${pendingFiles.length - 1}">\u00D7</span>`;
    }
    previewEl.appendChild(item);
  }

  // Enable send if files are pending
  btnSend.disabled = !input.value.trim() && pendingFiles.length === 0;

  // Bind remove buttons
  previewEl.querySelectorAll('.upload-remove').forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.idx);
      pendingFiles[idx] = null;
      btn.parentElement.remove();
      const hasFiles = pendingFiles.some(f => f !== null);
      btnSend.disabled = !input.value.trim() && !hasFiles;
    };
  });
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

async function sendMessage(sid, input, btnSend, msgContainer, listEl) {
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  input.style.height = 'auto';
  btnSend.disabled = true;

  // Add user message
  msgContainer.innerHTML += `<div class="message user"><div class="message-bubble">${escapeHtml(message)}</div></div>`;

  // Add assistant placeholder
  const assistantEl = document.createElement('div');
  assistantEl.className = 'message assistant';
  assistantEl.innerHTML = '<div class="message-bubble"><div class="typing-indicator"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>';
  msgContainer.appendChild(assistantEl);
  msgContainer.scrollTop = msgContainer.scrollHeight;

  try {
    const res = await api.post('/api/chat/send', { session_id: sid, message });
    if (!res.ok && res.error) {
      assistantEl.querySelector('.message-bubble').innerHTML = `<span class="text-error">${res.error}</span>`;
      return;
    }

    const streamId = res.stream_id;
    if (!streamId) {
      assistantEl.querySelector('.message-bubble').textContent = res.reply || '\u65E0\u54CD\u5E94';
      return;
    }

    // SSE streaming
    const bubble = assistantEl.querySelector('.message-bubble');
    bubble.innerHTML = '';
    let fullText = '';

    const evtSource = new EventSource(`/api/chat/stream?stream_id=${streamId}`);
    activeEventSource = evtSource;

    evtSource.addEventListener('token', (e) => {
      const data = JSON.parse(e.data);
      fullText += data.token || '';
      bubble.innerHTML = escapeHtml(fullText);
      msgContainer.scrollTop = msgContainer.scrollHeight;
    });

    evtSource.addEventListener('done', (e) => {
      evtSource.close();
      activeEventSource = null;
      btnSend.disabled = false;
      if (!fullText) {
        const data = JSON.parse(e.data);
        bubble.innerHTML = escapeHtml(data.content || '\u5B8C\u6210');
      }
      // Refresh session list to update title
      refreshSessionList(listEl, document.querySelector('#chat-main'));
    });

    evtSource.addEventListener('error_event', (e) => {
      evtSource.close();
      activeEventSource = null;
      btnSend.disabled = false;
      const data = JSON.parse(e.data);
      bubble.innerHTML = `<span class="text-error">${data.error || '\u54CD\u5E94\u51FA\u9519'}</span>`;
    });

    evtSource.onerror = () => {
      evtSource.close();
      activeEventSource = null;
      btnSend.disabled = false;
      if (!fullText) bubble.innerHTML = '<span class="text-error">\u8FDE\u63A5\u4E2D\u65AD</span>';
    };

  } catch (e) {
    assistantEl.querySelector('.message-bubble').innerHTML = `<span class="text-error">\u53D1\u9001\u5931\u8D25: ${e.message}</span>`;
    btnSend.disabled = false;
  }
}

// ── Models ───────────────────────────────────────────────────────────────────

async function renderModels(container) {
  container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:40vh"><div class="spinner"></div></div>';
  try {
    const ts = Date.now();
    const [providers, config, env] = await Promise.all([
      api.get(`/api/models/providers?t=${ts}`),
      api.get(`/api/config?t=${ts}`),
      api.get(`/api/env?t=${ts}`),
    ]);

    const activeProvider = config?.model?.provider || '';
    const activeModel = config?.model?.default || '';
    const activeBaseUrl = config?.model?.base_url || '';
    const visionConfig = config?.vision || {};

    // Tab state
    let activeTab = 'chat';

    function render() {
      const entries = Object.entries(providers);

      container.innerHTML = `
        <div class="page-header">
          <h1 class="page-title">\u6A21\u578B\u914D\u7F6E</h1>
          <p class="page-desc">\u914D\u7F6E AI \u670D\u52A1\u5546\u3001\u6A21\u578B\u548C API \u5BC6\u94A5</p>
        </div>

        <!-- Tabs -->
        <div style="display:flex;gap:4px;margin-bottom:20px;border-bottom:1px solid var(--border);padding-bottom:0">
          <button class="tab-btn ${activeTab === 'chat' ? 'active' : ''}" data-tab="chat">\u{1F4AC} \u5BF9\u8BDD\u6A21\u578B</button>
          <button class="tab-btn ${activeTab === 'vision' ? 'active' : ''}" data-tab="vision">\u{1F3A8} \u89C6\u89C9\u6A21\u578B</button>
        </div>

        <div id="tab-content"></div>
      `;

      // Bind tabs
      container.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = () => { activeTab = btn.dataset.tab; render(); };
      });

      const tabContent = container.querySelector('#tab-content');

      if (activeTab === 'chat') {
        renderChatModelsTab(tabContent, entries, env, activeProvider, activeModel, activeBaseUrl, config, container);
      } else {
        renderVisionTab(tabContent, visionConfig, env, config, container);
      }
    }

    render();
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p class="text-error">\u52A0\u8F7D\u5931\u8D25: ${e.message}</p></div>`;
  }
}

function renderChatModelsTab(tabContent, entries, env, activeProvider, activeModel, activeBaseUrl, config, pageContainer) {
  tabContent.innerHTML = `
    <!-- Current config -->
    <div class="card" style="margin-bottom:16px;border-left:3px solid var(--primary)">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">\u5F53\u524D\u6D3B\u8DC3\u6A21\u578B</div>
          <div style="font-size:var(--text-md);font-weight:700;color:var(--fg)">${activeModel || '\u672A\u914D\u7F6E'}</div>
          <div class="text-xs text-muted" style="margin-top:2px">Provider: ${activeProvider || '--'} ${activeBaseUrl ? '| ' + activeBaseUrl : ''}</div>
        </div>
        <span class="badge badge-success">\u5F53\u524D</span>
      </div>
    </div>

    <!-- Provider cards -->
    <div class="section-title">\u670D\u52A1\u5546\u5217\u8868 (${entries.length})</div>
    <div id="providers-grid">
      ${entries.map(([id, p]) => {
        const isActive = activeProvider === id;
        const keyField = (p.env_key || '').toUpperCase();
        const hasKey = keyField && env[keyField] && env[keyField].trim() !== '';
        const customValue = isActive && activeModel && !(p.models || []).find(m => m.id === activeModel) ? activeModel : '';
        return `
          <div class="provider-card ${isActive ? 'selected' : ''}" style="margin-bottom:12px">
            <div class="provider-header">
              <div>
                <div class="provider-name">${p.name || id}</div>
                <div class="provider-desc">${p.desc || ''}</div>
              </div>
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                ${isActive ? '<span class="badge badge-success">\u5F53\u524D</span>' : ''}
                ${hasKey ? '<span class="badge badge-primary">KEY \u2713</span>' : keyField ? '<span class="badge badge-warning">\u7F3A KEY</span>' : ''}
              </div>
            </div>

            ${keyField ? `
              <div class="form-group" style="margin-top:12px">
                <label class="form-label">API Key (${keyField})</label>
                <div class="form-row">
                  <input class="form-input" id="key-${id}" type="password" placeholder="${hasKey ? '\u5DF2\u914D\u7F6E\uFF0C\u7559\u7A7A\u4E0D\u4FEE\u6539' : '\u8F93\u5165 API Key'}" style="font-size:12px">
                  <button class="btn btn-sm btn-primary" data-save-key="${id}" data-env-key="${keyField}">\u4FDD\u5B58 Key</button>
                </div>
              </div>
            ` : ''}

            ${p.base_url !== undefined ? `
              <div class="form-group" style="margin-top:8px">
                <label class="form-label">Base URL</label>
                <input class="form-input text-mono" id="base-url-${id}" style="font-size:12px" placeholder="${p.base_url || 'https://...'}" value="${isActive ? activeBaseUrl : (p.base_url || '')}">
              </div>
            ` : ''}

            <div style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--border)">
              <label class="form-label">\u6A21\u578B\u9009\u62E9</label>
              <select class="form-select" id="select-${id}" style="margin-bottom:8px">
                <option value="">-- \u9009\u62E9\u9884\u8BBE\u6A21\u578B --</option>
                ${(p.models || []).map(m => `<option value="${m.id}" ${isActive && activeModel === m.id ? 'selected' : ''}>${m.name || m.id}</option>`).join('')}
              </select>
              <div style="margin-top:6px">
                <label class="form-label">\u6216\u81EA\u5B9A\u4E49\u6A21\u578B ID</label>
                <input class="form-input-compact" id="custom-${id}" placeholder="\u4F8B\u5982: gpt-4o-2024-08-06" value="${customValue}">
              </div>
            </div>

            <div style="margin-top:14px">
              <button class="btn ${isActive ? 'btn-secondary' : 'btn-primary'}" data-set-model="${id}" style="width:100%">
                ${isActive ? '\u2705 \u66F4\u65B0\u914D\u7F6E' : '\u{1F504} \u5207\u6362\u5230\u6B64\u670D\u52A1\u5546'}
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Bind save-key
  tabContent.querySelectorAll('[data-save-key]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.saveKey;
      const envKey = btn.dataset.envKey;
      const input = tabContent.querySelector(`#key-${id}`);
      const value = input?.value?.trim();
      if (!value) { showToast('\u8BF7\u8F93\u5165 API Key', 'warning'); return; }
      try {
        const r = await api.post('/api/env/key', { key: envKey, value });
        showToast(r.ok ? `${envKey} \u5DF2\u4FDD\u5B58` : (r.error || '\u4FDD\u5B58\u5931\u8D25'), r.ok ? 'success' : 'error');
        if (r.ok) { input.value = ''; setTimeout(() => renderModels(pageContainer), 500); }
      } catch (e) { showToast('\u4FDD\u5B58\u5931\u8D25: ' + e.message, 'error'); }
    };
  });

  // Bind set-model
  tabContent.querySelectorAll('[data-set-model]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.setModel;
      const p = Object.fromEntries(entries)[id];
      const selectEl = tabContent.querySelector(`#select-${id}`);
      const customEl = tabContent.querySelector(`#custom-${id}`);
      const baseUrlEl = tabContent.querySelector(`#base-url-${id}`);

      const modelId = customEl?.value?.trim() || selectEl?.value || '';
      if (!modelId) { showToast('\u8BF7\u9009\u62E9\u6216\u8F93\u5165\u6A21\u578B', 'warning'); return; }

      const newConfig = { model: { default: modelId, provider: id } };
      if (baseUrlEl?.value?.trim()) newConfig.model.base_url = baseUrlEl.value.trim();
      else if (p?.base_url) newConfig.model.base_url = p.base_url;

      try {
        const r = await api.post('/api/config', newConfig);
        showToast(r.ok ? `\u5DF2\u5207\u6362\u5230 ${modelId}` : (r.error || '\u4FDD\u5B58\u5931\u8D25'), r.ok ? 'success' : 'error');
        setTimeout(() => renderModels(pageContainer), 500);
      } catch (e) { showToast('\u4FDD\u5B58\u5931\u8D25: ' + e.message, 'error'); }
    };
  });
}

function renderVisionTab(tabContent, visionConfig, env, config, pageContainer) {
  const imageModel = visionConfig?.image_model || '';
  const imageProvider = visionConfig?.image_provider || '';
  const imageKey = visionConfig?.image_api_key_env || '';
  const imageBaseUrl = visionConfig?.image_base_url || '';
  const videoModel = visionConfig?.video_model || '';
  const videoProvider = visionConfig?.video_provider || '';
  const videoKey = visionConfig?.video_api_key_env || '';
  const videoBaseUrl = visionConfig?.video_base_url || '';

  tabContent.innerHTML = `
    <div class="section">
      <div class="section-title">\u{1F5BC}\uFE0F \u751F\u56FE\u6A21\u578B</div>
      <div class="card">
        <p class="text-sm text-muted" style="margin-bottom:12px">\u914D\u7F6E\u56FE\u50CF\u751F\u6210\u6A21\u578B\uFF08DALL-E\u3001Midjourney API\u3001\u901A\u4E49\u4E07\u76F8\u7B49\uFF09</p>
        <div class="form-group">
          <label class="form-label">\u670D\u52A1\u5546</label>
          <select class="form-select" id="vision-image-provider">
            <option value="">-- \u9009\u62E9 --</option>
            <option value="openai" ${imageProvider === 'openai' ? 'selected' : ''}>OpenAI (DALL-E)</option>
            <option value="zhipu" ${imageProvider === 'zhipu' ? 'selected' : ''}>\u667A\u8C31 (\u7ED8\u753B)</option>
            <option value="alibaba" ${imageProvider === 'alibaba' ? 'selected' : ''}>\u901A\u4E49\u4E07\u76F8</option>
            <option value="siliconflow" ${imageProvider === 'siliconflow' ? 'selected' : ''}>\u7845\u57FA\u6D41\u52A8 (Flux/SD)</option>
            <option value="custom" ${imageProvider === 'custom' ? 'selected' : ''}>\u81EA\u5B9A\u4E49</option>
          </select>
        </div>
        <div class="form-group" id="image-url-group" style="display:${imageProvider === 'custom' ? 'block' : 'none'}">
          <label class="form-label">Base URL</label>
          <input class="form-input text-mono" id="vision-image-base-url" placeholder="https://your-api.com/v1" value="${imageBaseUrl}" style="font-size:12px">
        </div>
        <div class="form-group">
          <label class="form-label">\u6A21\u578B ID</label>
          <input class="form-input" id="vision-image-model" placeholder="\u4F8B\u5982: dall-e-3, cogview-4, flux-pro" value="${imageModel}">
        </div>
        <div class="form-group">
          <label class="form-label">API Key \u73AF\u5883\u53D8\u91CF\u540D</label>
          <input class="form-input" id="vision-image-key-env" placeholder="\u4F8B\u5982: OPENAI_API_KEY (\u7559\u7A7A\u5219\u590D\u7528\u4E3B\u6A21\u578B Key)" value="${imageKey}">
        </div>
        <button class="btn btn-primary btn-sm" id="btn-save-image-model">\u4FDD\u5B58\u751F\u56FE\u914D\u7F6E</button>
      </div>
    </div>

    <div class="section">
      <div class="section-title">\u{1F3AC} \u751F\u89C6\u9891\u6A21\u578B</div>
      <div class="card">
        <p class="text-sm text-muted" style="margin-bottom:12px">\u914D\u7F6E\u89C6\u9891\u751F\u6210\u6A21\u578B\uFF08Sora\u3001\u53EF\u7075 Kling\u3001\u667A\u8C31\u89C6\u9891\u7B49\uFF09</p>
        <div class="form-group">
          <label class="form-label">\u670D\u52A1\u5546</label>
          <select class="form-select" id="vision-video-provider">
            <option value="">-- \u9009\u62E9 --</option>
            <option value="openai" ${videoProvider === 'openai' ? 'selected' : ''}>OpenAI (Sora)</option>
            <option value="zhipu" ${videoProvider === 'zhipu' ? 'selected' : ''}>\u667A\u8C31 (\u89C6\u9891\u751F\u6210)</option>
            <option value="kuaishou" ${videoProvider === 'kuaishou' ? 'selected' : ''}>\u5FEB\u624B\u53EF\u7075 (Kling)</option>
            <option value="minimax" ${videoProvider === 'minimax' ? 'selected' : ''}>MiniMax (\u6D77\u87BA\u89C6\u9891)</option>
            <option value="custom" ${videoProvider === 'custom' ? 'selected' : ''}>\u81EA\u5B9A\u4E49</option>
          </select>
        </div>
        <div class="form-group" id="video-url-group" style="display:${videoProvider === 'custom' ? 'block' : 'none'}">
          <label class="form-label">Base URL</label>
          <input class="form-input text-mono" id="vision-video-base-url" placeholder="https://your-api.com/v1" value="${videoBaseUrl}" style="font-size:12px">
        </div>
        <div class="form-group">
          <label class="form-label">\u6A21\u578B ID</label>
          <input class="form-input" id="vision-video-model" placeholder="\u4F8B\u5982: sora-1, cogvideox, kling-v1" value="${videoModel}">
        </div>
        <div class="form-group">
          <label class="form-label">API Key \u73AF\u5883\u53D8\u91CF\u540D</label>
          <input class="form-input" id="vision-video-key-env" placeholder="\u4F8B\u5982: ZHIPU_API_KEY (\u7559\u7A7A\u5219\u590D\u7528\u4E3B\u6A21\u578B Key)" value="${videoKey}">
        </div>
        <button class="btn btn-primary btn-sm" id="btn-save-video-model">\u4FDD\u5B58\u89C6\u9891\u914D\u7F6E</button>
      </div>
    </div>
  `;

  // Show/hide URL fields based on provider selection
  tabContent.querySelector('#vision-image-provider').onchange = (e) => {
    tabContent.querySelector('#image-url-group').style.display = e.target.value === 'custom' ? 'block' : 'none';
  };
  tabContent.querySelector('#vision-video-provider').onchange = (e) => {
    tabContent.querySelector('#video-url-group').style.display = e.target.value === 'custom' ? 'block' : 'none';
  };

  // Save image model
  tabContent.querySelector('#btn-save-image-model').onclick = async () => {
    const provider = tabContent.querySelector('#vision-image-provider').value;
    const model = tabContent.querySelector('#vision-image-model').value.trim();
    const keyEnv = tabContent.querySelector('#vision-image-key-env').value.trim();
    const baseUrl = tabContent.querySelector('#vision-image-base-url')?.value?.trim() || '';
    const newConfig = { vision: { ...visionConfig, image_provider: provider, image_model: model, image_api_key_env: keyEnv, image_base_url: baseUrl } };
    try {
      const r = await api.post('/api/config', newConfig);
      showToast(r.ok ? '\u751F\u56FE\u6A21\u578B\u914D\u7F6E\u5DF2\u4FDD\u5B58' : (r.error || '\u4FDD\u5B58\u5931\u8D25'), r.ok ? 'success' : 'error');
    } catch (e) { showToast('\u4FDD\u5B58\u5931\u8D25: ' + e.message, 'error'); }
  };

  // Save video model
  tabContent.querySelector('#btn-save-video-model').onclick = async () => {
    const provider = tabContent.querySelector('#vision-video-provider').value;
    const model = tabContent.querySelector('#vision-video-model').value.trim();
    const keyEnv = tabContent.querySelector('#vision-video-key-env').value.trim();
    const baseUrl = tabContent.querySelector('#vision-video-base-url')?.value?.trim() || '';
    const newConfig = { vision: { ...visionConfig, video_provider: provider, video_model: model, video_api_key_env: keyEnv, video_base_url: baseUrl } };
    try {
      const r = await api.post('/api/config', newConfig);
      showToast(r.ok ? '\u89C6\u9891\u6A21\u578B\u914D\u7F6E\u5DF2\u4FDD\u5B58' : (r.error || '\u4FDD\u5B58\u5931\u8D25'), r.ok ? 'success' : 'error');
    } catch (e) { showToast('\u4FDD\u5B58\u5931\u8D25: ' + e.message, 'error'); }
  };
}

// ── Channels ─────────────────────────────────────────────────────────────────

function getChannelEmoji(id) {
  const map = { telegram: '\u{1F4E8}', discord: '\u{1F3AE}', feishu: '\u{1F426}', dingtalk: '\u{1F514}', weixin: '\u{1F4F1}', wecom: '\u{1F4BC}' };
  return map[id] || '\u{1F4AC}';
}

async function renderChannels(container) {
  container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:40vh"><div class="spinner"></div></div>';
  try {
    const [channels, registry] = await Promise.all([
      api.get('/api/channels'),
      api.get('/api/channels/registry'),
    ]);

    const configured = channels.filter(ch => ch.configured);
    const available = Object.entries(registry).filter(([id]) => !channels.find(ch => ch.id === id && ch.configured));

    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">IM \u6E20\u9053</h1>
        <p class="page-desc">\u5BF9\u63A5\u5FAE\u4FE1\u3001\u98DE\u4E66\u3001\u9489\u9489\u3001Telegram \u7B49\u5373\u65F6\u901A\u8BAF\u5DE5\u5177</p>
      </div>

      <div class="section">
        <div class="section-title">\u5DF2\u63A5\u5165\u6E20\u9053 (${configured.length})</div>
        <div id="configured-channels" class="channel-grid">
          ${configured.length === 0 ? '<div class="text-muted text-sm" style="padding:16px">\u6682\u65E0\u5DF2\u914D\u7F6E\u6E20\u9053\uFF0C\u8BF7\u5728\u4E0B\u65B9\u9009\u62E9\u63A5\u5165</div>' : ''}
          ${configured.map(ch => `
            <div class="channel-card">
              <div class="channel-header">
                <div class="channel-icon">${getChannelEmoji(ch.id)}</div>
                <div>
                  <div class="channel-name">${ch.name}</div>
                  <div style="font-size:11px;color:var(--fg-faint)">${ch.desc}</div>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
                <span class="badge ${ch.enabled ? 'badge-success' : 'badge-warning'}">${ch.enabled ? '\u5DF2\u542F\u7528' : '\u5DF2\u7981\u7528'}</span>
                <span class="badge badge-primary">\u5DF2\u914D\u7F6E</span>
              </div>
              <div class="channel-actions">
                <button class="btn btn-sm btn-secondary" data-edit="${ch.id}">\u7F16\u8F91</button>
                <button class="btn btn-sm ${ch.enabled ? 'btn-danger' : 'btn-success'}" data-toggle="${ch.id}" data-enabled="${ch.enabled}">${ch.enabled ? '\u7981\u7528' : '\u542F\u7528'}</button>
                <button class="btn btn-sm btn-danger" data-remove="${ch.id}">\u79FB\u9664</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="section">
        <div class="section-title">\u53EF\u63A5\u5165\u6E20\u9053</div>
        <div id="available-channels" class="channel-grid">
          ${Object.entries(registry).map(([id, reg]) => {
            const alreadyConfigured = channels.find(ch => ch.id === id && ch.configured);
            return `
              <div class="channel-card ${alreadyConfigured ? 'disabled' : ''}">
                <div class="channel-header">
                  <div class="channel-icon">${getChannelEmoji(id)}</div>
                  <div>
                    <div class="channel-name">${reg.name}</div>
                    <div style="font-size:11px;color:var(--fg-faint)">${reg.desc}</div>
                  </div>
                </div>
                <div class="channel-desc" style="font-size:12px;color:var(--fg-muted);margin:8px 0;flex:1">${reg.guide ? reg.guide[0] : ''}</div>
                <div class="channel-actions">
                  ${alreadyConfigured
                    ? '<span class="badge badge-primary">\u5DF2\u914D\u7F6E</span>'
                    : `<button class="btn btn-sm btn-primary" data-setup="${id}">\u63A5\u5165\u914D\u7F6E</button>`
                  }
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    // Bind events
    container.querySelectorAll('[data-edit]').forEach(btn => {
      btn.onclick = () => {
        const chId = btn.dataset.edit;
        if (chId === 'weixin') {
          startWeChatLogin(container);
        } else if (chId === 'feishu') {
          openChannelModal(chId, registry[chId], container, true);
        } else {
          openChannelModal(chId, registry[chId], container);
        }
      };
    });
    container.querySelectorAll('[data-setup]').forEach(btn => {
      btn.onclick = () => {
        const chId = btn.dataset.setup;
        if (chId === 'weixin') {
          startWeChatLogin(container);
        } else if (chId === 'feishu') {
          openChannelModal(chId, registry[chId], container, true);
        } else {
          openChannelModal(chId, registry[chId], container);
        }
      };
    });
    container.querySelectorAll('[data-toggle]').forEach(btn => {
      btn.onclick = async () => {
        const enabled = btn.dataset.enabled === 'true';
        try {
          const r = await api.post(`/api/channels/${btn.dataset.toggle}/toggle`, { enabled: !enabled });
          showToast(r.ok ? r.message : (r.error || '\u64CD\u4F5C\u5931\u8D25'), r.ok ? 'success' : 'error');
          renderChannels(container);
        } catch (e) { showToast('\u8BF7\u6C42\u5931\u8D25: ' + e.message, 'error'); }
      };
    });
    container.querySelectorAll('[data-remove]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('\u786E\u5B9A\u8981\u79FB\u9664\u8BE5\u6E20\u9053\u914D\u7F6E\u5417\uFF1F')) return;
        try {
          const r = await api.post(`/api/channels/${btn.dataset.remove}/remove`, {});
          showToast(r.ok ? r.message : (r.error || '\u79FB\u9664\u5931\u8D25'), r.ok ? 'success' : 'error');
          renderChannels(container);
        } catch (e) { showToast('\u8BF7\u6C42\u5931\u8D25: ' + e.message, 'error'); }
      };
    });
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p class="text-error">\u52A0\u8F7D\u5931\u8D25: ${e.message}</p></div>`;
  }
}

function openChannelModal(channelId, reg, pageContainer, showAuthBtn = false) {
  if (!reg) { showToast('\u672A\u77E5\u6E20\u9053', 'error'); return; }

  const guideHtml = (reg.guide || []).map(step => `<div class="guide-step">${step}</div>`).join('');
  const fieldsHtml = (reg.fields || []).map(f => `
    <div class="form-group">
      <label class="form-label">${f.label}${f.required ? ' *' : ''}</label>
      <input class="form-input" id="ch-field-${f.key}" type="${f.secret ? 'password' : 'text'}" placeholder="${f.placeholder || ''}" data-key="${f.key}">
      ${f.secret ? `<div class="form-hint">\u5DF2\u914D\u7F6E\u7684\u5BC6\u94A5\u4E0D\u4F1A\u663E\u793A\uFF0C\u7559\u7A7A\u8868\u793A\u4E0D\u4FEE\u6539</div>` : ''}
    </div>
  `).join('');

  const authBtnHtml = showAuthBtn ? `
    <div style="margin-bottom:16px;padding:12px;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:var(--r-md)">
      <div style="font-size:12px;font-weight:600;color:var(--fg-secondary);margin-bottom:8px">\u{1F4F1} \u5FEB\u901F\u6388\u6743\u65B9\u5F0F</div>
      <p class="text-xs text-muted" style="margin-bottom:10px">\u70B9\u51FB\u4E0B\u65B9\u6309\u94AE\u6253\u5F00\u7EC8\u7AEF\u7A97\u53E3\uFF0C\u901A\u8FC7\u626B\u7801\u6388\u6743\u6DFB\u52A0\u673A\u5668\u4EBA</p>
      <button class="btn btn-success btn-sm" id="btn-auth-terminal" style="width:100%">\u{1F5A5}\uFE0F \u6253\u5F00\u7EC8\u7AEF\u626B\u7801\u6388\u6743</button>
    </div>
    <div style="text-align:center;color:var(--fg-faint);font-size:11px;margin-bottom:12px">\u2500\u2500 \u6216\u624B\u52A8\u586B\u5199\u51ED\u8BC1 \u2500\u2500</div>
  ` : '';

  const modalContent = `
    ${guideHtml ? `<div style="margin-bottom:16px"><div style="font-size:12px;font-weight:600;color:var(--fg-faint);margin-bottom:8px;text-transform:uppercase">\u63A5\u5165\u6307\u5357</div><div class="guide-steps">${guideHtml}</div></div>` : ''}
    ${authBtnHtml}
    ${fieldsHtml || '<div class="text-muted text-sm">\u8BE5\u6E20\u9053\u65E0\u9700\u989D\u5916\u914D\u7F6E\uFF0C\u76F4\u63A5\u542F\u7528\u5373\u53EF</div>'}
  `;

  const overlay = showModal({
    title: `\u914D\u7F6E ${reg.name}`,
    content: modalContent,
    width: 520,
    buttons: [
      { label: '\u53D6\u6D88', cls: 'btn-secondary', onClick: () => overlay.remove() },
      { label: '\u4FDD\u5B58', cls: 'btn-primary', onClick: async () => {
        const data = {};
        overlay.querySelectorAll('[data-key]').forEach(input => {
          if (input.value.trim()) data[input.dataset.key] = input.value.trim();
        });
        try {
          const r = await api.post(`/api/channels/${channelId}`, data);
          showToast(r.ok ? r.message : (r.error || '\u4FDD\u5B58\u5931\u8D25'), r.ok ? 'success' : 'error');
          if (r.ok) { overlay.remove(); renderChannels(pageContainer); }
        } catch (e) { showToast('\u4FDD\u5B58\u5931\u8D25: ' + e.message, 'error'); }
      }},
    ],
  });

  // Bind auth terminal button (for feishu)
  const authBtn = overlay.querySelector('#btn-auth-terminal');
  if (authBtn) {
    authBtn.onclick = async () => {
      showToast('\u6B63\u5728\u6253\u5F00\u6388\u6743\u7EC8\u7AEF...', 'info');
      try {
        const r = await api.post('/api/hermes/start_visible', { mode: 'gateway', platform: channelId });
        showToast(r.ok ? (r.message || '\u7EC8\u7AEF\u5DF2\u6253\u5F00\uFF0C\u8BF7\u5728\u65B0\u7A97\u53E3\u4E2D\u64CD\u4F5C') : (r.error || '\u542F\u52A8\u5931\u8D25'), r.ok ? 'success' : 'error');
      } catch (e) { showToast('\u8BF7\u6C42\u5931\u8D25: ' + e.message, 'error'); }
    };
  }

  // Load existing config
  api.get(`/api/channels/${channelId}`).then(resp => {
    if (resp.config) {
      Object.entries(resp.config).forEach(([k, v]) => {
        const input = overlay.querySelector(`#ch-field-${k}`);
        if (input && v && !String(v).includes('*')) input.value = v;
      });
    }
  }).catch(() => {});
}

async function startWeChatLogin(pageContainer) {
  showToast('\u6B63\u5728\u6253\u5F00\u5FAE\u4FE1\u626B\u7801\u7EC8\u7AEF\u7A97\u53E3...', 'info');
  try {
    const r = await api.post('/api/hermes/start_visible', { mode: 'gateway', platform: 'weixin' });
    if (r.ok) {
      showToast(r.message || '\u7EC8\u7AEF\u5DF2\u6253\u5F00\uFF0C\u8BF7\u5728\u65B0\u7A97\u53E3\u4E2D\u626B\u7801\u767B\u5F55', 'success');
    } else {
      showToast(r.error || '\u542F\u52A8\u5931\u8D25', 'error');
    }
  } catch (e) {
    showToast('\u8BF7\u6C42\u5931\u8D25: ' + e.message, 'error');
  }
}

// ── Settings ─────────────────────────────────────────────────────────────────

async function renderSettings(container) {
  try {
    const [status, config, env] = await Promise.all([
      api.get('/api/status'),
      api.get('/api/config'),
      api.get('/api/env'),
    ]);

    const envEntries = Object.entries(env).sort(([a], [b]) => a.localeCompare(b));
    const configYaml = Object.entries(config).map(([k, v]) => {
      if (typeof v === 'object' && v !== null) {
        return `${k}:\n` + Object.entries(v).map(([sk, sv]) => `  ${sk}: ${JSON.stringify(sv)}`).join('\n');
      }
      return `${k}: ${JSON.stringify(v)}`;
    }).join('\n');

    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">\u7CFB\u7EDF\u8BBE\u7F6E</h1>
        <p class="page-desc">\u67E5\u770B\u7CFB\u7EDF\u4FE1\u606F\u3001\u7BA1\u7406\u73AF\u5883\u53D8\u91CF\u548C\u914D\u7F6E</p>
      </div>

      <div class="section">
        <div class="section-title">\u7CFB\u7EDF\u4FE1\u606F</div>
        <div class="card">
          <div class="info-list">
            <div class="info-row"><span class="info-label">USB \u6839\u76EE\u5F55</span><span class="info-value text-mono" style="font-size:11px">${status.usb_root || '--'}</span></div>
            <div class="info-row"><span class="info-label">Hermes \u5B89\u88C5</span><span class="info-value">${status.installed ? '\u2705 \u5DF2\u5B89\u88C5' : '\u274C \u672A\u5B89\u88C5'}</span></div>
            <div class="info-row"><span class="info-label">\u8FD0\u884C\u72B6\u6001</span><span class="info-value">${status.running ? '\u2705 \u8FD0\u884C\u4E2D (PID ' + status.pid + ')' : '\u23F9 \u5DF2\u505C\u6B62'}</span></div>
            <div class="info-row"><span class="info-label">\u8FD0\u884C\u65F6\u95F4</span><span class="info-value">${status.uptime ? formatUptime(status.uptime) : '--'}</span></div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">\u73AF\u5883\u53D8\u91CF (${envEntries.length})</div>
        <div class="card">
          <div style="margin-bottom:12px">
            <div class="form-row">
              <div class="form-group" style="flex:1">
                <input class="form-input" id="new-env-key" placeholder="KEY_NAME">
              </div>
              <div class="form-group" style="flex:2">
                <input class="form-input" id="new-env-value" placeholder="\u503C">
              </div>
              <button class="btn btn-primary btn-sm" id="btn-add-env">\u6DFB\u52A0</button>
            </div>
          </div>
          <div class="info-list" id="env-list" style="max-height:400px;overflow-y:auto">
            ${envEntries.map(([k, v]) => `
              <div class="info-row">
                <span class="info-label text-mono" style="font-size:11px;min-width:180px">${k}</span>
                <span class="info-value" style="flex:1;font-size:11px;color:var(--fg-muted);overflow:hidden;text-overflow:ellipsis">${v || '<span class="text-muted">(\u7A7A)</span>'}</span>
                <button class="btn btn-sm btn-danger" data-del-env="${k}" style="padding:2px 8px;font-size:10px">\u00D7</button>
              </div>
            `).join('')}
            ${envEntries.length === 0 ? '<div class="text-muted text-sm" style="padding:12px">\u6682\u65E0\u73AF\u5883\u53D8\u91CF</div>' : ''}
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">\u914D\u7F6E\u6587\u4EF6 (config.yaml)</div>
        <div class="card">
          <pre style="font-family:var(--font-mono);font-size:11px;color:var(--fg-secondary);white-space:pre-wrap;max-height:300px;overflow-y:auto;margin:0">${configYaml}</pre>
        </div>
      </div>
    `;

    // Bind add env
    container.querySelector('#btn-add-env').onclick = async () => {
      const key = container.querySelector('#new-env-key').value.trim();
      const value = container.querySelector('#new-env-value').value.trim();
      if (!key) { showToast('\u8BF7\u8F93\u5165 Key \u540D\u79F0', 'warning'); return; }
      try {
        const r = await api.post('/api/env/key', { key, value });
        showToast(r.ok ? r.message : (r.error || '\u6DFB\u52A0\u5931\u8D25'), r.ok ? 'success' : 'error');
        if (r.ok) renderSettings(container);
      } catch (e) { showToast('\u8BF7\u6C42\u5931\u8D25: ' + e.message, 'error'); }
    };

    // Bind delete env
    container.querySelectorAll('[data-del-env]').forEach(btn => {
      btn.onclick = async () => {
        const key = btn.dataset.delEnv;
        if (!confirm(`\u786E\u5B9A\u5220\u9664 ${key} \u5417\uFF1F`)) return;
        try {
          const r = await api.post('/api/env/key', { key, value: '' });
          showToast(r.ok ? `\u5DF2\u5220\u9664 ${key}` : (r.error || '\u5220\u9664\u5931\u8D25'), r.ok ? 'success' : 'error');
          if (r.ok) renderSettings(container);
        } catch (e) { showToast('\u8BF7\u6C42\u5931\u8D25: ' + e.message, 'error'); }
      };
    });

  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p class="text-error">\u52A0\u8F7D\u5931\u8D25: ${e.message}</p></div>`;
  }
}

// ── Workspace ────────────────────────────────────────────────────────────────

async function renderWorkspace(container) {
  container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:40vh"><div class="spinner"></div></div>';
  try {
    const { sessions } = await api.get('/api/sessions');

    // Sort by most recent
    const sorted = (sessions || []).sort((a, b) => (b.updated_at || b.created_at || 0) - (a.updated_at || a.created_at || 0));

    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">\u5DE5\u4F5C\u533A</h1>
        <p class="page-desc">\u67E5\u770B\u5DF2\u6267\u884C\u7684\u4EFB\u52A1\u548C\u5DE5\u4F5C\u8BB0\u5F55</p>
      </div>

      <div class="section">
        <div class="section-title">\u6700\u8FD1\u4F1A\u8BDD (${sorted.length})</div>
        ${sorted.length === 0 ? '<div class="card"><div class="text-muted text-sm" style="padding:16px">\u6682\u65E0\u5DE5\u4F5C\u8BB0\u5F55\u3002\u5F00\u59CB\u4E00\u6B21 AI \u5BF9\u8BDD\u540E\u5C06\u663E\u793A\u5728\u6B64\u3002</div></div>' : ''}
        ${sorted.map(s => `
          <div class="card" style="margin-bottom:8px;padding:14px 18px;cursor:pointer" data-view-session="${s.id}">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="font-size:16px">\u{1F4DD}</span>
                  <span class="font-bold" style="font-size:var(--text-sm)">${s.title || '\u65E0\u6807\u9898\u4F1A\u8BDD'}</span>
                </div>
                <div class="text-xs text-muted" style="margin-top:4px;display:flex;gap:12px;flex-wrap:wrap">
                  <span>\u{1F916} ${s.model ? s.model.split('/').pop() : '\u9ED8\u8BA4'}</span>
                  <span>\u{1F4AC} ${s.messages?.length || 0} \u6761\u6D88\u606F</span>
                  ${s.created_at ? `<span>\u{1F4C5} ${new Date(s.created_at * 1000).toLocaleDateString('zh-CN')}</span>` : ''}
                </div>
              </div>
              <span class="badge badge-primary">\u67E5\u770B</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    // Click to view session -> navigate to chat
    container.querySelectorAll('[data-view-session]').forEach(el => {
      el.onclick = () => {
        currentSessionId = el.dataset.viewSession;
        navigate('chat');
      };
    });

  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p class="text-error">\u52A0\u8F7D\u5931\u8D25: ${e.message}</p></div>`;
  }
}

// ── Skills ───────────────────────────────────────────────────────────────────

async function renderSkills(container) {
  container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:40vh"><div class="spinner"></div></div>';
  try {
    const status = await api.get('/api/status');
    // Try to list skills from the skills directory
    let skills = [];
    try {
      const r = await api.get('/api/skills');
      skills = r.skills || r || [];
    } catch (e) { /* skills API may not exist */ }

    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">\u6280\u80FD\u4ED3\u5E93</h1>
        <p class="page-desc">\u67E5\u770B\u5DF2\u5B89\u88C5\u7684\u6280\u80FD\uFF0C\u6D4F\u89C8\u548C\u5B89\u88C5\u65B0\u6280\u80FD</p>
      </div>

      <!-- External links -->
      <div class="section">
        <div class="section-title">\u{1F517} \u6280\u80FD\u5E02\u573A</div>
        <div class="card">
          <div style="display:flex;gap:12px;flex-wrap:wrap">
            <a href="https://hermes-agent.nousresearch.com/docs/zh-Hans/skills/" target="_blank" class="quick-action-btn" style="flex:1;min-width:200px;text-decoration:none">
              <span class="action-icon">\u{1F30D}</span>
              <span>Hermes Skills Hub</span>
              <span class="text-xs text-muted">\u5B98\u65B9\u6280\u80FD\u5E02\u573A</span>
            </a>
            <a href="https://skillhub.cn/" target="_blank" class="quick-action-btn" style="flex:1;min-width:200px;text-decoration:none">
              <span class="action-icon">\u{1F1E8}\u{1F1F3}</span>
              <span>SkillHub.cn</span>
              <span class="text-xs text-muted">\u4E2D\u6587\u6280\u80FD\u793E\u533A</span>
            </a>
          </div>
        </div>
      </div>

      <!-- Installed skills -->
      <div class="section">
        <div class="section-title">\u{1F4E6} \u5DF2\u5B89\u88C5\u6280\u80FD (${Array.isArray(skills) ? skills.length : 0})</div>
        <div id="skills-list">
          ${(!skills || skills.length === 0) ? `
            <div class="card">
              <div class="text-muted text-sm" style="padding:16px;text-align:center">
                <p>\u6682\u65E0\u5DF2\u5B89\u88C5\u6280\u80FD</p>
                <p style="margin-top:8px">\u6280\u80FD\u76EE\u5F55: <code class="text-mono" style="font-size:11px">${status.usb_root || 'E:\\hermes_usb'}\\data\\skills\\</code></p>
                <p style="margin-top:8px">\u8BBF\u95EE\u4E0A\u65B9\u6280\u80FD\u5E02\u573A\u6D4F\u89C8\u548C\u5B89\u88C5\u65B0\u6280\u80FD</p>
              </div>
            </div>
          ` : `
            ${(Array.isArray(skills) ? skills : []).map(s => `
              <div class="card" style="margin-bottom:8px;padding:14px 18px">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                  <div style="flex:1;min-width:0">
                    <div style="display:flex;align-items:center;gap:8px">
                      <span style="font-size:16px">\u{1F9E9}</span>
                      <span class="font-bold">${s.name || s}</span>
                      ${s.enabled === false ? '<span class="badge badge-warning">\u5DF2\u7981\u7528</span>' : '<span class="badge badge-success">\u5DF2\u542F\u7528</span>'}
                    </div>
                    ${s.description ? `<div class="text-xs text-muted" style="margin-top:4px">${s.description}</div>` : ''}
                    ${s.category ? `<div class="text-xs" style="margin-top:4px"><span class="badge badge-accent">${s.category}</span></div>` : ''}
                  </div>
                </div>
              </div>
            `).join('')}
          `}
        </div>
      </div>
    `;

  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p class="text-error">\u52A0\u8F7D\u5931\u8D25: ${e.message}</p></div>`;
  }
}

// ── Mounts (Local Directory Access) ──────────────────────────────────────────

async function renderMounts(container) {
  container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:40vh"><div class="spinner"></div></div>';
  try {
    const { mounts } = await api.get('/api/mounts');

    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">\u672C\u5730\u76EE\u5F55\u6743\u9650</h1>
        <p class="page-desc">\u7BA1\u7406 Hermes \u53EF\u8BBF\u95EE\u7684 Windows \u672C\u5730\u6587\u4EF6\u5939\uFF0C\u4FEE\u6539\u540E\u91CD\u542F\u751F\u6548</p>
      </div>

      <div class="section">
        <div class="section-title">\u6DFB\u52A0\u76EE\u5F55</div>
        <div class="card">
          <div style="margin-bottom:12px">
            <p class="text-sm text-muted" style="margin-bottom:12px">\u70B9\u51FB\u201C\u6D4F\u89C8\u201D\u9009\u62E9\u6587\u4EF6\u5939\uFF0C\u6216\u76F4\u63A5\u8F93\u5165\u8DEF\u5F84\u3002\u652F\u6301\u4E00\u6B21\u6DFB\u52A0\u591A\u4E2A\u76EE\u5F55\u3002</p>
            <div class="form-row" style="gap:8px">
              <input class="form-input" id="mount-path-input" placeholder="C:\\Users\\YourName\\Projects \u6216\u70B9\u51FB\u6D4F\u89C8" style="flex:2">
              <button class="btn btn-secondary btn-sm" id="btn-browse-folder">\u{1F4C2} \u6D4F\u89C8</button>
              <button class="btn btn-primary btn-sm" id="btn-add-mount">\u2795 \u6DFB\u52A0</button>
            </div>
          </div>
          <div id="pending-paths" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px"></div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">\u5DF2\u6302\u8F7D\u76EE\u5F55 (${mounts.length})</div>
        <div id="mounts-list">
          ${mounts.length === 0 ? '<div class="card"><div class="text-muted text-sm" style="padding:16px">\u6682\u65E0\u5DF2\u6302\u8F7D\u76EE\u5F55\u3002\u6DFB\u52A0\u540E Hermes \u5C31\u80FD\u8BBF\u95EE\u8FD9\u4E9B\u6587\u4EF6\u5939\u3002</div></div>' : ''}
          ${mounts.map(m => `
            <div class="card" style="margin-bottom:8px;padding:14px 18px">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                <div style="flex:1;min-width:0">
                  <div style="display:flex;align-items:center;gap:8px">
                    <span style="font-size:18px">${m.exists ? '\u{1F4C1}' : '\u26A0\uFE0F'}</span>
                    <span class="font-bold" style="font-size:var(--text-sm)">${m.label}</span>
                    ${!m.exists ? '<span class="badge badge-error">\u8DEF\u5F84\u4E0D\u5B58\u5728</span>' : ''}
                    ${m.enabled ? '<span class="badge badge-success">\u5DF2\u542F\u7528</span>' : '<span class="badge badge-warning">\u5DF2\u7981\u7528</span>'}
                    ${m.rw ? '<span class="badge badge-primary">RW</span>' : '<span class="badge badge-accent">RO</span>'}
                  </div>
                  <div class="text-mono text-xs" style="color:var(--fg-faint);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.path}</div>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0">
                  <button class="btn btn-sm ${m.enabled ? 'btn-secondary' : 'btn-success'}" data-toggle-mount="${m.path}" data-enabled="${m.enabled}">${m.enabled ? '\u7981\u7528' : '\u542F\u7528'}</button>
                  <button class="btn btn-sm ${m.rw ? 'btn-secondary' : 'btn-primary'}" data-toggle-rw="${m.path}" data-rw="${m.rw}">${m.rw ? '\u8BBE\u4E3A\u53EA\u8BFB' : '\u8BBE\u4E3A\u8BFB\u5199'}</button>
                  <button class="btn btn-sm btn-danger" data-remove-mount="${m.path}">\u79FB\u9664</button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      ${mounts.filter(m => m.enabled).length > 0 ? `
        <div class="section">
          <div class="section-title">\u5E94\u7528\u66F4\u6539</div>
          <div class="card">
            <p class="text-sm text-muted" style="margin-bottom:12px">\u4FEE\u6539\u6302\u8F7D\u76EE\u5F55\u540E\u9700\u8981\u91CD\u542F Hermes \u624D\u80FD\u751F\u6548\u3002</p>
            <button class="btn btn-primary" id="btn-restart-apply">\u{1F504} \u91CD\u542F Hermes \u5E94\u7528\u66F4\u6539</button>
          </div>
        </div>
      ` : ''}
    `;

    // ── Bind events ──
    let pendingPaths = [];
    const pendingEl = container.querySelector('#pending-paths');
    const pathInput = container.querySelector('#mount-path-input');

    function renderPending() {
      pendingEl.innerHTML = pendingPaths.map((p, i) => `
        <span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:var(--r-md);font-size:11px;font-family:var(--font-mono)">
          ${p}
          <span style="cursor:pointer;color:var(--fg-faint);font-weight:700" data-rm-pending="${i}">\u00D7</span>
        </span>
      `).join('');
      pendingEl.querySelectorAll('[data-rm-pending]').forEach(btn => {
        btn.onclick = () => { pendingPaths.splice(parseInt(btn.dataset.rmPending), 1); renderPending(); };
      });
    }

    // Add path from input
    container.querySelector('#btn-add-mount').onclick = async () => {
      const val = pathInput.value.trim();
      if (val) {
        pendingPaths.push(val);
        pathInput.value = '';
        renderPending();
      }

      if (pendingPaths.length === 0) { showToast('\u8BF7\u8F93\u5165\u6216\u6D4F\u89C8\u9009\u62E9\u76EE\u5F55', 'warning'); return; }

      const toAdd = [...pendingPaths];
      pendingPaths = [];
      renderPending();

      showToast(`\u6B63\u5728\u6DFB\u52A0 ${toAdd.length} \u4E2A\u76EE\u5F55...`, 'info');
      try {
        const r = await api.post('/api/mounts/add', { paths: toAdd });
        showToast(r.ok ? r.message : (r.error || '\u6DFB\u52A0\u5931\u8D25'), r.ok ? 'success' : 'error');
        if (r.errors && r.errors.length > 0) {
          r.errors.forEach(e => showToast(`${e.path}: ${e.error}`, 'warning'));
        }
        renderMounts(container);
      } catch (e) { showToast('\u8BF7\u6C42\u5931\u8D25: ' + e.message, 'error'); }
    };

    // Browse folder
    container.querySelector('#btn-browse-folder').onclick = () => openFolderBrowser(pathInput, pendingPaths, renderPending);

    // Toggle enable/disable
    container.querySelectorAll('[data-toggle-mount]').forEach(btn => {
      btn.onclick = async () => {
        const enabled = btn.dataset.enabled === 'true';
        try {
          const r = await api.post('/api/mounts/toggle', { path: btn.dataset.toggleMount, enabled: !enabled });
          showToast(r.ok ? r.message : (r.error || '\u5931\u8D25'), r.ok ? 'success' : 'error');
          renderMounts(container);
        } catch (e) { showToast('\u5931\u8D25: ' + e.message, 'error'); }
      };
    });

    // Toggle RW
    container.querySelectorAll('[data-toggle-rw]').forEach(btn => {
      btn.onclick = async () => {
        const rw = btn.dataset.rw === 'true';
        try {
          const r = await api.post('/api/mounts/toggle', { path: btn.dataset.toggleRw, rw: !rw });
          showToast(r.ok ? r.message : (r.error || '\u5931\u8D25'), r.ok ? 'success' : 'error');
          renderMounts(container);
        } catch (e) { showToast('\u5931\u8D25: ' + e.message, 'error'); }
      };
    });

    // Remove
    container.querySelectorAll('[data-remove-mount]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('\u786E\u5B9A\u79FB\u9664\u8BE5\u76EE\u5F55\uFF1F')) return;
        try {
          const r = await api.post('/api/mounts/remove', { path: btn.dataset.removeMount });
          showToast(r.ok ? r.message : (r.error || '\u79FB\u9664\u5931\u8D25'), r.ok ? 'success' : 'error');
          renderMounts(container);
        } catch (e) { showToast('\u5931\u8D25: ' + e.message, 'error'); }
      };
    });

    // Restart to apply
    const restartBtn = container.querySelector('#btn-restart-apply');
    if (restartBtn) {
      restartBtn.onclick = async () => {
        showToast('\u6B63\u5728\u91CD\u542F Hermes...', 'info');
        try {
          const r = await api.post('/api/hermes/restart');
          showToast(r.ok ? '\u91CD\u542F\u6210\u529F\uFF0C\u65B0\u6302\u8F7D\u5DF2\u751F\u6548' : (r.error || '\u91CD\u542F\u5931\u8D25'), r.ok ? 'success' : 'error');
        } catch (e) { showToast('\u91CD\u542F\u5931\u8D25: ' + e.message, 'error'); }
      };
    }

  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p class="text-error">\u52A0\u8F7D\u5931\u8D25: ${e.message}</p></div>`;
  }
}

function openFolderBrowser(pathInput, pendingPaths, renderPending) {
  let currentPath = '';

  async function loadDir(dirPath) {
    const url = dirPath ? `/api/mounts/browse?path=${encodeURIComponent(dirPath)}` : '/api/mounts/browse';
    const data = await api.get(url);
    return data;
  }

  async function renderBrowser(dirPath) {
    const data = await loadDir(dirPath);
    currentPath = data.current || '';

    const itemsHtml = data.items.map(item => `
      <div class="folder-item ${item.locked ? 'locked' : ''}" data-path="${item.path}" data-type="${item.type}">
        <span>${item.type === 'drive' ? '\u{1F4BF}' : item.locked ? '\u{1F512}' : '\u{1F4C1}'}</span>
        <span style="flex:1">${item.name}</span>
        ${item.type !== 'drive' ? '<span style="color:var(--fg-faint);font-size:11px">\u25B6</span>' : ''}
      </div>
    `).join('');

    const content = `
      <div style="margin-bottom:12px">
        <div class="text-mono text-xs" style="padding:8px 12px;background:var(--bg-tertiary);border-radius:var(--r-md);color:var(--fg-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${currentPath || '\u6211\u7684\u7535\u8111'}
        </div>
      </div>
      ${data.parent !== undefined && currentPath ? `<div class="folder-item" data-path="${data.parent}" data-type="parent"><span>\u2B06\uFE0F</span><span>\u8FD4\u56DE\u4E0A\u7EA7</span></div>` : ''}
      <div style="max-height:350px;overflow-y:auto">
        ${itemsHtml || '<div class="text-muted text-sm" style="padding:12px">\u7A7A\u76EE\u5F55</div>'}
      </div>
    `;

    const bodyEl = overlay.querySelector('.modal-body');
    bodyEl.innerHTML = content;

    // Bind folder clicks
    bodyEl.querySelectorAll('.folder-item').forEach(el => {
      el.onclick = () => {
        if (el.dataset.type === 'parent') {
          renderBrowser(el.dataset.path);
        } else if (!el.classList.contains('locked')) {
          renderBrowser(el.dataset.path);
        }
      };
    });
  }

  const overlay = showModal({
    title: '\u{1F4C2} \u6D4F\u89C8\u6587\u4EF6\u5939',
    content: '<div class="spinner" style="margin:20px auto"></div>',
    width: 500,
    buttons: [
      { label: '\u53D6\u6D88', cls: 'btn-secondary', onClick: () => overlay.remove() },
      { label: '\u9009\u62E9\u5F53\u524D\u76EE\u5F55', cls: 'btn-primary', onClick: () => {
        if (currentPath) {
          pendingPaths.push(currentPath);
          renderPending();
          pathInput.value = '';
          showToast(`\u5DF2\u6DFB\u52A0: ${currentPath}`, 'success');
        }
        overlay.remove();
      }},
    ],
  });

  renderBrowser('');
}

// ── Status Polling ───────────────────────────────────────────────────────────

let statusInterval = null;

function startStatusPolling() {
  if (statusInterval) return;
  statusInterval = setInterval(async () => {
    try {
      const status = await api.get('/api/status');
      const dot = document.getElementById('sidebar-status-dot');
      const text = document.getElementById('sidebar-status-text');
      if (dot) dot.className = `status-dot ${status.running ? 'online' : 'offline'}`;
      if (text) text.textContent = status.running ? '\u8FD0\u884C\u4E2D' : '\u5DF2\u505C\u6B62';
    } catch (e) { /* ignore */ }
  }, 5000);
}

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Bind nav
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.page));
  });

  // Initial render
  navigate('dashboard');
  startStatusPolling();
});
