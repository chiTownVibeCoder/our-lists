// Supabase library is loaded by index.html from vendor/supabase.js
const { createClient } = window.supabase;
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

const app = document.getElementById('app');
// allLists/allItems include things in the recycle bin; lists/items are only the live ones.
const state = { user: null, allLists: [], allItems: [], lists: [], items: [], openListId: null, view: 'home', notice: null, toast: null };
const BIN_DAYS = 30;

// ---------- tiny DOM helper ----------
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

// ---------- data ----------
async function loadAll() {
  const [l, i] = await Promise.all([
    sb.from('lists').select('*').order('created_at'),
    sb.from('items').select('*').order('created_at'),
  ]);
  if (l.error || i.error) { state.notice = (l.error || i.error).message; }
  state.allLists = l.data || [];
  state.allItems = i.data || [];
  derive();
  if (state.openListId && !state.lists.some(x => x.id === state.openListId)) state.openListId = null;
  render();
  purgeOldBin();
}

// Work out what's live and what's in the recycle bin.
function derive() {
  // Drag order first (position), then oldest first.
  state.allItems.sort((a, b) =>
    (a.position ?? Infinity) - (b.position ?? Infinity) || (a.created_at || '').localeCompare(b.created_at || ''));
  state.lists = state.allLists.filter(l => !l.deleted_at);
  const live = new Set(state.lists.map(l => l.id));
  state.items = state.allItems.filter(i => !i.deleted_at && live.has(i.list_id));
}

// Anything in the bin for more than 30 days is deleted for good.
let purged = false;
async function purgeOldBin() {
  if (purged) return; purged = true;
  const cutoff = new Date(Date.now() - BIN_DAYS * 864e5).toISOString();
  const old = [...state.allLists, ...state.allItems].some(x => x.deleted_at && x.deleted_at < cutoff);
  if (!old) return;
  await sb.from('items').delete().lt('deleted_at', cutoff);
  await sb.from('lists').delete().lt('deleted_at', cutoff);
  scheduleReload();
}

// ---------- recycle bin + undo ----------
function moveToBin(table, rows, message) {
  if (!rows.length) return;
  const when = new Date().toISOString();
  const ids = rows.map(r => r.id);
  rows.forEach(r => { r.deleted_at = when; });
  derive();
  showToast(message, () => restore(table, rows));
  render();
  act(sb.from(table).update({ deleted_at: when }).in('id', ids));
}

function restore(table, rows) {
  clearTimeout(toastTimer); state.toast = null;
  rows.forEach(r => { r.deleted_at = null; });
  derive(); render();
  act(sb.from(table).update({ deleted_at: null }).in('id', rows.map(r => r.id)));
}

function deleteForever(table, rows) {
  const ids = new Set(rows.map(r => r.id));
  if (table === 'lists') {
    state.allLists = state.allLists.filter(l => !ids.has(l.id));
    state.allItems = state.allItems.filter(i => !ids.has(i.list_id));
  } else state.allItems = state.allItems.filter(i => !ids.has(i.id));
  derive(); render();
  act(sb.from(table).delete().in('id', [...ids]));
}

let toastTimer = null;
function showToast(text, undo) {
  clearTimeout(toastTimer);
  state.toast = { text, undo };
  toastTimer = setTimeout(() => { state.toast = null; render(); }, 7000);
}

function toastBar() {
  const t = state.toast;
  if (!t) return null;
  return h('div', { class: 'toast', role: 'status' },
    h('span', { class: 'grow' }, t.text),
    h('button', { onclick: () => { clearTimeout(toastTimer); state.toast = null; t.undo(); } }, 'Undo'));
}

function daysLeft(deletedAt) {
  const left = Math.ceil(BIN_DAYS - (Date.now() - new Date(deletedAt)) / 864e5);
  return left <= 1 ? 'Deleted for good tomorrow' : `${left} days left`;
}

