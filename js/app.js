import { loadBoard, saveBoard } from './github.js';

const DOMAINS = ['home', 'work', 'apps'];
const DOMAIN_LABELS = { home: 'Home', work: 'Work', apps: 'Apps' };
const STATUS_LABELS = { todo: 'To Do', 'in-progress': 'In Progress', done: 'Done' };
const DATA_PATH = 'board.json';
const CONFIG_KEY = 'kanban-config';

let cfg = null;
let tasks = [];
let sha = null;
let saving = false;
let saveQueued = null;
let demoMode = false;
let filterDomains = new Set(DOMAINS);
let activeView = 'list';
let activeScope = 'incomplete'; // 'all' | 'upcoming' | 'incomplete'
let activeSortDir = 'asc'; // 'asc' = oldest first, 'desc' = newest first
let filterImportance = 'all'; // 'all' | 'important' | 'normal'
let editingId = null;
let draggedId = null;

// ── Utilities ─────────────────────────────────────────────────────────────────

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysUntil(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const t = new Date(todayStr() + 'T00:00:00');
  return Math.round((d - t) / 86400000);
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function dueDateClass(task) {
  if (!task.dueDate || task.status === 'done') return '';
  const days = daysUntil(task.dueDate);
  if (days < 0) return 'overdue';
  if (days <= 3) return 'due-soon';
  return '';
}

function dueDateLabel(task) {
  if (!task.dueDate) return '';
  const days = daysUntil(task.dueDate);
  if (task.status === 'done') return `Due ${formatDate(task.dueDate)}`;
  if (days < 0) return `Overdue · ${formatDate(task.dueDate)}`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days <= 7) return `Due in ${days} days`;
  return `Due ${formatDate(task.dueDate)}`;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function filteredTasks() {
  let ft = filterDomains.size === DOMAINS.length ? tasks : tasks.filter(t => filterDomains.has(t.domain));
  if (filterImportance === 'important') ft = ft.filter(t => t.important);
  if (filterImportance === 'normal') ft = ft.filter(t => !t.important);
  return ft;
}

// ── Config ────────────────────────────────────────────────────────────────────

function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY)); } catch { return null; }
}

function persistConfig(c) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
}

// ── Status bar ────────────────────────────────────────────────────────────────

let statusTimer = null;

function showStatus(msg, type = '') {
  const bar = document.getElementById('status-bar');
  const txt = document.getElementById('status-message');
  clearTimeout(statusTimer);
  txt.textContent = msg;
  bar.className = type;
  bar.hidden = false;
  if (type === 'success' || type === '') {
    statusTimer = setTimeout(() => { bar.hidden = true; }, 2500);
  }
}

// ── Persist ───────────────────────────────────────────────────────────────────

async function persist(message, applyChange = null) {
  if (saving) {
    saveQueued = { message, applyChange };
    return;
  }
  saving = true;
  showStatus('Saving…');
  try {
    sha = await saveBoard(cfg.token, cfg.owner, cfg.repo, cfg.branch, DATA_PATH,
      { version: 1, tasks }, sha, message);
    showStatus('Saved', 'success');
  } catch (err) {
    if (err.message && err.message.includes('does not match')) {
      try {
        const current = await loadBoard(cfg.token, cfg.owner, cfg.repo, cfg.branch, DATA_PATH);
        sha = current.sha;
        if (applyChange) {
          tasks = applyChange(current.data.tasks || []);
          renderAll();
        }
        sha = await saveBoard(cfg.token, cfg.owner, cfg.repo, cfg.branch, DATA_PATH,
          { version: 1, tasks }, sha, message);
        showStatus('Saved', 'success');
      } catch (retryErr) {
        showStatus(`Save failed: ${retryErr.message}`, 'error');
      }
    } else {
      showStatus(`Save failed: ${err.message}`, 'error');
    }
  } finally {
    saving = false;
    if (saveQueued) {
      const q = saveQueued;
      saveQueued = null;
      await persist(q.message, q.applyChange);
    }
  }
}

// ── Render helpers ────────────────────────────────────────────────────────────

function domainBadge(domain) {
  return `<span class="domain-badge" data-domain="${domain}">${DOMAIN_LABELS[domain]}</span>`;
}

