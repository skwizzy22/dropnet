const STORAGE = {
  users: 'dng_users_git_ready_v1',
  session: 'dng_session_git_ready_v1',
  tickets: 'dng_tickets_git_ready_v1',
  news: 'dng_news_git_ready_v1',
  matches: 'dng_matches_git_ready_v1',
  quests: 'dng_quests_git_ready_v1'
};

const ADMIN = {
  username: 'skwizzy22',
  password: '123456',
  nickname: 'skwizzy22',
  role: 'admin',
  elo: 1000,
  level: 1,
  wins: 0,
  losses: 0,
  matches: 0,
  xp: 0
};

const routes = [
  'matchmaking','play','match-room','tournaments','premium','teams','leaderboard','news','quests','feedback','profile','login','register','admin','rules','faq','contacts','privacy','testing','search','friends','inventory','maps','servers','anticheat','settings','stats','league'
];

const navTop = [
  ['matchmaking', 'Матчмейкинг'], ['play', 'Играть'], ['match-room', 'Комната матча'], ['tournaments', 'Турниры'], ['premium', 'Premium'], ['teams', 'Команды'], ['leaderboard', 'Лидерборд'], ['news', 'Новости'], ['faq', 'FAQ']
];

const navMain = [
  ['search','Поиск','⌕'], ['friends','Party Finder','☷'], ['play','Играть','▶'], ['match-room','Комната матча','×'], ['premium','Premium','♕'], ['teams','Команды','☷'], ['leaderboard','Лидерборд','↗'], ['news','Новости','▤'], ['quests','Задания','☼'], ['feedback','Обратная связь','▱']
];

const navService = [
  ['tournaments','Турниры','♕'], ['inventory','SKINBRO | CS2','▣'], ['testing','Тестирование','◉'], ['rules','Правила','◈'], ['contacts','Контакты','▱'], ['privacy','Политика','◈']
];

