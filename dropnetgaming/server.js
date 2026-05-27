const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 10000;
const hasDatabase = Boolean(process.env.DATABASE_URL);

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_PATH = process.env.ADMIN_PATH || "/_dng-control";
const ADMIN_TOKEN_SECRET =
  process.env.ADMIN_TOKEN_SECRET ||
  crypto.createHash("sha256").update(String(ADMIN_PASSWORD || "dev-secret")).digest("hex");

app.use(express.json({ limit: "5mb" }));

const defaultState = {
  users: [],
  tickets: [],
  payments: [],
  news: [
    {
      id: 1,
      tag: "CS2",
      title: "Обновление матчмейкинга DNG",
      text: "Сайт подключён к Render и готов к работе через сервер."
    },
    {
      id: 2,
      tag: "DNG",
      title: "Скрытая панель управления",
      text: "Панель управления вынесена на сервер и больше не лежит во frontend-коде."
    },
    {
      id: 3,
      tag: "Payments",
      title: "Платежи Premium",
      text: "Тарифы создают счета, которые владелец видит в скрытой панели."
    }
  ],
  matches: [],
  quests: [
    { id: 1, title: "Сыграть 1 матч", type: "matches", goal: 1, progress: 0, reward: 40 },
    { id: 2, title: "Выиграть 1 матч", type: "wins", goal: 1, progress: 0, reward: 60 },
    { id: 3, title: "Получить ELO", type: "elo", goal: 20, progress: 0, reward: 80 }
  ]
};

let memoryState = structuredCloneSafe(defaultState);

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

const pool = hasDatabase
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
    })
  : null;

async function initDatabase() {
  if (!pool) {
    console.log("DATABASE_URL is not set. Running with in-memory state.");
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(
    `
    INSERT INTO app_state (id, data)
    VALUES ($1, $2::jsonb)
    ON CONFLICT (id) DO NOTHING;
    `,
    ["dng-main", JSON.stringify(defaultState)]
  );

  const current = await getState();
  if (!Array.isArray(current.payments)) {
    current.payments = [];
    await setState(current);
  }

  console.log("Database connected.");
}

function makePasswordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto
    .pbkdf2Sync(String(password), salt, 120000, 64, "sha512")
    .toString("hex");

  return { salt, passwordHash: hash };
}