function statusBadge(status) {
  return `<span class="status-badge" data-status="${status}">${STATUS_LABELS[status]}</span>`;
}

function cardHTML(task) {
  const dc = dueDateClass(task);
  const dl = dueDateLabel(task);
  const star = task.important ? '<span class="important-icon" aria-label="Important">★</span>' : '';
  return `
    <article class="task-card" data-id="${task.id}" data-domain="${task.domain}"
      data-status="${task.status}" draggable="true" role="listitem"
      tabindex="0" aria-label="${esc(task.title)}">
      <div class="task-card-header">
        <span class="task-title">${star}${esc(task.title)}</span>
        ${domainBadge(task.domain)}
      </div>
      ${dl ? `<div class="due-date-badge ${dc}">📅 ${esc(dl)}</div>` : ''}
    </article>`;
}

// ── Sound ─────────────────────────────────────────────────────────────────────

function playDoneSound() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  [[523.25, 0], [659.25, 0.07], [783.99, 0.14]].forEach(([freq, delay]) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = ctx.currentTime + delay;
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.start(t);
    osc.stop(t + 0.35);
  });
}

// ── Kanban ────────────────────────────────────────────────────────────────────

function sortTasks(list) {
  const dir = activeSortDir === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => {
    const aDone = a.status === 'done' ? 1 : 0;
    const bDone = b.status === 'done' ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return dir * (a.createdAt || '').localeCompare(b.createdAt || '');
  });
}

function completionFiltered() {
  const ft = filteredTasks();
  if (activeScope === 'incomplete') return ft.filter(t => t.status !== 'done');
  if (activeScope === 'upcoming') return ft.filter(t => t.dueDate);
  return ft;
}

function renderKanban() {
  const ft = completionFiltered();
  document.querySelector('.kanban-board').classList.toggle('hide-done', activeScope === 'incomplete');
  document.querySelectorAll('.kanban-column').forEach(col => {
    const status = col.dataset.status;
    const colTasks = sortTasks(ft.filter(t => t.status === status));
    col.querySelector('.column-count').textContent = colTasks.length;
    col.querySelector('.column-cards').innerHTML = colTasks.map(cardHTML).join('');
  });
}

// ── List ──────────────────────────────────────────────────────────────────────

function renderList() {
  const ft = completionFiltered();
  const tbody = document.getElementById('list-tbody');
  if (!ft.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">No tasks</td></tr>';
    return;
  }
  const sorted = sortTasks(ft);
  tbody.innerHTML = sorted.map(t => `
    <tr data-id="${t.id}" tabindex="0">
      <td class="complete-cell">
        <button class="complete-btn ${t.status === 'done' ? 'is-done' : ''}"
          data-id="${t.id}" aria-label="Mark complete" tabindex="0">
          ${t.status === 'done' ? '✓' : ''}
        </button>
      </td>
      <td class="${t.status === 'done' ? 'done-title' : ''}">${t.important ? '<span class="important-icon" aria-label="Important">★</span>' : ''}${esc(t.title)}</td>
      <td>${domainBadge(t.domain)}</td>
      <td>${statusBadge(t.status)}</td>
      <td>${t.dueDate
        ? `<span class="due-date-badge ${dueDateClass(t)}">${esc(dueDateLabel(t))}</span>`
        : '<span class="muted">—</span>'
      }</td>
    </tr>`).join('');
}

// ── Render all ────────────────────────────────────────────────────────────────

function renderAll() {
  document.getElementById('kanban-view').hidden = activeView !== 'kanban';
  document.getElementById('list-view').hidden = activeView !== 'list';
  if (activeView === 'kanban') renderKanban();
  else renderList();
}

// ── View switching ────────────────────────────────────────────────────────────

function switchView(view) {
  activeView = view;
  document.querySelectorAll('.view-switcher .pill-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
    btn.setAttribute('aria-pressed', btn.dataset.view === view);
  });
  renderAll();
}

// ── Domain filter ─────────────────────────────────────────────────────────────

function setDomainFilter(domain) {
  if (domain === 'all') {
    filterDomains = new Set(DOMAINS);
  } else if (filterDomains.size === 1 && filterDomains.has(domain)) {
    filterDomains = new Set(DOMAINS);
  } else {
    filterDomains = new Set([domain]);
  }
  updateFilterButtons();
  renderAll();
}