function read(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function write(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function route() {
  const clean = location.hash.replace('#/', '').replace('#', '').split('?')[0].trim();
  return routes.includes(clean) ? clean : (clean ? 'not-found' : 'matchmaking');
}
function go(path) { location.hash = `#/${routes.includes(path) ? path : 'not-found'}`; }
function today() { return new Date().toISOString().slice(0, 10); }
function normalizeUser(user) {
  const xp = Number(user.xp || 0);
  return {
    ...ADMIN,
    ...user,
    elo: Math.max(100, Number(user.elo || 1000)),
    level: Math.max(1, Math.floor(xp / 160) + 1),
    wins: Number(user.wins || 0),
    losses: Number(user.losses || 0),
    matches: Number(user.matches || 0),
    xp
  };
}
function loadUsers() {
  const users = read(STORAGE.users, []);
  const withoutAdmin = users.filter(u => u.username !== ADMIN.username && u.username !== 'admin').map(normalizeUser);
  return [normalizeUser(ADMIN), ...withoutAdmin];
}
function loadQuests() {
  const saved = read(STORAGE.quests, null);
  if (saved && saved.date === today()) return saved;
  return {
    date: today(),
    items: [
      { id: 'matches', title: 'Сыграть 1 матч', type: 'matches', goal: 1, progress: 0, reward: 50, completed: false },
      { id: 'wins', title: 'Победить 1 раз', type: 'wins', goal: 1, progress: 0, reward: 80, completed: false },
      { id: 'elo', title: 'Получить 25 ELO', type: 'elo', goal: 25, progress: 0, reward: 90, completed: false }
    ]
  };
}

let users = loadUsers();
let currentUser = read(STORAGE.session, null);
currentUser = currentUser ? normalizeUser(currentUser) : null;
let tickets = read(STORAGE.tickets, []);
let news = read(STORAGE.news, [
  { id: 1, tag: 'CS2', title: 'Новый сезон DNG Match Hub', text: 'Обновлены ELO, матч-рум, задания и мини-игра перед поиском матча.', hot: true },
  { id: 2, tag: 'Турниры', title: 'Weekend Cup 5v5', text: 'Команды могут подать заявку на участие через форму обратной связи.', hot: false },
  { id: 3, tag: 'Premium', title: 'Premium Queue', text: 'Отдельная очередь для игроков, которым нужен быстрый подбор и продвинутый профиль.', hot: false }
]);
let matches = read(STORAGE.matches, []);
let quests = loadQuests();
let notifications = [];

function persist() {
  write(STORAGE.users, users);
  write(STORAGE.tickets, tickets);
  write(STORAGE.news, news);
  write(STORAGE.matches, matches);
  write(STORAGE.quests, quests);
  if (currentUser) write(STORAGE.session, currentUser);
}
function notify(text) { notifications = [{ id: Date.now(), text }, ...notifications].slice(0, 6); renderToasts(); }
function renderToasts() {
  const wrap = document.querySelector('.toast-wrap');
  if (!wrap) return;
  wrap.innerHTML = notifications.map(n => `<div class="toast">${escapeHtml(n.text)}</div>`).join('');
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m]));
}
function updateUser(updated) {
  currentUser = normalizeUser(updated);
  users = users.map(u => u.username === currentUser.username ? currentUser : u);
  persist();
}
function markQuest(type, amount) {
  let reward = 0;
  quests.items = quests.items.map(q => {
    if (q.type !== type || q.completed) return q;
    const progress = Math.min(q.goal, q.progress + amount);
    const completed = progress >= q.goal;
    if (completed) reward += q.reward;
    return { ...q, progress, completed };
  });
  if (reward && currentUser) {
    updateUser({ ...currentUser, xp: currentUser.xp + reward });
    notify(`Задание выполнено: +${reward} XP`);
  }
  persist();
}
function applyGameResult(payload) {
  if (!payload || payload.type !== 'DNG_GAME_RESULT' || !currentUser) return;
  const id = `${payload.result}-${payload.eloChange}-${payload.kills}-${payload.createdAt}`;
  if (localStorage.getItem('dng_last_result_id') === id) return;
  localStorage.setItem('dng_last_result_id', id);
  const eloChange = Number(payload.eloChange || 0);
  const win = payload.result === 'win';
  updateUser({
    ...currentUser,
    elo: Math.max(100, currentUser.elo + eloChange),
    wins: currentUser.wins + (win ? 1 : 0),
    losses: currentUser.losses + (win ? 0 : 1),
    matches: currentUser.matches + 1,
    xp: currentUser.xp + (win ? 60 : 25)
  });
  matches = [{ id: Date.now(), map: 'DNG Aim Mission', server: 'Browser Mini Game', result: win ? 'Win' : 'Lose', score: `${payload.kills || 0} kills`, eloChange, createdAt: payload.createdAt || new Date().toLocaleString('ru-RU') }, ...matches].slice(0, 30);
  markQuest('matches', 1);
  if (win) markQuest('wins', 1);
  if (eloChange > 0) markQuest('elo', eloChange);
  persist();
  notify(`Мини-игра: ${win ? 'победа' : 'поражение'}, ${eloChange > 0 ? '+' : ''}${eloChange} ELO`);
  localStorage.removeItem('dng_minigame_result');
  render();
}

window.addEventListener('message', e => applyGameResult(e.data));
window.addEventListener('storage', e => {
  if (e.key === 'dng_minigame_result' && e.newValue) {
    try { applyGameResult(JSON.parse(e.newValue)); } catch {}
  }
});
window.addEventListener('hashchange', render);

function startMatch() {
  if (!currentUser) { go('login'); return; }
  const url = new URL('public/cs2-minigame.html', location.href).href;
  const popup = window.open(url, 'dng-cs2-minigame', 'width=1280,height=760,menubar=no,toolbar=no,location=no,status=no');
  if (!popup) alert('Браузер заблокировал окно игры. Разреши всплывающие окна для сайта.');
  else notify('Мини-игра открыта в отдельном окне');
}

