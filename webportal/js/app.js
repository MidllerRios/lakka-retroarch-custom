const API = '/api';

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body && !(body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = new URLSearchParams(body).toString();
  } else if (body instanceof FormData) {
    opts.body = body;
  }
  try {
    const r = await fetch(API + path, opts);
    return r.json();
  } catch (e) {
    return { error: 'Erro de conexão com servidor' };
  }
}

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  document.getElementById('toast').appendChild(el);
  setTimeout(() => {
    if(el.parentNode) el.remove();
  }, 4000);
}

function escape(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

let _volCur = parseInt(localStorage.getItem('lakka-vol') || '0');
let _volMuted = false;

async function setVolume(action) {
  const r = await api('POST', '/console/volume_' + action);
  if (r && typeof r.db === 'number') {
    _volCur = r.db;
    localStorage.setItem('lakka-vol', String(_volCur));
  }
  if (action === 'mute') {
    _volMuted = !_volMuted;
    const icon = document.getElementById('vol-icon');
    if (icon) icon.style.fill = _volMuted ? 'var(--danger)' : 'var(--text2)';
  }
  refreshVolState();
}

function onVolumeSlider(val) {
  updateVolLabel(Number(val));
}

async function onVolumeChange(val) {
  const target = parseInt(val);
  if (target === Math.round(_volCur)) return;

  const slider = document.getElementById('vol-slider');
  const label = document.getElementById('vol-label');
  if (label) label.textContent = 'Aplicando...';
  if (slider) slider.disabled = true;

  await api('POST', '/console/volume_set/' + target);

  await pollVolumeDone();
}

function updateVolLabel(db) {
  const label = document.getElementById('vol-label');
  if (!label) return;
  if (db <= -80) { label.textContent = 'Mudo'; return; }
  const sign = db > 0 ? '+' : '';
  // Show 1 decimal place like RetroArch menu
  const dbStr = Number.isInteger(db) ? db.toFixed(1) : parseFloat(db).toFixed(1);
  label.textContent = `${sign}${dbStr} dB`;
}

function updateVolDisplay(db) {
  const slider = document.getElementById('vol-slider');
  if (slider) slider.value = Math.round(db);
  updateVolLabel(db);
}

async function refreshVolState() {
  const r = await api('GET', '/console/volume_state');
  if (r && typeof r.db === 'number') {
    _volCur = r.db;
    localStorage.setItem('lakka-vol', String(_volCur));
    updateVolDisplay(_volCur);
    // Update mute icon state
    const icon = document.getElementById('vol-icon');
    if (icon) {
      _volMuted = (_volCur <= -80);
      icon.style.fill = _volMuted ? 'var(--danger)' : 'var(--text2)';
    }
  }
  return r;
}

async function pollVolumeDone() {
  return new Promise(resolve => {
    const id = setInterval(async () => {
      try {
        const r = await api('GET', '/console/volume_state');
        const slider = document.getElementById('vol-slider');
        if (slider) slider.disabled = false;
        _volCur = r.db;
        localStorage.setItem('lakka-vol', String(_volCur));
        updateVolDisplay(_volCur);
        clearInterval(id);
        resolve();
      } catch(e) {
        clearInterval(id);
        const slider = document.getElementById('vol-slider');
        if (slider) slider.disabled = false;
        resolve();
      }
    }, 300);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const slider = document.getElementById('vol-slider');
  if (slider) {
    await refreshVolState();
    slider.onchange = function(){ onVolumeChange(this.value); };
  }
  // Sync actual volume from RetroArch config on page load
  api('POST', '/console/volume_sync').then(sync => {
    if (sync && typeof sync.db === 'number') {
      _volCur = sync.db;
      localStorage.setItem('lakka-vol', String(_volCur));
      updateVolDisplay(_volCur);
      // Update mute icon
      const icon = document.getElementById('vol-icon');
      if (icon) {
        _volMuted = (_volCur <= -80);
        icon.style.fill = _volMuted ? 'var(--danger)' : 'var(--text2)';
      }
    }
  });
  setTimeout(() => updateVolDisplay(_volCur), 100);

  // Poll volume_busy on page load (e.g. burst left running after page refresh)
  try {
    const s = await api('GET', '/console/volume_busy');
    if (s && s.busy) {
      if (slider) slider.disabled = true;
      await pollVolumeDone();
    }
  } catch(e) {}

  // Periodic volume sync: poll every 5s to detect console-side changes
  // Only updates UI if the slider is not being actively dragged
  setInterval(async () => {
    const sl = document.getElementById('vol-slider');
    if (sl && sl.disabled) return; // Skip if slider is busy
    if (document.activeElement === sl) return; // Skip if user is dragging
    try {
      const r = await api('GET', '/console/volume_state');
      if (r && typeof r.db === 'number' && r.db !== _volCur) {
        _volCur = r.db;
        localStorage.setItem('lakka-vol', String(_volCur));
        updateVolDisplay(_volCur);
        const icon = document.getElementById('vol-icon');
        if (icon) {
          _volMuted = (_volCur <= -80);
          icon.style.fill = _volMuted ? 'var(--danger)' : 'var(--text2)';
        }
      }
    } catch(e) {}
  }, 5000);
});

// ---- Clock ----
function updateClock() {
  document.getElementById('clock').textContent = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
setInterval(updateClock, 1000);
updateClock();

// ---- Theme & Layout ----
const themeBtn = document.getElementById('theme-btn');
const root = document.documentElement;
const savedTheme = localStorage.getItem('lakka-theme') || 'dark';
root.setAttribute('data-theme', savedTheme);

themeBtn.addEventListener('click', () => {
  const current = root.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  localStorage.setItem('lakka-theme', next);
});

const menuBtn = document.getElementById('menu-btn');
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('mobile-overlay');

function toggleMenu() {
  sidebar.classList.toggle('open');
  overlay.classList.toggle('show');
}
menuBtn.addEventListener('click', toggleMenu);
overlay.addEventListener('click', toggleMenu);

// ---- Router ----
const routes = {
  'dashboard': { title: 'Dashboard', render: renderDashboard },
  'roms': { title: 'ROMs', render: renderRoms },
  'roms-folder': { title: 'ROMs', render: renderRomsFolder },
  'download': { title: 'Download', render: renderDownload },
  'queue': { title: 'Fila de Downloads', render: renderQueue },
  'console': { title: 'Console', render: renderConsole },
  'console-bios': { title: 'BIOS', render: renderConsoleBios },
  'console-bluetooth': { title: 'Bluetooth', render: renderConsoleBluetooth },
  'console-fan': { title: 'Ventoinha', render: renderConsoleFan },
};

function navigate(hash) {
  hash = hash.replace(/^#\//, '') || 'dashboard';
  const parts = hash.split('/');
  const page = parts[0];
  const sub = parts[1];
  let route;
  if (page === 'roms' && parts[1]) {
    route = routes['roms-folder'];
  } else if (page === 'console' && sub === 'bios') {
    route = routes['console-bios'];
  } else if (page === 'console' && sub === 'bluetooth') {
    route = routes['console-bluetooth'];
  } else if (page === 'console' && sub === 'fan') {
    route = routes['console-fan'];
  } else {
    route = routes[page];
  }
  if (!route) { navigate('dashboard'); return; }
  
  document.querySelectorAll('.sidebar nav a').forEach(a => a.classList.remove('active'));
  const link = document.querySelector(`.sidebar nav a[data-page="${page}"]`);
  if (link) link.classList.add('active');
  
  if (window._queueTimer) { clearInterval(window._queueTimer); window._queueTimer = null; }
  if (window._scanTimer) { clearTimeout(window._scanTimer); window._scanTimer = null; }
  if (window._fanTimer) { clearInterval(window._fanTimer); window._fanTimer = null; }
  
  // Fechar menu mobile se estiver aberto
  sidebar.classList.remove('open');
  overlay.classList.remove('show');

  document.getElementById('page-title').textContent = route.title;
  const content = document.getElementById('page-content');
  
  // Transição suave
  content.classList.add('fade');
  setTimeout(() => {
    content.innerHTML = '<div class="loading">Carregando dados...</div>';
    content.classList.remove('fade');
    
    // Renderizar página assincronamente
    route.render(content, parts.slice(1)).catch(err => {
      content.innerHTML = `<div class="empty">Erro ao carregar a página: ${escape(err.message)}</div>`;
    });
  }, 250);
}

window.addEventListener('hashchange', () => navigate(window.location.hash));
window.addEventListener('DOMContentLoaded', () => navigate(window.location.hash || '#/'));

// ---- Dashboard ----
async function renderDashboard(el) {
  const data = await api('GET', '/info');
  if (data.error) {
    el.innerHTML = '<div class="card"><h3 style="color:var(--danger)">Erro ao buscar dados do sistema</h3></div>';
    return;
  }
  const m = data.mem || {};
  const d = data.disk || {};
  el.innerHTML = `
  <div class="grid">
    <div class="stat"><div class="value">${escape(data.cpu||'')}</div><div class="label">Processador</div></div>
    <div class="stat"><div class="value">${escape(data.load?.[0]||'')}</div><div class="label">Load (1m)</div></div>
    <div class="stat"><div class="value">${m.avail||'?'} MB</div><div class="label">RAM Livre</div></div>
    <div class="stat"><div class="value">${m.used||'?'} MB</div><div class="label">RAM Usada</div></div>
    <div class="stat"><div class="value">${d.avail||'?'}</div><div class="label">Disco Livre</div></div>
    <div class="stat"><div class="value">${d.used||'?'}</div><div class="label">Disco Usado</div></div>
    <div class="stat"><div class="value">${escape(data.temp||'')}</div><div class="label">Temperatura</div></div>
    <div class="stat"><div class="value">${escape(data.uptime||'').replace('up ','')}</div><div class="label">Ligado há</div></div>
  </div>
  <div class="card mt">
    <h2>Sistema Lakka</h2>
    <table>
      <tr><td>Hostname</td><td>${escape(data.hostname||'')}</td></tr>
      <tr><td>Plataforma</td><td>LibreELEC (RetroGaming)</td></tr>
      <tr><td>Memória Total</td><td>${m.total||'?'} MB</td></tr>
      <tr><td>Armazenamento</td><td>${d.size||'?'}</td></tr>
      <tr><td>Acesso Web</td><td><a href="http://${window.location.host}" class="text-accent" target="_blank">http://${window.location.host}</a></td></tr>
    </table>
  </div>`;
}

// ---- ROMs ----
async function renderRoms(el) {
  const tree = await api('GET', '/roms');
  if (tree.error) {
    el.innerHTML = '<div class="card"><h3 style="color:var(--danger)">Erro ao ler pastas de ROMs</h3></div>';
    return;
  }
  let rows = '';
  for (const [folder, data] of Object.entries(tree)) {
    const pct = Math.min(data.count * 2, 100);
    rows += `<tr>
      <td><a href="#/roms/${encodeURIComponent(folder)}" class="text-accent">${escape(folder)}</a></td>
      <td><strong>${data.count}</strong></td>
      <td style="width: 30%"><progress value="${pct}" max="100"></progress></td>
      <td style="text-align: right;"><button class="btn btn-outline btn-sm" onclick="deleteFolder('${escape(folder)}')">Limpar</button></td>
    </tr>`;
  }
  const folders = Object.keys(tree);
  const opts = folders.map(f => `<option value="${escape(f)}">${escape(f)}</option>`).join('');
  el.innerHTML = `
  <div class="flex flex-between mb">
    <h2>Diretórios de ROMs (${folders.length})</h2>
    <button class="btn btn-primary" onclick="toggleUpload()">
      <svg style="width:16px;height:16px;fill:currentColor;vertical-align:middle;margin-right:4px;" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg> Upload ROM
    </button>
  </div>
  <div id="upload-area" class="card hidden mb">
    <h3>Upload Manual</h3>
    <form id="upform" enctype="multipart/form-data">
      <div class="grid" style="align-items: end;">
        <div>
          <label>Sistema / Pasta</label>
          <select id="upfolder">${opts}</select>
        </div>
        <div>
          <label>Arquivo da ROM</label>
          <input type="file" id="upfile" required>
        </div>
        <div>
          <button type="submit" class="btn btn-primary btn-block">Enviar ao Lakka</button>
        </div>
      </div>
    </form>
  </div>
  <div class="card">
    <div style="overflow-x:auto;">
      <table>
        <thead><tr><th>Sistema</th><th>Qtd</th><th>Capacidade</th><th>Ações</th></tr></thead>
        <tbody>${rows||'<tr><td colspan="4" class="empty">Nenhuma pasta encontrada no /storage/roms</td></tr>'}</tbody>
      </table>
    </div>
  </div>`;
  document.getElementById('upform').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData();
    const file = document.getElementById('upfile').files[0];
    if(!file) return toast('Selecione um arquivo', 'err');
    fd.append('file', file);
    const f = document.getElementById('upfolder').value;
    toast('Enviando...', 'ok');
    const r = await api('POST', `/roms/${encodeURIComponent(f)}/upload`, fd);
    toast(r.msg || r.error || 'Erro', r.msg ? 'ok' : 'err');
    if(r.msg) {
      document.getElementById('upform').reset();
      navigate(window.location.hash);
    }
  };
}

function toggleUpload() {
  const el = document.getElementById('upload-area');
  el.classList.toggle('hidden');
}

async function deleteFolder(name) {
  if (!confirm(`CUIDADO: Tem certeza que deseja apagar a pasta '${name}' inteira e todas as suas ROMs?`)) return;
  const r = await api('DELETE', `/roms/${encodeURIComponent(name)}`);
  toast(r.msg || r.error || 'Excluído', r.msg ? 'ok' : 'err');
  navigate(window.location.hash);
}

async function renderRomsFolder(el, parts) {
  const folder = decodeURIComponent(parts[0]);
  const tree = await api('GET', '/roms');
  const data = tree[folder];
  if (!data) { el.innerHTML = '<div class="card"><h2>Pasta não encontrada</h2><button class="btn btn-primary mt" onclick="window.history.back()">Voltar</button></div>'; return; }

  const viewMode = localStorage.getItem('roms-view-' + folder) || 'grid';
  let cards = '';
  for (const rom of data.roms) {
    const cleanName = rom.replace(/\.(zip|7z|rar|iso|bin|chd|cue|smc|nes|gba|gb|gbc|nds|n64|z64)$/i, '');
    const thumbUrl = API + '/thumbnail/' + encodeURIComponent(folder) + '/' + encodeURIComponent(rom);
    cards += `
      <div class="rom-card" ondblclick="deleteRom('${escape(folder)}','${escape(rom)}')">
        <div class="rom-card-img-wrap">
          <img class="rom-card-img" src="${thumbUrl}" alt="${escape(rom)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'rom-card-placeholder\\'><svg viewBox=\\'0 0 24 24\\' width=\\'32\\' height=\\'32\\' fill=\\'%2394a3b8\\'><path d=\\'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z\\'/></svg></div>'">
        </div>
        <div class="rom-card-name">${escape(rom)}</div>
        <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteRom('${escape(folder)}','${escape(rom)}')">Excluir</button>
      </div>`;
  }

  el.innerHTML = `
  <div class="flex flex-between mb">
    <h2><a href="#/roms" class="text-accent">ROMs</a> <span style="color:var(--text2)">/</span> ${escape(folder)}</h2>
    <div class="flex">
      <button class="btn btn-outline btn-sm" onclick="scanFolder('${escape(folder)}')" title="Escanear apenas esta pasta">
        <svg style="width:14px;height:14px;fill:currentColor;vertical-align:middle;margin-right:4px;" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg> Scan
      </button>
      <span style="font-weight:600;color:var(--text2)">${data.count} Arquivos</span>
      <div class="view-toggle">
        <button class="btn btn-sm ${viewMode==='grid'?'btn-primary':'btn-outline'}" onclick="setRomsView('${escape(folder)}','grid')" title="Grade com Thumbnails">▦</button>
        <button class="btn btn-sm ${viewMode==='list'?'btn-primary':'btn-outline'}" onclick="setRomsView('${escape(folder)}','list')" title="Lista">☰</button>
      </div>
    </div>
  </div>
  <div id="scan-progress-folder" class="hidden mb" style="background:var(--surface2);border-radius:var(--radius);padding:0.75rem;border:1px solid var(--border);">
    <div class="flex flex-between mb" style="margin-bottom:0.4rem;">
      <span id="scan-msg-folder" style="font-weight:600;font-size:0.85rem;">Escaneando...</span>
      <span id="scan-pct-folder" style="color:var(--accent);font-weight:700;font-size:0.85rem;">0%</span>
    </div>
    <progress id="scan-bar-folder" value="0" max="100"></progress>
  </div>
  <div class="roms-container ${viewMode === 'grid' ? 'roms-grid' : 'roms-list'}">
    ${cards || '<div class="empty">Pasta vazia</div>'}
  </div>`;

  // Resume scan progress if one is active
  api('POST', '/console/scan_status').then(st => {
    if (st.status === 'scanning') {
      const prog = document.getElementById('scan-progress-folder');
      const msg = document.getElementById('scan-msg-folder');
      const pct = document.getElementById('scan-pct-folder');
      const bar = document.getElementById('scan-bar-folder');
      if (prog) {
        prog.classList.remove('hidden');
        msg.textContent = st.msg || 'Escaneando... (retomado)';
        pct.textContent = st.pct + '%';
        bar.value = st.pct;
      }
    }
  });
}

function setRomsView(folder, mode) {
  localStorage.setItem('roms-view-' + folder, mode);
  navigate('#/roms/' + encodeURIComponent(folder));
}

async function deleteRom(folder, rom) {
  if (!confirm(`Excluir a ROM '${rom}'?`)) return;
  const r = await api('DELETE', `/roms/${encodeURIComponent(folder)}/${encodeURIComponent(rom)}`);
  toast(r.msg || r.error || 'Excluído', r.msg ? 'ok' : 'err');
  navigate(window.location.hash);
}

// ---- Download ----
const SYS_MAP = {
  snes:'Super Nintendo', nes:'Nintendo (NES)', n64:'Nintendo 64', psx:'PlayStation 1',
  ps2:'PlayStation 2', gba:'Game Boy Advance', gbc:'Game Boy Color', gb:'Game Boy Original',
  megadrive:'Sega Mega Drive', arcade:'Arcade (MAME)', mastersystem:'Sega Master System', ds:'Nintendo DS'
};

async function renderDownload(el) {
  const repos = await api('GET', '/repos');
  let reposOpts = '';
  let reposList = '';
  
  if (repos && !repos.error) {
      reposOpts = repos.map(r => `<option value="${escape(r.id)}">${escape(r.name)}</option>`).join('');
      reposList = repos.map(r => `
        <tr>
          <td>${escape(r.name)}</td>
          <td><code style="font-size:0.7rem; color:var(--text2)">${escape(r.url)}</code></td>
          <td style="text-align:right">
            ${r.id !== 'romsgames' ? `<button class="btn btn-danger btn-sm" onclick="deleteRepo('${escape(r.id)}')">Remover</button>` : '<span style="font-size:0.75rem;color:var(--text2)">Padrão</span>'}
          </td>
        </tr>
      `).join('');
  }

  const sysOpts = '<option value="">Todas as Plataformas (Busca Global)</option>' + Object.entries(SYS_MAP).map(([k,v]) => `<option value="${k}">${v}</option>`).join('');
  
  el.innerHTML = `
  <div class="card">
    <div class="flex flex-between mb">
        <h2>Download Automático de ROMs</h2>
        <button class="btn btn-outline btn-sm" onclick="toggleRepoArea()">
          <svg style="width:16px;height:16px;fill:currentColor;vertical-align:middle;margin-right:4px;" viewBox="0 0 24 24"><path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/></svg> Fontes
        </button>
    </div>
    
    <div id="repo-area" class="hidden mb" style="border-left: 3px solid var(--accent); padding-left: 1rem; margin-bottom: 2rem;">
        <h3 style="font-size:0.95rem; margin-bottom: 0.5rem">Repositórios Cadastrados</h3>
        <div style="overflow-x:auto;">
          <table class="mb">
              <thead><tr><th>Nome</th><th>URL Base</th><th></th></tr></thead>
              <tbody>${reposList}</tbody>
          </table>
        </div>
        
        <h3 style="font-size:0.85rem; margin-top:1rem;">Nova Fonte JSON Compatível</h3>
        <form id="repo-form" class="grid" style="align-items:end; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));">
            <div><label>ID curto</label><input type="text" id="repo-id" placeholder="ex: meurepo" required></div>
            <div><label>Nome Visível</label><input type="text" id="repo-name" placeholder="ex: Minha Fonte" required></div>
            <div style="grid-column: span 2;"><label>URL Dinâmica (use {system} e {count})</label><input type="url" id="repo-url" placeholder="https://api.site.com/roms/{system}?limit={count}" required></div>
            <div><button type="submit" class="btn btn-primary btn-block">Adicionar</button></div>
        </form>
    </div>

    <div class="grid mb" style="align-items: end;">
      <div>
        <label>Fonte de Download</label>
        <select id="dl-repo">${reposOpts}</select>
      </div>
      <div>
        <label>Sistema</label>
        <select id="dl-sys">${sysOpts}</select>
      </div>
      <div>
        <label>Quantidade Máxima (Top N)</label>
        <input type="number" id="dl-count" value="50" min="1" max="100">
      </div>
    </div>
    
    <div class="mb">
      <input type="text" id="search-filter" style="width:100%; padding:0.8rem; font-size:1.1rem; border-radius:8px;" placeholder="Qual jogo você quer baixar? (ex: Mario)" onkeyup="filterRoms()">
    </div>
    
    <div class="mb">
      <button class="btn btn-primary btn-block" onclick="searchRoms()">Buscar Jogos</button>
    </div>
    
    <div id="search-area" class="hidden mt">
      <div id="bulk-actions" class="flex flex-between mb hidden" style="align-items:center;">
        <span id="bulk-count" style="font-weight:bold;">0 selecionados</span>
        <button id="btn-bulk-dl" class="btn btn-primary" onclick="downloadBulk()">🎮 Baixar Selecionados para Lakka</button>
      </div>
      <div style="overflow-x:auto; max-height:400px; border:1px solid var(--surface2); border-radius:8px;">
        <table style="margin:0;">
          <thead><tr><th style="width:40px;text-align:center;"><input type="checkbox" id="chk-all" onclick="toggleAllRoms(this)" title="Selecionar Todos"></th><th>Nome da ROM</th><th style="min-width:180px; text-align:right;">Baixar para</th></tr></thead>
          <tbody id="search-results"></tbody>
        </table>
      </div>
    </div>
  </div>`;
  
  const rForm = document.getElementById('repo-form');
  if(rForm) {
      rForm.onsubmit = async (e) => {
          e.preventDefault();
          const fd = {
              id: document.getElementById('repo-id').value,
              name: document.getElementById('repo-name').value,
              url: document.getElementById('repo-url').value
          };
          const r = await api('POST', '/repos', fd);
          toast(r.msg || r.error, r.error ? 'err' : 'ok');
          if (r.msg) navigate('#/download');
      };
  }
}

function toggleRepoArea() {
    document.getElementById('repo-area').classList.toggle('hidden');
}

async function deleteRepo(id) {
    if (!confirm('Tem certeza que deseja excluir esta fonte?')) return;
    const r = await api('DELETE', '/repos/' + encodeURIComponent(id));
    toast(r.msg || r.error, r.error ? 'err' : 'ok');
    if (r.msg) navigate('#/download');
}

async function searchRoms() {
  const query = document.getElementById('search-filter').value.trim();
  const repo_id = document.getElementById('dl-repo').value;
  const sys = document.getElementById('dl-sys').value;
  const count = document.getElementById('dl-count').value;
  const btn = document.querySelector('button[onclick="searchRoms()"]');
  const resultsBody = document.getElementById('search-results');
  const searchArea = document.getElementById('search-area');
  
  if (!query && !sys) {
    toast('Digite o nome do jogo ou selecione uma plataforma.', 'err');
    return;
  }
  
  searchArea.classList.remove('hidden');
  document.getElementById('bulk-actions').classList.add('hidden');
  document.getElementById('chk-all').checked = false;
  resultsBody.innerHTML = `<tr><td colspan="3" class="empty">Buscando ${query ? 'por "' + escape(query) + '"' : 'Top ' + count}... aguarde.</td></tr>`;
  btn.disabled = true;
  
  const r = await api('POST', '/search', { query, repo_id, system: sys, count });
  btn.disabled = false;
  
  if(r.error) {
    resultsBody.innerHTML = `<tr><td colspan="2" class="empty" style="color:var(--danger)">${escape(r.error)}</td></tr>`;
    return;
  }
  
  if(!r.results || !r.results.length) {
    resultsBody.innerHTML = '<tr><td colspan="3" class="empty">Nenhum jogo encontrado.</td></tr>';
    return;
  }
  
  window._lastRoms = r.results; // Guarda na memoria pra busca local
  window._lastSys = sys;
  filterRoms(); // Aplica o filtro imediatamente caso o usuário já tenha digitado
}

function renderRomsTable(list) {
  const tbody = document.getElementById('search-results');
  if(!list.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty">Nenhum jogo corresponde ao filtro.</td></tr>';
    return;
  }
  
  tbody.innerHTML = list.map((rom, i) => `
    <tr>
      <td style="text-align:center;"><input type="checkbox" class="chk-rom" data-index="${window._lastRoms.indexOf(rom)}" ${rom.installed ? 'disabled' : ''} onclick="updateBulkCount()" title="${rom.installed ? 'Já instalado no Lakka' : ''}"></td>
      <td>${escape(rom.name)} ${rom.installed ? '<span style="background:var(--success); color:#fff; padding:2px 6px; border-radius:4px; font-size:0.7rem; margin-left:8px;" title="Este jogo já se encontra no diretório do Lakka">✅ Instalado</span>' : ''}<br><small style="color:var(--primary); opacity:0.8; font-weight:bold;">${SYS_MAP[rom.sys] || escape(rom.sys || window._lastSys)}</small></td>
      <td style="text-align:right; display:flex; gap:0.5rem; justify-content:flex-end;">
        <button class="btn btn-outline btn-sm" style="flex:1;" onclick="downloadPC(${i})" title="Baixar para o meu Computador (Browser)">💻 PC</button>
        <button id="btn-lakka-${i}" class="btn ${rom.installed ? 'btn-outline' : 'btn-primary'} btn-sm" style="flex:1;" onclick="downloadSingle(${i})" title="O Console Lakka fará o download direto">${rom.installed ? '✅ Rebaixar' : '🎮 Lakka'}</button>
      </td>
    </tr>
  `).join('');
}

async function downloadPC(index) {
  const rom = window._lastRoms[index];
  toast('Extraindo link do servidor de ROMs...', 'ok');
  
  const r = await api('POST', '/resolve_download', { url: rom.url });
  if (r.download) {
      window.open(r.download, '_blank');
      toast('Download iniciado pelo navegador!', 'ok');
  } else {
      toast(r.error || 'Falha ao extrair link final.', 'err');
  }
}

function filterRoms() {
  if(!window._lastRoms) return;
  const q = document.getElementById('search-filter').value.toLowerCase();
  const filtered = window._lastRoms.filter(r => r.name.toLowerCase().includes(q));
  renderRomsTable(filtered);
}

function toggleAllRoms(chkAll) {
  const checkboxes = document.querySelectorAll('.chk-rom');
  for (const chk of checkboxes) {
      if (!chk.disabled) chk.checked = chkAll.checked;
  }
  updateBulkCount();
}

function updateBulkCount() {
  const count = document.querySelectorAll('.chk-rom:checked').length;
  const area = document.getElementById('bulk-actions');
  const span = document.getElementById('bulk-count');
  span.innerText = `${count} jogo(s) selecionado(s)`;
  if (count > 0) area.classList.remove('hidden');
  else area.classList.add('hidden');
}

async function downloadBulk() {
  const checkboxes = document.querySelectorAll('.chk-rom:checked');
  if(checkboxes.length === 0) return toast('Selecione ao menos um jogo', 'err');
  
  const btnBulk = document.getElementById('btn-bulk-dl');
  btnBulk.disabled = true;
  document.getElementById('chk-all').disabled = true;
  
  for(const chk of checkboxes) {
    const idx = parseInt(chk.getAttribute('data-index'));
    chk.disabled = true;
    await downloadSingle(idx, true);
    chk.checked = false;
  }
  
  toast(`Jogos adicionados à fila! Redirecionando...`, 'ok');
  btnBulk.disabled = false;
  document.getElementById('chk-all').disabled = false;
  document.getElementById('chk-all').checked = false;
  updateBulkCount();
  navigate('#/queue');
}

async function downloadSingle(index, isBatch=false) {
  const rom = window._lastRoms[index];
  const sys = rom.sys || window._lastSys;
  const btn = document.getElementById('btn-lakka-' + index);
  
  if(btn) btn.disabled = true;
  toast(`Enviando ${rom.name} para o Lakka...`, 'ok');
  
  const r = await api('POST', '/download_single', {
    system: sys,
    name: rom.name,
    url: rom.url
  });
  
  if(r.error) {
      if(btn) btn.disabled = false;
      toast(r.error, 'err');
      return false;
  }
  
  if(!isBatch) navigate('#/queue');
  return true;
}

// ---- Queue ----
async function renderQueue(el) {
  el.innerHTML = `
    <div class="flex flex-between mb">
      <h2>Fila e Histórico</h2>
      <button class="btn btn-outline btn-sm" onclick="clearQueueHistory()">🗑️ Limpar Concluídos</button>
    </div>
    <div class="card" style="padding:0; overflow-x:auto;">
      <table style="margin:0" id="queue-table">
        <thead><tr><th>Jogo</th><th>Status</th><th style="text-align:right">Ações</th></tr></thead>
        <tbody><tr><td colspan="3" class="empty">Carregando fila...</td></tr></tbody>
      </table>
    </div>
  `;
  
  async function loadQueue() {
      const dls = await api('GET', '/downloads');
      const tbody = document.querySelector('#queue-table tbody');
      if(!tbody) return;
      
      if(dls.error) {
         tbody.innerHTML = '<tr><td colspan="3" class="empty" style="color:var(--danger)">Erro ao buscar fila.</td></tr>';
         return;
      }
      if(dls.length === 0) {
         tbody.innerHTML = '<tr><td colspan="3" class="empty">Nenhum download na fila ou histórico.</td></tr>';
         return;
      }
      
      tbody.innerHTML = dls.map(t => {
          let badge = '';
          if(t.status==='queued') badge = `<span style="color:var(--text2)">⏳ Na Fila</span>`;
          else if(t.status==='resolving') badge = `<span style="color:var(--text2)">⏳ Extraindo link...</span>`;
          else if(t.status==='downloading') badge = `<span style="color:var(--accent); font-weight:bold;">⬇️ ${t.pct}% - ${escape(t.msg)}</span>`;
          else if(t.status==='done') badge = `<span style="color:var(--success)">✅ ${escape(t.msg)}</span>`;
          else if(t.status==='error') badge = `<span style="color:var(--danger)">❌ ${escape(t.msg)}</span>`;
          else if(t.status==='cancelled') badge = `<span style="color:var(--danger)">🛑 Cancelado</span>`;
          else badge = `<span>${t.status}</span>`;
          
          const btnAction = (t.status === 'queued' || t.status === 'downloading' || t.status === 'resolving') ?
              `<button class="btn btn-danger btn-sm" onclick="removeTask('${t.id}')">Abortar</button>` :
              `<button class="btn btn-outline btn-sm" onclick="removeTask('${t.id}')">Limpar</button>`;
          
          return `<tr><td>${escape(t.name)}<br><small style="color:var(--primary); font-weight:bold;">${SYS_MAP[t.system] || escape(t.system)}</small></td><td>${badge}</td><td style="text-align:right">${btnAction}</td></tr>`;
      }).reverse().join('');
  }
  
  loadQueue();
  window._queueTimer = setInterval(loadQueue, 1500);
}

async function removeTask(id) {
    const r = await api('DELETE', '/downloads/' + id);
    if(r.error) toast(r.error, 'err');
}

async function clearQueueHistory() {
    const dls = await api('GET', '/downloads');
    if(!dls.error) {
        for(const t of dls) {
            if(t.status === 'done' || t.status === 'error' || t.status === 'cancelled') {
                await api('DELETE', '/downloads/' + t.id);
            }
        }
    }
}

// ---- Console ----
async function renderConsole(el) {
  el.innerHTML = `
  <div class="card">
    <h2>Console</h2>
    <div class="console-grid">
      <a href="#/console/bluetooth" class="console-card">
        <svg viewBox="0 0 24 24"><path d="M14.24 12.01l2.32 2.32c.28-.72.44-1.51.44-2.33 0-.82-.16-1.59-.43-2.31l-2.33 2.32zm5.29-5.3l-1.26 1.26c.63 1.21.98 2.57.98 4.02s-.36 2.82-.98 4.02l1.2 1.2c.97-1.54 1.54-3.36 1.54-5.31-.01-1.89-.55-3.67-1.48-5.19zm-3.82 1L10 2H9v7.59L4.41 5 3 6.41 8.59 12 3 17.59 4.41 19 9 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM11 5.83l1.88 1.88L11 9.59V5.83zm1.88 10.46L11 18.17v-3.76l1.88 1.88z"/></svg>
        <span class="console-card-title">Bluetooth</span>
        <span class="console-card-desc">Gerenciar dispositivos Bluetooth</span>
      </a>
      <a href="#/console/bios" class="console-card">
        <svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .43-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.49-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
        <span class="console-card-title">BIOS / Firmware</span>
        <span class="console-card-desc">Verificar e instalar BIOS dos emuladores</span>
      </a>
      <a href="#/console/fan" class="console-card">
        <svg viewBox="0 0 24 24"><path d="M11.5 2C6.81 2 3 5.81 3 10.5c0 1.8.54 3.46 1.44 4.82L2 21l5.68-2.44c1.36.9 3.02 1.44 4.82 1.44C17.19 20 21 16.19 21 11.5S17.19 2 11.5 2zm1.5 13c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm1.12-4.37c-.42.32-.87.57-1.12.95-.25.38-.25.92-.25 1.42h-1.5c0-.75 0-1.5.38-2.03.37-.53.92-.88 1.42-1.23.52-.37 1.13-.74 1.13-1.49 0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5H9c0-1.66 1.34-3 3-3s3 1.34 3 3c0 .99-.5 1.68-1.38 2.38z"/></svg>
        <span class="console-card-title">Ventoinha</span>
        <span class="console-card-desc">Controle de temperatura e cooler</span>
      </a>
      <div class="console-card" onclick="startScan()" style="cursor:pointer;">
        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg>
        <span class="console-card-title">Escanear Playlists</span>
        <span class="console-card-desc">Atualizar playlists do RetroArch</span>
      </div>
      <div class="console-card" onclick="doAction('restart_ra')" style="cursor:pointer;">
        <svg viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
        <span class="console-card-title">Reiniciar RetroArch</span>
        <span class="console-card-desc">Reiniciar o servico do emulador</span>
      </div>
      <div class="console-card" onclick="doAction('restart')" style="cursor:pointer;">
        <svg viewBox="0 0 24 24"><path d="M13 3h-2v10h2V3zm4.83 2.17l-1.42 1.42C17.99 7.86 19 9.81 19 12c0 3.87-3.13 7-7 7s-7-3.13-7-7c0-2.19 1.01-4.14 2.58-5.42L6.17 5.17C4.23 6.82 3 9.26 3 12c0 4.97 4.03 9 9 9s9-4.03 9-9c0-2.74-1.23-5.18-3.17-6.83z"/></svg>
        <span class="console-card-title">Reboot Lakka</span>
        <span class="console-card-desc">Reiniciar o sistema completo</span>
      </div>
    </div>
    <div id="scan-progress" class="hidden mt" style="margin-top:1rem;">
      <div class="flex flex-between mb">
        <span id="scan-msg" style="font-weight:600;">Preparando...</span>
        <span id="scan-pct" style="color:var(--accent);font-weight:700;">0%</span>
      </div>
      <progress id="scan-bar" value="0" max="100"></progress>
      <pre id="scan-log" class="hidden" style="margin-top:0.5rem;max-height:150px;"></pre>
    </div>
    <pre id="con-log" class="hidden mt"></pre>
  </div>
  <div class="card">
    <div class="flex flex-between mb">
      <h2>Log RetroArch</h2>
      <button class="btn btn-outline btn-sm" onclick="loadLog()">Atualizar Log</button>
    </div>
    <pre id="ra-log" style="height:250px; overflow-y:auto; margin-top:0;">Carregando logs...</pre>
  </div>`;
  loadLog();
  // Resume scan progress if one is active
  api('POST', '/console/scan_status').then(st => {
    if (st.status === 'scanning') {
      const prog = document.getElementById('scan-progress');
      const msg = document.getElementById('scan-msg');
      const pct = document.getElementById('scan-pct');
      const bar = document.getElementById('scan-bar');
      if (prog) {
        prog.classList.remove('hidden');
        msg.textContent = st.msg || 'Escaneando... (retomado)';
        pct.textContent = st.pct + '%';
        bar.value = st.pct;
        window._scanTimer = setTimeout(() => watchScan(prog, msg, pct, bar, document.getElementById('scan-log')), 500);
      }
    }
  });
}

// ---- Console BIOS ----
async function renderConsoleBios(el) {
  el.innerHTML = `
  <div class="flex flex-between mb">
    <h2><a href="#/console" class="text-accent">Console</a> <span style="color:var(--text2)">/</span> BIOS / Firmware</h2>
  </div>
  <div id="bios-loading" class="loading">Verificando BIOS nos emuladores...</div>
  <div id="bios-content" class="hidden"></div>`;

  const data = await api('GET', '/bios/status');
  const loading = document.getElementById('bios-loading');
  const content = document.getElementById('bios-content');

  if (data.error) {
    loading.textContent = 'Erro ao verificar BIOS: ' + data.error;
    return;
  }

  loading.classList.add('hidden');
  content.classList.remove('hidden');

  let html = '';
  for (const [key, info] of Object.entries(data)) {
    const allOk = info.present === info.total;
    const pct = info.total > 0 ? Math.round(info.present / info.total * 100) : 0;
    html += `
    <div class="card bios-console" data-console="${key}">
      <div class="flex flex-between mb">
        <h3 style="margin:0;">
          <span class="bios-status-dot ${allOk ? 'dot-green' : 'dot-red'}"></span>
          ${info.label}
        </h3>
        <span class="bios-count">${info.present}/${info.total} arquivos</span>
      </div>
      <progress value="${pct}" max="100" style="margin-bottom:1rem;"></progress>
      <div class="bios-files">
        ${info.files.map(f => {
          const ok = f.exists && (f.md5_ok === null || f.md5_ok === true);
          const icon = ok ? '&#9989;' : (f.exists ? '&#9888;' : '&#10060;');
          const status = ok ? 'OK' : (f.exists ? 'MD5 invalido' : 'Ausente');
          return `<div class="bios-file-row ${ok ? 'ok' : 'missing'}">
            <span class="bios-file-icon">${icon}</span>
            <span class="bios-file-path">${f.path}</span>
            <span class="bios-file-desc">${f.desc}</span>
            <span class="bios-file-status">${status}</span>
            ${!ok ? `<button class="btn btn-outline btn-sm bios-upload-btn" onclick="uploadBios('${key}','${f.path}')">Upload</button>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  content.innerHTML = html + `
  <div class="card">
    <h3>Sobre os arquivos BIOS</h3>
    <p style="color:var(--text2); font-size:0.85rem; line-height:1.6;">
      Os arquivos BIOS s\u00e3o necess\u00e1rios para emular consoles. Eles n\u00e3o podem ser distribu\u00eddos por quest\u00f5es legais.
      Você deve extrair os BIOS do seu pr\u00f3prio console ou encontr\u00e1-los em fontes confi\u00e1veis.
      Ap\u00f3s o upload, reinicie o RetroArch no menu Console.
    </p>
  </div>`;
}

// ---- Bluetooth ----
let _btScanning = false;
let _btScanTimer = null;

async function renderConsoleBluetooth(el) {
  el.innerHTML = `
  <div class="flex flex-between mb">
    <h2><a href="#/console" class="text-accent">Console</a> <span style="color:var(--text2)">/</span> Bluetooth</h2>
    <div class="flex">
      <button class="btn btn-outline btn-sm" id="bt-scan-btn" onclick="toggleBtScan()">
        <svg style="width:14px;height:14px;fill:currentColor;vertical-align:middle;margin-right:4px;" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg> <span id="bt-scan-label">Escanear</span>
      </button>
      <button class="btn btn-outline btn-sm" onclick="refreshBluetooth()">
        <svg style="width:14px;height:14px;fill:currentColor;vertical-align:middle;margin-right:4px;" viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg> Atualizar
      </button>
    </div>
  </div>
  <div id="bt-status-bar" class="flex flex-between mb" style="gap:1rem;"></div>
  <div id="bt-scan-msg" class="hidden mb" style="background:var(--surface2);border-radius:var(--radius);padding:0.75rem;border:1px solid var(--border);">
    <span style="color:var(--accent);font-weight:600;">Escaneando dispositivos Bluetooth nas proximidades...</span>
  </div>
  <div id="bt-devices" class="loading">Carregando dispositivos...</div>`;
  await refreshBluetooth();
}

async function refreshBluetooth() {
  const statusEl = document.getElementById('bt-status-bar');
  const devEl = document.getElementById('bt-devices');
  if (!devEl) return;

  const [status, devices] = await Promise.all([
    api('POST', '/bluetooth/status'),
    api('POST', '/bluetooth/devices'),
  ]);

  if (statusEl) {
    const on = status.powered ? '<span style="color:var(--success)">&#9679; Ligado</span>' : '<span style="color:var(--danger)">&#9679; Desligado</span>';
    const pa = status.pairable ? 'Pare&#225;vel' : 'N&#227;o pare&#225;vel';
    const di = status.discoverable ? 'Descoberta Ativa' : 'Descoberta Inativa';
    statusEl.innerHTML = `
      <div class="stat" style="flex:1;"><div class="value">${on}</div><div class="label">Adaptador</div></div>
      <div class="stat" style="flex:1;"><div class="value" style="font-size:1rem;">${status.mac||'---'}</div><div class="label">MAC</div></div>
      <div class="stat" style="flex:1;"><div class="value" style="font-size:0.9rem;">${pa} &middot; ${di}</div><div class="label">Configura&#231;&#227;o</div></div>`;
  }

  if (!devices || devices.error) {
    devEl.innerHTML = '<div class="card"><span style="color:var(--danger)">Erro ao buscar dispositivos</span></div>';
    return;
  }

  const paired = devices.filter(d => d.paired);
  const unpaired = devices.filter(d => !d.paired);

  let html = '';
  if (paired.length > 0) {
    html += '<h3 style="margin-bottom:0.75rem;margin-top:1rem;">Dispositivos Pareados</h3>';
    html += paired.map(d => {
      const icon = d.connected ? '<span style="color:var(--success);font-size:1.2rem;">&#9679;</span>' : '<span style="color:var(--text2);font-size:1.2rem;">&#9675;</span>';
      const statusText = d.connected ? 'Conectado' : 'Desconectado';
      const statusColor = d.connected ? 'var(--success)' : 'var(--text2)';
      return `<div class="bt-device ${d.connected ? 'connected' : ''}">
        <div class="bt-device-info">
          <div class="bt-device-icon">${icon}</div>
          <div>
            <div class="bt-device-name">${escape(d.name || '(sem nome)')}</div>
            <div class="bt-device-mac">${d.mac}</div>
          </div>
        </div>
        <div class="bt-device-actions">
          <span style="color:${statusColor};font-weight:600;font-size:0.75rem;">${statusText}</span>
          ${d.connected
            ? `<button class="btn btn-outline btn-sm" onclick="btDisconnect('${d.mac}')">Desconectar</button>`
            : `<button class="btn btn-primary btn-sm" onclick="btConnect('${d.mac}')">Conectar</button>`
          }
          <button class="btn btn-danger btn-sm" onclick="btRemove('${d.mac}','${escape(d.name)}')">Remover</button>
        </div>
      </div>`;
    }).join('');
  }

  if (unpaired.length > 0) {
    html += '<h3 style="margin-bottom:0.75rem;margin-top:1rem;">Dispositivos Descobertos</h3>';
    html += unpaired.map(d => {
      return `<div class="bt-device">
        <div class="bt-device-info">
          <div class="bt-device-icon"><span style="color:var(--accent);font-size:1.2rem;">&#9899;</span></div>
          <div>
            <div class="bt-device-name">${escape(d.name || '(sem nome)')}</div>
            <div class="bt-device-mac">${d.mac}</div>
          </div>
        </div>
        <div class="bt-device-actions">
          <span style="color:var(--accent);font-weight:600;font-size:0.75rem;">Novo</span>
          <button class="btn btn-primary btn-sm" onclick="btPair('${d.mac}')">Parear</button>
        </div>
      </div>`;
    }).join('');
  }

  if (!html) {
    html = '<div class="card empty">Nenhum dispositivo encontrado. Clique em <strong>Escanear</strong> para buscar dispositivos nas proximidades.</div>';
  }
  devEl.innerHTML = html;
}

async function toggleBtScan() {
  const btn = document.getElementById('bt-scan-btn');
  const label = document.getElementById('bt-scan-label');
  const msg = document.getElementById('bt-scan-msg');

  if (_btScanning) {
    await api('POST', '/bluetooth/scan', { action: 'off' });
    await api('POST', '/bluetooth/pairable', { action: 'off' });
    await api('POST', '/bluetooth/discoverable', { action: 'off' });
    _btScanning = false;
    if (btn) btn.classList.remove('btn-primary');
    if (label) label.textContent = 'Escanear';
    if (msg) msg.classList.add('hidden');
    if (_btScanTimer) { clearInterval(_btScanTimer); _btScanTimer = null; }
  } else {
    await api('POST', '/bluetooth/scan', { action: 'on' });
    await api('POST', '/bluetooth/pairable', { action: 'on' });
    await api('POST', '/bluetooth/discoverable', { action: 'on' });
    _btScanning = true;
    if (btn) btn.classList.add('btn-primary');
    if (label) label.textContent = 'Parar Scan';
    if (msg) msg.classList.remove('hidden');
    refreshBluetooth();
    _btScanTimer = setInterval(refreshBluetooth, 3000);
    // Auto-stop scan UI after 12s (background scan --timeout 8 + buffer)
    setTimeout(() => {
      if (_btScanning) {
        // Check if discovery is still active; if not, stop UI
        api('POST', '/bluetooth/scan_status').then(st => {
          if (!st.scanning) {
            // Discovery stopped naturally — reset UI
            _btScanning = false;
            if (btn) btn.classList.remove('btn-primary');
            if (label) label.textContent = 'Escanear';
            if (msg) {
              msg.innerHTML = '<span style="color:var(--text2);font-weight:600;">Scan conclu\u00eddo.</span>';
              setTimeout(() => msg.classList.add('hidden'), 3000);
            }
            if (_btScanTimer) { clearInterval(_btScanTimer); _btScanTimer = null; }
            // Scan stopped on backend too
            refreshBluetooth();
          }
        });
      }
    }, 12000);
  }
}

async function btConnect(mac) {
  const r = await api('POST', '/bluetooth/connect/' + mac);
  toast(r.msg || 'Conectado', 'ok');
  refreshBluetooth();
}

async function btDisconnect(mac) {
  const r = await api('POST', '/bluetooth/disconnect/' + mac);
  toast(r.msg || 'Desconectado', 'ok');
  refreshBluetooth();
}

async function btPair(mac) {
  toast('Pareando... Coloque o dispositivo em modo de pareamento se necessario.', 'ok');
  const r = await api('POST', '/bluetooth/pair/' + mac);
  if (r.msg) { toast(r.msg, 'ok'); }
  if (r.error) { toast(r.error, 'err'); }
  refreshBluetooth();
}

async function btRemove(mac, name) {
  if (!confirm(`Remover pareamento de '${name}' (${mac})?`)) return;
  const r = await api('POST', '/bluetooth/remove/' + mac);
  toast(r.msg || 'Removido', 'ok');
  refreshBluetooth();
}

async function uploadBios(biosKey, destPath) {
  const input = document.createElement('input');
  input.type = 'file';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('bios_key', biosKey);
    fd.append('dest_path', destPath);
    toast('Enviando ' + file.name + '...', 'ok');
    const r = await api('POST', '/bios/upload', fd);
    if (r.msg) {
      toast(r.msg, 'ok');
      navigate('#/console/bios');
    } else {
      toast(r.error || 'Erro no upload', 'err');
    }
  };
  input.click();
}

async function scanFolder(folder) {
  const prog = document.getElementById('scan-progress-folder');
  const msg = document.getElementById('scan-msg-folder');
  const pct = document.getElementById('scan-pct-folder');
  const bar = document.getElementById('scan-bar-folder');

  prog.classList.remove('hidden');
  msg.textContent = 'Escaneando ' + folder + '...';
  pct.textContent = '0%';
  bar.value = 0;

  const r = await api('POST', '/console/scan_start', { folder });
  if (r.error) { toast(r.error, 'err'); msg.textContent = r.error; return; }
  toast('Scan de ' + folder + ' iniciado!', 'ok');
  window._scanTimer = setTimeout(() => watchScan(prog, msg, pct, bar, null), 500);
}

async function watchScan(prog, msg, pct, bar, logEl) {
  const st = await api('POST', '/console/scan_status');
  if (prog) {
    msg.textContent = st.msg || 'Escaneando...';
    pct.textContent = st.pct + '%';
    bar.value = st.pct;
  }
  if (st.status === 'scanning') {
    window._scanTimer = setTimeout(() => watchScan(prog, msg, pct, bar, logEl), 1500);
  } else if (st.status === 'done' && prog) {
    msg.textContent = st.msg || 'Scan concluido!';
    pct.textContent = '100%';
    bar.value = 100;
    if (st.errors && st.errors.length) {
      logEl.classList.remove('hidden');
      logEl.textContent = 'Erros:\n' + st.errors.join('\n');
    }
    toast('Scan finalizado!', 'ok');
  }
}

async function startScan() {
  const prog = document.getElementById('scan-progress');
  const msg = document.getElementById('scan-msg');
  const pct = document.getElementById('scan-pct');
  const bar = document.getElementById('scan-bar');
  const logEl = document.getElementById('scan-log');

  prog.classList.remove('hidden');
  logEl.classList.add('hidden');
  msg.textContent = 'Iniciando scan...';
  pct.textContent = '0%';
  bar.value = 0;

  const r = await api('POST', '/console/scan_start');
  if (r.error) { toast(r.error, 'err'); msg.textContent = r.error; return; }

  toast('Scan iniciado! Acompanhe o progresso abaixo.', 'ok');
  window._scanTimer = setTimeout(() => watchScan(prog, msg, pct, bar, logEl), 500);
}

async function doAction(action) {
  const log = document.getElementById('con-log');
  log.classList.remove('hidden');
  log.textContent = 'Enviando comando ' + action + '...';
  const r = await api('POST', '/console/' + action);
  log.textContent = r.msg || r.error || 'Sucesso';
  toast(r.msg || r.error || 'Comando enviado', r.msg ? 'ok' : 'err');
}

// ---- Fan Control ----
let _fanTimer = null;

async function renderConsoleFan(el) {
  el.innerHTML = `
  <div class="flex flex-between mb">
    <h2><a href="#/console" class="text-accent">Console</a> <span style="color:var(--text2)">/</span> Ventoinha</h2>
    <button class="btn btn-outline btn-sm" onclick="refreshFan()">
      <svg style="width:14px;height:14px;fill:currentColor;vertical-align:middle;margin-right:4px;" viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg> Atualizar
    </button>
  </div>
  <div id="fan-status" class="loading">Carregando...</div>`;
  await refreshFan();
  if (_fanTimer) clearInterval(_fanTimer);
  _fanTimer = setInterval(refreshFan, 5000);
}

async function refreshFan() {
  const el = document.getElementById('fan-status');
  if (!el) return;
  const r = await api('POST', '/fan/status');
  if (r.error) { el.innerHTML = '<div class="card"><span style="color:var(--danger)">' + escape(r.error) + '</span></div>'; return; }

  const cpu = r.temps.cpu || 0;
  const ambient = r.temps.ambient || 0;
  const cpuColor = cpu >= 85 ? 'var(--danger)' : cpu >= 70 ? 'var(--warning)' : 'var(--success)';

  let html = `
  <div class="flex" style="gap:1rem;margin-bottom:1rem;">
    <div class="stat" style="flex:1;"><div class="value" style="color:${cpuColor};">${cpu}&deg;C</div><div class="label">CPU</div></div>
    <div class="stat" style="flex:1;"><div class="value">${ambient}&deg;C</div><div class="label">Ambiente</div></div>
    <div class="stat" style="flex:1;"><div class="value" style="font-size:0.9rem;">${r.auto_mode ? '<span style="color:var(--success);">Auto</span>' : '<span style="color:var(--warning);">Manual</span>'}</div><div class="label">Modo</div></div>
  </div>
  <div class="mb">
    <label class="toggle-label">
      <span>Controle autom&aacute;tico (liga ventoinhas aos 85&deg;C)</span>
      <input type="checkbox" id="fan-auto-toggle" ${r.auto_mode ? 'checked' : ''} onchange="toggleFanAuto()">
      <span class="toggle-slider"></span>
    </label>
  </div>
  <h3 style="margin-bottom:0.75rem;">Ventoinhas</h3>`;

  for (const fan of r.fans) {
    if (fan.type !== 'Fan') continue;
    const isOn = fan.cur === 1;
    html += `<div class="bt-device">
      <div class="bt-device-info">
        <div class="bt-device-icon"><span style="color:${isOn ? 'var(--success)' : 'var(--text2)'};font-size:1.5rem;">${isOn ? '&#9733;' : '&#9734;'}</span></div>
        <div>
          <div class="bt-device-name">Ventoinha ${fan.id + 1}</div>
          <div class="bt-device-mac">${isOn ? 'Ligada' : 'Desligada'} &middot; Max: ${fan.max}</div>
        </div>
      </div>
      <div class="bt-device-actions">
        <button class="btn btn-sm ${isOn ? 'btn-outline' : 'btn-primary'}" onclick="setFan(${fan.id}, ${isOn ? 0 : 1})">
          ${isOn ? 'Desligar' : 'Ligar'}
        </button>
      </div>
    </div>`;
  }

  if (cpu >= 85) {
    html += `<div class="card" style="background:var(--danger);color:white;margin-top:0.75rem;">Temperatura alta! Ventoinhas acionadas automaticamente.</div>`;
  }

  el.innerHTML = html;
}

async function toggleFanAuto() {
  const val = document.getElementById('fan-auto-toggle').checked ? '1' : '0';
  const r = await api('POST', '/fan/set', { mode: 'auto', value: val });
  toast(r.msg || 'OK', 'ok');
}

async function setFan(id, val) {
  const r = await api('POST', '/fan/set', { id: id.toString(), value: val.toString() });
  toast(r.msg || r.error || 'OK', r.msg ? 'ok' : 'err');
  refreshFan();
}

async function loadLog() {
  const el = document.getElementById('ra-log');
  el.textContent = 'Buscando logs do retroarch no lakka...';
  const r = await api('GET', '/log');
  el.textContent = r.log || r.error || 'Arquivo de log vazio ou inacessível';
  el.scrollTop = el.scrollHeight; // Auto-scroll bottom
}