function updateFilterButtons() {
  document.querySelectorAll('.domain-filter .pill-btn').forEach(btn => {
    const d = btn.dataset.domain;
    const active = d === 'all'
      ? filterDomains.size === DOMAINS.length
      : filterDomains.size === 1 && filterDomains.has(d);
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active);
  });
}

function resetFilters() {
  filterDomains = new Set(DOMAINS);
  activeScope = 'incomplete';
  activeView = 'list';
  activeSortDir = 'asc';
  filterImportance = 'all';
  updateFilterButtons();
  document.querySelectorAll('.completion-filter .pill-btn').forEach(b => {
    const on = b.dataset.scope === activeScope;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on);
  });
  document.querySelectorAll('.view-switcher .pill-btn').forEach(b => {
    const on = b.dataset.view === activeView;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on);
  });
  document.querySelectorAll('.sort-filter .pill-btn').forEach(b => {
    const on = b.dataset.sort === activeSortDir;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on);
  });
  document.querySelectorAll('.importance-filter .pill-btn').forEach(b => {
    const on = b.dataset.importance === filterImportance;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on);
  });
  renderAll();
}

// ── Task dialog ───────────────────────────────────────────────────────────────

function openTaskDialog(taskId = null, defaultStatus = 'todo') {
  editingId = taskId;
  const dialog = document.getElementById('task-dialog');
  const titleEl = document.getElementById('task-dialog-title');
  const form = document.getElementById('task-form');
  const deleteBtn = document.getElementById('delete-task-btn');

  if (taskId) {
    const t = tasks.find(x => x.id === taskId);
    if (!t) return;
    titleEl.textContent = 'Edit Task';
    form.title.value = t.title;
    form.description.value = t.description || '';
    form.domain.value = t.domain;
    form.status.value = t.status;
    form.dueDate.value = t.dueDate || '';
    form.important.checked = !!t.important;
    deleteBtn.hidden = false;
  } else {
    titleEl.textContent = 'Add Task';
    form.reset();
    form.domain.value = filterDomains.size === 1 ? [...filterDomains][0] : 'home';
    form.status.value = defaultStatus;
    deleteBtn.hidden = true;
  }

  dialog.showModal();
  setTimeout(() => form.title.focus(), 50);
}

function closeTaskDialog() {
  document.getElementById('task-dialog').close();
  editingId = null;
}

// ── Setup dialog ──────────────────────────────────────────────────────────────

function openSetupDialog() {
  const dialog = document.getElementById('setup-dialog');
  const form = dialog.querySelector('form');
  if (cfg) {
    form.owner.value = cfg.owner;
    form.repo.value = cfg.repo;
    form.branch.value = cfg.branch;
  }
  dialog.showModal();
}

// ── Demo mode ─────────────────────────────────────────────────────────────────

