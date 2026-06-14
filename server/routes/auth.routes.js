/*
 * auth.routes.js — Đăng ký, đăng nhập, đăng xuất, lấy người dùng hiện tại.
 */
const express = require('express');
const router = express.Router();
const userService = require('../services/user.service');

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,50}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', async (req, res) => {
  try {
    const username = (req.body.username || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    if (!USERNAME_RE.test(username))
      return res.status(400).json({ error: 'Tên đăng nhập 3-50 ký tự (chữ, số, _ .)' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Email không hợp lệ' });
    if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự' });

    if (await userService.findByUsername(username))
      return res.status(409).json({ error: 'Tên đăng nhập đã tồn tại' });
    if (await userService.emailExists(email))
      return res.status(409).json({ error: 'Email đã được sử dụng' });

    const user = await userService.createUser({ username, email, password });
    req.session.userId = user.id;
    res.status(201).json({ user });
  } catch (err) {
    console.error('register error:', err.message);
    res.status(500).json({ error: 'Lỗi máy chủ khi đăng ký' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const username = (req.body.username || '').trim();
    const password = req.body.password || '';
    const user = await userService.verifyCredentials(username, password);
    if (!user) return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
    req.session.userId = user.id;
    res.json({ user });
  } catch (err) {
    console.error('login error:', err.message);
    res.status(500).json({ error: 'Lỗi máy chủ khi đăng nhập' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

router.get('/me', async (req, res) => {
  if (!req.session || !req.session.userId) return res.json({ user: null });
  const user = await userService.findById(req.session.userId);
  res.json({ user });
});

module.exports = router;
