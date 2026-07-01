/*
 * ui.js — Dùng chung cho mọi trang: navbar, trạng thái đăng nhập, menu mobile.
 */
(function () {
  'use strict';

  // Áp dụng giao diện đã lưu càng sớm càng tốt (giảm nhấp nháy).
  try {
    const saved = localStorage.getItem('dct-theme');
    if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light');
  } catch (e) {}

  // Nút đổi Sáng/Tối, chèn vào navbar.
  function wireThemeToggle() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost theme-toggle';
    const isLight = () => document.documentElement.getAttribute('data-theme') === 'light';
    const paint = () => {
      btn.textContent = isLight() ? '🌙' : '☀️';
      btn.title = isLight() ? 'Chuyển giao diện Tối' : 'Chuyển giao diện Sáng';
    };
    paint();
    btn.addEventListener('click', () => {
      const next = isLight() ? 'dark' : 'light';
      if (next === 'light') document.documentElement.setAttribute('data-theme', 'light');
      else document.documentElement.removeAttribute('data-theme');
      try { localStorage.setItem('dct-theme', next); } catch (e) {}
      paint();
    });
    const actions = document.querySelector('.nav-actions');
    if (actions) actions.insertBefore(btn, actions.firstChild);
    else {
      const nav = document.querySelector('.nav-inner');
      if (nav) nav.appendChild(btn);
    }
  }

  // Đăng ký Service Worker (cho phép cài app + chơi với máy offline).
  function registerSW() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
      });
    }
  }

  async function refreshAuthUI() {
    const guest = document.querySelectorAll('[data-auth="guest"]');
    const user = document.querySelectorAll('[data-auth="user"]');
    const nameEls = document.querySelectorAll('[data-user-name]');
    let me = null;
    try {
      me = await window.API.me();
    } catch (e) {
      me = null;
    }
    const loggedIn = me && me.user;
    guest.forEach((el) => (el.style.display = loggedIn ? 'none' : ''));
    user.forEach((el) => (el.style.display = loggedIn ? '' : 'none'));
    if (loggedIn) nameEls.forEach((el) => (el.textContent = me.user.username));
    return me;
  }

  function wireLogout() {
    document.querySelectorAll('[data-action="logout"]').forEach((el) => {
      el.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          await window.API.logout();
        } catch (err) {}
        location.href = 'index.html';
      });
    });
  }

  function wireMobileMenu() {
    const toggle = document.querySelector('.nav-toggle');
    const menu = document.querySelector('.nav-menu');
    if (toggle && menu) {
      toggle.addEventListener('click', () => menu.classList.toggle('open'));
    }
  }

  // Nút đóng (×) cho mọi popup: ẩn overlay gần nhất, hoặc điều hướng nếu có data-close-href.
  function wireModalClose() {
    document.querySelectorAll('.modal-close').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const href = btn.getAttribute('data-close-href');
        if (href) { location.href = href; return; }
        const ov = btn.closest('.overlay');
        if (ov) ov.classList.add('hidden');
      });
    });
  }

  function highlightActive() {
    const page = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-menu a').forEach((a) => {
      if (a.getAttribute('href') === page) a.classList.add('active');
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireThemeToggle();
    wireMobileMenu();
    wireModalClose();
    highlightActive();
    if (window.API) {
      refreshAuthUI();
      wireLogout();
    }
  });
  registerSW();

  window.UI = { refreshAuthUI };
})();