function requireDataRepo() {
  if (!demoMode) return true;
  document.getElementById('connect-dialog').showModal();
  return false;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

async function saveTask(data, id = null) {
  if (!requireDataRepo()) return;
  const now = new Date().toISOString();
  if (id) {
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return;
    tasks[idx] = { ...tasks[idx], ...data, updatedAt: now };
    const updated = tasks[idx];
    await persist(`Update: ${updated.title}`,
      remoteTasks => remoteTasks.map(t => t.id === updated.id ? updated : t));
  } else {
    const task = { id: uid(), ...data, createdAt: now, updatedAt: now };
    tasks.unshift(task);
    await persist(`Add: ${task.title}`,
      remoteTasks => remoteTasks.find(t => t.id === task.id)
        ? remoteTasks
        : [task, ...remoteTasks]);
  }
  renderAll();
}

async function deleteTask(id) {
  if (!requireDataRepo()) return;
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  if (!confirm(`Delete "${task.title}"?`)) return;
  tasks = tasks.filter(t => t.id !== id);
  closeTaskDialog();
  renderAll();
  await persist(`Delete: ${task.title}`,
    remoteTasks => remoteTasks.filter(t => t.id !== id));
}

async function moveTask(id, newStatus) {
  if (!requireDataRepo()) return;
  const task = tasks.find(t => t.id === id);
  if (!task || task.status === newStatus) return;
  const prev = task.status;
  const now = new Date().toISOString();
  task.status = newStatus;
  task.updatedAt = now;
  renderAll();
  await persist(`Move: ${task.title} (${STATUS_LABELS[prev]} → ${STATUS_LABELS[newStatus]})`,
    remoteTasks => remoteTasks.map(t => t.id === id ? { ...t, status: newStatus, updatedAt: now } : t));
}

// ── Drag and drop ─────────────────────────────────────────────────────────────

function setupDragDrop() {
  document.addEventListener('dragstart', e => {
    const card = e.target.closest('.task-card');
    if (!card) return;
    draggedId = card.dataset.id;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedId);
  });

  document.addEventListener('dragend', e => {
    e.target.closest?.('.task-card')?.classList.remove('dragging');
    document.querySelectorAll('.kanban-column').forEach(c => c.classList.remove('drag-over'));
    draggedId = null;
  });

  document.addEventListener('dragover', e => {
    const col = e.target.closest('.kanban-column');
    if (!col) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.kanban-column').forEach(c => c.classList.remove('drag-over'));
    col.classList.add('drag-over');
  });

  document.addEventListener('dragleave', e => {
    const col = e.target.closest('.kanban-column');
    if (col && !col.contains(e.relatedTarget)) col.classList.remove('drag-over');
  });

  document.addEventListener('drop', async e => {
    const col = e.target.closest('.kanban-column');
    if (!col || !draggedId) return;
    e.preventDefault();
    col.classList.remove('drag-over');
    await moveTask(draggedId, col.dataset.status);
  });
}

// ── Events ────────────────────────────────────────────────────────────────────

