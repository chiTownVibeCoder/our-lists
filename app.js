// Supabase library is loaded by index.html from vendor/supabase.js
const { createClient } = window.supabase;
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

const app = document.getElementById('app');
const state = { user: null, lists: [], items: [], openListId: null, notice: null };

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
  state.lists = l.data || [];
  // Drag order first (position), then oldest first.
  state.items = (i.data || []).sort((a, b) =>
    (a.position ?? Infinity) - (b.position ?? Infinity) || a.created_at.localeCompare(b.created_at));
  if (state.openListId && !state.lists.some(x => x.id === state.openListId)) state.openListId = null;
  render();
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
      h('span', {}, state.user.email),
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
      state.items = state.items.filter(i => i.id !== item.id); render();
      act(sb.from('items').delete().eq('id', item.id));
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
      state.items.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.created_at?.localeCompare(b.created_at));
      render();
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
    state.items.push({ id: 'tmp' + Date.now(), list_id: list.id, text: t, done: false, position });
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
          state.items = state.items.filter(i => !(i.list_id === list.id && i.done)); render();
          act(sb.from('items').delete().eq('list_id', list.id).eq('done', true));
        } }, 'Clear done items'),
        h('span')),
    ],
    h('div', { class: 'footer' },
      h('span'),
      h('button', { style: 'color: var(--danger)', onclick: () => {
        if (!confirm(`Delete the list "${list.name}" and everything in it?`)) return;
        state.openListId = null;
        act(sb.from('lists').delete().eq('id', list.id));
      } }, 'Delete list')));
}

function render() {
  const focused = document.activeElement?.closest('.addbar') ? true : false;
  let screen;
  if (!state.user) return;
  else {
    const list = state.lists.find(l => l.id === state.openListId);
    screen = list ? listScreen(list) : homeScreen();
  }
  app.replaceChildren(screen);
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
    channel = null; state.lists = []; state.items = []; state.openListId = null;
    app.replaceChildren(signInScreen(state.signInMsg, true));
    state.signInMsg = null;
  }
}
// Run outside the auth callback (calling Supabase inside it can stall).
sb.auth.onAuthStateChange((_event, session) => { setTimeout(() => handleSession(session), 0); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
