'use strict';

// 블록 채우기: 화면·입력·흐름. 판 규칙은 logic.js (LOGIC) 에 있다.
(() => {
const L = LOGIC;
const { N, SHAPES } = L;
const $ = (id) => document.getElementById(id);
const INK = '#2b1d52';
const FONT = '"Jua", "Apple SD Gothic Neo", sans-serif';

// ---------- 모양 (논리 좌표) ----------
const W = 360;
const CS = 34, BX = 10, BY = 10;                    // 판 한 칸, 왼쪽 위
const BOARD = CS * N;                               // 340
const TY = BY + BOARD + 22;                         // 블록 놓는 자리 위쪽
const SLOT_W = 112, SLOT_H = 112, SLOT_GAP = 2;
const TC = 20;                                      // 놓는 자리에서의 블록 한 칸
const H = TY + SLOT_H + 12;
const slotX = (i) => 10 + i * (SLOT_W + SLOT_GAP);
const PALETTE = [
  ['#ff5f7a', '#ffc2cc', '#b0243e'], ['#ffa42b', '#ffe0b0', '#b36a00'], ['#ffd23f', '#fff4b8', '#b38a00'], ['#4cd964', '#c9f7d2', '#1c8a33'],
  ['#3fb6ff', '#c7e8ff', '#0b64a8'], ['#6b7cff', '#d0d6ff', '#3a44b8'], ['#b066ff', '#e7ccff', '#6a24b8'], ['#ff7ab6', '#ffd0e6', '#b8317a'],
];

// ---------- 캔버스 ----------
const canvas = $('game');
const ctx = canvas.getContext('2d');
function fit() {
  const hudH = 52;
  const scale = Math.min((innerWidth - 16) / W, (innerHeight - 16 - hudH) / H, 1.5);
  const cssW = Math.floor(W * scale), cssH = Math.floor(H * scale);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  $('col').style.width = cssW + 'px';
}
addEventListener('resize', fit);

// ---------- 저장소 ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} },
};
let best = Number(store.get('blockBest')) || 0;
const SAVE_KEY = 'blockSave';

// ---------- 소리 ----------
let audio = null;
let muted = store.get('blockMuted') === '1';
function tone(freq, dur, type = 'sine', vol = 0.09, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (_) {}
}
const seq = (notes, step, type = 'triangle', vol = 0.09) => notes.forEach((f, i) => setTimeout(() => tone(f, step * 0.0009, type, vol), i * step));
const sfx = {
  pick: () => tone(560, 0.05, 'triangle', 0.06),
  place: (n) => tone(220 + n * 12, 0.08, 'sine', 0.12, 90),
  nope: () => tone(190, 0.1, 'square', 0.05, -50),
  clear: (lines, combo) => seq([523, 659, 784, 1047, 1319].slice(0, 2 + Math.min(lines, 3)).map((f) => f * (1 + Math.min(combo - 1, 4) * 0.06)), 70, 'triangle', 0.1),
  deal: () => tone(380, 0.08, 'sine', 0.05, 160),
  over: () => seq([392, 330, 262, 196], 170, 'triangle', 0.1),
};
const buzz = (ms) => { try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(ms); } catch (_) {} };

// ---------- 상태 ----------
let st = L.newGame();
let state = 'title';            // title · play · over · paused
let drag = null;                // { slot, x, y, pid, shape, bottomGap }
let clock = 0;
let pops = [], clears = [], particles = [], texts = [], banner = null;
let trayIn = [1, 1, 1], backAnim = null, shakeT = 0;
let gameOverAt = 0;

function updateHud() { $('score').textContent = st.score.toLocaleString(); $('best').textContent = best.toLocaleString(); }
function save() { if (state === 'play' || state === 'paused') store.set(SAVE_KEY, JSON.stringify(L.serialize(st))); }
function loadSave() { try { const s = L.deserialize(JSON.parse(store.get(SAVE_KEY) || 'null')); return s && !s.over ? s : null; } catch (_) { return null; } }

function startGame(saved) {
  st = saved || L.newGame();
  state = 'play'; drag = null; pops = []; clears = []; particles = []; texts = []; banner = null; backAnim = null; shakeT = 0;
  trayIn = [0, 0.08, 0.16]; sfx.deal();
  hideOverlay(); updateHud(); save();
}

