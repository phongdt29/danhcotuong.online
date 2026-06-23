/*
 * play-online.js — Điều phối ván Cờ Tướng NGƯỜI với NGƯỜI qua WebSocket.
 * Phụ thuộc: xiangqi.js, board.js, api.js (đã nạp trước).
 *
 * Tái dùng engine xiangqi.js để kiểm tra luật phía client; server chỉ chuyển tiếp nước đi.
 */
(function () {
  'use strict';
  const X = window.Xiangqi;
  const $ = (id) => document.getElementById(id);

  const state = {
    ws: null,
    game: null,
    board: null,
    myColor: null, // 'r' | 'b'
    over: false,
    startTs: null,
    name: 'Khách',
    capturedByRed: [],
    capturedByBlack: [],
    auto: null,
    totalSec: 600,
    timeLeft: { r: 600, b: 600 },
    timerId: null,
    pendingOffer: null, // 'draw' | 'takeback' (đề nghị đang chờ mình trả lời)
    moves: [], // lưu nước đi để xem lại (replay)
  };

  const GLYPH = {
    r: { K: '帥', A: '仕', E: '相', H: '傌', R: '俥', C: '炮', P: '兵' },
    b: { K: '將', A: '士', E: '象', H: '馬', R: '車', C: '砲', P: '卒' },
  };
  const NAME = { K: 'Tướng', A: 'Sĩ', E: 'Tượng', H: 'Mã', R: 'Xe', C: 'Pháo', P: 'Tốt' };

  /* ---------------- Âm thanh ---------------- */
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
      } catch (e) {}
    }
    return {
      move: () => tone(420, 0.08, 'triangle', 0.05),
      capture: () => { tone(220, 0.12, 'square', 0.06); setTimeout(() => tone(160, 0.1, 'square', 0.05), 50); },
      check: () => tone(880, 0.18, 'sawtooth', 0.05),
      end: () => {
        tone(523, 0.18, 'triangle', 0.07);
        setTimeout(() => tone(659, 0.18, 'triangle', 0.07), 140);
        setTimeout(() => tone(784, 0.3, 'triangle', 0.07), 280);
      },
    };
  })();

  function sq(x, y) { return String.fromCharCode(65 + x) + (10 - y); }
  function status(msg) { const el = $('status-msg'); if (el) el.textContent = msg; }
  function lobbyStatus(msg) { const el = $('lobby-status'); if (el) el.textContent = msg; }

  /* ---------------- Đồng hồ thi đấu ---------------- */
  function fmtTime(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function renderTimers() {
    const tr = $('timer-red'), tb = $('timer-black');
    if (tr) tr.textContent = fmtTime(state.timeLeft.r);
    if (tb) tb.textContent = fmtTime(state.timeLeft.b);
  }
  function startTimer() {
    stopTimer();
    state.timerId = setInterval(() => {
      if (state.over || !state.game) return;
      const side = state.game.turn; // 'r' | 'b'
      state.timeLeft[side] -= 1;
      renderTimers();
      if (state.timeLeft[side] <= 0) {
        if (side === state.myColor) sendWs({ type: 'timeout' }); // mình hết giờ -> báo đối thủ
        endGame(side === 'r' ? 'b' : 'r', 'Hết giờ');
      }
    }, 1000);
  }
  function stopTimer() { if (state.timerId) clearInterval(state.timerId); state.timerId = null; }

  /* ---------------- WebSocket ---------------- */
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(proto + '://' + location.host + '/ws');
    state.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'hello', name: state.name }));
      enableLobby(true);
      lobbyStatus('Đã kết nối. Chọn cách vào trận.');
      status('Đã kết nối máy chủ.');
      if (state.auto) { doAuto(state.auto); state.auto = null; }
    };
    ws.onclose = () => {
      enableLobby(false);
      lobbyStatus('Mất kết nối máy chủ. Tải lại trang để thử lại.');
      if (!state.over && state.game) endGame(null, 'Mất kết nối máy chủ');
    };
    ws.onerror = () => lobbyStatus('Lỗi kết nối máy chủ.');
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handle(msg);
    };
  }

  function sendWs(obj) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(obj));
  }

  // Tự thực hiện hành động khi vào từ trang Danh sách phòng (?join=/?create=/?quick=).
  function doAuto(a) {
    if (a.type === 'join') { sendWs({ type: 'join', code: a.code }); lobbyStatus('Đang vào phòng ' + a.code + '…'); }
    else if (a.type === 'create') { sendWs({ type: 'create' }); showWaiting('Đang tạo phòng…', null); }
    else if (a.type === 'quick') { sendWs({ type: 'quick' }); showWaiting('Đang tìm đối thủ…', null); }
  }

  function handle(msg) {
    switch (msg.type) {
      case 'welcome': break;
      case 'waiting':
        showWaiting('Đang tìm đối thủ…', null);
        break;
      case 'created':
        showWaiting('Đang chờ bạn bè vào phòng…', msg.code);
        break;
      case 'start':
        beginGame(msg.color, msg.opponent);
        break;
      case 'move':
        onOpponentMove(msg.from, msg.to);
        break;
      case 'resign':
        endGame(state.myColor, 'Đối thủ xin thua');
        break;
      case 'opponent-left':
        if (!state.over) endGame(state.myColor, 'Đối thủ đã thoát');
        break;
      case 'opponent-timeout':
        if (!state.over) endGame(state.myColor, 'Đối thủ hết giờ');
        break;
      case 'draw-offer':
        showOffer('draw', 'Đối thủ xin cầu hòa. Bạn đồng ý?');
        break;
      case 'draw-accept':
        endGame('draw', 'Hai bên đồng ý hòa');
        break;
      case 'draw-decline':
        status('Đối thủ từ chối cầu hòa.');
        break;
      case 'takeback-offer':
        showOffer('takeback', 'Đối thủ xin hoàn nước. Bạn đồng ý?');
        break;
      case 'takeback-accept':
        applyTakeback(state.myColor); // đối thủ đồng ý cho MÌNH hoàn nước
        status('Đối thủ đồng ý. Đã hoàn nước.');
        break;
      case 'takeback-decline':
        status('Đối thủ từ chối hoàn nước.');
        break;
      case 'rematch':
        $('rematch-status').textContent = 'Đối thủ muốn chơi lại! Bấm "🔄 Chơi lại" để bắt đầu.';
        break;
      case 'rooms':
        renderRooms(msg.rooms || []);
        break;
      case 'chat':
        appendChat('Đối thủ', msg.text);
        break;
      case 'error':
        lobbyStatus('⚠ ' + (msg.message || 'Có lỗi xảy ra'));
        break;
    }
  }

  /* ---------------- Sảnh (lobby) ---------------- */
  function enableLobby(on) {
    ['btn-quick', 'btn-create', 'btn-join', 'btn-refresh'].forEach((id) => { const b = $(id); if (b) b.disabled = !on; });
  }

  function requestList() { sendWs({ type: 'list' }); }

  function renderRooms(list) {
    const box = $('room-list');
    if (!box) return;
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = '<div class="room-empty">Chưa có phòng nào đang mở. Hãy tạo phòng mới!</div>';
      return;
    }
    list.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'room-item';
      const info = document.createElement('span');
      info.className = 'room-info';
      info.innerHTML = '<b>' + escapeHtml(r.host) + '</b><span class="room-code-sm">#' + escapeHtml(r.code) + '</span>';
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.textContent = 'Vào';
      btn.addEventListener('click', () => sendWs({ type: 'join', code: r.code }));
      row.appendChild(info);
      row.appendChild(btn);
      box.appendChild(row);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function showWaiting(text, code) {
    $('waiting-box').classList.remove('hidden');
    $('waiting-msg').textContent = text;
    const codeBox = $('code-box');
    if (code) { codeBox.classList.remove('hidden'); $('room-code').textContent = code; }
    else codeBox.classList.add('hidden');
    enableLobby(false);
  }
  function hideWaiting() {
    $('waiting-box').classList.add('hidden');
    enableLobby(true);
  }

  /* ---------------- Bắt đầu ván ---------------- */
  function beginGame(color, opponentName) {
    state.myColor = color;
    state.over = false;
    state.startTs = Date.now();
    state.capturedByRed = [];
    state.capturedByBlack = [];
    state.moves = [];
    state.pendingOffer = null;
    state.timeLeft = { r: state.totalSec, b: state.totalSec };
    state.game = new X.Game();

    state.board = new window.Board($('board'), {
      humanColor: color,
      onMove: onMyMove,
    });
    // Lật bàn cho bên Đen để quân của mình ở phía dưới
    const flip = color === 'b';
    $('board').classList.toggle('flip', flip);
    const col = document.querySelector('.board-col');
    if (col) col.classList.toggle('flip', flip);
    state.board.clearSelection();
    state.board.setLastMove(null);
    state.board.render(state.game);

    // Nhãn người chơi theo màu
    const opp = opponentName || 'Đối thủ';
    if (color === 'r') {
      $('name-red').textContent = state.name + ' (Bạn — Đỏ)';
      $('name-black').textContent = opp + ' (Đen)';
    } else {
      $('name-red').textContent = opp + ' (Đỏ)';
      $('name-black').textContent = state.name + ' (Bạn — Đen)';
    }

    $('btn-resign').disabled = false;
    $('btn-draw').disabled = false;
    $('chat-input').disabled = false;
    $('chat-send').disabled = false;
    $('lobby-overlay').classList.add('hidden');
    $('result-modal').classList.add('hidden');
    $('rematch-status').textContent = '';
    offerHide();
    $('chat-log').innerHTML = '';
    renderCaptured();
    renderHistory();
    renderTimers();
    updateTurn();
    startTimer();
  }

  function updateTurn() {
    const myTurn = !state.over && state.game.turn === state.myColor;
    state.board.setInteractive(myTurn);
    $('bar-red').classList.toggle('active', !state.over && state.game.turn === 'r');
    $('bar-black').classList.toggle('active', !state.over && state.game.turn === 'b');
    $('btn-takeback').disabled = state.over || state.game.history.length === 0;
    renderTimers();
    if (state.over) return;
    status(myTurn ? 'Tới lượt BẠN đi.' : 'Đang chờ đối thủ đi…');
  }

  /* ---------------- Nước đi ---------------- */
  function onMyMove(from, to) {
    if (state.over) return;
    if (state.game.turn !== state.myColor) return;
    const rec = state.game.move(from, to);
    if (!rec) return;
    sendWs({ type: 'move', from, to });
    afterMove(rec);
  }

  function onOpponentMove(from, to) {
    if (state.over || !state.game) return;
    if (state.game.turn === state.myColor) return; // không phải lượt đối thủ
    const rec = state.game.move(from, to);
    if (!rec) return; // nước không hợp lệ (không nên xảy ra)
    afterMove(rec);
  }

  function afterMove(rec) {
    state.moves.push({ from: { x: rec.from.x, y: rec.from.y }, to: { x: rec.to.x, y: rec.to.y } });
    state.pendingOffer = null; // có nước đi mới -> huỷ đề nghị đang chờ
    offerHide();
    if (rec.captured) {
      if (X.colorOf(rec.captured) === X.BLACK) state.capturedByRed.push(rec.captured);
      else state.capturedByBlack.push(rec.captured);
    }
    state.board.setLastMove({ from: rec.from, to: rec.to });
    state.board.clearSelection();
    state.board.render(state.game);
    renderCaptured();
    renderHistory();

    const st = state.game.status();
    if (st.over) {
      Sound.end();
      const winner = st.loser === X.RED ? X.BLACK : X.RED;
      endGame(winner, st.reason === 'checkmate' ? 'Chiếu hết' : 'Hết nước đi');
      return;
    }
    if (st.check) { Sound.check(); }
    else if (rec.captured) { Sound.capture(); }
    else { Sound.move(); }
    updateTurn();
    if (!state.over && st.check) {
      status((state.game.turn === state.myColor ? 'BẠN' : 'Đối thủ') + ' đang bị chiếu!');
    }
  }

  /* ---------------- Kết thúc ---------------- */
  function endGame(winnerColor, reason) {
    if (state.over) return;
    state.over = true;
    stopTimer();
    if (state.board) state.board.setInteractive(false);
    ['btn-resign', 'btn-draw', 'btn-takeback'].forEach((id) => { $(id).disabled = true; });
    $('bar-red').classList.remove('active');
    $('bar-black').classList.remove('active');
    state.pendingOffer = null;
    offerHide();

    let title;
    let result = null;
    if (winnerColor === 'draw') {
      title = 'Hòa cờ 🤝';
      result = 'draw';
    } else if (winnerColor == null) {
      title = 'Ván kết thúc';
    } else if (winnerColor === state.myColor) {
      title = 'Bạn THẮNG! 🎉';
      result = 'win';
    } else {
      title = 'Bạn THUA';
      result = 'loss';
    }
    status(title + ' — ' + reason);
    showResultModal(title, reason);
    if (result) saveResult(result);
  }

  function showResultModal(title, reason) {
    const modal = $('result-modal');
    if (!modal) return;
    $('result-title').textContent = title;
    $('result-reason').textContent = reason;
    $('btn-rematch').disabled = false;
    $('rematch-status').textContent = '';
    modal.classList.remove('hidden');
  }

  async function saveResult(result) {
    if (!window.API || !state.game) return;
    try {
      const me = await window.API.me();
      if (!me || !me.user) return;
      const duration = Math.round((Date.now() - state.startTs) / 1000);
      await window.API.saveGame({
        opponent_type: 'pvp',
        result,
        moves_count: state.game.history.length,
        duration_sec: duration,
        pgn: JSON.stringify(state.moves || []),
      });
    } catch (e) {}
  }

  /* ---------------- Lịch sử & quân bị ăn ---------------- */
  function renderHistory() {
    const list = $('move-list');
    if (!list || !state.game) return;
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
    s.textContent = NAME[X.typeOf(rec.piece)] + ' ' + sq(rec.from.x, rec.from.y) + '→' + sq(rec.to.x, rec.to.y);
    return s;
  }
  function renderCaptured() {
    const red = $('captured-red');
    const black = $('captured-black');
    if (red) red.innerHTML = state.capturedByRed.map(chip).join('');
    if (black) black.innerHTML = state.capturedByBlack.map(chip).join('');
  }
  function chip(p) {
    const c = X.colorOf(p);
    return '<span class="cap-chip ' + (c === X.RED ? 'red' : 'black') + '">' + GLYPH[c][X.typeOf(p)] + '</span>';
  }

  /* ---------------- Cầu hòa / Hoàn nước ---------------- */
  function showOffer(type, text) {
    state.pendingOffer = type;
    $('offer-text').textContent = text;
    $('offer-box').classList.remove('hidden');
  }
  function offerHide() { const b = $('offer-box'); if (b) b.classList.add('hidden'); }
  function offerAccept() {
    const t = state.pendingOffer;
    offerHide();
    state.pendingOffer = null;
    if (t === 'draw') {
      sendWs({ type: 'draw-accept' });
      endGame('draw', 'Hai bên đồng ý hòa');
    } else if (t === 'takeback') {
      sendWs({ type: 'takeback-accept' });
      applyTakeback(state.myColor === 'r' ? 'b' : 'r'); // đối thủ (người xin) được hoàn nước
    }
  }
  function offerDecline() {
    const t = state.pendingOffer;
    offerHide();
    state.pendingOffer = null;
    if (t === 'draw') sendWs({ type: 'draw-decline' });
    else if (t === 'takeback') sendWs({ type: 'takeback-decline' });
  }

  function undoOne() {
    const rec = state.game.undo();
    if (!rec) return;
    state.moves.pop();
    if (rec.captured) {
      if (X.colorOf(rec.captured) === X.BLACK) state.capturedByRed.pop();
      else state.capturedByBlack.pop();
    }
  }
  // Hoàn nước cho tới khi tới lượt của `requesterColor` (người xin hoàn), tối đa 2 nước.
  function applyTakeback(requesterColor) {
    if (state.over || !state.game || state.game.history.length === 0) return;
    let guard = 0;
    do { undoOne(); guard++; } while (state.game.history.length > 0 && state.game.turn !== requesterColor && guard < 4);
    const last = state.game.history[state.game.history.length - 1];
    state.board.setLastMove(last ? { from: last.from, to: last.to } : null);
    state.board.clearSelection();
    state.board.render(state.game);
    renderCaptured();
    renderHistory();
    updateTurn();
  }

  /* ---------------- Chat ---------------- */
  function appendChat(who, text) {
    const log = $('chat-log');
    if (!log) return;
    const line = document.createElement('div');
    line.className = 'chat-line';
    const b = document.createElement('b');
    b.textContent = who + ': ';
    line.appendChild(b);
    line.appendChild(document.createTextNode(text));
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }
  function sendChat() {
    const input = $('chat-input');
    const text = (input.value || '').trim();
    if (!text) return;
    sendWs({ type: 'chat', text });
    appendChat('Bạn', text);
    input.value = '';
  }

  /* ---------------- Khởi tạo UI ---------------- */
  function resetToLobby() {
    state.over = true;
    state.game = null;
    stopTimer();
    state.pendingOffer = null;
    offerHide();
    if (state.board) {
      $('board').innerHTML = '';
      $('board').classList.remove('flip');
      const col = document.querySelector('.board-col');
      if (col) col.classList.remove('flip');
      state.board = null;
    }
    $('result-modal').classList.add('hidden');
    $('lobby-overlay').classList.remove('hidden');
    hideWaiting();
    ['btn-resign', 'btn-draw', 'btn-takeback'].forEach((id) => { $(id).disabled = true; });
    $('chat-input').disabled = true;
    $('chat-send').disabled = true;
    lobbyStatus(state.ws && state.ws.readyState === WebSocket.OPEN ? 'Chọn cách vào trận.' : 'Đang kết nối…');
    requestList(); // làm mới danh sách phòng khi quay lại sảnh
  }

  async function init() {
    // Lấy tên hiển thị từ tài khoản nếu đã đăng nhập
    try {
      const me = window.API && (await window.API.me());
      if (me && me.user) state.name = me.user.username;
      else state.name = 'Khách-' + Math.floor(1000 + Math.random() * 9000);
    } catch (e) { state.name = 'Khách-' + Math.floor(1000 + Math.random() * 9000); }

    // Hành động tự động khi đến từ trang Danh sách phòng (rooms.html)
    const params = new URLSearchParams(location.search);
    if (params.get('join')) state.auto = { type: 'join', code: String(params.get('join')).toUpperCase().trim() };
    else if (params.get('create') === '1') state.auto = { type: 'create' };
    else if (params.get('quick') === '1') state.auto = { type: 'quick' };

    $('btn-quick').addEventListener('click', () => { sendWs({ type: 'quick' }); showWaiting('Đang tìm đối thủ…', null); });
    $('btn-create').addEventListener('click', () => { sendWs({ type: 'create' }); showWaiting('Đang tạo phòng…', null); });
    $('btn-join').addEventListener('click', () => {
      const code = ($('join-code').value || '').toUpperCase().trim();
      if (code.length < 3) { lobbyStatus('Nhập mã phòng hợp lệ.'); return; }
      sendWs({ type: 'join', code });
    });
    $('btn-cancel').addEventListener('click', () => { sendWs({ type: 'cancel' }); hideWaiting(); requestList(); lobbyStatus('Đã huỷ. Chọn cách vào trận.'); });
    $('btn-refresh').addEventListener('click', requestList);

    $('btn-resign').addEventListener('click', () => {
      if (state.over || !state.game) return;
      sendWs({ type: 'resign' });
      endGame(state.myColor === 'r' ? 'b' : 'r', 'Bạn xin thua');
    });
    $('btn-draw').addEventListener('click', () => {
      if (state.over || !state.game) return;
      sendWs({ type: 'draw-offer' });
      status('Đã gửi lời cầu hòa, chờ đối thủ trả lời…');
    });
    $('btn-takeback').addEventListener('click', () => {
      if (state.over || !state.game || state.game.history.length === 0) return;
      sendWs({ type: 'takeback-offer' });
      status('Đã xin hoàn nước, chờ đối thủ đồng ý…');
    });
    $('offer-yes').addEventListener('click', offerAccept);
    $('offer-no').addEventListener('click', offerDecline);
    $('btn-rematch').addEventListener('click', () => {
      sendWs({ type: 'rematch' });
      $('btn-rematch').disabled = true;
      $('rematch-status').textContent = 'Đã sẵn sàng chơi lại, chờ đối thủ…';
    });
    $('btn-new').addEventListener('click', resetToLobby);
    $('btn-again').addEventListener('click', resetToLobby);

    $('chat-send').addEventListener('click', sendChat);
    $('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

    connect();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
