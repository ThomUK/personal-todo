import { loadBoard, saveBoard } from './github.js';

const DOMAINS = ['home', 'work', 'apps'];
const DOMAIN_LABELS = { home: 'Home', work: 'Work', apps: 'Apps' };
const STATUS_LABELS = { todo: 'To Do', 'in-progress': 'In Progress', done: 'Done' };
const DATA_PATH = 'data/board.json';
const CONFIG_KEY = 'kanban-config';

let cfg = null;
let tasks = [];
let sha = null;
let saving = false;
let filterDomains = new Set(DOMAINS);
let activeView = 'kanban';
let showCompleted = true;
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
  if (filterDomains.size === DOMAINS.length) return tasks;
  return tasks.filter(t => filterDomains.has(t.domain));
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

async function persist(message) {
  if (saving) return;
  saving = true;
  showStatus('Saving…');
  try {
    sha = await saveBoard(cfg.token, cfg.owner, cfg.repo, cfg.branch, DATA_PATH,
      { version: 1, tasks }, sha, message);
    showStatus('Saved', 'success');
  } catch (err) {
    showStatus(`Save failed: ${err.message}`, 'error');
  } finally {
    saving = false;
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
  return `
    <article class="task-card" data-id="${task.id}" data-domain="${task.domain}"
      data-status="${task.status}" draggable="true" role="listitem"
      tabindex="0" aria-label="${esc(task.title)}">
      <div class="task-card-header">
        <span class="task-title">${esc(task.title)}</span>
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

function completionFiltered() {
  const ft = filteredTasks();
  return showCompleted ? ft : ft.filter(t => t.status !== 'done');
}

function renderKanban() {
  const ft = completionFiltered();
  document.querySelectorAll('.kanban-column').forEach(col => {
    const status = col.dataset.status;
    const colTasks = ft.filter(t => t.status === status);
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
  const order = { todo: 0, 'in-progress': 1, done: 2 };
  const sorted = [...ft].sort((a, b) => {
    const sd = order[a.status] - order[b.status];
    if (sd !== 0) return sd;
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    return a.dueDate ? -1 : b.dueDate ? 1 : 0;
  });
  tbody.innerHTML = sorted.map(t => `
    <tr data-id="${t.id}" tabindex="0">
      <td class="complete-cell">
        <button class="complete-btn ${t.status === 'done' ? 'is-done' : ''}"
          data-id="${t.id}" aria-label="Mark complete" tabindex="0">
          ${t.status === 'done' ? '✓' : ''}
        </button>
      </td>
      <td class="${t.status === 'done' ? 'done-title' : ''}">${esc(t.title)}</td>
      <td>${domainBadge(t.domain)}</td>
      <td>${statusBadge(t.status)}</td>
      <td>${t.dueDate
        ? `<span class="due-date-badge ${dueDateClass(t)}">${esc(dueDateLabel(t))}</span>`
        : '<span class="muted">—</span>'
      }</td>
    </tr>`).join('');
}

// ── Upcoming ──────────────────────────────────────────────────────────────────

function renderUpcoming() {
  const ft = filteredTasks().filter(t => t.dueDate);
  const container = document.getElementById('upcoming-list');
  if (!ft.length) {
    container.innerHTML = '<div class="empty-state">No tasks with due dates</div>';
    return;
  }
  const sorted = [...ft].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const active = sorted.filter(t => t.status !== 'done');
  const done = sorted.filter(t => t.status === 'done');

  function itemHTML(t) {
    const dc = dueDateClass(t);
    const isDone = t.status === 'done';
    return `<div class="upcoming-item ${dc} ${isDone ? 'done-item' : ''}"
      data-id="${t.id}" tabindex="0" role="button" aria-label="${esc(t.title)}">
      <span class="upcoming-date">${formatDate(t.dueDate)}</span>
      ${domainBadge(t.domain)}
      <span class="upcoming-title">${esc(t.title)}</span>
      ${statusBadge(t.status)}
    </div>`;
  }

  function section(heading, items, cls = '') {
    if (!items.length) return '';
    return `<div class="upcoming-section">
      <h3 class="${cls}">${heading}</h3>
      ${items.map(itemHTML).join('')}
    </div>`;
  }

  const overdue = active.filter(t => daysUntil(t.dueDate) < 0);
  const today = active.filter(t => daysUntil(t.dueDate) === 0);
  const upcoming = active.filter(t => daysUntil(t.dueDate) > 0);

  container.innerHTML =
    section('Overdue', overdue, 'heading-overdue') +
    section('Today', today) +
    section('Upcoming', upcoming) +
    (done.length ? section('Completed', done, 'heading-muted') : '');
}

// ── Render all ────────────────────────────────────────────────────────────────

function renderAll() {
  if (activeView === 'kanban') renderKanban();
  else if (activeView === 'list') renderList();
  else renderUpcoming();
}

// ── View switching ────────────────────────────────────────────────────────────

function switchView(view) {
  activeView = view;
  ['kanban', 'list', 'upcoming'].forEach(v => {
    document.getElementById(`${v}-view`).hidden = v !== view;
  });
  document.querySelectorAll('.view-btn').forEach(btn => {
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
  document.querySelectorAll('.filter-btn').forEach(btn => {
    const d = btn.dataset.domain;
    const active = d === 'all'
      ? filterDomains.size === DOMAINS.length
      : filterDomains.size === 1 && filterDomains.has(d);
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active);
  });
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

// ── CRUD ──────────────────────────────────────────────────────────────────────

async function saveTask(data) {
  const now = new Date().toISOString();
  if (editingId) {
    const idx = tasks.findIndex(t => t.id === editingId);
    if (idx === -1) return;
    tasks[idx] = { ...tasks[idx], ...data, updatedAt: now };
    await persist(`Update: ${tasks[idx].title}`);
  } else {
    const task = { id: uid(), ...data, createdAt: now, updatedAt: now };
    tasks.unshift(task);
    await persist(`Add: ${task.title}`);
  }
  renderAll();
}

async function deleteTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  if (!confirm(`Delete "${task.title}"?`)) return;
  tasks = tasks.filter(t => t.id !== id);
  closeTaskDialog();
  renderAll();
  await persist(`Delete: ${task.title}`);
}

async function moveTask(id, newStatus) {
  const task = tasks.find(t => t.id === id);
  if (!task || task.status === newStatus) return;
  const prev = task.status;
  task.status = newStatus;
  task.updatedAt = new Date().toISOString();
  renderAll();
  await persist(`Move: ${task.title} (${STATUS_LABELS[prev]} → ${STATUS_LABELS[newStatus]})`);
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
  document.getElementById('add-task-btn').addEventListener('click', () => openTaskDialog());

  document.getElementById('settings-btn').addEventListener('click', openSetupDialog);

  document.querySelector('.domain-filter').addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (btn) setDomainFilter(btn.dataset.domain);
  });

  document.querySelector('.view-switcher').addEventListener('click', e => {
    const btn = e.target.closest('.view-btn');
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
    if (!btn || btn.classList.contains('is-done')) return;
    e.stopPropagation();
    playDoneSound();
    moveTask(btn.dataset.id, 'done');
  });

  attachTaskOpen('kanban-view', '.task-card');
  attachTaskOpen('list-tbody', 'tr[data-id]');
  attachTaskOpen('upcoming-list', '.upcoming-item[data-id]');

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
    };
    closeTaskDialog();
    await saveTask(data);
  });

  document.getElementById('delete-task-btn').addEventListener('click', () => {
    if (editingId) deleteTask(editingId);
  });

  document.getElementById('cancel-task-btn').addEventListener('click', closeTaskDialog);

  document.getElementById('task-dialog').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeTaskDialog();
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
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    showCompleted = btn.dataset.completion === 'all';
    document.querySelectorAll('.completion-filter .filter-btn').forEach(b => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-pressed', b === btn);
    });
    renderAll();
  });

  document.getElementById('cancel-setup-btn')?.addEventListener('click', () => {
    document.getElementById('setup-dialog').close();
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

async function initApp() {
  document.getElementById('app').hidden = false;
  showStatus('Loading…');
  try {
    const result = await loadBoard(cfg.token, cfg.owner, cfg.repo, cfg.branch, DATA_PATH);
    tasks = result.data.tasks || [];
    sha = result.sha;
    document.getElementById('status-bar').hidden = true;
    renderAll();
  } catch (err) {
    showStatus(`Failed to load: ${err.message}`, 'error');
  }
}

async function main() {
  cfg = loadConfig();
  setupEvents();
  if (!cfg) {
    document.getElementById('setup-dialog').showModal();
  } else {
    await initApp();
  }
}

main();
