/*
 * server.js — Express app: phục vụ frontend tĩnh + REST API + (nền) WebSocket.
 */
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const { WebSocketServer } = require('ws');
require('dotenv').config();

const authRoutes = require('./routes/auth.routes');
const gameRoutes = require('./routes/game.routes');
const userRoutes = require('./routes/user.routes');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Khi chạy sau reverse proxy (Nginx/Apache) để secure cookie & req.ip hoạt động đúng.
if (IS_PROD) app.set('trust proxy', 1);

if (IS_PROD && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.includes('doi-chuoi-bi-mat'))) {
  console.error('✗ Thiếu SESSION_SECRET an toàn. Đặt SESSION_SECRET ngẫu nhiên trong .env trước khi chạy production.');
  process.exit(1);
}

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// Session lưu vào MySQL (production-ready, không mất phiên khi restart).
const sessionStore = new MySQLStore({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'danhcotuong',
  createDatabaseTable: true,
  charset: 'utf8mb4_bin',
});

app.use(
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'doi-chuoi-bi-mat-nay',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 ngày
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === 'true' || IS_PROD, // bật khi chạy HTTPS
    },
  })
);

// REST API
app.use('/api', authRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/users', userRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Frontend tĩnh
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// Mọi đường dẫn khác -> trang chủ (cho phép mở thẳng các .html)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Xử lý lỗi tập trung — không lộ stack trace ra client ở production.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('✗ Lỗi:', err.stack || err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: IS_PROD ? 'Lỗi máy chủ' : String(err.message || err) });
});

const server = http.createServer(app);

/* ---------- WebSocket (nền cho đấu online — Giai đoạn 2) ---------- */
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'welcome', msg: 'WebSocket sẵn sàng (đấu online — GĐ2)' }));
  ws.on('message', (data) => {
    // Giai đoạn 2: ghép trận, đồng bộ nước đi giữa 2 người chơi.
    // Hiện tại chỉ phản hồi echo để xác nhận kết nối.
    try {
      const msg = JSON.parse(data);
      ws.send(JSON.stringify({ type: 'echo', data: msg }));
    } catch (e) {
      /* bỏ qua message không hợp lệ */
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n✓ Đánh Cờ Tướng Online đang chạy (${IS_PROD ? 'production' : 'development'}): http://localhost:${PORT}\n`);
});

/* ---------- Tắt máy chủ êm (graceful shutdown) ---------- */
function shutdown(signal) {
  console.log(`\n${signal} nhận được — đang tắt máy chủ...`);
  server.close(() => {
    sessionStore.close().catch(() => {});
    console.log('✓ Đã tắt máy chủ.');
    process.exit(0);
  });
  // Ép thoát nếu treo quá 10s.
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
