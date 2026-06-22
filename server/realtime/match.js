/*
 * match.js — Ghép trận & đồng bộ nước đi Cờ Tướng trực tuyến (người với người) qua WebSocket.
 *
 * Hỗ trợ 2 cách vào trận:
 *   - "quick": tìm trận nhanh (ghép 2 người đang chờ với nhau).
 *   - "create"/"join": tạo phòng riêng -> nhận mã -> bạn bè nhập mã để vào.
 *
 * Server chỉ làm trọng tài nhẹ (chuyển tiếp nước đi + kiểm tra đúng lượt). Việc kiểm
 * tra luật cờ do mỗi client tự thực hiện bằng engine xiangqi.js dùng chung.
 *
 * Giao thức (JSON):
 *   client -> server: {type:'hello',name} | {type:'quick'} | {type:'create'} |
 *                     {type:'join',code} | {type:'move',from,to} | {type:'resign'} |
 *                     {type:'chat',text} | {type:'cancel'}
 *   server -> client: {type:'welcome'} | {type:'waiting'} | {type:'created',code} |
 *                     {type:'start',color,opponent} | {type:'move',from,to} |
 *                     {type:'resign'} | {type:'opponent-left'} | {type:'chat',text} |
 *                     {type:'error',message}
 */
const { WebSocketServer } = require('ws');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bỏ ký tự dễ nhầm (I,O,0,1)

function makeCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

module.exports = function attachMatch(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  let quickWaiting = null; // ws đang chờ ghép trận nhanh
  const rooms = new Map(); // code -> { players:[ws,...], code, started, turn }

  const isOpen = (ws) => ws && ws.readyState === ws.OPEN;
  const send = (ws, obj) => { if (isOpen(ws)) ws.send(JSON.stringify(obj)); };
  const opponent = (room, ws) => room.players.find((p) => p !== ws);

  function startRoom(room) {
    room.started = true;
    room.turn = 'r'; // Đỏ đi trước
    const [a, b] = room.players;
    a.color = 'r';
    b.color = 'b';
    send(a, { type: 'start', color: 'r', opponent: b.name });
    send(b, { type: 'start', color: 'b', opponent: a.name });
  }

  function endRoomNotify(ws) {
    const room = ws.room;
    if (!room) return;
    const other = opponent(room, ws);
    if (other && room.started) send(other, { type: 'opponent-left' });
    if (room.code) rooms.delete(room.code);
    room.players.forEach((p) => { p.room = null; });
  }

  wss.on('connection', (ws) => {
    ws.name = 'Khách';
    ws.room = null;
    ws.color = null;
    send(ws, { type: 'welcome' });

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch (e) { return; }
      switch (msg && msg.type) {
        case 'hello':
          ws.name = String(msg.name || 'Khách').slice(0, 24) || 'Khách';
          break;
        case 'quick':
          if (ws.room) return;
          if (isOpen(quickWaiting) && quickWaiting !== ws) {
            const room = { players: [quickWaiting, ws], code: null };
            quickWaiting.room = room;
            ws.room = room;
            quickWaiting = null;
            startRoom(room);
          } else {
            quickWaiting = ws;
            send(ws, { type: 'waiting' });
          }
          break;
        case 'create': {
          if (ws.room) return;
          let code;
          do { code = makeCode(); } while (rooms.has(code));
          const room = { players: [ws], code };
          ws.room = room;
          rooms.set(code, room);
          send(ws, { type: 'created', code });
          break;
        }
        case 'join': {
          if (ws.room) return;
          const code = String(msg.code || '').toUpperCase().trim();
          const room = rooms.get(code);
          if (!room) return send(ws, { type: 'error', message: 'Không tìm thấy phòng với mã này' });
          if (room.players.length >= 2) return send(ws, { type: 'error', message: 'Phòng đã đủ 2 người' });
          room.players.push(ws);
          ws.room = room;
          startRoom(room);
          break;
        }
        case 'move': {
          const room = ws.room;
          if (!room || !room.started) return;
          if (ws.color !== room.turn) return; // không đúng lượt -> bỏ qua
          if (!msg.from || !msg.to) return;
          room.turn = room.turn === 'r' ? 'b' : 'r';
          send(opponent(room, ws), { type: 'move', from: msg.from, to: msg.to });
          break;
        }
        case 'resign': {
          const room = ws.room;
          if (!room || !room.started) return;
          send(opponent(room, ws), { type: 'resign' });
          break;
        }
        case 'chat': {
          const room = ws.room;
          if (!room) return;
          const text = String(msg.text || '').slice(0, 200);
          if (text) send(opponent(room, ws), { type: 'chat', text });
          break;
        }
        case 'cancel':
          if (quickWaiting === ws) quickWaiting = null;
          if (ws.room && !ws.room.started) {
            if (ws.room.code) rooms.delete(ws.room.code);
            ws.room = null;
          }
          break;
      }
    });

    ws.on('close', () => {
      if (quickWaiting === ws) quickWaiting = null;
      if (ws.room) {
        if (ws.room.started) endRoomNotify(ws);
        else {
          if (ws.room.code) rooms.delete(ws.room.code);
          ws.room = null;
        }
      }
    });
  });

  return wss;
};
