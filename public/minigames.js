// Міні-ігри для вкладки «Ігри». Працюють без інтернету й бази:
// рекорди зберігаються на цьому пристрої.
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (text, cls = "btn", onClick) => { const b = el("button", cls, text); b.type = "button"; if (onClick) b.addEventListener("click", onClick); return b; };
const rnd = n => Math.floor(Math.random() * n);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const KEYS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", s: "down", a: "left", d: "right", "ц": "up", "і": "down", "ф": "left", "в": "right" };

// Свайп пальцем: повертає напрям.
function onSwipe(node, fn) {
  let sx = 0, sy = 0, on = false;
  node.style.touchAction = "none";
  node.addEventListener("pointerdown", e => { on = true; sx = e.clientX; sy = e.clientY; });
  node.addEventListener("pointerup", e => {
    if (!on) return; on = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    fn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
  });
}

export function setupMiniGames(box, { store, toast }) {
  const best = k => store.get("mg.best." + k, 0);
  // lower = true — менше краще (ходи, мілісекунди).
  const record = (k, v, lower = false) => {
    const b = best(k);
    if (!b || (lower ? v < b : v > b)) { store.set("mg.best." + k, v); return true; }
    return false;
  };
  const picker = el("div", "chips mg-picker"), head = el("div", "mg-head"), stage = el("div", "mg-stage");
  box.append(picker, head, stage);
  let cur = null, game = null;

  const GAMES = {
    snake: ["🐍 Змійка", snake], memo: ["🧠 Мемо", memo], g2048: ["🔢 2048", g2048], react: ["⚡ Реакція", reaction],
    math: ["🧮 Швидкий рахунок", mathSprint], word: ["🔤 Вгадай слово", word], rps: ["✊ Камінь-ножиці-папір", rps]
  };
  function open(id) {
    if (!GAMES[id]) id = "snake";
    game && game.stop && game.stop();
    cur = id; store.set("mg.cur", id);
    picker.replaceChildren(...Object.entries(GAMES).map(([k, [t]]) => { const b = btn(t, "chip", () => open(k)); b.setAttribute("aria-pressed", String(k === id)); return b; }));
    head.replaceChildren(el("h3", null, GAMES[id][0]), el("span", "muted small mg-best"));
    stage.replaceChildren();
    game = GAMES[id][1](stage, txt => { head.querySelector(".mg-best").textContent = txt; }) || {};
  }
  document.addEventListener("keydown", e => {
    if (!game || !game.key || box.closest("[hidden]")) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName) && !document.activeElement.closest(".mg-stage")) return;
    const dir = KEYS[e.key] || KEYS[e.key.toLowerCase()];
    if (game.key(e.key, dir)) e.preventDefault();
  });
  open(store.get("mg.cur", "snake"));

  /* ---------- Змійка ---------- */
  function snake(st, setBest) {
    const N = 16, C = 20, cv = el("canvas", "mg-canvas"); cv.width = cv.height = N * C;
    cv.setAttribute("aria-label", "Поле змійки");
    const g = cv.getContext("2d"), info = el("p", "mg-info", "Стрілки, WASD, свайп або кнопки нижче.");
    const pad = el("div", "dpad");
    let body, dir, next, food, score, timer = null, over = true;
    const show = () => setBest(`Рекорд: ${best("snake")}`);
    const place = () => { do food = [rnd(N), rnd(N)]; while (body.some(([x, y]) => x === food[0] && y === food[1])); };
    function draw() {
      g.fillStyle = "#10142F"; g.fillRect(0, 0, cv.width, cv.height);
      g.fillStyle = "#FF7A82"; g.beginPath(); g.arc(food[0] * C + C / 2, food[1] * C + C / 2, C / 2 - 2, 0, 7); g.fill();
      body.forEach(([x, y], i) => { g.fillStyle = i ? "#4FD3EA" : "#FFC93C"; g.fillRect(x * C + 1, y * C + 1, C - 2, C - 2); });
    }
    function reset() {
      body = [[8, 8], [7, 8], [6, 8]]; dir = next = "right"; score = 0; over = false; place(); draw();
      info.textContent = "Рахунок: 0";
      clearInterval(timer); timer = setInterval(step, 130);
    }
    function step() {
      if (!(DIRS[next][0] === -DIRS[dir][0] && DIRS[next][1] === -DIRS[dir][1])) dir = next;
      const [dx, dy] = DIRS[dir], h = [(body[0][0] + dx + N) % N, (body[0][1] + dy + N) % N];
      if (body.some(([x, y]) => x === h[0] && y === h[1])) {
        clearInterval(timer); over = true;
        info.textContent = `Гру закінчено! Рахунок: ${score}` + (record("snake", score) && score ? " — новий рекорд! 🏆" : "");
        show(); start.textContent = "Ще раз"; return;
      }
      body.unshift(h);
      if (h[0] === food[0] && h[1] === food[1]) { score++; info.textContent = `Рахунок: ${score}`; place(); } else body.pop();
      draw();
    }
    const turn = d => { if (over) return; next = d; };
    const start = btn("Старт", "btn", reset);
    [["up", "⬆"], ["left", "⬅"], ["down", "⬇"], ["right", "➡"]].forEach(([d, t]) => { const b = btn(t, "icon-btn", () => turn(d)); b.dataset.d = d; b.setAttribute("aria-label", d); pad.append(b); });
    onSwipe(cv, turn);
    body = [[8, 8], [7, 8], [6, 8]]; food = [12, 8]; draw(); show();
    st.append(cv, info, el("div", "row mg-row", null), pad);
    st.querySelector(".mg-row").append(start);
    return { stop: () => clearInterval(timer), key: (k, d) => { if (d) { if (over && k.startsWith("Arrow")) return true; turn(d); return true; } if (k === " " && over) { reset(); return true; } return false; } };
  }

  /* ---------- Мемо ---------- */
  function memo(st, setBest) {
    const EM = ["🦊", "🐼", "🚀", "⚽", "🍕", "🎮", "🌈", "🦄"];
    const grid = el("div", "memo"), info = el("p", "mg-info");
    let cards, open1, lock, moves, found;
    const show = () => setBest(best("memo") ? `Рекорд: ${best("memo")} ходів` : "Рекорду ще немає");
    function reset() {
      cards = shuffle([...EM, ...EM]); open1 = null; lock = false; moves = 0; found = 0;
      grid.replaceChildren(...cards.map((e, i) => { const b = btn("❔", "memo-card", () => flip(i, b)); b.setAttribute("aria-label", `Картка ${i + 1}`); return b; }));
      info.textContent = "Знайди всі пари. Ходів: 0"; show();
    }
    function flip(i, b) {
      if (lock || b.classList.contains("open")) return;
      b.textContent = cards[i]; b.classList.add("open");
      if (!open1) { open1 = [i, b]; return; }
      moves++;
      const [j, a] = open1; open1 = null;
      if (cards[i] === cards[j]) {
        a.classList.add("done"); b.classList.add("done"); found++;
        if (found === EM.length) { info.textContent = `Усі пари за ${moves} ходів! 🎉` + (record("memo", moves, true) ? " Новий рекорд! 🏆" : ""); show(); return; }
      } else {
        lock = true;
        setTimeout(() => { [a, b].forEach(x => { x.textContent = "❔"; x.classList.remove("open"); }); lock = false; }, 750);
      }
      info.textContent = `Ходів: ${moves} · пар знайдено: ${found} з ${EM.length}`;
    }
    st.append(grid, info, btn("Нова гра", "btn ghost", reset));
    reset();
  }

  /* ---------- 2048 ---------- */
  function g2048(st, setBest) {
    const grid = el("div", "g2048"), info = el("p", "mg-info");
    let b, score, over;
    const show = () => setBest(`Рекорд: ${best("2048")}`);
    const add = () => { const free = []; b.forEach((v, i) => { if (!v) free.push(i); }); if (free.length) b[free[rnd(free.length)]] = Math.random() < .9 ? 2 : 4; };
    function draw() {
      grid.replaceChildren(...b.map(v => { const t = el("div", "tile t" + Math.min(v, 4096), v ? String(v) : ""); return t; }));
      info.textContent = over ? `Ходів більше немає. Рахунок: ${score}` : `Рахунок: ${score}` + (b.includes(2048) ? " · Є 2048! 🏆" : "");
    }
    function reset() { b = Array(16).fill(0); score = 0; over = false; add(); add(); draw(); show(); }
    const lineIdx = (d, k) => [0, 1, 2, 3].map(i => d === "left" ? k * 4 + i : d === "right" ? k * 4 + 3 - i : d === "up" ? i * 4 + k : (3 - i) * 4 + k);
    function move(d) {
      if (over) return;
      let moved = false;
      for (let k = 0; k < 4; k++) {
        const idx = lineIdx(d, k), vals = idx.map(i => b[i]).filter(Boolean), out = [];
        for (let i = 0; i < vals.length; i++) {
          if (vals[i] === vals[i + 1]) { out.push(vals[i] * 2); score += vals[i] * 2; i++; } else out.push(vals[i]);
        }
        while (out.length < 4) out.push(0);
        idx.forEach((p, i) => { if (b[p] !== out[i]) moved = true; b[p] = out[i]; });
      }
      if (!moved) return;
      add();
      const canMove = b.includes(0) || b.some((v, i) => (i % 4 < 3 && v === b[i + 1]) || (i < 12 && v === b[i + 4]));
      if (!canMove) { over = true; if (record("2048", score)) toast("Новий рекорд у 2048! 🏆"); show(); }
      else if (score > best("2048")) { record("2048", score); show(); }
      draw();
    }
    onSwipe(grid, move);
    st.append(grid, info, el("p", "muted small", "Стрілки або свайп. Зʼєднуй однакові числа!"), btn("Нова гра", "btn ghost", reset));
    reset();
    return { key: (k, d) => { if (d) { move(d); return true; } return false; } };
  }

  /* ---------- Реакція ---------- */
  function reaction(st, setBest) {
    const pad = btn("Натисни, щоб почати", "react-pad"), info = el("p", "mg-info", "Коли стане зелено — тисни якнайшвидше!");
    let state = "idle", t0 = 0, timer = null;
    const show = () => setBest(best("react") ? `Рекорд: ${best("react")} мс` : "Рекорду ще немає");
    const set = (s, text) => { state = s; pad.className = "react-pad " + s; pad.textContent = text; };
    pad.addEventListener("pointerdown", () => {
      if (state === "idle" || state === "done" || state === "early") {
        set("wait", "Чекай зеленого…");
        timer = setTimeout(() => { set("go", "ТИСНИ!"); t0 = performance.now(); }, 1200 + rnd(2800));
      } else if (state === "wait") { clearTimeout(timer); set("early", "Зарано! 😅 Натисни ще раз"); }
      else if (state === "go") {
        const ms = Math.round(performance.now() - t0);
        set("done", `${ms} мс`);
        info.textContent = (ms < 250 ? "Блискавка! ⚡" : ms < 350 ? "Добре! 👍" : "Можна швидше 🙂") + (record("react", ms, true) ? " Новий рекорд! 🏆" : "") + " Натисни, щоб ще раз.";
        show();
      }
    });
    st.append(pad, info); show();
    return { stop: () => clearTimeout(timer) };
  }

  /* ---------- Швидкий рахунок ---------- */
  function mathSprint(st, setBest) {
    const q = el("div", "pick-name", "60 секунд — скільки прикладів розвʼяжеш?");
    const form = el("form", "row"), inp = el("input"); inp.inputMode = "numeric"; inp.placeholder = "Відповідь"; inp.setAttribute("aria-label", "Відповідь"); inp.disabled = true;
    const go = btn("Старт"); go.type = "submit"; form.append(inp, go);
    const info = el("p", "mg-info");
    let ans = 0, score = 0, left = 0, timer = null, running = false;
    const show = () => setBest(`Рекорд: ${best("math")}`);
    function nextQ() {
      const op = rnd(3);
      let a, c, t;
      if (op === 0) { a = 5 + rnd(60); c = 5 + rnd(40); ans = a + c; t = `${a} + ${c}`; }
      else if (op === 1) { a = 20 + rnd(80); c = 1 + rnd(a - 1); ans = a - c; t = `${a} − ${c}`; }
      else { a = 2 + rnd(9); c = 2 + rnd(9); ans = a * c; t = `${a} × ${c}`; }
      q.textContent = t + " = ?"; inp.value = ""; inp.focus();
    }
    function end() {
      clearInterval(timer); running = false; inp.disabled = true; go.textContent = "Ще раз";
      q.textContent = `Час вийшов! Правильно: ${score}`;
      info.textContent = record("math", score) && score ? "Новий рекорд! 🏆" : ""; show();
    }
    form.addEventListener("submit", e => {
      e.preventDefault();
      if (!running) {
        running = true; score = 0; left = 60; inp.disabled = false; go.textContent = "OK"; nextQ();
        info.textContent = "Залишилось: 60 с · правильно: 0";
        timer = setInterval(() => { left--; info.textContent = `Залишилось: ${left} с · правильно: ${score}`; if (left <= 0) end(); }, 1000);
        return;
      }
      if (inp.value.trim() === "") return;
      if (Number(inp.value) === ans) { score++; inp.classList.remove("bad"); } else { inp.classList.add("bad"); setTimeout(() => inp.classList.remove("bad"), 300); }
      info.textContent = `Залишилось: ${left} с · правильно: ${score}`;
      nextQ();
    });
    st.append(q, form, info); show();
    return { stop: () => clearInterval(timer) };
  }

  /* ---------- Вгадай слово ---------- */
  function word(st, setBest) {
    const WORDS = [
      ["ПІДРУЧНИК", "школа"], ["ПЕРЕРВА", "школа"], ["ЩОДЕННИК", "школа"], ["КАНІКУЛИ", "школа"], ["ВЧИТЕЛЬКА", "школа"], ["ОЛІВЕЦЬ", "школа"],
      ["ДРІБ", "математика"], ["ТРИКУТНИК", "математика"], ["ДІЛЕННЯ", "математика"], ["ПЕРИМЕТР", "математика"], ["ВІДСОТОК", "математика"],
      ["МАТЕРИК", "географія"], ["ВУЛКАН", "географія"], ["ЕКВАТОР", "географія"], ["КАРПАТИ", "географія"], ["ДНІПРО", "географія"],
      ["ДІЄСЛОВО", "мова"], ["ПРИКМЕТНИК", "мова"], ["РЕЧЕННЯ", "мова"], ["АБЗАЦ", "мова"],
      ["КОЗАК", "історія"], ["ГЕТЬМАН", "історія"], ["КНЯЗЬ", "історія"], ["ФОТОСИНТЕЗ", "природа"], ["МАГНІТ", "природа"], ["ЖИРАФА", "тварини"], ["ДЕЛЬФІН", "тварини"]
    ];
    const ABC = "АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ";
    const shown = el("div", "word-shown"), hint = el("p", "small muted"), lives = el("p", "mg-info"), keys = el("div", "word-keys");
    let w, used, miss, streak = 0, done;
    const show = () => setBest(`Рекорд: ${best("word")} слів поспіль`);
    function draw() {
      shown.textContent = [...w].map(c => used.has(c) ? c : "_").join(" ");
      lives.textContent = done ? lives.textContent : `Життя: ${"❤️".repeat(6 - miss)}${"🤍".repeat(miss)} · серія: ${streak}`;
      keys.querySelectorAll("button").forEach(b => { b.disabled = done || used.has(b.textContent); b.classList.toggle("hit", used.has(b.textContent) && w.includes(b.textContent)); });
    }
    function reset() {
      const [x, h] = WORDS[rnd(WORDS.length)]; w = x; used = new Set(); miss = 0; done = false;
      hint.textContent = `Підказка: ${h} · ${w.length} літер`; draw(); show();
    }
    function guess(c) {
      if (done || used.has(c)) return;
      used.add(c);
      if (!w.includes(c)) miss++;
      if ([...w].every(x => used.has(x))) { done = true; streak++; lives.textContent = `Вгадав! 🎉 Серія: ${streak}` + (record("word", streak) ? " — новий рекорд! 🏆" : ""); show(); setTimeout(reset, 1600); }
      else if (miss >= 6) { done = true; lives.textContent = `Не вийшло 😢 Це було слово «${w}». Серію скинуто.`; streak = 0; used = new Set(w); }
      draw();
    }
    keys.append(...[...ABC].map(c => btn(c, "key", () => guess(c))));
    st.append(shown, hint, lives, keys, btn("Нове слово", "btn ghost", () => { if (!done) streak = 0; reset(); }));
    reset();
    return { key: k => { const c = k.toUpperCase(); if (c.length === 1 && ABC.includes(c)) { guess(c); return true; } return false; } };
  }

  /* ---------- Камінь-ножиці-папір ---------- */
  function rps(st, setBest) {
    const OPT = [["rock", "✊", "Камінь"], ["scissors", "✌️", "Ножиці"], ["paper", "✋", "Папір"]];
    const beats = { rock: "scissors", scissors: "paper", paper: "rock" };
    const arena = el("div", "pick-name", "Обери: ✊ ✌️ ✋"), info = el("p", "mg-info"), row = el("div", "row rps");
    let me = 0, cpu = 0, streak = 0;
    const show = () => setBest(`Рекорд: ${best("rps")} перемог поспіль`);
    OPT.forEach(([k, e, t]) => row.append(btn(`${e} ${t}`, "btn ghost", () => {
      const [ck, ce] = OPT[rnd(3)];
      let res;
      if (k === ck) res = "Нічия 🤝";
      else if (beats[k] === ck) { me++; streak++; res = "Ти виграв! 🎉"; if (record("rps", streak)) show(); }
      else { cpu++; streak = 0; res = "Компʼютер виграв 🤖"; }
      arena.textContent = `${e}  vs  ${ce}`;
      info.textContent = `${res} · Рахунок ${me} : ${cpu} · серія ${streak}`;
    })));
    st.append(arena, row, info); show();
  }
}
