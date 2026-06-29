/*
 * ai.worker.js — AI Cờ Tướng chạy trong Web Worker.
 * Thuật toán: Negamax + cắt tỉa alpha-beta, lượng giá = giá trị quân + bảng vị trí (PST).
 * Nhận message: { board, difficulty } -> trả về { move, nodes }.
 */
importScripts('xiangqi.js?v=2');

const X = self.Xiangqi;
const RED = X.RED;
const BLACK = X.BLACK;

const MATE = 1000000;
const REPEAT_PENALTY = 60; // phạt nước đi tạo lại thế cờ vừa xuất hiện (chống lặp)

// Khoá thế cờ (chuỗi) để phát hiện lặp.
function boardKey(board) {
  let s = '';
  for (let y = 0; y < X.ROWS; y++) for (let x = 0; x < X.COLS; x++) s += board[y][x] || '.';
  return s;
}

// Giá trị quân (đơn vị ~ centipawn)
const VALUE = {
  K: 60000,
  R: 1200,
  C: 600,
  H: 550,
  E: 220,
  A: 220,
  P: 120,
};

// Bảng vị trí (PST) theo hướng ĐỎ (y=9 là nhà Đỏ). Quân Đen lấy đối xứng y -> 9-y.
// Mỗi bảng 10 hàng x 9 cột.
const PST = {
  R: [
    [14, 14, 12, 18, 16, 18, 12, 14, 14],
    [16, 20, 18, 24, 26, 24, 18, 20, 16],
    [12, 12, 12, 18, 18, 18, 12, 12, 12],
    [12, 18, 16, 22, 22, 22, 16, 18, 12],
    [12, 14, 12, 18, 18, 18, 12, 14, 12],
    [12, 16, 14, 20, 20, 20, 14, 16, 12],
    [6, 10, 8, 14, 14, 14, 8, 10, 6],
    [4, 8, 6, 14, 12, 14, 6, 8, 4],
    [8, 4, 8, 16, 8, 16, 8, 4, 8],
    [-2, 10, 6, 14, 12, 14, 6, 10, -2],
  ],
  H: [
    [4, 8, 16, 12, 4, 12, 16, 8, 4],
    [4, 10, 28, 16, 8, 16, 28, 10, 4],
    [12, 14, 16, 20, 18, 20, 16, 14, 12],
    [8, 24, 18, 24, 20, 24, 18, 24, 8],
    [6, 16, 14, 18, 16, 18, 14, 16, 6],
    [4, 12, 16, 14, 12, 14, 16, 12, 4],
    [2, 6, 8, 6, 10, 6, 8, 6, 2],
    [4, 2, 8, 8, 4, 8, 8, 2, 4],
    [0, 2, 4, 4, -2, 4, 4, 2, 0],
    [0, -4, 0, 0, 0, 0, 0, -4, 0],
  ],
  C: [
    [6, 4, 0, -10, -12, -10, 0, 4, 6],
    [2, 2, 0, -4, -14, -4, 0, 2, 2],
    [2, 2, 0, -10, -8, -10, 0, 2, 2],
    [0, 0, -2, 4, 10, 4, -2, 0, 0],
    [0, 0, 0, 2, 8, 2, 0, 0, 0],
    [-2, 0, 4, 2, 6, 2, 4, 0, -2],
    [0, 0, 0, 2, 4, 2, 0, 0, 0],
    [4, 0, 8, 6, 10, 6, 8, 0, 4],
    [0, 2, 4, 6, 6, 6, 4, 2, 0],
    [0, 0, 2, 6, 6, 6, 2, 0, 0],
  ],
  P: [
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [18, 36, 56, 80, 120, 80, 56, 36, 18],
    [14, 26, 42, 60, 80, 60, 42, 26, 14],
    [14, 18, 32, 40, 50, 40, 32, 18, 14],
    [12, 16, 20, 26, 30, 26, 20, 16, 12],
    [6, 12, 14, 18, 20, 18, 14, 12, 6],
    [2, 0, 8, 0, 8, 0, 8, 0, 2],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
  ],
  A: [
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 18, 0, 18, 0, 0, 0],
    [0, 0, 0, 20, 0, 20, 0, 0, 0],
  ],
  E: [
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 20, 0, 0, 0, 20, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [18, 0, 0, 0, 22, 0, 0, 0, 18],
  ],
  K: [
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 2, 2, 2, 0, 0, 0],
    [0, 0, 0, 4, 5, 4, 0, 0, 0],
    [0, 0, 0, 6, 8, 6, 0, 0, 0],
  ],
};

