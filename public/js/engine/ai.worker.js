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

function negamax(game, depth, alpha, beta, color) {
  const moves = game.legalMoves(color);
  if (moves.length === 0) {
    // hết nước -> bên đi thua (chiếu hết hoặc hết nước)
    return -MATE - depth;
  }
  if (depth === 0) {
    return evaluate(game, color);
  }
  orderMoves(game, moves);
  const opp = color === RED ? BLACK : RED;
  let best = -Infinity;
  for (const m of moves) {
    nodeCount++;
    const cap = game._apply(m);
    const score = -negamax(game, depth - 1, -beta, -alpha, opp);
    game._revert(m, cap);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function chooseMove(game, color, depth, randomness, recent) {
  nodeCount = 0;
  const moves = orderMoves(game, game.legalMoves(color));
  if (moves.length === 0) return null;
  const opp = color === RED ? BLACK : RED;
  let alpha = -Infinity;
  const beta = Infinity;
  const hasRecent = recent && recent.length > 0;
  const scored = [];
  for (const m of moves) {
    const cap = game._apply(m);
    const raw = -negamax(game, depth - 1, -beta, -alpha, opp);
    const key = hasRecent ? boardKey(game.board) : null;
    game._revert(m, cap);
    if (raw > alpha) alpha = raw; // cắt tỉa dùng điểm thật
    // Phạt nếu nước này tạo lại một thế cờ vừa xuất hiện (gây lặp)
    const score = key && recent.indexOf(key) !== -1 ? raw - REPEAT_PENALTY : raw;
    scored.push({ move: m, score });
  }
  scored.sort((a, b) => b.score - a.score);

  // Mức dễ/trung bình: thỉnh thoảng chọn ngẫu nhiên trong nhóm nước gần tốt nhất
  if (randomness > 0 && Math.random() < randomness) {
    const top = scored.filter((s) => s.score >= scored[0].score - 80);
    return top[Math.floor(Math.random() * top.length)].move;
  }
  // Luôn phá thế đơn định: chọn ngẫu nhiên trong nhóm nước ngang điểm tốt nhất
  const best = scored[0].score;
  const ties = scored.filter((s) => s.score >= best - 12);
  return ties[Math.floor(Math.random() * ties.length)].move;
}

const LEVELS = {
  easy: { depth: 2, randomness: 0.45 },
  medium: { depth: 3, randomness: 0.1 },
  hard: { depth: 4, randomness: 0 },
};

self.onmessage = function (e) {
  const { board, difficulty, recent } = e.data;
  const cfg = LEVELS[difficulty] || LEVELS.medium;
  const game = new X.Game(board, BLACK); // AI luôn cầm quân Đen ở v1
  const move = chooseMove(game, BLACK, cfg.depth, cfg.randomness, recent || []);
  self.postMessage({ move, nodes: nodeCount });
};