function binScreen() {
  const lists = state.allLists.filter(l => l.deleted_at)
    .sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
  const liveIds = new Set(state.lists.map(l => l.id));
  const items = state.allItems.filter(i => i.deleted_at && liveIds.has(i.list_id))
    .sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
  const listName = id => state.lists.find(l => l.id === id)?.name || '';
  const binRow = (title, sub, table, row) => h('div', { class: 'row' },
    h('div', { class: 'grow' }, h('span', { class: 'text' }, title), h('span', { class: 'sub' }, sub)),
    h('button', { onclick: () => restore(table, [row]) }, 'Restore'),
    h('button', { class: 'del', 'aria-label': 'Delete forever', onclick: () => {
      if (confirm(`Delete "${title}" for good? This can't be undone.`)) deleteForever(table, [row]);
    } }, '×'));

  return h('div', {},
    h('div', { class: 'topbar' },
      h('button', { onclick: () => { state.view = 'home'; render(); } }, '‹ Lists'), h('span')),
    h('h1', {}, 'Recycle bin'),
    h('p', { class: 'muted' }, `Deleted lists and items stay here for ${BIN_DAYS} days, then they're gone for good.`),
    state.notice && h('div', { class: 'msg err' }, state.notice),
    h('h2', {}, 'Lists'),
    lists.length
      ? h('div', { class: 'card' }, lists.map(l => {
          const n = state.allItems.filter(i => i.list_id === l.id && !i.deleted_at).length;
          return binRow(l.name, `${n} item${n === 1 ? '' : 's'} · ${daysLeft(l.deleted_at)}`, 'lists', l);
        }))
      : h('p', { class: 'muted' }, 'No deleted lists.'),
    h('h2', {}, 'Items'),
    items.length
      ? h('div', { class: 'card' }, items.map(i => binRow(i.text, `From ${listName(i.list_id)} · ${daysLeft(i.deleted_at)}`, 'items', i)))
      : h('p', { class: 'muted' }, 'No deleted items.'),
    (lists.length || items.length) ? h('div', { class: 'footer' }, h('span'),
      h('button', { style: 'color: var(--danger)', onclick: () => {
        if (!confirm("Empty the recycle bin? Everything in it will be deleted for good. This can't be undone.")) return;
        deleteForever('items', items);
        deleteForever('lists', lists);
      } }, 'Empty recycle bin')) : null);
}

let channel = null;
let reloadTimer = null;
function scheduleReload() {
  if (state.dragging) { state.reloadAfterDrag = true; return; } clearTimeout(reloadTimer); reloadTimer = setTimeout(loadAll, 150); }

function startLive() {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel('shared-lists')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lists' }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, scheduleReload)
    .subscribe();
}

// iPhone pauses the app in the background; catch up when it comes back.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.user) { loadAll(); startLive(); }
});

async function act(promise) {
  const { error } = await promise;
  if (error) { state.notice = error.message; render(); }
  scheduleReload();
}

// ---------- screens ----------
function signInScreen(message, isError) {
  const email = h('input', { type: 'email', placeholder: 'Email', autocomplete: 'email', required: true });
  const pass = h('input', { type: 'password', placeholder: 'Password (6+ characters)', autocomplete: 'current-password', required: true, minlength: 6 });
  const msg = h('div');
  const show = (t, err) => { msg.replaceChildren(t ? h('div', { class: 'msg' + (err ? ' err' : '') }, t) : ''); };
  if (message) show(message, isError);

  async function go(mode) {
    if (!email.value || pass.value.length < 6) return show('Enter your email and a password of at least 6 characters.', true);
    show('One moment…');
    const creds = { email: email.value.trim(), password: pass.value };
    const res = mode === 'up'
      ? await sb.auth.signUp({ ...creds, options: { emailRedirectTo: location.origin + location.pathname } })
      : await sb.auth.signInWithPassword(creds);
    if (res.error) return show(res.error.message, true);
    if (mode === 'up' && !res.data.session) show('Account created. Check your email and tap the confirm link, then come back here and sign in.');
  }

  return h('form', { class: 'stack', onsubmit: e => { e.preventDefault(); go('in'); } },
    h('h1', {}, 'Our Lists'),
    h('p', { class: 'muted' }, 'Shared to-do and shopping lists.'),
    email, pass,
    h('button', { class: 'btn', type: 'submit' }, 'Sign in'),
    h('button', { class: 'btn secondary', type: 'button', onclick: () => go('up') }, 'Create account'),
    msg,
  );
}