// ---------- 놓기 ----------
function cellCenter(r, c) { return [BX + (c + 0.5) * CS, BY + (r + 0.5) * CS]; }
function doPlace(slot, r, c) {
  const res = L.place(st, slot, r, c);
  if (!res) return false;
  for (const [rr, cc] of res.cells) pops.push({ r: rr, c: cc, col: res.color, t: 0 });
  sfx.place(res.cells.length);
  const [mx, my] = cellCenter(res.cells[0][0], res.cells[0][1]);
  if (res.cleared.length) {
    for (const [rr, cc, col] of res.cleared) {
      clears.push({ r: rr, c: cc, col, t: 0 });
      const [px, py] = cellCenter(rr, cc);
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * 6.283, s = 60 + Math.random() * 140;
        particles.push({ x: px, y: py, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.55, col: PALETTE[col][0], r: 2 + Math.random() * 2.5 });
      }
    }
    sfx.clear(res.lines, res.combo); buzz(res.lines > 1 ? 40 : 20);
    texts.push({ text: `+${res.gain}`, x: BX + BOARD / 2, y: BY + BOARD / 2 - 10, t: 0, big: true });
    if (res.lines >= 2 || res.combo >= 2) banner = { text: res.combo >= 2 ? `${res.combo} 콤보!` : `${res.lines}줄 한 번에!`, sub: res.combo >= 2 && res.lines >= 2 ? `${res.lines}줄 한 번에` : '', t: 0 };
  } else texts.push({ text: `+${res.gain}`, x: mx, y: my - 14, t: 0 });
  if (res.refilled) { trayIn = [0, 0.1, 0.2]; sfx.deal(); }
  if (st.score > best) { best = st.score; store.set('blockBest', String(best)); }
  updateHud();
  if (res.over) gameOver(); else save();
  return true;
}

function gameOver() {
  state = 'over'; gameOverAt = clock; shakeT = 0.4; drag = null;
  store.del(SAVE_KEY);
  sfx.over(); buzz(120);
  setTimeout(() => {
    if (state !== 'over') return;
    const isBest = st.score > 0 && st.score >= best;
    showOverlay(`
      <h2>더 놓을 곳이 없어요!</h2>
      <div class="big">${st.score.toLocaleString()}</div>
      <span class="tag">${isBest ? '🏆 최고 기록!' : `최고 ${best.toLocaleString()}`}</span>
      <div class="card2"><dl class="stats">
        <dt>지운 줄</dt><dd>${st.lines}줄</dd>
        <dt>놓은 블록</dt><dd>${st.moves}개</dd>
      </dl></div>
      <div class="col"><button id="againBtn">다시 하기</button></div>`);
    $('againBtn').onclick = () => startGame();
  }, 1000);
}

// ---------- 입력 ----------
function toLogical(e) {
  const rect = canvas.getBoundingClientRect();
  return [(e.clientX - rect.left) * (W / rect.width), (e.clientY - rect.top) * (H / rect.height)];
}
const slotAt = (x, y) => {
  if (y < TY - 14) return -1;
  for (let i = 0; i < 3; i++) if (x >= slotX(i) - 4 && x <= slotX(i) + SLOT_W + 4 && st.tray[i] !== null) return i;
  return -1;
};
// 끌고 있는 블록이 놓일 칸 (왼쪽 위): 손가락 위에 떠 있는 블록의 위치에서 가장 가까운 놓을 수 있는 자리
function dragTarget() {
  if (!drag) return null;
  const sh = drag.shape;
  const cx = drag.x - (sh.w * CS) / 2, cy = drag.y - drag.bottomGap - sh.h * CS;      // 블록 왼쪽 위의 화면 좌표
  const fc = (cx - BX) / CS, fr = (cy - BY) / CS;
  let bestT = null, bd = 1.1;
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const r = Math.round(fr) + dr, c = Math.round(fc) + dc;
    if (!L.canPlace(st, sh, r, c)) continue;
    const d = Math.hypot(fr - r, fc - c);
    if (d < bd) { bd = d; bestT = { r, c }; }
  }
  return bestT;
}
canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'play' || drag) return;
  const [x, y] = toLogical(e);
  const slot = slotAt(x, y);
  if (slot < 0) return;
  e.preventDefault();
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  drag = { slot, x, y, pid: e.pointerId, shape: SHAPES[st.tray[slot]], bottomGap: e.pointerType === 'mouse' ? 14 : 52 };
  canvas.classList.add('drag');
  sfx.pick();
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pid) return;
  [drag.x, drag.y] = toLogical(e);
});
function endDrag(e, cancel) {
  if (!drag || e.pointerId !== drag.pid) return;
  [drag.x, drag.y] = toLogical(e);
  const d = drag, tgt = cancel ? null : dragTarget();
  drag = null; canvas.classList.remove('drag');
  if (tgt && doPlace(d.slot, tgt.r, tgt.c)) return;
  // 못 놓으면 제자리로 날아가 돌아간다
  if (!cancel && d.y < TY - 10) sfx.nope();
  const sh = d.shape;
  backAnim = { slot: d.slot, x: d.x - (sh.w * CS) / 2, y: d.y - d.bottomGap - sh.h * CS, t: 0 };
}
canvas.addEventListener('pointerup', (e) => endDrag(e, false));
canvas.addEventListener('pointercancel', (e) => endDrag(e, true));

