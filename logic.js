'use strict';

// 블록 채우기: 판 규칙만 모아 둔 파일 (그리기·입력 없음). 브라우저와 테스트(Node)가 같이 쓴다.
//
// - 10×10 판에 블록 3개가 주어진다. 하나씩 끌어서 놓고, 가로 또는 세로 한 줄이 꽉 차면 그 줄이 지워진다
// - 블록은 돌릴 수 없다. 3개를 모두 놓으면 새 블록 3개가 나온다
// - 주어진 블록 중 놓을 자리가 있는 것이 하나도 없으면 끝
// - 점수: 놓은 칸 수 + 지운 줄 보너스(한 번에 많이 지울수록 크게) + 연속으로 줄을 지우는 콤보 보너스
const N = 10, TRAY = 3;

// 모양: '#' 이 칸. 놓을 때 왼쪽 위 칸이 기준
const SHAPE_DEFS = [
  // 1칸
  { s: ['#'], w: 0.5 },
  // 2칸
  { s: ['##'], w: 1 }, { s: ['#', '#'], w: 1 },
  // 3칸 직선
  { s: ['###'], w: 1 }, { s: ['#', '#', '#'], w: 1 },
  // 4칸 직선
  { s: ['####'], w: 0.8 }, { s: ['#', '#', '#', '#'], w: 0.8 },
  // 5칸 직선
  { s: ['#####'], w: 0.6 }, { s: ['#', '#', '#', '#', '#'], w: 0.6 },
  // 네모
  { s: ['##', '##'], w: 1.2 }, { s: ['###', '###', '###'], w: 0.5 },
  { s: ['###', '###'], w: 0.7 }, { s: ['##', '##', '##'], w: 0.7 },
  // ㄱ자 3칸 (네 방향)
  { s: ['##', '#.'], w: 1 }, { s: ['##', '.#'], w: 1 }, { s: ['#.', '##'], w: 1 }, { s: ['.#', '##'], w: 1 },
  // ㄱ자 5칸 (네 방향)
  { s: ['###', '#..', '#..'], w: 0.6 }, { s: ['###', '..#', '..#'], w: 0.6 },
  { s: ['#..', '#..', '###'], w: 0.6 }, { s: ['..#', '..#', '###'], w: 0.6 },
];
const SHAPES = SHAPE_DEFS.map((d, id) => {
  const cells = [];
  d.s.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === '#') cells.push([r, c]); }));
  return { id, cells, h: d.s.length, w: d.s[0].length, n: cells.length, weight: d.w };
});
const COLORS = 8;                                       // 모양마다 색 번호 (그리기용)
const colorOf = (id) => id % COLORS;