function setupEvents() {
  document.querySelector('.app-title').addEventListener('click', resetFilters);

  document.getElementById('add-task-btn').addEventListener('click', () => openTaskDialog());

  document.getElementById('settings-btn').addEventListener('click', openSetupDialog);
  document.getElementById('demo-connect-btn').addEventListener('click', openSetupDialog);

  document.querySelector('.domain-filter').addEventListener('click', e => {
    const btn = e.target.closest('.pill-btn');
    if (btn) setDomainFilter(btn.dataset.domain);
  });

  document.querySelector('.view-switcher').addEventListener('click', e => {
    const btn = e.target.closest('.pill-btn');
    if (btn) switchView(btn.dataset.view);
  });

  // Open task on card click/keyboard
  function attachTaskOpen(containerId, selector) {
    const el = document.getElementById(containerId);
    el.addEventListener('click', e => {
      const target = e.target.closest(selector);
      if (target?.dataset.id) openTaskDialog(target.dataset.id);
    });
    el.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const target = e.target.closest(selector);
      if (target?.dataset.id) { e.preventDefault(); openTaskDialog(target.dataset.id); }
    });
  }
  document.getElementById('list-tbody').addEventListener('click', e => {
    const btn = e.target.closest('.complete-btn');
    if (!btn) return;
    if (btn.classList.contains('is-done')) return;
    playDoneSound();
    moveTask(btn.dataset.id, 'done');
  });

  attachTaskOpen('kanban-view', '.task-card');

  // List row click — skip if it was a complete-btn click
  document.getElementById('list-tbody').addEventListener('click', e => {
    if (e.target.closest('.complete-btn')) return;
    const target = e.target.closest('tr[data-id]');
    if (target?.dataset.id) openTaskDialog(target.dataset.id);
  });
  document.getElementById('list-tbody').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('.complete-btn')) return;
    const target = e.target.closest('tr[data-id]');
    if (target?.dataset.id) { e.preventDefault(); openTaskDialog(target.dataset.id); }
  });

  // Column add-task buttons
  document.getElementById('kanban-view').addEventListener('click', e => {
    const btn = e.target.closest('.column-add-btn');
    if (btn) openTaskDialog(null, btn.closest('.kanban-column').dataset.status);
  });

  document.getElementById('task-form').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      title: fd.get('title').trim(),
      description: fd.get('description').trim(),
      domain: fd.get('domain'),
      status: fd.get('status'),
      dueDate: fd.get('dueDate') || null,
      important: fd.get('important') === 'on',
    };
    const idToEdit = editingId;
    closeTaskDialog();
    await saveTask(data, idToEdit);
  });

  document.getElementById('delete-task-btn').addEventListener('click', () => {
    if (editingId) deleteTask(editingId);
  });

  document.getElementById('cancel-task-btn').addEventListener('click', closeTaskDialog);

  document.getElementById('task-dialog').addEventListener('click', e => {
    if (e.target === e.currentTarget) {
      e.stopPropagation();
      closeTaskDialog();
    }
  });

  document.getElementById('setup-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const newCfg = {
      token: form.token.value.trim(),
      owner: form.owner.value.trim(),
      repo: form.repo.value.trim(),
      branch: form.branch.value.trim() || 'main',
    };
    persistConfig(newCfg);
    cfg = newCfg;
    document.getElementById('setup-dialog').close();
    await initApp();
  });

  document.querySelector('.completion-filter').addEventListener('click', e => {
    const btn = e.target.closest('.pill-btn');
    if (!btn) return;
    activeScope = btn.dataset.scope;
    document.querySelectorAll('.completion-filter .pill-btn').forEach(b => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-pressed', b === btn);
    });
    renderAll();
  });

  document.querySelector('.sort-filter').addEventListener('click', e => {
    const btn = e.target.closest('.pill-btn');
    if (!btn) return;
    activeSortDir = btn.dataset.sort;
    document.querySelectorAll('.sort-filter .pill-btn').forEach(b => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-pressed', b === btn);
    });
    renderAll();
  });

  document.querySelector('.importance-filter').addEventListener('click', e => {
    const btn = e.target.closest('.pill-btn');
    if (!btn) return;
    filterImportance = btn.dataset.importance;
    document.querySelectorAll('.importance-filter .pill-btn').forEach(b => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-pressed', b === btn);
    });
    renderAll();
  });

  document.getElementById('cancel-setup-btn')?.addEventListener('click', () => {
    document.getElementById('setup-dialog').close();
  });

  document.getElementById('disconnect-btn').addEventListener('click', () => {
    document.getElementById('setup-dialog').close();
    document.getElementById('disconnect-dialog').showModal();
  });

  document.getElementById('disconnect-confirm-btn').addEventListener('click', async () => {
    document.getElementById('disconnect-dialog').close();
    localStorage.removeItem(CONFIG_KEY);
    cfg = null;
    sha = null;
    await initApp();
  });

  document.getElementById('disconnect-cancel-btn').addEventListener('click', () => {
    document.getElementById('disconnect-dialog').close();
    openSetupDialog();
  });

  document.getElementById('connect-dialog-setup').addEventListener('click', () => {
    document.getElementById('connect-dialog').close();
    openSetupDialog();
  });

  document.getElementById('connect-dialog-close').addEventListener('click', () => {
    document.getElementById('connect-dialog').close();
  });

  // 'n' shortcut to add task
  document.addEventListener('keydown', e => {
    if (e.key !== 'n' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    if (document.querySelector('dialog[open]')) return;
    openTaskDialog();
  });

  setupDragDrop();
}

// ── Init ──────────────────────────────────────────────────────────────────────

function showLoadingScreen(visible) {
  document.getElementById('loading-screen').hidden = !visible;
}

async function initApp() {
  demoMode = !cfg;
  document.getElementById('demo-banner').hidden = !demoMode;
  document.getElementById('status-bar').hidden = true;

  if (demoMode) {
    try {
      const res = await fetch('./example.board.json');
      const data = await res.json();
      tasks = data.tasks || [];
    } catch {
      tasks = [];
    }
    renderAll();
    return;
  }

  const loadingTimer = setTimeout(() => showLoadingScreen(true), 500);
  try {
    const result = await loadBoard(cfg.token, cfg.owner, cfg.repo, cfg.branch, DATA_PATH);
    tasks = result.data.tasks || [];
    sha = result.sha;
    clearTimeout(loadingTimer);
    showLoadingScreen(false);
    renderAll();
  } catch (err) {
    clearTimeout(loadingTimer);
    showLoadingScreen(false);
    showStatus(`Failed to load: ${err.message}`, 'error');
  }
}

async function main() {
  cfg = loadConfig();
  setupEvents();
  await initApp();
}

main();