// ---------- 그리기 ----------
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function label(text, x, y, size, fill = '#fff', align = 'center') {
  ctx.font = `${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size * 0.22); ctx.strokeStyle = INK; ctx.strokeText(text, x, y);
  ctx.fillStyle = fill; ctx.fillText(text, x, y);
}
// 블록 한 칸 (왼쪽 위 x,y 에 크기 s)
function drawCell(x, y, s, col, alpha = 1, scale = 1) {
  const [base, hi, dark] = PALETTE[col];
  ctx.save(); ctx.globalAlpha = alpha;
  if (scale !== 1) { ctx.translate(x + s / 2, y + s / 2); ctx.scale(scale, scale); ctx.translate(-s / 2, -s / 2); x = 0; y = 0; }
  const g = 1.5, r = s * 0.22;
  roundRect(x + g, y + g + 2, s - g * 2, s - g * 2, r); ctx.fillStyle = INK; ctx.fill();            // 아래로 떨어진 그림자
  roundRect(x + g, y + g, s - g * 2, s - g * 2, r); ctx.fillStyle = base; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
  roundRect(x + g + 3, y + g + 3, s - g * 2 - 6, (s - g * 2) * 0.3, r * 0.6); ctx.fillStyle = hi; ctx.globalAlpha = alpha * 0.55; ctx.fill();
  ctx.globalAlpha = alpha; ctx.fillStyle = dark; ctx.globalAlpha = alpha * 0.25; roundRect(x + g + 2, y + s - g - 7, s - g * 2 - 4, 5, 3); ctx.fill();
  ctx.restore();
}
function drawShape(sh, col, x, y, s, alpha = 1) { for (const [r, c] of sh.cells) drawCell(x + c * s, y + r * s, s, col, alpha); }

function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (shakeT > 0) ctx.translate((Math.random() - 0.5) * 10 * shakeT * 2.5, (Math.random() - 0.5) * 6 * shakeT * 2.5);

  // 판 바탕
  roundRect(BX - 8, BY - 8, BOARD + 16, BOARD + 16, 20); ctx.fillStyle = INK; ctx.fill();
  roundRect(BX - 5, BY - 5, BOARD + 10, BOARD + 10, 17); ctx.fillStyle = '#3b2a7a'; ctx.fill();
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    roundRect(BX + c * CS + 2, BY + r * CS + 2, CS - 4, CS - 4, 7);
    ctx.fillStyle = (r + c) % 2 ? '#47348e' : '#43308a'; ctx.fill();                          // 칸마다 아주 살짝 번갈아
  }

  // 미리보기: 놓일 자리와 지워질 줄
  const tgt = state === 'play' ? dragTarget() : null;
  let pv = null;
  if (drag && tgt) {
    pv = L.previewClear(st, drag.slot, tgt.r, tgt.c);
    const flash = 0.18 + 0.12 * Math.sin(clock * 12);
    if (pv) {
      ctx.fillStyle = `rgba(255,235,120,${flash + 0.12})`;
      for (const r of pv.rows) { roundRect(BX, BY + r * CS + 1, BOARD, CS - 2, 8); ctx.fill(); }
      for (const c of pv.cols) { roundRect(BX + c * CS + 1, BY, CS - 2, BOARD, 8); ctx.fill(); }
    }
  }

  // 놓인 블록
  const popOf = new Map(pops.map((p) => [p.r * N + p.c, p]));
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const v = st.grid[r * N + c];
    if (v === -1) continue;
    const p = popOf.get(r * N + c);
    let sc = 1; if (p) sc = 1 + Math.sin(Math.min(1, p.t / 0.2) * Math.PI) * 0.18;
    const x = BX + c * CS, y = BY + r * CS;
    const inClear = pv && (pv.rows.includes(r) || pv.cols.includes(c));
    drawCell(x, y, CS, v, state === 'over' ? 0.55 : 1, sc);
    if (inClear) { ctx.fillStyle = 'rgba(255,255,255,.35)'; roundRect(x + 2, y + 2, CS - 4, CS - 4, 7); ctx.fill(); }
  }
  // 지워지는 칸
  for (const cl of clears) {
    const k = cl.t / 0.4;
    drawCell(BX + cl.c * CS, BY + cl.r * CS, CS, cl.col, 1 - k, 1 + k * 0.5);
    ctx.fillStyle = `rgba(255,255,255,${(1 - k) * 0.8})`; roundRect(BX + cl.c * CS + 2, BY + cl.r * CS + 2, CS - 4, CS - 4, 7); ctx.fill();
  }
  // 끌고 있는 블록이 놓일 자리 (그림자)
  if (drag && tgt) drawShape(drag.shape, L.colorOf(drag.shape.id), BX + tgt.c * CS, BY + tgt.r * CS, CS, 0.45);

  // 블록 놓는 자리
  for (let i = 0; i < 3; i++) {
    roundRect(slotX(i) + 2, TY, SLOT_W - 4, SLOT_H, 18); ctx.fillStyle = 'rgba(43,29,82,.35)'; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.setLineDash([7, 7]); ctx.stroke(); ctx.setLineDash([]);
    const id = st.tray[i];
    if (id === null || (drag && drag.slot === i)) continue;
    if (backAnim && backAnim.slot === i) continue;
    const sh = SHAPES[id];
    const k = Math.min(1, Math.max(0, trayIn[i]) / 0.25);
    const ease = 1 - Math.pow(1 - k, 3);
    const ox = slotX(i) + (SLOT_W - sh.w * TC) / 2, oy = TY + (SLOT_H - sh.h * TC) / 2 + (1 - ease) * 40;
    const playable = state === 'play' ? L.fits(st, sh) : true;
    ctx.save(); ctx.globalAlpha = (playable ? 1 : 0.4) * ease;
    drawShape(sh, L.colorOf(id), ox, oy, TC);
    ctx.restore();
  }
  // 제자리로 돌아가는 블록
  if (backAnim) {
    const sh = SHAPES[st.tray[backAnim.slot]], k = Math.min(1, backAnim.t / 0.18), e = 1 - Math.pow(1 - k, 3);
    const tx = slotX(backAnim.slot) + (SLOT_W - sh.w * TC) / 2, ty = TY + (SLOT_H - sh.h * TC) / 2;
    const s = CS + (TC - CS) * e;
    const x = backAnim.x + (tx - backAnim.x) * e - 0, y = backAnim.y + (ty - backAnim.y) * e;
    drawShape(sh, L.colorOf(sh.id), x + (sh.w * CS - sh.w * s) / 2 * (1 - e) * 0, y, s);
  }
  // 끌고 있는 블록: 손가락 위에 크게 떠 있다
  if (drag) {
    const sh = drag.shape;
    const x = drag.x - (sh.w * CS) / 2, y = drag.y - drag.bottomGap - sh.h * CS;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 8;
    drawShape(sh, L.colorOf(sh.id), x, y, CS);
    ctx.restore();
  }

  // 효과
  for (const p of particles) { ctx.globalAlpha = Math.min(1, p.life * 3); ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(p.x, p.y + 1, p.r + 1, 0, 7); ctx.fill(); ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); }
  ctx.globalAlpha = 1;
  for (const t of texts) { ctx.globalAlpha = Math.min(1, (0.9 - t.t) * 3); label(t.text, t.x, t.y, t.big ? 30 : 20, t.big ? '#ffd23f' : '#fff'); }
  ctx.globalAlpha = 1;
  if (banner) {
    const s = 1 + Math.max(0, 0.25 - banner.t) * 1.6;
    ctx.save(); ctx.globalAlpha = Math.min(1, (1.3 - banner.t) * 3); ctx.translate(W / 2, BY + BOARD * 0.28); ctx.scale(s, s);
    label(banner.text, 0, banner.sub ? -10 : 0, 40, '#ffd23f');
    if (banner.sub) label(banner.sub, 0, 28, 20, '#fff');
    ctx.restore();
  }
  ctx.restore();
}

// ---------- 루프 ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
  if (state !== 'paused') {
    clock += dt;
    for (const p of pops) p.t += dt; pops = pops.filter((p) => p.t < 0.25);
    for (const c of clears) c.t += dt; clears = clears.filter((c) => c.t < 0.4);
    for (const p of particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 520 * dt; } particles = particles.filter((p) => p.life > 0);
    for (const t of texts) { t.t += dt; t.y -= 34 * dt; } texts = texts.filter((t) => t.t < 0.9);
    if (banner) { banner.t += dt; if (banner.t > 1.3) banner = null; }
    for (let i = 0; i < 3; i++) trayIn[i] += dt;
    if (backAnim) { backAnim.t += dt; if (backAnim.t > 0.18) backAnim = null; }
    if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);
  }
  draw();
  requestAnimationFrame(frame);
}

// ---------- 오버레이 ----------
function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); o.scrollTop = 0; }
function hideOverlay() { $('overlay').classList.add('hidden'); }
function showTitle() {
  state = 'title';
  const s = loadSave();
  showOverlay(`
    <h1>블록<br>채우기</h1>
    <p>블록을 <b>끌어서</b> 판에 놓고,<br>가로나 세로 한 줄을 <b>꽉 채우면</b> 사라져요!</p>
    <div class="col">
      ${s ? `<button id="contBtn">▶ 이어서 하기<small>${s.score.toLocaleString()}점 · ${s.moves}개 놓음</small></button>` : ''}
      <button id="startBtn"${s ? ' class="sub"' : ''}>${s ? '새로 시작' : '시작하기'}</button>
    </div>
    <div class="card2">
      👆 아래 블록을 끌어서 판 위에 놓기 (손가락 위에 떠서 보여요)<br>
      ✨ 한 번에 많이 지울수록, 연달아 지울수록 큰 점수<br>
      🚫 블록은 돌릴 수 없어요 · 놓을 곳이 없으면 끝!
    </div>`);
  $('startBtn').onclick = () => startGame();
  const c = $('contBtn'); if (c) c.onclick = () => startGame(s);
}
function pause() {
  if (state !== 'play') return;
  state = 'paused'; drag = null; canvas.classList.remove('drag');
  showOverlay(`<h2>일시정지</h2><div class="col"><button id="contBtn">계속하기</button><button id="restartBtn" class="sub">새로 시작</button></div>`);
  $('contBtn').onclick = resume;
  $('restartBtn').onclick = () => startGame();
  save();
}
function resume() { if (state !== 'paused') return; state = 'play'; hideOverlay(); }

// ---------- 버튼·키 ----------
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
function toggleMute() { muted = !muted; store.set('blockMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'KeyP' || e.code === 'Escape') { state === 'paused' ? resume() : pause(); }
  else if (e.code === 'KeyM') toggleMute();
  else if ((e.code === 'Enter' || e.code === 'Space') && state === 'over' && !$('overlay').classList.contains('hidden')) { e.preventDefault(); startGame(); }
});
addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) { pause(); save(); } });
addEventListener('pagehide', save);

// 시작: 타이틀 뒤에 빈 판을 깔아 둔다
st = L.newGame(20241019); updateHud();
showTitle();
fit();
requestAnimationFrame(frame);

// 테스트용
window.__bk = { frame, draw, get st() { return st; }, get state() { return state; }, get drag() { return drag; }, startGame, doPlace, dragTarget, L, W, H, BX, BY, CS, TY, slotX, SLOT_W, SLOT_H, TC };
})();