function layout(content) {
  const r = route();
  return `
    <div class="app-shell">
      <header class="topbar">
        <button class="brand nav-reset" onclick="go('matchmaking')">
          <img src="public/logo.svg" class="brand-logo" alt="DNG" />
          <span class="brand-text"><strong>DNG</strong><span>CS2</span></span>
        </button>
        <nav class="topnav">${navTop.map(([p,l]) => `<button onclick="go('${p}')" class="nav-pill ${r===p?'active':''}">${l}</button>`).join('')}</nav>
        <div class="top-actions">
          <button class="mini-btn">🔔 ${notifications.length}</button>
          ${currentUser ? `
            <button class="mini-btn" onclick="go('profile')">${escapeHtml(currentUser.nickname || currentUser.username)}</button>
            ${currentUser.role === 'admin' ? `<button class="mini-btn admin" onclick="go('admin')">Админ-панель</button>` : ''}
            <button class="mini-btn danger" onclick="logout()">Выйти</button>` : `
            <button class="mini-btn" onclick="go('login')">Войти</button>
            <button class="mini-btn admin" onclick="go('register')">Регистрация</button>`}
        </div>
      </header>
      <div class="body-grid">
        <aside class="sidebar">
          <button class="sidebar-logo" onclick="go('matchmaking')"><img src="public/logo.svg" alt="DNG" /></button>
          <nav class="side-list">
            ${navMain.map(item => navItem(item, r)).join('')}
            <div class="side-divider"></div>
            ${navService.map(item => navItem(item, r)).join('')}
          </nav>
        </aside>
        <main class="page">${content}</main>
        <aside class="rightbar">
          ${[['profile','DN','Профиль'],['feedback','▱','Обратная связь'],['quests','☼','Задания'],['settings','⚙','Настройки'],['rules','◈','Правила']].map(([p,i,l]) => `<button class="right-btn" onclick="go('${p}')" title="${l}">${i}</button>`).join('')}
        </aside>
      </div>
      <div class="toast-wrap"></div>
    </div>`;
}
function navItem([p,l,i], r) { return `<button onclick="go('${p}')" class="nav-item ${r===p?'active':''}"><span class="ico">${i}</span><span>${l}</span></button>`; }

function homePage() {
  const u = currentUser || normalizeUser({ username: 'guest', nickname: 'Гость', role: 'guest' });
  const completed = quests.items.filter(q => q.completed).length;
  return `
    <div class="strip">DROP NET GAMING • CS2 PROJECT • STEEL WINGS ARENA</div>
    <section class="grid-hero">
      <div class="card hero-card">
        <span class="kicker">Europe CS2 5v5 Queue</span>
        <h1>Level ${u.level}</h1>
        <p>Платформа DNG: матчи, ELO, новости, задания, админ-панель и мини-игра перед поиском матча.</p>
        <div class="btn-row">
          <button class="btn primary" onclick="startMatch()">НАЙТИ МАТЧ</button>
          <button class="btn" onclick="go('leaderboard')">Открыть лидерборд</button>
        </div>
      </div>
      <div class="stats-grid">
        <div class="card stat"><span class="kicker">Daily quests</span><strong>${completed}/3 заданий выполнено 🏆</strong><div class="progress"><span style="width:${completed / 3 * 100}%"></span></div></div>
        <div class="card stat"><h2>ELO и уровни</h2><button class="btn" onclick="go('leaderboard')">Открыть лидерборд</button><p>Последних матчей: ${matches.length}</p></div>
      </div>
    </section>
    <section class="profile-zone">
      <div class="level-ring">${u.level}</div>
      <div>
        <span class="badge">ELO ${u.elo}</span>
        <h2>${escapeHtml(u.nickname || u.username)}</h2>
        <div class="progress"><span style="width:${Math.min(100, (u.xp % 160) / 160 * 100)}%"></span></div>
        <p>Побед: ${u.wins} • Матчей: ${u.matches} • XP: ${u.xp}</p>
        <span class="badge">Верификация пройдена</span>
      </div>
    </section>
    <section class="party">
      ${['Пригласить','Пригласить','player','Пригласить','Поиск группы'].map((x,idx) => idx===2 ? `<div class="party-card"><div class="avatar">${(u.nickname || u.username).slice(0,2).toUpperCase()}</div><b>${escapeHtml(u.nickname || u.username)}</b></div>` : `<button class="party-card" onclick="go('${idx===4?'friends':'feedback'}')"><div class="plus">${idx===4?'⌕':'+'}</div><span>${x}</span></button>`).join('')}
    </section>
    <section class="match-panel">
      <div class="match-head"><b>× Тип матча</b><button class="btn primary" onclick="startMatch()">НАЙТИ МАТЧ</button><div><b>▤ Серверы</b></div></div>
      <div class="match-types">
        ${['Стандартный матч','Суперматч','Premium Match'].map(t => `<button class="match-type" onclick="startMatch()"><b>${t} • 5v5</b><p>Premium подбор • Античит • Карты CS2</p></button>`).join('')}
      </div>
    </section>
    <section class="two-col">
      <div class="card"><span class="kicker">Commercial goal</span><h2>Как сайт зарабатывает</h2><p>Premium-подписка, турниры, рекламные партнёры, продвижение команд и игровые сервисы.</p></div>
      <div class="card"><span class="kicker">Trust block</span><h2>Блок доверия</h2><p>Профили, история матчей, обращения в поддержку, правила, FAQ и прозрачная статистика.</p></div>
    </section>`;
}