function safeEqualString(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function verifyPassword(password, user) {
  if (!user) return false;

  if (user.passwordHash && user.salt) {
    const candidate = makePasswordHash(password, user.salt).passwordHash;
    return safeEqualString(candidate, user.passwordHash);
  }

  if (user.password) {
    return String(user.password) === String(password);
  }

  return false;
}

function publicUser(user) {
  return {
    username: user.username,
    nickname: user.nickname || user.username,
    role: "user",
    elo: Number(user.elo || 1000),
    level: Number(user.level || 1),
    wins: Number(user.wins || 0),
    losses: Number(user.losses || 0),
    matches: Number(user.matches || 0),
    xp: Number(user.xp || 0)
  };
}

function publicState(state) {
  return {
    users: Array.isArray(state.users)
      ? state.users.filter((user) => user.role !== "admin").map(publicUser)
      : [],
    tickets: Array.isArray(state.tickets) ? state.tickets : [],
    payments: Array.isArray(state.payments) ? state.payments.map(publicPayment) : [],
    news: Array.isArray(state.news) ? state.news : defaultState.news,
    matches: Array.isArray(state.matches) ? state.matches : [],
    quests: Array.isArray(state.quests) ? state.quests : defaultState.quests
  };
}

function publicPayment(payment) {
  return {
    id: payment.id,
    plan: payment.plan,
    amount: payment.amount,
    username: payment.username,
    nickname: payment.nickname,
    status: payment.status,
    createdAt: payment.createdAt,
    paidAt: payment.paidAt || "",
    updatedAt: payment.updatedAt || ""
  };
}

function sanitizeState(input) {
  return {
    users: Array.isArray(input.users)
      ? input.users.filter((user) => user && user.username && user.role !== "admin")
      : [],
    tickets: Array.isArray(input.tickets) ? input.tickets : [],
    payments: Array.isArray(input.payments) ? input.payments : [],
    news: Array.isArray(input.news) ? input.news : defaultState.news,
    matches: Array.isArray(input.matches) ? input.matches : [],
    quests: Array.isArray(input.quests) ? input.quests : defaultState.quests
  };
}

function mergePublicUpdate(current, update) {
  const next = sanitizeState(current);

  if (Array.isArray(update.tickets)) next.tickets = update.tickets;
  if (Array.isArray(update.matches)) next.matches = update.matches;
  if (Array.isArray(update.quests)) next.quests = update.quests;

  if (Array.isArray(update.users)) {
    const currentByName = new Map(next.users.map((user) => [user.username, user]));

    next.users = update.users
      .filter((user) => user && user.username && user.role !== "admin")
      .map((incoming) => {
        const existing = currentByName.get(incoming.username) || {};

        return {
          ...existing,
          ...publicUser(incoming),
          role: "user",
          passwordHash: existing.passwordHash,
          salt: existing.salt,
          password: existing.password
        };
      });
  }

  return next;
}

async function getState() {
  if (!pool) return memoryState;

  const result = await pool.query("SELECT data FROM app_state WHERE id = $1", ["dng-main"]);

  if (result.rows.length === 0) {
    return structuredCloneSafe(defaultState);
  }

  return sanitizeState(result.rows[0].data);
}

async function setState(nextState) {
  const clean = sanitizeState(nextState);

  if (!pool) {
    memoryState = clean;
    return clean;
  }

  await pool.query(
    `
    INSERT INTO app_state (id, data, updated_at)
    VALUES ($1, $2::jsonb, NOW())
    ON CONFLICT (id)
    DO UPDATE SET data = EXCLUDED.data, updated_at = NOW();
    `,
    ["dng-main", JSON.stringify(clean)]
  );

  return clean;
}

function parseCookies(req) {
  const header = req.headers.cookie || "";

  return header.split(";").reduce((cookies, item) => {
    const [key, ...value] = item.trim().split("=");

    if (key) {
      cookies[key] = decodeURIComponent(value.join("="));
    }

    return cookies;
  }, {});
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", ADMIN_TOKEN_SECRET).update(body).digest("base64url");

  return `${body}.${signature}`;
}

function verifyToken(token) {
  try {
    if (!token || !token.includes(".")) return null;

    const [body, signature] = token.split(".");
    const expected = crypto.createHmac("sha256", ADMIN_TOKEN_SECRET).update(body).digest("base64url");

    if (!safeEqualString(signature, expected)) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));

    if (!payload.exp || Date.now() > payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function isAdminRequest(req) {
  const cookies = parseCookies(req);
  const payload = verifyToken(cookies.dng_admin_session);

  return Boolean(payload && payload.role === "admin");
}

function adminCookie(token, req) {
  const isHttps = req.headers["x-forwarded-proto"] === "https" || req.secure;

  return [
    `dng_admin_session=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=43200",
    isHttps ? "Secure" : ""
  ].filter(Boolean).join("; ");
}

function clearAdminCookie() {
  return "dng_admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
}

function requireAdmin(req, res, next) {
  if (!isAdminRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function adminLoginHtml() {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DNG Control Login</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: radial-gradient(circle at 30% 10%, rgba(255,255,255,.12), transparent 28%), linear-gradient(135deg, #050505, #11131c 55%, #020202);
      color: white;
      font-family: Arial, Helvetica, sans-serif;
      padding: 20px;
    }
    .card {
      width: min(460px, 100%);
      border: 1px solid rgba(255,255,255,.14);
      background: rgba(0,0,0,.68);
      border-radius: 28px;
      padding: 28px;
      box-shadow: 0 0 50px rgba(255,255,255,.09);
    }
    h1 { margin: 0 0 10px; font-size: 42px; letter-spacing: -.06em; }
    p { color: #aaa; line-height: 1.6; }
    .form { display: grid; gap: 12px; margin-top: 18px; }
    input {
      width: 100%;
      border: 1px solid rgba(255,255,255,.15);
      background: rgba(0,0,0,.5);
      color: white;
      border-radius: 14px;
      padding: 14px;
      outline: none;
    }
    button {
      border: 1px solid rgba(255,255,255,.18);
      background: linear-gradient(135deg, #fff, #aaa);
      color: #070707;
      border-radius: 14px;
      padding: 14px 18px;
      font-weight: 900;
      cursor: pointer;
    }
    .error { color: #ffb4b4; min-height: 20px; }
  </style>
</head>
<body>
  <section class="card">
    <h1>DNG Control</h1>
    <p>Закрытый вход владельца проекта.</p>
    <div class="form">
      <input id="username" placeholder="Логин" autocomplete="username" />
      <input id="password" type="password" placeholder="Пароль" autocomplete="current-password" />
      <button onclick="login()">Войти</button>
      <div class="error" id="error"></div>
    </div>
  </section>

  <script>
    async function login() {
      const username = document.getElementById("username").value.trim();
      const password = document.getElementById("password").value;
      const error = document.getElementById("error");

      error.textContent = "";

      const response = await fetch("/api/control/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });

      if (!response.ok) {
        error.textContent = "Неверный логин или пароль";
        return;
      }

      location.reload();
    }
  </script>
</body>
</html>`;
}

function adminPanelHtml() {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DNG Control</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: radial-gradient(circle at 30% 10%, rgba(255,255,255,.12), transparent 28%), linear-gradient(135deg, #050505, #11131c 55%, #020202);
      color: white;
      font-family: Arial, Helvetica, sans-serif;
    }
    .wrap { width: min(1280px, calc(100% - 32px)); margin: 0 auto; padding: 36px 0 80px; }
    .hero, .card {
      border: 1px solid rgba(255,255,255,.14);
      background: rgba(0,0,0,.55);
      border-radius: 26px;
      padding: 24px;
      box-shadow: 0 0 40px rgba(255,255,255,.07);
    }
    .hero h1 { margin: 0; font-size: clamp(38px, 6vw, 72px); letter-spacing: -.06em; }
    .hero p, .muted { color: #aaa; line-height: 1.6; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 20px; }
    .grid-2 { grid-template-columns: repeat(2, 1fr); }
    .form { display: grid; gap: 12px; margin-top: 14px; }
    input, textarea, select {
      width: 100%;
      border: 1px solid rgba(255,255,255,.15);
      background: rgba(0,0,0,.5);
      color: white;
      border-radius: 14px;
      padding: 14px;
      outline: none;
    }
    textarea { min-height: 120px; resize: vertical; }
    button {
      border: 1px solid rgba(255,255,255,.18);
      background: linear-gradient(135deg, #fff, #aaa);
      color: #070707;
      border-radius: 14px;
      padding: 13px 18px;
      font-weight: 900;
      cursor: pointer;
    }
    button.dark { background: rgba(255,255,255,.08); color: white; }
    button.danger { background: rgba(255,80,80,.18); color: #ffb8b8; border-color: rgba(255,80,80,.38); }
    button.good { background: rgba(80,255,150,.18); color: #b8ffd3; border-color: rgba(80,255,150,.38); }
    .row {
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 16px;
      padding: 14px;
      margin-top: 10px;
      background: rgba(255,255,255,.04);
    }
    .top { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 20px; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
    .pill { display: inline-flex; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; padding: 5px 10px; color: #ddd; background: rgba(255,255,255,.06); font-size: 12px; font-weight: 900; }
    @media (max-width: 900px) { .grid, .grid-2 { grid-template-columns: 1fr; } .top { flex-direction: column; align-items: flex-start; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div>
        <h2>DNG Server Control</h2>
        <p class="muted">Новости, ELO, платежи, обращения и игроки.</p>
      </div>
      <button class="dark" onclick="logout()">Выйти</button>
    </div>

    <section class="hero">
      <h1>Панель управления</h1>
      <p>Здесь можно удалять новости, менять ELO игроков и контролировать платежи.</p>
    </section>

    <section class="grid" id="stats"></section>

    <section class="grid grid-2">
      <div class="card">
        <h2>Добавить новость</h2>
        <div class="form">
          <input id="newsTag" placeholder="Тег, например CS2" />
          <input id="newsTitle" placeholder="Заголовок" />
          <textarea id="newsText" placeholder="Текст новости"></textarea>
          <button onclick="addNews()">Добавить новость</button>
        </div>
      </div>

      <div class="card">
        <h2>Выдать / снять ELO</h2>
        <div class="form">
          <select id="eloUser"></select>
          <input id="eloAmount" type="number" placeholder="Например: 50 или -25" />
          <input id="eloReason" placeholder="Причина изменения" />
          <button onclick="changeElo()">Применить ELO</button>
        </div>
      </div>
    </section>

    <section class="grid grid-2">
      <div class="card">
        <h2>Новости</h2>
        <div id="news"></div>
      </div>

      <div class="card">
        <h2>Платежи</h2>
        <div id="payments"></div>
      </div>
    </section>

    <section class="grid grid-2">
      <div class="card">
        <h2>Обращения</h2>
        <div id="tickets"></div>
      </div>

      <div class="card">
        <h2>Игроки</h2>
        <div id="users"></div>
      </div>
    </section>
  </div>

  <script>
    let state = null;

    function esc(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    async function api(path, options = {}) {
      const response = await fetch(path, {
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Request failed");
      }

      return response.json();
    }

    async function load() {
      state = await api("/api/control/state");

      document.getElementById("stats").innerHTML = [
        ["Пользователей", state.users.length],
        ["Новостей", state.news.length],
        ["Обращений", state.tickets.length],
        ["Платежей", state.payments.length],
        ["Оплачено", state.payments.filter(item => item.status === "paid").length],
        ["Ожидают", state.payments.filter(item => item.status === "pending").length]
      ].map(item => \`
        <article class="card"><h2>\${item[1]}</h2><p class="muted">\${item[0]}</p></article>
      \`).join("");

      document.getElementById("eloUser").innerHTML = state.users.length
        ? state.users.map(user => \`<option value="\${esc(user.username)}">\${esc(user.nickname || user.username)} — ELO \${user.elo || 1000}</option>\`).join("")
        : '<option value="">Нет игроков</option>';

      document.getElementById("news").innerHTML = state.news.length
        ? state.news.map(item => \`
          <div class="row">
            <span class="pill">\${esc(item.tag || "DNG")}</span>
            <h3>\${esc(item.title)}</h3>
            <p class="muted">\${esc(item.text)}</p>
            <button class="danger" onclick="deleteNews(\${Number(item.id)})">Удалить новость</button>
          </div>
        \`).join("")
        : '<p class="muted">Новостей нет.</p>';

      document.getElementById("payments").innerHTML = state.payments.length
        ? state.payments.map(payment => \`
          <div class="row">
            <b>\${esc(payment.plan)} • \${Number(payment.amount || 0)} ₽</b>
            <p class="muted">\${esc(payment.nickname || payment.username || "Гость")} • \${esc(payment.createdAt || "")}</p>
            <p>Статус: <span class="pill">\${esc(payment.status)}</span></p>
            <div class="actions">
              <button class="good" onclick="setPaymentStatus('\${esc(payment.id)}', 'paid')">Оплачен</button>
              <button class="dark" onclick="setPaymentStatus('\${esc(payment.id)}', 'cancelled')">Отменён</button>
              <button class="danger" onclick="setPaymentStatus('\${esc(payment.id)}', 'refunded')">Возврат</button>
            </div>
          </div>
        \`).join("")
        : '<p class="muted">Платежей нет.</p>';

      document.getElementById("tickets").innerHTML = state.tickets.length
        ? state.tickets.map(ticket => \`
          <div class="row">
            <b>\${esc(ticket.subject || "Без темы")}</b>
            <p class="muted">\${esc(ticket.author || "Гость")} • \${esc(ticket.createdAt || "")}</p>
            <p>\${esc(ticket.message || "")}</p>
            <button class="danger" onclick="deleteTicket(\${Number(ticket.id)})">Удалить</button>
          </div>
        \`).join("")
        : '<p class="muted">Обращений нет.</p>';

      document.getElementById("users").innerHTML = state.users.length
        ? state.users.map(user => \`
          <div class="row">
            <b>\${esc(user.nickname || user.username)}</b>
            <p class="muted">Логин: \${esc(user.username)} • ELO \${user.elo || 1000} • Level \${user.level || 1} • Matches \${user.matches || 0}</p>
          </div>
        \`).join("")
        : '<p class="muted">Пользователей нет.</p>';
    }

    async function addNews() {
      const tag = document.getElementById("newsTag").value.trim() || "DNG";
      const title = document.getElementById("newsTitle").value.trim();
      const text = document.getElementById("newsText").value.trim();

      if (!title || !text) {
        alert("Заполни заголовок и текст");
        return;
      }

      await api("/api/control/news", {
        method: "POST",
        body: JSON.stringify({ tag, title, text })
      });

      document.getElementById("newsTag").value = "";
      document.getElementById("newsTitle").value = "";
      document.getElementById("newsText").value = "";

      await load();
    }

    async function deleteNews(id) {
      if (!confirm("Удалить эту новость?")) return;
      await api("/api/control/news/" + id, { method: "DELETE" });
      await load();
    }

    async function changeElo() {
      const username = document.getElementById("eloUser").value;
      const amount = Number(document.getElementById("eloAmount").value || 0);
      const reason = document.getElementById("eloReason").value.trim();

      if (!username || !amount) {
        alert("Выбери игрока и укажи ELO");
        return;
      }

      await api("/api/control/users/" + encodeURIComponent(username) + "/elo", {
        method: "POST",
        body: JSON.stringify({ amount, reason })
      });

      document.getElementById("eloAmount").value = "";
      document.getElementById("eloReason").value = "";
      await load();
    }

    async function setPaymentStatus(id, status) {
      await api("/api/control/payments/" + encodeURIComponent(id) + "/status", {
        method: "POST",
        body: JSON.stringify({ status })
      });
      await load();
    }

    async function deleteTicket(id) {
      await api("/api/control/tickets/" + id, { method: "DELETE" });
      await load();
    }

    async function logout() {
      await api("/api/control/logout", { method: "POST", body: "{}" });
      location.reload();
    }

    load().catch(() => {
      alert("Нет доступа или сессия истекла.");
      location.reload();
    });
  </script>
</body>
</html>`;
}

function paymentPageHtml(payment) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DNG Payment</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: radial-gradient(circle at 30% 10%, rgba(255,255,255,.12), transparent 28%), linear-gradient(135deg, #050505, #11131c 55%, #020202);
      color: white;
      font-family: Arial, Helvetica, sans-serif;
      padding: 20px;
    }
    .card {
      width: min(560px, 100%);
      border: 1px solid rgba(255,255,255,.14);
      background: rgba(0,0,0,.72);
      border-radius: 28px;
      padding: 28px;
      box-shadow: 0 0 50px rgba(255,255,255,.09);
    }
    h1 { margin: 0 0 10px; font-size: 44px; letter-spacing: -.06em; }
    p { color: #aaa; line-height: 1.6; }
    .price { font-size: 48px; font-weight: 1000; margin: 16px 0; }
    .pill { display: inline-flex; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; padding: 6px 12px; background: rgba(255,255,255,.06); font-weight: 900; }
    button {
      width: 100%;
      margin-top: 12px;
      border: 1px solid rgba(255,255,255,.18);
      background: linear-gradient(135deg, #fff, #aaa);
      color: #070707;
      border-radius: 14px;
      padding: 15px 18px;
      font-weight: 900;
      cursor: pointer;
    }
    button.dark { background: rgba(255,255,255,.08); color: white; }
  </style>
</head>
<body>
  <section class="card">
    <span class="pill">${escapeHtml(payment.status)}</span>
    <h1>DNG Payment</h1>
    <p>Счёт: <b>${escapeHtml(payment.id)}</b></p>
    <p>Тариф: <b>${escapeHtml(payment.plan)}</b></p>
    <p>Игрок: <b>${escapeHtml(payment.nickname || payment.username || "Гость")}</b></p>
    <div class="price">${Number(payment.amount || 0)} ₽</div>
    <p>Это демо-платёжная система проекта: она не принимает банковские карты и не списывает реальные деньги. Для реального эквайринга нужно подключить платёжного провайдера.</p>
    ${payment.status === "paid"
      ? `<button class="dark" onclick="window.close()">Уже оплачено</button>`
      : `<button onclick="demoPay()">Демо-оплатить</button>
         <button class="dark" onclick="window.close()">Закрыть</button>`
    }
  </section>

  <script>
    async function demoPay() {
      const response = await fetch("/api/payments/${encodeURIComponent(payment.id)}/demo-pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });

      if (!response.ok) {
        alert("Ошибка оплаты");
        return;
      }

      alert("Демо-оплата прошла. Статус обновлён в панели владельца.");
      location.reload();
    }
  </script>
</body>
</html>`;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    database: hasDatabase ? "render-postgres" : "memory",
    hiddenControlPathConfigured: Boolean(process.env.ADMIN_PATH),
    payments: true,
    time: new Date().toISOString()
  });
});

app.get("/api/state", async (_req, res) => {
  try {
    res.json(publicState(await getState()));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to load state" });
  }
});

app.post("/api/state", async (req, res) => {
  try {
    const current = await getState();
    const next = mergePublicUpdate(current, req.body || {});
    const saved = await setState(next);
    res.json({ ok: true, ...publicState(saved) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to save state" });
  }
});

app.post("/api/register", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const nickname = String(req.body.nickname || username).trim();
    const password = String(req.body.password || "");

    if (!username || !password) {
      return res.status(400).json({ error: "Логин и пароль обязательны" });
    }

    if (username === ADMIN_USERNAME) {
      return res.status(400).json({ error: "Логин занят" });
    }

    const state = await getState();

    if (state.users.some((user) => user.username === username)) {
      return res.status(409).json({ error: "Такой логин уже занят" });
    }

    const user = {
      username,
      nickname,
      role: "user",
      elo: 1000,
      level: 1,
      wins: 0,
      losses: 0,
      matches: 0,
      xp: 0,
      ...makePasswordHash(password)
    };

    state.users.push(user);

    await setState(state);

    res.json({ ok: true, user: publicUser(user) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to register" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    const state = await getState();
    const user = state.users.find((item) => item.username === username && item.role !== "admin");

    if (!user || !verifyPassword(password, user)) {
      return res.status(401).json({ error: "Неверный логин или пароль" });
    }

    res.json({ ok: true, user: publicUser(user) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to login" });
  }
});

app.post("/api/payments/create", async (req, res) => {
  try {
    const plan = String(req.body.plan || "").trim();
    const amount = Number(req.body.amount || 0);
    const username = String(req.body.username || "").trim();
    const nickname = String(req.body.nickname || username || "Гость").trim();

    if (!plan || amount <= 0) {
      return res.status(400).json({ error: "Некорректный тариф" });
    }

    const state = await getState();

    const payment = {
      id: "pay_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex"),
      plan,
      amount,
      username,
      nickname,
      status: "pending",
      createdAt: new Date().toLocaleString("ru-RU")
    };

    state.payments.unshift(payment);
    state.tickets.unshift({
      id: Date.now(),
      subject: "Создан счёт " + plan,
      message: `${nickname} создал счёт на ${plan}: ${amount} ₽`,
      author: nickname,
      createdAt: new Date().toLocaleString("ru-RU"),
      status: "payment"
    });

    await setState(state);

    res.json({
      ok: true,
      payment: publicPayment(payment),
      paymentUrl: "/pay/" + encodeURIComponent(payment.id)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create payment" });
  }
});

app.get("/pay/:id", async (req, res) => {
  try {
    const state = await getState();
    const payment = state.payments.find((item) => item.id === req.params.id);

    if (!payment) {
      return res.status(404).send("Payment not found");
    }

    res.type("html").send(paymentPageHtml(payment));
  } catch (error) {
    console.error(error);
    res.status(500).send("Payment error");
  }
});

app.post("/api/payments/:id/demo-pay", async (req, res) => {
  try {
    const state = await getState();
    const payment = state.payments.find((item) => item.id === req.params.id);

    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }

    payment.status = "paid";
    payment.paidAt = new Date().toLocaleString("ru-RU");
    payment.updatedAt = payment.paidAt;

    state.tickets.unshift({
      id: Date.now(),
      subject: "Оплата получена " + payment.plan,
      message: `${payment.nickname || payment.username || "Гость"} оплатил ${payment.plan}: ${payment.amount} ₽`,
      author: payment.nickname || payment.username || "Гость",
      createdAt: new Date().toLocaleString("ru-RU"),
      status: "paid"
    });

    await setState(state);

    res.json({ ok: true, payment: publicPayment(payment) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to pay" });
  }
});

app.get(ADMIN_PATH, (req, res) => {
  res.type("html").send(isAdminRequest(req) ? adminPanelHtml() : adminLoginHtml());
});

app.post("/api/control/login", (req, res) => {
  const username = String(req.body.username || "");
  const password = String(req.body.password || "");

  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    return res.status(503).json({ error: "Owner credentials are not configured" });
  }

  const isValid = safeEqualString(username, ADMIN_USERNAME) && safeEqualString(password, ADMIN_PASSWORD);

  if (!isValid) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = signToken({
    role: "admin",
    username,
    exp: Date.now() + 12 * 60 * 60 * 1000
  });

  res.setHeader("Set-Cookie", adminCookie(token, req));
  res.json({ ok: true });
});

app.post("/api/control/logout", requireAdmin, (_req, res) => {
  res.setHeader("Set-Cookie", clearAdminCookie());
  res.json({ ok: true });
});

app.get("/api/control/state", requireAdmin, async (_req, res) => {
  try {
    res.json(publicState(await getState()));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to load control state" });
  }
});

app.post("/api/control/news", requireAdmin, async (req, res) => {
  try {
    const tag = String(req.body.tag || "DNG").trim();
    const title = String(req.body.title || "").trim();
    const body = String(req.body.text || "").trim();

    if (!title || !body) {
      return res.status(400).json({ error: "Title and text are required" });
    }

    const state = await getState();

    state.news.unshift({
      id: Date.now(),
      tag,
      title,
      text: body
    });

    await setState(state);

    res.json({ ok: true, news: state.news });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to add news" });
  }
});

app.delete("/api/control/news/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const state = await getState();

    state.news = state.news.filter((item) => Number(item.id) !== id);

    await setState(state);

    res.json({ ok: true, news: state.news });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete news" });
  }
});

app.post("/api/control/users/:username/elo", requireAdmin, async (req, res) => {
  try {
    const username = String(req.params.username || "").trim();
    const amount = Number(req.body.amount || 0);
    const reason = String(req.body.reason || "Изменение ELO владельцем").trim();

    if (!username || !amount) {
      return res.status(400).json({ error: "Username and amount are required" });
    }

    const state = await getState();
    const user = state.users.find((item) => item.username === username);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const oldElo = Number(user.elo || 1000);
    const newElo = Math.max(100, oldElo + amount);

    user.elo = newElo;

    state.tickets.unshift({
      id: Date.now(),
      subject: "Изменение ELO",
      message: `${user.nickname || user.username}: ${oldElo} → ${newElo}. Причина: ${reason}`,
      author: "DNG Control",
      createdAt: new Date().toLocaleString("ru-RU"),
      status: "elo"
    });

    await setState(state);

    res.json({ ok: true, user: publicUser(user) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update ELO" });
  }
});

app.post("/api/control/payments/:id/status", requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const status = String(req.body.status || "").trim();

    if (!["pending", "paid", "cancelled", "refunded"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const state = await getState();
    const payment = state.payments.find((item) => item.id === id);

    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }

    payment.status = status;
    payment.updatedAt = new Date().toLocaleString("ru-RU");

    if (status === "paid" && !payment.paidAt) {
      payment.paidAt = payment.updatedAt;
    }

    await setState(state);

    res.json({ ok: true, payment: publicPayment(payment) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update payment" });
  }
});

app.delete("/api/control/tickets/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const state = await getState();

    state.tickets = state.tickets.filter((ticket) => Number(ticket.id) !== id);

    await setState(state);

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete ticket" });
  }
});

app.use("/public", express.static(path.join(__dirname, "public")));
app.use(express.static(__dirname));

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`DNG site is running on port ${PORT}`);
      console.log(`Hidden control path is configured: ${ADMIN_PATH}`);
      console.log("Payments, news delete and ELO control are enabled.");
    });
  })
  .catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
