/*
 * ui.js — Dùng chung cho mọi trang: navbar, trạng thái đăng nhập, menu mobile.
 */
(function () {
  'use strict';

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

  function highlightActive() {
    const page = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-menu a').forEach((a) => {
      if (a.getAttribute('href') === page) a.classList.add('active');
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireMobileMenu();
    highlightActive();
    if (window.API) {
      refreshAuthUI();
      wireLogout();
    }
  });

  window.UI = { refreshAuthUI };
})();
