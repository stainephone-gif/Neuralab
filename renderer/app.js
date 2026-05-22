const state = {
  config: null,
  token: localStorage.getItem('token') || null,
  user: null,
  users: [],
  board: null,
  columns: [],
  cards: []
};

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['X-Auth-Token'] = state.token;
  const res = await fetch(`${state.config.serverUrl}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) {
    state.token = null;
    localStorage.removeItem('token');
    showLogin();
    throw new Error('Unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка');
  return data;
}

function $(id) { return document.getElementById(id); }
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
function formatDateOnly(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('ru-RU');
}
function formatDuration(ms) {
  if (!ms) return '—';
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days > 0) return `${days}д ${hours}ч`;
  if (hours > 0) return `${hours}ч`;
  return `${Math.floor(ms / 60000)}мин`;
}
function toDateInputValue(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function showLogin() {
  $('login-view').classList.remove('hidden');
  $('main-view').classList.add('hidden');
}
function showMain() {
  $('login-view').classList.add('hidden');
  $('main-view').classList.remove('hidden');
}

async function init() {
  state.config = await window.neuralab.getConfig();
  if (!state.config) {
    document.body.innerHTML = '<p>Конфигурация не найдена. Перезапустите приложение.</p>';
    return;
  }

  $('login-btn').addEventListener('click', login);
  $('login-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  $('reset-config').addEventListener('click', (e) => { e.preventDefault(); window.neuralab.reset(); });
  $('logout-btn').addEventListener('click', logout);
  document.querySelectorAll('nav a').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      switchView(a.dataset.view);
      document.querySelectorAll('nav a').forEach((x) => x.classList.toggle('active', x === a));
    });
  });

  if (state.token) {
    try {
      const res = await api('GET', '/me');
      state.user = res.user;
      await postLogin();
    } catch {
      showLogin();
    }
  } else {
    showLogin();
  }
}

async function login() {
  const username = $('login-username').value.trim();
  const password = $('login-password').value;
  if (!username || !password) return;
  try {
    const data = await api('POST', '/login', { username, password });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('token', data.token);
    $('login-error').textContent = '';
    await postLogin();
  } catch (err) {
    $('login-error').textContent = err.message;
  }
}

async function logout() {
  try { await api('POST', '/logout'); } catch {}
  state.token = null;
  state.user = null;
  localStorage.removeItem('token');
  showLogin();
}

async function postLogin() {
  $('current-user').textContent = state.user.name;
  $('users-link').classList.toggle('hidden', state.user.role !== 'admin');
  showMain();
  await loadUsers();
  switchView('board');
}

async function loadUsers() {
  const res = await api('GET', '/users');
  state.users = res.users;
}

function switchView(name) {
  ['board', 'reports', 'users'].forEach((v) => {
    $(`${v}-view`).classList.toggle('hidden', v !== name);
  });
  if (name === 'board') renderBoard();
  if (name === 'reports') renderReports();
  if (name === 'users') renderUsersAdmin();
}

async function renderBoard() {
  const data = await api('GET', '/board');
  state.board = data.board;
  state.columns = data.columns;
  state.cards = data.cards;

  const root = $('board-view');
  root.innerHTML = '';
  const board = el('div', { class: 'board' });

  state.columns.forEach((col) => {
    const cards = state.cards.filter((c) => c.column_id === col.id);
    const list = el('div', { class: 'cards-list', 'data-column-id': col.id });
    cards.forEach((card) => list.appendChild(renderCard(card)));

    const column = el('div', { class: 'column' },
      el('div', { class: 'column-header' },
        el('span', {}, col.name),
        el('span', { class: 'count' }, String(cards.length))
      ),
      list,
      el('button', {
        class: 'add-card-btn',
        onclick: () => openCardModal({ column_id: col.id })
      }, '+ Добавить задачу')
    );
    board.appendChild(column);

    new Sortable(list, {
      group: 'cards',
      animation: 150,
      onEnd: async (evt) => {
        const cardId = Number(evt.item.dataset.cardId);
        const newColumnId = Number(evt.to.dataset.columnId);
        const newIndex = evt.newIndex;
        try {
          await api('POST', `/cards/${cardId}/move`, {
            column_id: newColumnId,
            position: newIndex
          });
          await renderBoard();
        } catch (err) {
          alert('Ошибка перемещения: ' + err.message);
          await renderBoard();
        }
      }
    });
  });

  root.appendChild(board);
}

function renderCard(card) {
  const now = Date.now();
  const dayMs = 86400000;
  let deadlineEl = null;
  if (card.deadline) {
    let cls = 'deadline';
    if (!card.completed_at) {
      if (card.deadline < now) cls += ' overdue';
      else if (card.deadline - now < dayMs) cls += ' soon';
    }
    deadlineEl = el('span', { class: cls }, '⏱ ' + formatDateOnly(card.deadline));
  }

  return el('div', {
    class: 'card',
    'data-card-id': card.id,
    onclick: () => openCardModal(card)
  },
    el('div', { class: 'card-title' }, card.title),
    el('div', { class: 'card-meta' },
      el('span', {}, card.assignee_name || 'Не назначено'),
      deadlineEl
    )
  );
}

function openCardModal(card) {
  const isNew = !card.id;
  const assigneeOptions = ['<option value="">— Не назначено —</option>']
    .concat(state.users.map((u) =>
      `<option value="${u.id}" ${card.assignee_id === u.id ? 'selected' : ''}>${u.name}</option>`
    )).join('');

  const html = `
    <h2>${isNew ? 'Новая задача' : 'Задача'}</h2>
    <div class="modal-row">
      <label>Название</label>
      <input id="m-title" value="${escapeHtml(card.title || '')}">
    </div>
    <div class="modal-row">
      <label>Описание</label>
      <textarea id="m-description">${escapeHtml(card.description || '')}</textarea>
    </div>
    <div class="modal-row">
      <label>Исполнитель</label>
      <select id="m-assignee">${assigneeOptions}</select>
    </div>
    <div class="modal-row">
      <label>Дедлайн</label>
      <input type="date" id="m-deadline" value="${toDateInputValue(card.deadline)}">
    </div>
    ${!isNew && card.completed_at ? `<div class="muted small">Выполнено: ${formatDate(card.completed_at)}</div>` : ''}
    ${!isNew ? `<div class="muted small">Создано: ${formatDate(card.created_at)}</div>` : ''}
    <div class="modal-actions">
      <div>${!isNew ? '<button class="danger" id="m-delete">Удалить</button>' : ''}</div>
      <div class="right">
        <button class="secondary" id="m-cancel">Отмена</button>
        <button id="m-save">Сохранить</button>
      </div>
    </div>
  `;
  $('modal-content').innerHTML = html;
  $('modal').classList.remove('hidden');

  $('m-cancel').addEventListener('click', closeModal);
  $('m-save').addEventListener('click', async () => {
    const payload = {
      title: $('m-title').value.trim(),
      description: $('m-description').value,
      assignee_id: $('m-assignee').value ? Number($('m-assignee').value) : null,
      deadline: $('m-deadline').value ? new Date($('m-deadline').value).getTime() : null
    };
    if (!payload.title) { alert('Введите название'); return; }
    try {
      if (isNew) {
        await api('POST', '/cards', { ...payload, column_id: card.column_id });
      } else {
        await api('PUT', `/cards/${card.id}`, payload);
      }
      closeModal();
      await renderBoard();
    } catch (err) {
      alert(err.message);
    }
  });
  if (!isNew) {
    $('m-delete').addEventListener('click', async () => {
      if (!confirm('Удалить задачу?')) return;
      await api('DELETE', `/cards/${card.id}`);
      closeModal();
      await renderBoard();
    });
  }
}

function closeModal() {
  $('modal').classList.add('hidden');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function renderReports() {
  const root = $('reports-view');
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 86400000);

  root.innerHTML = `
    <div class="filter-row">
      <label>С:</label>
      <input type="date" id="r-from" value="${toDateInputValue(monthAgo.getTime())}">
      <label>По:</label>
      <input type="date" id="r-to" value="${toDateInputValue(now.getTime())}">
      <button id="r-refresh">Обновить</button>
    </div>
    <div id="report-body"></div>
  `;

  $('r-refresh').addEventListener('click', loadReport);
  await loadReport();
}

async function loadReport() {
  const from = new Date($('r-from').value).getTime();
  const to = new Date($('r-to').value).getTime() + 86400000;
  const data = await api('GET', `/reports/summary?from=${from}&to=${to}`);

  const body = $('report-body');
  const usersTable = el('table', {},
    el('thead', {}, el('tr', {},
      el('th', {}, 'Сотрудник'),
      el('th', {}, 'Выполнено'),
      el('th', {}, 'В работе'),
      el('th', {}, 'Просрочено'),
      el('th', {}, 'Среднее время')
    )),
    el('tbody', {}, ...data.byUser.map((u) =>
      el('tr', {},
        el('td', {}, u.name),
        el('td', {}, String(u.completed || 0)),
        el('td', {}, String(u.in_progress || 0)),
        el('td', {}, String(u.overdue || 0)),
        el('td', {}, formatDuration(u.avg_duration_ms))
      )
    ))
  );

  const overdueTable = el('table', {},
    el('thead', {}, el('tr', {},
      el('th', {}, 'Задача'),
      el('th', {}, 'Исполнитель'),
      el('th', {}, 'Дедлайн')
    )),
    el('tbody', {},
      ...(data.overdueCards.length === 0
        ? [el('tr', {}, el('td', { colspan: '3' }, 'Просроченных задач нет'))]
        : data.overdueCards.map((c) => el('tr', {},
            el('td', {}, c.title),
            el('td', {}, c.assignee_name || '—'),
            el('td', {}, formatDateOnly(c.deadline))
          )))
    )
  );

  body.innerHTML = '';
  body.appendChild(el('div', { class: 'report-section' },
    el('h2', {}, 'По сотрудникам за выбранный период'),
    usersTable
  ));
  body.appendChild(el('div', { class: 'report-section' },
    el('h2', {}, 'Просроченные задачи (актуально на сейчас)'),
    overdueTable
  ));
}

async function renderUsersAdmin() {
  if (state.user.role !== 'admin') {
    $('users-view').innerHTML = '<p>Доступно только администратору</p>';
    return;
  }
  await loadUsers();
  const root = $('users-view');
  root.innerHTML = '';

  const table = el('table', {},
    el('thead', {}, el('tr', {},
      el('th', {}, 'Имя'),
      el('th', {}, 'Логин'),
      el('th', {}, 'Роль'),
      el('th', {}, '')
    )),
    el('tbody', {}, ...state.users.map((u) =>
      el('tr', {},
        el('td', {}, u.name),
        el('td', {}, u.username),
        el('td', {}, u.role === 'admin' ? 'Администратор' : 'Сотрудник'),
        el('td', {}, u.id === state.user.id
          ? el('span', { class: 'muted small' }, 'вы')
          : el('button', {
              class: 'danger',
              onclick: async () => {
                if (!confirm(`Удалить ${u.name}?`)) return;
                await api('DELETE', `/users/${u.id}`);
                await renderUsersAdmin();
              }
            }, 'Удалить'))
      )
    ))
  );

  const addBtn = el('button', {
    onclick: openAddUserModal
  }, '+ Добавить сотрудника');

  root.appendChild(el('div', { class: 'report-section' },
    el('h2', {}, 'Сотрудники'),
    addBtn,
    el('div', { style: 'margin-top: 16px;' }, table)
  ));
}

function openAddUserModal() {
  $('modal-content').innerHTML = `
    <h2>Новый сотрудник</h2>
    <div class="modal-row"><label>Имя</label><input id="nu-name"></div>
    <div class="modal-row"><label>Логин</label><input id="nu-username"></div>
    <div class="modal-row"><label>Пароль</label><input id="nu-password" type="password"></div>
    <div class="modal-row">
      <label>Роль</label>
      <select id="nu-role">
        <option value="user">Сотрудник</option>
        <option value="admin">Администратор</option>
      </select>
    </div>
    <div class="modal-actions">
      <div></div>
      <div class="right">
        <button class="secondary" id="nu-cancel">Отмена</button>
        <button id="nu-save">Создать</button>
      </div>
    </div>
  `;
  $('modal').classList.remove('hidden');
  $('nu-cancel').addEventListener('click', closeModal);
  $('nu-save').addEventListener('click', async () => {
    try {
      await api('POST', '/users', {
        name: $('nu-name').value.trim(),
        username: $('nu-username').value.trim(),
        password: $('nu-password').value,
        role: $('nu-role').value
      });
      closeModal();
      await renderUsersAdmin();
    } catch (err) {
      alert(err.message);
    }
  });
}

init();