function rng(seed) {                                     // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 상태: grid(칸마다 색 번호, 빈칸 -1), tray(남은 블록 모양 번호 또는 null), score, combo, moves, seed·draws(난수 위치)
function newGame(seed = (Math.random() * 2 ** 31) | 0) {
  const st = { grid: new Int8Array(N * N).fill(-1), tray: [null, null, null], score: 0, combo: 0, moves: 0, lines: 0, seed, draws: 0, over: false };
  refill(st);
  return st;
}

const cellAt = (st, r, c) => (r < 0 || r >= N || c < 0 || c >= N ? 0 : st.grid[r * N + c]);

function canPlace(st, shape, r, c) {
  for (const [dr, dc] of shape.cells) {
    const rr = r + dr, cc = c + dc;
    if (rr < 0 || rr >= N || cc < 0 || cc >= N || st.grid[rr * N + cc] !== -1) return false;
  }
  return true;
}
function fits(st, shape) {
  for (let r = 0; r <= N - shape.h; r++) for (let c = 0; c <= N - shape.w; c++) if (canPlace(st, shape, r, c)) return true;
  return false;
}
const filledCount = (st) => { let n = 0; for (let i = 0; i < st.grid.length; i++) if (st.grid[i] !== -1) n++; return n; };

// 새 블록 3개. 판이 빽빽할수록 작은 블록이 잘 나오고, 적어도 하나는 놓을 자리가 있게 한다
function refill(st) {
  const rand = rng((st.seed + Math.imul(st.draws + 1, 0x9E3779B1)) >>> 0);
  st.draws++;
  const fill = filledCount(st) / (N * N);
  const pickShape = (strictFit) => {
    let total = 0; const ws = SHAPES.map((sh) => {
      // 빽빽하면(50% 넘게 참) 큰 블록은 확률을 줄인다
      let w = sh.weight * (fill > 0.5 ? Math.max(0.15, 1 - (fill - 0.5) * (sh.n - 1) * 0.35) : 1);
      if (strictFit && !fits(st, sh)) w = 0;
      total += w; return w;
    });
    if (total <= 0) return -1;
    let x = rand() * total;
    for (let i = 0; i < ws.length; i++) { x -= ws[i]; if (x <= 0) return i; }
    return ws.length - 1;
  };
  for (let attempt = 0; attempt < 60; attempt++) {
    const ids = [pickShape(false), pickShape(false), pickShape(false)];
    if (ids.some((id) => fits(st, SHAPES[id]))) { st.tray = ids; return; }
  }
  // 어떻게 뽑아도 하나도 못 놓을 만큼 꽉 찬 판: 들어가는 것 중에서만 고른다 (그래도 없으면 끝난 판)
  const ids = [pickShape(true), pickShape(true), pickShape(true)];
  st.tray = ids.map((id) => (id < 0 ? 0 : id));
}

// 줄 점수: 한 번에 지운 줄 수 L 이 클수록 크게 (1줄 10, 2줄 30, 3줄 60, 4줄 100 ...)
const lineScore = (L) => (L * (L + 1) / 2) * 10;
const comboBonus = (combo) => (combo >= 2 ? (combo - 1) * 10 : 0);

// 블록(slot 번째)을 (r, c) 에 놓는다. 놓을 수 없으면 null.
// 돌려주는 값: { cells:[[r,c]..], rows:[지운 행], cols:[지운 열], cleared:[[r,c,색]..], gain, combo, over, refilled }
function place(st, slot, r, c) {
  const id = st.tray[slot];
  if (st.over || id === null || id === undefined) return null;
  const shape = SHAPES[id];
  if (!canPlace(st, shape, r, c)) return null;
  const color = colorOf(id);
  const cells = shape.cells.map(([dr, dc]) => [r + dr, c + dc]);
  for (const [rr, cc] of cells) st.grid[rr * N + cc] = color;
  // 꽉 찬 줄 찾기 (지우는 건 한꺼번에: 가로·세로가 겹쳐도 한 번에)
  const rows = [], cols = [];
  for (let i = 0; i < N; i++) {
    let fr = true, fc = true;
    for (let j = 0; j < N; j++) { if (st.grid[i * N + j] === -1) fr = false; if (st.grid[j * N + i] === -1) fc = false; }
    if (fr) rows.push(i);
    if (fc) cols.push(i);
  }
  const cleared = [], seen = new Set();
  const take = (rr, cc) => { const k = rr * N + cc; if (seen.has(k)) return; seen.add(k); cleared.push([rr, cc, st.grid[k]]); };
  for (const i of rows) for (let j = 0; j < N; j++) take(i, j);
  for (const j of cols) for (let i = 0; i < N; i++) take(i, j);
  for (const [rr, cc] of cleared) st.grid[rr * N + cc] = -1;
  const L = rows.length + cols.length;
  st.combo = L > 0 ? st.combo + 1 : 0;
  const gain = shape.n + (L ? lineScore(L) + comboBonus(st.combo) : 0);
  st.score += gain; st.lines += L; st.moves++;
  st.tray[slot] = null;
  let refilled = false;
  if (st.tray.every((x) => x === null)) { refill(st); refilled = true; }
  st.over = !st.tray.some((x) => x !== null && fits(st, SHAPES[x]));
  return { cells, rows, cols, cleared, gain, lines: L, combo: st.combo, over: st.over, refilled, color };
}

const isOver = (st) => !st.tray.some((x) => x !== null && fits(st, SHAPES[x]));

// 이 블록을 놓으면 지워질 줄 (미리보기용): { rows, cols }
function previewClear(st, slot, r, c) {
  const id = st.tray[slot];
  if (id === null || !canPlace(st, SHAPES[id], r, c)) return null;
  const add = new Set(SHAPES[id].cells.map(([dr, dc]) => (r + dr) * N + c + dc));
  const rows = [], cols = [];
  for (let i = 0; i < N; i++) {
    let fr = true, fc = true;
    for (let j = 0; j < N; j++) { if (st.grid[i * N + j] === -1 && !add.has(i * N + j)) fr = false; if (st.grid[j * N + i] === -1 && !add.has(j * N + i)) fc = false; }
    if (fr) rows.push(i);
    if (fc) cols.push(i);
  }
  return { rows, cols };
}

// 놓을 수 있는 가장 좋은 자리를 찾아 준다 (힌트·시험 봇용): 줄을 많이 지우고, 빈칸을 덜 쪼개는 쪽
function bestPlacement(st) {
  let best = null, bs = -Infinity;
  st.tray.forEach((id, slot) => {
    if (id === null) return;
    const sh = SHAPES[id];
    for (let r = 0; r <= N - sh.h; r++) for (let c = 0; c <= N - sh.w; c++) {
      if (!canPlace(st, sh, r, c)) continue;
      const pv = previewClear(st, slot, r, c);
      const L = pv.rows.length + pv.cols.length;
      // 이웃이 찬 칸/벽에 붙을수록 좋다
      let touch = 0;
      for (const [dr, dc] of sh.cells) for (const [ar, ac] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const rr = r + dr + ar, cc = c + dc + ac;
        if (rr < 0 || rr >= N || cc < 0 || cc >= N || st.grid[rr * N + cc] !== -1) touch++;
      }
      const s = L * 100 + touch - sh.n * 0.01 * (r + c);
      if (s > bs) { bs = s; best = { slot, r, c }; }
    }
  });
  return best;
}

function serialize(st) { return { grid: Array.from(st.grid), tray: st.tray, score: st.score, combo: st.combo, moves: st.moves, lines: st.lines, seed: st.seed, draws: st.draws, over: st.over }; }
function deserialize(o) {
  if (!o || !Array.isArray(o.grid) || o.grid.length !== N * N || !Array.isArray(o.tray) || o.tray.length !== TRAY) return null;
  if (!o.grid.every((v) => Number.isInteger(v) && v >= -1 && v < COLORS)) return null;
  if (!o.tray.every((v) => v === null || (Number.isInteger(v) && v >= 0 && v < SHAPES.length))) return null;
  const st = { grid: Int8Array.from(o.grid), tray: o.tray.slice(), score: Number(o.score) || 0, combo: Number(o.combo) || 0, moves: Number(o.moves) || 0, lines: Number(o.lines) || 0, seed: o.seed | 0, draws: Number(o.draws) || 0, over: !!o.over };
  return st;
}

const LOGIC = { N, TRAY, SHAPES, COLORS, colorOf, newGame, canPlace, fits, place, refill, isOver, previewClear, bestPlacement, filledCount, lineScore, comboBonus, serialize, deserialize };
if (typeof module !== 'undefined') module.exports = LOGIC;