function generic(title, text, cards = []) {
  return `<section class="card hero-card"><span class="kicker">DNG Section</span><h1>${title}</h1><p>${text}</p><div class="btn-row"><button class="btn primary" onclick="startMatch()">Найти матч</button><button class="btn" onclick="go('matchmaking')">На главную</button></div></section>${cards.length ? `<section class="content-grid">${cards.map(c => `<article class="card"><h2>${c}</h2><p>Раздел работает как отдельная страница сайта.</p></article>`).join('')}</section>` : ''}`;
}
function playPage() { return generic('Играть', 'Выбери режим. При поиске матча открывается отдельное окно браузера с мини-игрой.', ['5v5 Ranked','Premium Queue','Custom Lobby','Aim Training']); }
function matchRoomPage() { return generic('Комната матча', 'Страница найденного матча: команды, карта, сервер, результат и история.', ['Team A','Карта Mirage','Team B']); }
function newsPage() { return `<section class="card hero-card"><span class="kicker">News feed</span><h1>Новости</h1><p>Новости CS2, турниров, Premium и обновлений платформы.</p></section><section class="content-grid">${news.map(n => `<article class="card"><span class="badge">${n.tag}${n.hot?' • HOT':''}</span><h2>${escapeHtml(n.title)}</h2><p>${escapeHtml(n.text)}</p></article>`).join('')}</section>`; }
function questsPage() { return `<section class="card hero-card"><span class="kicker">Daily</span><h1>Задания</h1><p>Выполняй задания, получай XP и повышай уровень.</p></section><section class="content-grid">${quests.items.map(q => `<article class="card"><h2>${q.completed?'✅':'☼'} ${q.title}</h2><p>${q.progress}/${q.goal} • награда ${q.reward} XP</p><div class="progress"><span style="width:${q.progress/q.goal*100}%"></span></div></article>`).join('')}</section>`; }
function leaderboardPage() { const sorted = [...users].sort((a,b)=>b.elo-a.elo); return `<section class="card hero-card"><span class="kicker">ELO</span><h1>Лидерборд</h1><p>Топ игроков по рейтингу ELO.</p></section><section class="card"><table class="table"><thead><tr><th>#</th><th>Игрок</th><th>ELO</th><th>Победы</th><th>Матчи</th></tr></thead><tbody>${sorted.map((u,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(u.nickname||u.username)}</td><td>${u.elo}</td><td>${u.wins}</td><td>${u.matches}</td></tr>`).join('')}</tbody></table></section>`; }
function profilePage() { if (!currentUser) return loginPage(); const u=currentUser; return `<section class="card hero-card"><span class="kicker">Profile</span><h1>${escapeHtml(u.nickname||u.username)}</h1><p>@${escapeHtml(u.username)} • роль: ${u.role}</p><div class="btn-row"><span class="badge">ELO ${u.elo}</span><span class="badge">Level ${u.level}</span><span class="badge">XP ${u.xp}</span></div></section><section class="content-grid">${matches.slice(0,6).map(m=>`<article class="card"><h2>${m.result} ${m.eloChange>0?'+':''}${m.eloChange} ELO</h2><p>${m.map} • ${m.score} • ${m.createdAt}</p></article>`).join('') || '<article class="card"><h2>Матчей пока нет</h2><p>Нажми Найти матч и сыграй мини-игру.</p></article>'}</section>`; }
function feedbackPage() { return `<section class="card hero-card"><span class="kicker">Support</span><h1>Обратная связь</h1><p>Отправь обращение админу. Оно появится в админ-панели.</p><form class="form" onsubmit="sendTicket(event)"><input class="input" name="subject" placeholder="Тема обращения" required><textarea name="message" placeholder="Опиши проблему" required></textarea><button class="btn primary">Отправить</button></form></section>`; }
function loginPage() { return `<section class="card hero-card"><span class="kicker">Auth</span><h1>Вход</h1><p>Админ: skwizzy22 / 123456</p><form class="form" onsubmit="login(event)"><input class="input" name="username" placeholder="Логин" required><input class="input" name="password" placeholder="Пароль" type="password" required><button class="btn primary">Войти</button><button class="btn" type="button" onclick="go('register')">Регистрация</button></form></section>`; }
function registerPage() { return `<section class="card hero-card"><span class="kicker">Auth</span><h1>Регистрация</h1><form class="form" onsubmit="register(event)"><input class="input" name="username" placeholder="Логин" required><input class="input" name="nickname" placeholder="Никнейм"><input class="input" name="password" placeholder="Пароль" type="password" required><button class="btn primary">Создать аккаунт</button></form></section>`; }
function adminPage() { if (!currentUser || currentUser.role !== 'admin') return `<section class="card hero-card"><h1>Доступ закрыт</h1><p>Войди под админом.</p><button class="btn primary" onclick="go('login')">Войти</button></section>`; return `<section class="card hero-card"><span class="kicker">Admin</span><h1>Админ-панель</h1><p>Управление новостями, обращениями и пользователями.</p></section><section class="two-col"><div class="card"><h2>Добавить новость</h2><form class="form" onsubmit="addNews(event)"><input class="input" name="title" placeholder="Заголовок" required><input class="input" name="tag" placeholder="Тег" required><textarea name="text" placeholder="Текст" required></textarea><button class="btn primary">Добавить</button></form></div><div class="card"><h2>Обращения</h2>${tickets.map(t=>`<p><b>${escapeHtml(t.subject)}</b><br>${escapeHtml(t.message)}<br><span class="badge">${escapeHtml(t.author)}</span></p>`).join('') || '<p>Пока обращений нет.</p>'}</div></section><section class="card"><h2>Пользователи</h2><table class="table"><tbody>${users.map(u=>`<tr><td>${escapeHtml(u.username)}</td><td>${escapeHtml(u.nickname||u.username)}</td><td>${u.role}</td><td>${u.elo}</td></tr>`).join('')}</tbody></table></section>`; }

window.login = function(e) { e.preventDefault(); const f = new FormData(e.target); const user = users.find(u => u.username === f.get('username') && u.password === f.get('password')); if (!user) return alert('Неверный логин или пароль'); currentUser = normalizeUser(user); persist(); notify('Вход выполнен'); go(currentUser.role === 'admin' ? 'admin' : 'profile'); };
window.register = function(e) { e.preventDefault(); const f = new FormData(e.target); const username = f.get('username').trim(); if (users.some(u=>u.username.toLowerCase()===username.toLowerCase())) return alert('Логин занят'); const u = normalizeUser({ username, password: f.get('password'), nickname: f.get('nickname') || username, role: 'user', elo:1000, xp:0 }); users.push(u); currentUser=u; persist(); go('profile'); };
window.logout = function() { currentUser = null; localStorage.removeItem(STORAGE.session); notify('Вы вышли'); go('matchmaking'); };
window.sendTicket = function(e) { e.preventDefault(); const f = new FormData(e.target); tickets.unshift({ id: Date.now(), subject: f.get('subject'), message: f.get('message'), author: currentUser?.nickname || 'Гость', createdAt: new Date().toLocaleString('ru-RU') }); markQuest('matches', 0); persist(); alert('Обращение отправлено'); e.target.reset(); };
window.addNews = function(e) { e.preventDefault(); const f = new FormData(e.target); news.unshift({ id: Date.now(), title: f.get('title'), tag: f.get('tag'), text: f.get('text'), hot: true }); persist(); render(); };
window.go = go;
window.startMatch = startMatch;

function render() {
  const r = route();
  let content;
  if (r === 'matchmaking') content = homePage();
  else if (r === 'play') content = playPage();
  else if (r === 'match-room') content = matchRoomPage();
  else if (r === 'news') content = newsPage();
  else if (r === 'quests') content = questsPage();
  else if (r === 'leaderboard') content = leaderboardPage();
  else if (r === 'profile') content = profilePage();
  else if (r === 'feedback') content = feedbackPage();
  else if (r === 'login') content = loginPage();
  else if (r === 'register') content = registerPage();
  else if (r === 'admin') content = adminPage();
  else if (r === 'premium') content = generic('Premium', 'Премиум-подписка: приоритетная очередь, профиль, значки и бонусы.', ['Premium Queue','Значок профиля','Быстрый подбор']);
  else if (r === 'tournaments') content = generic('Турниры', 'Страница турниров DNG: сетки, заявки, команды и призы.', ['Weekend Cup','School Cup','5v5 Open']);
  else if (r === 'teams') content = generic('Команды', 'Создание команд, составы, приглашения и заявки.', ['Создать команду','Найти игроков','Рейтинг команд']);
  else if (r === 'rules') content = generic('Правила', 'Правила платформы, честная игра, античит и поведение игроков.', ['Fair play','Античит','Жалобы']);
  else if (r === 'faq') content = generic('FAQ', 'Ответы на частые вопросы по сайту, ELO, админке и мини-игре.', ['Как работает ELO?','Где админка?','Как начать матч?']);
  else if (r === 'contacts') content = generic('Контакты', 'Связь с администрацией проекта DNG.', ['Поддержка','Партнёрство','Жалобы']);
  else if (r === 'privacy') content = generic('Политика', 'Демо-политика хранения данных: сайт использует localStorage в браузере.', ['localStorage','Аккаунты','Обращения']);
  else if (r === 'testing') content = generic('Тестирование', 'Проверка функций сайта: вход, мини-игра, ELO, новости, обращения.', ['Авторизация','Мини-игра','Админ-панель']);
  else if (['search','friends','inventory','maps','servers','anticheat','settings','stats','league'].includes(r)) content = generic(r, 'Отдельная рабочая страница раздела DNG.', ['Демо-карта','Действие','Информация']);
  else content = `<section class="card hero-card"><span class="kicker">404</span><h1>Страница не найдена</h1><p>Такого раздела нет.</p><button class="btn primary" onclick="go('matchmaking')">На главную</button></section>`;
  document.getElementById('app').innerHTML = layout(content);
  renderToasts();
}

try {
  const saved = localStorage.getItem('dng_minigame_result');
  if (saved) applyGameResult(JSON.parse(saved));
} catch {}

persist();
render();
