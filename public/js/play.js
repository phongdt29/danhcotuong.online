/*
 * play.js — Điều phối ván đấu Người (Đỏ) vs AI (Đen).
 * Phụ thuộc: xiangqi.js, board.js, api.js (đã nạp trước).
 */
(function () {
  'use strict';
  const X = window.Xiangqi;

  const state = {
    game: null,
    board: null,
    worker: null,
    difficulty: 'medium',
    totalSec: 600,
    timeLeft: { r: 600, b: 600 },
    timerId: null,
    capturedByRed: [], // quân Đen bị Đỏ ăn
    capturedByBlack: [],
    over: false,
    thinking: false,
    startTs: null,
  };

  const GLYPH = {
    r: { K: '帥', A: '仕', E: '相', H: '傌', R: '俥', C: '炮', P: '兵' },
    b: { K: '將', A: '士', E: '象', H: '馬', R: '車', C: '砲', P: '卒' },
  };
  const NAME = { K: 'Tướng', A: 'Sĩ', E: 'Tượng', H: 'Mã', R: 'Xe', C: 'Pháo', P: 'Tốt' };

  /* ---------------- Âm thanh (Web Audio, không cần file) ---------------- */
  const Sound = (() => {
    let ctx = null;
    function tone(freq, dur, type, gain) {
      try {
        if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type || 'sine';
        o.frequency.value = freq;
        g.gain.value = gain || 0.06;
        o.connect(g);
        g.connect(ctx.destination);
        const t = ctx.currentTime;
        o.start(t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.stop(t + dur);
      } catch (e) {
        /* bỏ qua nếu trình duyệt chặn */
      }
    }
    return {
      move: () => tone(420, 0.08, 'triangle', 0.05),
      capture: () => {
        tone(220, 0.12, 'square', 0.06);
        setTimeout(() => tone(160, 0.1, 'square', 0.05), 50);
      },
      check: () => tone(880, 0.18, 'sawtooth', 0.05),
      end: () => {
        tone(523, 0.18, 'triangle', 0.07);
        setTimeout(() => tone(659, 0.18, 'triangle', 0.07), 140);
        setTimeout(() => tone(784, 0.3, 'triangle', 0.07), 280);
      },
    };
  })();

  /* ---------------- Tiện ích ---------------- */
  const $ = (id) => document.getElementById(id);

  function fmtTime(s) {
    s = Math.max(0, Math.floor(s));
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return m + ':' + String(ss).padStart(2, '0');
  }

  function sq(x, y) {
    return String.fromCharCode(65 + x) + (10 - y);
  }

  /* ---------------- Khởi tạo ván ---------------- */
  function startGame(difficulty, minutes) {
    state.difficulty = difficulty;
    state.totalSec = minutes * 60;
    state.timeLeft = { r: state.totalSec, b: state.totalSec };
    state.capturedByRed = [];
    state.capturedByBlack = [];
    state.over = false;
    state.thinking = false;
    state.startTs = Date.now();
    state.game = new X.Game();

    if (!state.board) {
      state.board = new window.Board($('board'), {
        humanColor: X.RED,
        onMove: onHumanMove,
      });
    }
    state.board.clearSelection();
    state.board.setLastMove(null);
    state.board.setInteractive(true);
    state.board.render(state.game);

    if (!state.worker) {
      state.worker = new Worker('js/engine/ai.worker.js');
      state.worker.onmessage = onAiReply;
    }

    renderHistory();
    renderCaptured();
    updateStatus('Tới lượt bạn (Đỏ)');
    startTimer();
    const ov = $('setup-overlay');
    if (ov) ov.classList.add('hidden');
  }

  /* ---------------- Đồng hồ ---------------- */
  function startTimer() {
    stopTimer();
    state.timerId = setInterval(() => {
      if (state.over) return;
      const side = state.game.turn === X.RED ? 'r' : 'b';
      state.timeLeft[side] -= 1;
      renderTimers();
      if (state.timeLeft[side] <= 0) {
        endGame(side === 'r' ? X.BLACK : X.RED, 'Hết giờ');
      }
    }, 1000);
  }
  function stopTimer() {
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = null;
  }
  function renderTimers() {
    $('timer-red').textContent = fmtTime(state.timeLeft.r);
    $('timer-black').textContent = fmtTime(state.timeLeft.b);
    $('timer-red').parentElement.classList.toggle('active', state.game.turn === X.RED && !state.over);
    $('timer-black').parentElement.classList.toggle('active', state.game.turn === X.BLACK && !state.over);
  }

  /* ---------------- Lượt người ---------------- */
  function onHumanMove(from, to) {
    if (state.over || state.thinking) return;
    if (state.game.turn !== X.RED) return;
    const rec = state.game.move(from, to);
    if (!rec) return;
    afterMove(rec);
    if (state.over) return;
    // tới lượt AI
    triggerAi();
  }

  function triggerAi() {
    state.thinking = true;
    state.board.setInteractive(false);
    updateStatus('AI đang suy nghĩ…');
    // gửi bản sao bàn cờ cho worker
    const snapshot = state.game.board.map((r) => r.slice());
    setTimeout(() => {
      state.worker.postMessage({ board: snapshot, difficulty: state.difficulty });
    }, 120);
  }

  function onAiReply(e) {
    const mv = e.data.move;
    state.thinking = false;
    if (state.over) return;
    if (!mv) {
      // AI hết nước -> người thắng
      endGame(X.RED, 'Chiếu hết');
      return;
    }
    const rec = state.game.move(mv.from, mv.to);
    if (!rec) {
      // không nên xảy ra
      state.board.setInteractive(true);
      return;
    }
    afterMove(rec);
    if (!state.over) {
      state.board.setInteractive(true);
      updateStatus('Tới lượt bạn (Đỏ)');
    }
  }

  /* ---------------- Sau mỗi nước ---------------- */
  function afterMove(rec) {
    // quân bị ăn
    if (rec.captured) {
      const capColor = X.colorOf(rec.captured);
      if (capColor === X.BLACK) state.capturedByRed.push(rec.captured);
      else state.capturedByBlack.push(rec.captured);
    }
    state.board.setLastMove({ from: rec.from, to: rec.to });
    state.board.render(state.game);
    renderCaptured();
    addHistory(rec);

    // âm thanh + trạng thái
    const st = state.game.status();
    if (st.over) {
      Sound.end();
      const winner = st.loser === X.RED ? X.BLACK : X.RED;
      endGame(winner, st.reason === 'checkmate' ? 'Chiếu hết' : 'Hết nước đi');
      return;
    }
    if (st.check) {
      Sound.check();
      updateStatus((st.check === X.RED ? 'Đỏ' : 'Đen') + ' đang bị chiếu!');
    } else if (rec.captured) {
      Sound.capture();
    } else {
      Sound.move();
    }
    renderTimers();
  }

  /* ---------------- Kết thúc ---------------- */
  function endGame(winnerColor, reason) {
    if (state.over) return;
    state.over = true;
    state.thinking = false;
    stopTimer();
    state.board.setInteractive(false);
    const humanWon = winnerColor === X.RED;
    const result = humanWon ? 'Bạn THẮNG! 🎉' : 'Bạn THUA';
    updateStatus(result + ' — ' + reason);
    showResultModal(result, reason);
    saveResult(humanWon ? 'win' : 'loss');
  }

  function showResultModal(title, reason) {
    const modal = $('result-modal');
    if (!modal) return;
    $('result-title').textContent = title;
    $('result-reason').textContent = reason;
    modal.classList.remove('hidden');
  }

  async function saveResult(result) {
    // chỉ lưu nếu đã đăng nhập
    if (!window.API) return;
    try {
      const me = await window.API.me();
      if (!me || !me.user) return;
      const duration = Math.round((Date.now() - state.startTs) / 1000);
      await window.API.saveGame({
        opponent_type: 'ai-' + state.difficulty,
        result,
        moves_count: state.game.history.length,
        duration_sec: duration,
      });
    } catch (e) {
      /* không chặn người chơi nếu lưu lỗi */
    }
  }

  /* ---------------- Lịch sử & quân bị ăn ---------------- */
  function addHistory(rec) {
    renderHistory();
  }
  function renderHistory() {
    const list = $('move-list');
    if (!list) return;
    list.innerHTML = '';
    const h = state.game.history;
    for (let i = 0; i < h.length; i += 2) {
      const row = document.createElement('div');
      row.className = 'move-row';
      const num = document.createElement('span');
      num.className = 'move-no';
      num.textContent = i / 2 + 1 + '.';
      row.appendChild(num);
      row.appendChild(moveSpan(h[i]));
      if (h[i + 1]) row.appendChild(moveSpan(h[i + 1]));
      list.appendChild(row);
    }
    list.scrollTop = list.scrollHeight;
  }
  function moveSpan(rec) {
    const s = document.createElement('span');
    s.className = 'move-cell ' + (X.colorOf(rec.piece) === X.RED ? 'mv-red' : 'mv-black');
    const t = X.typeOf(rec.piece);
    s.textContent = NAME[t] + ' ' + sq(rec.from.x, rec.from.y) + '→' + sq(rec.to.x, rec.to.y);
    return s;
  }

  function renderCaptured() {
    const red = $('captured-red');
    const black = $('captured-black');
    if (red) red.innerHTML = state.capturedByRed.map((p) => chip(p)).join('');
    if (black) black.innerHTML = state.capturedByBlack.map((p) => chip(p)).join('');
  }
  function chip(p) {
    const c = X.colorOf(p);
    return '<span class="cap-chip ' + (c === X.RED ? 'red' : 'black') + '">' + GLYPH[c][X.typeOf(p)] + '</span>';
  }

  function updateStatus(msg) {
    const el = $('status-msg');
    if (el) el.textContent = msg;
  }

  /* ---------------- Undo & ván mới ---------------- */
  function undo() {
    if (state.over || state.thinking) return;
    // hoàn 2 nước (AI + người) để trở lại lượt người
    if (state.game.history.length === 0) return;
    popCaptured(state.game.undo());
    if (state.game.history.length > 0 && state.game.turn !== X.RED) {
      popCaptured(state.game.undo());
    }
    const last = state.game.history[state.game.history.length - 1];
    state.board.setLastMove(last ? { from: last.from, to: last.to } : null);
    state.board.clearSelection();
    state.board.setInteractive(true);
    state.board.render(state.game);
    renderHistory();
    renderCaptured();
    updateStatus('Đã hoàn nước. Tới lượt bạn (Đỏ)');
  }
  function popCaptured(rec) {
    if (!rec || !rec.captured) return;
    if (X.colorOf(rec.captured) === X.BLACK) state.capturedByRed.pop();
    else state.capturedByBlack.pop();
  }

  /* ---------------- Gắn sự kiện UI ---------------- */
  function init() {
    renderTimers && void 0;
    const params = new URLSearchParams(location.search);
    const presetDiff = params.get('level');
    const presetTime = params.get('time');

    // nút bắt đầu trong overlay
    const startBtn = $('btn-start');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        const d = document.querySelector('input[name="difficulty"]:checked');
        const t = document.querySelector('input[name="time"]:checked');
        startGame(d ? d.value : 'medium', t ? parseInt(t.value, 10) : 10);
      });
    }

    const undoBtn = $('btn-undo');
    if (undoBtn) undoBtn.addEventListener('click', undo);

    const newBtn = $('btn-new');
    if (newBtn) newBtn.addEventListener('click', () => {
      stopTimer();
      const ov = $('setup-overlay');
      const modal = $('result-modal');
      if (modal) modal.classList.add('hidden');
      if (ov) ov.classList.remove('hidden');
    });

    const againBtn = $('btn-again');
    if (againBtn) againBtn.addEventListener('click', () => {
      const modal = $('result-modal');
      if (modal) modal.classList.add('hidden');
      startGame(state.difficulty, state.totalSec / 60);
    });

    const resignBtn = $('btn-resign');
    if (resignBtn) resignBtn.addEventListener('click', () => {
      if (!state.over && state.game) endGame(X.BLACK, 'Bạn xin thua');
    });

    // nếu có preset từ URL, vào thẳng
    if (presetDiff) {
      startGame(presetDiff, presetTime ? parseInt(presetTime, 10) : 10);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