let nodeCount = 0;
let startTime = 0; // thời điểm bắt đầu nghĩ (ms)
let timeLimit = 0; // ngân sách thời gian mỗi nước (ms)
let timedOut = false;
let killers = []; // killer moves theo độ sâu (ply) để cắt tỉa tốt hơn

// Lượng giá từ góc nhìn ĐỎ (dương = lợi cho Đỏ)
function evaluateRaw(game) {
  let score = 0;
  const b = game.board;
  for (let y = 0; y < X.ROWS; y++) {
    for (let x = 0; x < X.COLS; x++) {
      const p = b[y][x];
      if (!p) continue;
      const t = X.typeOf(p);
      const isRed = X.colorOf(p) === RED;
      const base = VALUE[t];
      const pst = isRed ? PST[t][y][x] : PST[t][X.ROWS - 1 - y][x];
      const v = base + pst;
      score += isRed ? v : -v;
    }
  }
  return score;
}

function evaluate(game, color) {
  const raw = evaluateRaw(game);
  return color === RED ? raw : -raw;
}

// Sắp xếp nước đi: ưu tiên nước ăn quân (MVV-LVA đơn giản) để cắt tỉa tốt hơn
function orderMoves(game, moves) {
  const b = game.board;
  for (const m of moves) {
    const victim = b[m.to.y][m.to.x];
    const attacker = b[m.from.y][m.from.x];
    m._score = victim ? VALUE[X.typeOf(victim)] * 10 - VALUE[X.typeOf(attacker)] : 0;
  }
  moves.sort((a, b2) => b2._score - a._score);
  return moves;
}

function sameMove(m, k) {
  return k && m.from.x === k.from.x && m.from.y === k.from.y && m.to.x === k.to.x && m.to.y === k.to.y;
}
function recordKiller(m, ply) {
  if (!killers[ply]) killers[ply] = [null, null];
  const k = killers[ply];
  if (!sameMove(m, k[0])) {
    k[1] = k[0];
    k[0] = { from: { x: m.from.x, y: m.from.y }, to: { x: m.to.x, y: m.to.y } };
  }
}

// Sắp xếp: nước ăn quân (MVV-LVA) trước, rồi killer move.
function orderMovesK(game, moves, ply) {
  const b = game.board;
  const k = killers[ply];
  for (const m of moves) {
    const victim = b[m.to.y][m.to.x];
    let s = 0;
    if (victim) s = 100000 + VALUE[X.typeOf(victim)] * 10 - VALUE[X.typeOf(b[m.from.y][m.from.x])];
    else if (k && (sameMove(m, k[0]) || sameMove(m, k[1]))) s = 9000;
    m._score = s;
  }
  moves.sort((a, b2) => b2._score - a._score);
  return moves;
}

function timeUp() {
  if ((nodeCount & 1023) === 0 && Date.now() - startTime > timeLimit) timedOut = true;
  return timedOut;
}