// ---------- due dates ----------
function todayStr(offset = 0) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dueInfo(due) {
  if (!due) return null;
  const today = todayStr();
  if (due < today) return { cls: 'overdue', text: 'Overdue · ' + niceDate(due) };
  if (due === today) return { cls: 'today', text: 'Due today' };
  if (due === todayStr(1)) return { cls: '', text: 'Due tomorrow' };
  return { cls: '', text: 'Due ' + niceDate(due) };
}
function niceDate(due) {
  const [y, m, d] = due.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

function dueChip(item) {
  const info = dueInfo(item.due_date);
  const picker = h('input', { type: 'date', value: item.due_date || '', 'aria-label': 'Due date' });
  picker.addEventListener('change', () => {
    const v = picker.value || null;
    item.due_date = v; render();
    act(sb.from('items').update({ due_date: v }).eq('id', item.id));
  });
  return h('label', { class: 'due ' + (info && !item.done ? info.cls : '') },
    info ? info.text : '+ Due date', picker);
}

function binCount() {
  const liveIds = new Set(state.lists.map(l => l.id));
  return state.allLists.filter(l => l.deleted_at).length
    + state.allItems.filter(i => i.deleted_at && liveIds.has(i.list_id)).length;
}

function homeScreen() {
  const remaining = id => state.items.filter(i => i.list_id === id && !i.done).length;
  const overdue = id => state.items.filter(i => i.list_id === id && !i.done && i.due_date && i.due_date < todayStr()).length;
  const section = (title, kind) => {
    const lists = state.lists.filter(l => l.kind === kind);
    return [
      h('h2', {}, title),
      lists.length
        ? h('div', { class: 'card' }, lists.map(l =>
            h('button', { class: 'row listlink', onclick: () => { state.openListId = l.id; render(); } },
              h('span', {}, kind === 'shopping' ? '🛒' : '✅'),
              h('span', { class: 'grow' }, l.name),
              overdue(l.id) > 0 && h('span', { class: 'badge' }, `${overdue(l.id)} overdue`),
              h('span', { class: 'count' }, String(remaining(l.id))),
              h('span', { class: 'chev' }, '›'))))
        : h('p', { class: 'muted' }, 'No lists yet.'),
    ];
  };

  const name = h('input', { placeholder: 'New list name', maxlength: 60 });
  const kindPick = h('div', { class: 'kinds' },
    h('label', {}, h('input', { type: 'radio', name: 'kind', value: 'todo', checked: true }), 'To-do'),
    h('label', {}, h('input', { type: 'radio', name: 'kind', value: 'shopping' }), 'Shopping'));
  const newForm = h('form', { class: 'stack', onsubmit: e => {
    e.preventDefault();
    const n = name.value.trim(); if (!n) return;
    const kind = kindPick.querySelector('input:checked').value;
    name.value = '';
    act(sb.from('lists').insert({ name: n, kind }));
  } }, h('h2', {}, 'Add a list'), name, kindPick, h('button', { class: 'btn', type: 'submit' }, 'Add list'));

  return h('div', {},
    h('h1', {}, 'Our Lists'),
    state.notice && h('div', { class: 'msg err' }, state.notice),
    section('To-do', 'todo'),
    section('Shopping', 'shopping'),
    newForm,
    h('div', { class: 'footer muted' },
      h('span', {}, state.user.email)),
    h('div', { class: 'footer' },
      h('button', { onclick: () => { state.view = 'bin'; render(); } }, `🗑 Recycle bin${binCount() ? ` (${binCount()})` : ''}`),
      h('button', { onclick: () => sb.auth.signOut() }, 'Sign out')));
}

function itemRow(item, list) {
  const label = h('span', { class: 'text' }, item.text);
  // Tap the text to edit it.
  label.addEventListener('click', () => {
    const input = h('input', { class: 'edit', value: item.text });
    const save = () => {
      const t = input.value.trim();
      if (t && t !== item.text) { item.text = t; act(sb.from('items').update({ text: t }).eq('id', item.id)); }
      render();
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
    label.replaceWith(input); input.focus();
  });
  return h('div', { class: 'row' + (item.done ? ' done' : ''), 'data-id': item.id },
    h('button', { class: 'check', 'aria-label': item.done ? 'Mark not done' : 'Mark done', onclick: () => {
      item.done = !item.done; render();
      act(sb.from('items').update({ done: item.done }).eq('id', item.id));
    } }, item.done ? '✓' : ''),
    h('div', { class: 'grow' }, label, list.kind === 'todo' && dueChip(item)),
    !item.done && h('span', { class: 'grip', 'aria-label': 'Drag to reorder' }, '≡'),
    h('button', { class: 'del', 'aria-label': 'Delete', onclick: () => {
      moveToBin('items', [item], `Deleted "${item.text}"`);
    } }, '×'));
}

// Drag the ≡ handle to reorder. Saves the new order for both phones.
function sortable(container, open) {
  window.Sortable.create(container, {
    handle: '.grip', animation: 150, forceFallback: true, fallbackTolerance: 3,
    onStart: () => { state.dragging = true; },
    onEnd: () => {
      state.dragging = false;
      const ids = [...container.querySelectorAll('.row')].map(r => r.dataset.id);
      const updates = [];
      ids.forEach((id, n) => {
        const item = open.find(i => i.id === id);
        if (item && item.position !== n + 1) {
          item.position = n + 1;
          if (!id.startsWith('tmp')) updates.push(sb.from('items').update({ position: n + 1 }).eq('id', id));
        }
      });
      derive(); render();
      Promise.all(updates).then(results => {
        const bad = results.find(r => r.error);
        if (bad) { state.notice = bad.error.message; render(); }
        if (state.reloadAfterDrag || bad) { state.reloadAfterDrag = false; scheduleReload(); }
      });
    },
  });
  return container;
}

function listScreen(list) {
  const items = state.items.filter(i => i.list_id === list.id);
  const open = items.filter(i => !i.done);
  const done = items.filter(i => i.done);
  const input = h('input', { placeholder: list.kind === 'shopping' ? 'Add item, e.g. 2 lemons' : 'Add a task', enterkeyhint: 'done' });

  const addForm = h('form', { class: 'addbar', onsubmit: e => {
    e.preventDefault();
    const t = input.value.trim(); if (!t) return;
    input.value = '';
    const position = Math.max(0, ...items.map(i => i.position || 0)) + 1;
    state.allItems.push({ id: 'tmp' + Date.now(), list_id: list.id, text: t, done: false, position, created_at: new Date().toISOString() });
    derive();
    render(); document.querySelector('.addbar input')?.focus();
    act(sb.from('items').insert({ list_id: list.id, text: t, position }));
  } }, input, h('button', { class: 'btn', type: 'submit' }, 'Add'));

  return h('div', {},
    h('div', { class: 'topbar' },
      h('button', { onclick: () => { state.openListId = null; render(); } }, '‹ Lists'),
      h('button', { onclick: () => {
        const n = prompt('Rename list', list.name);
        if (n && n.trim()) act(sb.from('lists').update({ name: n.trim() }).eq('id', list.id));
      } }, 'Rename')),
    h('h1', {}, list.name),
    state.notice && h('div', { class: 'msg err' }, state.notice),
    addForm,
    open.length ? sortable(h('div', { class: 'card' }, open.map(i => itemRow(i, list))), open)
      : h('p', { class: 'muted center' }, done.length ? 'All done 🎉' : 'Nothing here yet.'),
    done.length > 0 && [
      h('h2', {}, `Done (${done.length})`),
      h('div', { class: 'card' }, done.map(i => itemRow(i, list))),
      h('div', { class: 'footer' },
        h('button', { onclick: () => {
          moveToBin('items', done, `Cleared ${done.length} done item${done.length === 1 ? '' : 's'}`);
        } }, 'Clear done items'),
        h('span')),
    ],
    h('div', { class: 'footer' },
      h('span'),
      h('button', { style: 'color: var(--danger)', onclick: () => {
        state.openListId = null;
        moveToBin('lists', [list], `Deleted list "${list.name}"`);
      } }, 'Delete list')));
}

function render() {
  const focused = document.activeElement?.closest('.addbar') ? true : false;
  let screen;
  if (!state.user) return;
  else if (state.view === 'bin') screen = binScreen();
  else {
    const list = state.lists.find(l => l.id === state.openListId);
    screen = list ? listScreen(list) : homeScreen();
  }
  app.replaceChildren(screen, toastBar() || '');
  if (focused) app.querySelector('.addbar input')?.focus();
  state.notice = null;
}

// ---------- start ----------
async function checkMember() {
  const { data, error } = await sb.rpc('is_member');
  return !error && data === true;
}

let started = false;
async function handleSession(session) {
  const user = session?.user || null;
  if (started && user?.id === state.user?.id) return;
  started = true;
  if (user && !(await checkMember())) {
    state.signInMsg = `${user.email} isn't on this app's member list yet. Ask Sandeep to add it.`;
    await sb.auth.signOut();
    return;
  }
  state.user = user;
  if (user) { await loadAll(); startLive(); }
  else {
    if (channel) sb.removeChannel(channel);
    channel = null; state.allLists = []; state.allItems = []; state.lists = []; state.items = [];
    state.openListId = null; state.view = 'home'; state.toast = null;
    app.replaceChildren(signInScreen(state.signInMsg, true));
    state.signInMsg = null;
  }
}
// Run outside the auth callback (calling Supabase inside it can stall).
sb.auth.onAuthStateChange((_event, session) => { setTimeout(() => handleSession(session), 0); });

// Keep the Home Screen app up to date: check for a new version whenever it's opened,
// and reload once when a new version takes over.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update(); });
  });
  let reloaded = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
}