// Quiescence: tại nút lá chỉ tìm tiếp các nước ĂN QUÂN cho tới khi "yên tĩnh"
// -> tránh "horizon effect" (AI thí quân vì không thấy hậu quả ngay sau tầm tìm).
function quiesce(game, alpha, beta, color) {
  if (timeUp()) return evaluate(game, color);
  const standPat = evaluate(game, color);
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;
  const caps = game.legalMoves(color).filter((m) => game.board[m.to.y][m.to.x]);
  orderMoves(game, caps);
  const opp = color === RED ? BLACK : RED;
  for (const m of caps) {
    nodeCount++;
    const cap = game._apply(m);
    const score = -quiesce(game, -beta, -alpha, opp);
    game._revert(m, cap);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(game, depth, alpha, beta, color, ply, useQ) {
  if (timeUp()) return evaluate(game, color);
  const moves = game.legalMoves(color);
  if (moves.length === 0) return -MATE - depth; // hết nước -> thua
  if (depth === 0) return useQ ? quiesce(game, alpha, beta, color) : evaluate(game, color);
  orderMovesK(game, moves, ply);
  const opp = color === RED ? BLACK : RED;
  let best = -Infinity;
  for (const m of moves) {
    nodeCount++;
    const isCap = !!game.board[m.to.y][m.to.x];
    const cap = game._apply(m);
    const score = -negamax(game, depth - 1, -beta, -alpha, opp, ply + 1, useQ);
    game._revert(m, cap);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) {
      if (!isCap) recordKiller(m, ply); // chỉ nhớ nước "yên" (không ăn quân)
      break;
    }
  }
  return best;
}

// Iterative deepening: nghĩ sâu dần tới maxDepth hoặc hết ngân sách thời gian.
function chooseMove(game, color, cfg, recent) {
  nodeCount = 0;
  killers = [];
  timedOut = false;
  startTime = Date.now();
  timeLimit = cfg.timeMs;
  const rootMoves = game.legalMoves(color);
  if (rootMoves.length === 0) return null;
  const opp = color === RED ? BLACK : RED;
  const hasRecent = recent && recent.length > 0;
  let bestScored = rootMoves.map((m) => ({ move: m, score: 0 }));
  let bestMove = rootMoves[0];

  for (let d = 1; d <= cfg.depth; d++) {
    let alpha = -Infinity;
    const beta = Infinity;
    const scored = [];
    orderMovesK(game, rootMoves, 0);
    // ưu tiên nước tốt nhất của vòng trước -> cắt tỉa tốt hơn
    const bi = rootMoves.indexOf(bestMove);
    if (bi > 0) { rootMoves.splice(bi, 1); rootMoves.unshift(bestMove); }
    for (const m of rootMoves) {
      const cap = game._apply(m);
      const raw = -negamax(game, d - 1, -beta, -alpha, opp, 1, cfg.quiesce);
      const key = hasRecent ? boardKey(game.board) : null;
      game._revert(m, cap);
      if (timedOut) break;
      let score = raw;
      if (key && recent.indexOf(key) !== -1) score -= REPEAT_PENALTY; // chống lặp
      scored.push({ move: m, score });
      if (raw > alpha) alpha = raw;
    }
    if (timedOut && scored.length < rootMoves.length) break; // vòng dở -> giữ kết quả vòng trước
    scored.sort((a, b) => b.score - a.score);
    bestScored = scored;
    bestMove = scored[0].move;
    if (Math.abs(scored[0].score) > MATE - 1000) break; // đã thấy chiếu hết
    if (Date.now() - startTime > timeLimit) break;
  }

  // Mức dễ/trung bình: thỉnh thoảng chọn ngẫu nhiên trong nhóm gần tốt nhất
  if (cfg.randomness > 0 && Math.random() < cfg.randomness) {
    const top = bestScored.filter((s) => s.score >= bestScored[0].score - 80);
    return top[Math.floor(Math.random() * top.length)].move;
  }
  // Phá thế đơn định nhẹ: chọn ngẫu nhiên trong nhóm ngang điểm tốt nhất
  const best = bestScored[0].score;
  const ties = bestScored.filter((s) => s.score >= best - 12);
  return ties[Math.floor(Math.random() * ties.length)].move;
}

const LEVELS = {
  easy:   { depth: 2, randomness: 0.5,  timeMs: 400,  quiesce: false }, // Dễ
  medium: { depth: 3, randomness: 0.2,  timeMs: 700,  quiesce: true },  // Trung bình
  hard:   { depth: 4, randomness: 0.05, timeMs: 1200, quiesce: true },  // Khó
  expert: { depth: 6, randomness: 0,    timeMs: 2000, quiesce: true },  // Rất khó
  master: { depth: 8, randomness: 0,    timeMs: 3000, quiesce: true },  // Cao thủ
};

self.onmessage = function (e) {
  const { board, difficulty, recent } = e.data;
  const cfg = LEVELS[difficulty] || LEVELS.medium;
  const game = new X.Game(board, BLACK); // AI luôn cầm quân Đen
  const move = chooseMove(game, BLACK, cfg, recent || []);
  self.postMessage({ move, nodes: nodeCount });
};
