import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, sendPasswordResetEmail, connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc,
  collection, query, where, orderBy, limit, onSnapshot, serverTimestamp, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, SCHOOL } from "./config.js";
import { HINTS } from "./hints.js";

/* ---------- Дрібниці ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const store = {
  get(k, d) { try { const v = localStorage.getItem("portal." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("portal." + k, JSON.stringify(v)); } catch {} }
};
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("show"), 2600);
}
const ROLE = { student: "Учень", teacher: "Вчитель", parent: "Батьки" };
const STATUS = { pending: ["на розгляді", "warn"], approved: ["схвалено", "ok"], rejected: ["відхилено", "bad"] };
const CLASSES = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const classOptions = (withSchool = false) =>
  (withSchool ? `<option value="0">Уся школа</option>` : "") + CLASSES.map(n => `<option value="${n}">${n} клас</option>`).join("");
const toDate = ts => (ts && typeof ts.toDate === "function") ? ts.toDate() : null;
const fmtTime = d => d ? d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" }) : "";
const fmtDay = d => d ? d.toLocaleDateString("uk-UA", { day: "numeric", month: "long" }) : "";
function pill(text, cls) { return el("span", "pill " + cls, text); }
function emptyEl(text) { return el("div", "empty", text); }
/* Кнопка, що просить підтвердження другим натисканням */
function confirmButton(label, cls, action) {
  const b = el("button", cls, label); b.type = "button";
  b.addEventListener("click", async () => {
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Точно?"; setTimeout(() => { b.dataset.armed = ""; b.textContent = label; }, 3000); return; }
    b.disabled = true;
    try { await action(); } catch (e) { console.error(e); toast("Не вдалося. Спробуй ще раз."); b.disabled = false; }
  });
  return b;
}

/* ---------- Тема й розмір тексту (зберігаються на пристрої) ---------- */
const root = document.documentElement;
const SKINS = [
  { id: "space", name: "Космос", note: "фіолетова класика", c: ["#0B0F2A", "#9C8CFF", "#FFC93C"] },
  { id: "neon", name: "Неон", note: "яскраве світіння", c: ["#05030F", "#FF2BD6", "#00F0FF"] },
  { id: "matrix", name: "Матриця", note: "зелений код", c: ["#020A04", "#39FF6A", "#7FBF8E"] },
  { id: "sunset", name: "Захід сонця", note: "теплі вогні", c: ["#1A0B14", "#FF8A3D", "#FF5C8A"] },
  { id: "ocean", name: "Океан", note: "глибока вода", c: ["#03141C", "#2EE6D6", "#4DA3FF"] }
];
const SIZES = [["normal", "Звичайний"], ["large", "Більший"], ["xl", "Великий"]];
function applyLook() {
  root.dataset.skin = store.get("skin", "space");
  root.dataset.size = store.get("size", "normal");
}
applyLook();
function renderSettings() {
  const box = $("#skins"); box.replaceChildren();
  SKINS.forEach(s => {
    const b = el("button", "skin"); b.type = "button";
    b.style.background = s.c[0];
    b.setAttribute("aria-pressed", String(root.dataset.skin === s.id));
    const sw = el("span", "swatches"); s.c.forEach(c => { const i = el("i"); i.style.background = c; sw.append(i); });
    b.append(sw, el("b", null, s.name), el("small", null, s.note));
    b.addEventListener("click", () => { store.set("skin", s.id); applyLook(); renderSettings(); });
    box.append(b);
  });
  $("#sizes").innerHTML = SIZES.map(([k, t]) => `<button class="chip" type="button" data-s="${k}" aria-pressed="${root.dataset.size === k}">${t}</button>`).join("");
  $$("#sizes .chip").forEach(c => c.addEventListener("click", () => { store.set("size", c.dataset.s); applyLook(); renderSettings(); }));
}
renderSettings();

/* ---------- Екрани ---------- */
const show = id => $$(".screen").forEach(s => s.hidden = s.id !== "s-" + id);
$$(".school-name").forEach(e => e.textContent = SCHOOL.name);
document.title = "Підпільний портал учнів";

/* ---------- Firebase ---------- */
const useEmu = new URLSearchParams(location.search).has("emulator") && ["localhost", "127.0.0.1"].includes(location.hostname);
const configured = !String(firebaseConfig.apiKey).startsWith("ВСТАВ");
if (!configured && !useEmu) {
  show("setup");
} else {
  start();
}

function start() {
  const app = initializeApp(useEmu ? { apiKey: "demo-key", authDomain: "demo-school.firebaseapp.com", projectId: "demo-school", appId: "demo" } : firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  if (useEmu) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }

  /* ----- Форма профілю (заявки) ----- */
  $$(".profile-fields").forEach(box => {
    box.append($("#tpl-profile").content.cloneNode(true));
    $$(".class-select", box).forEach(s => { s.innerHTML = classOptions(); s.value = "6"; });
    const form = box.closest("form");
    $$("input[name=role]", box).forEach(r => r.addEventListener("change", () => syncRole(form)));
  });
  function syncRole(form) {
    const r = form.querySelector("input[name=role]:checked").value;
    $$("[data-for]", form).forEach(e => e.hidden = e.dataset.for !== r);
  }
  function readProfile(form) {
    const v = n => (form.elements[n] && form.elements[n].value || "").trim();
    const role = form.querySelector("input[name=role]:checked").value;
    const d = { name: v("name"), role, status: "pending", createdAt: serverTimestamp() };
    if (d.name.length < 2) return [null, "Впиши прізвище та ім'я.", "name"];
    if (role === "student") d.cls = Number(v("cls"));
    if (role === "teacher") { d.subject = v("subject"); if (d.subject.length < 2) return [null, "Вкажіть предмет.", "subject"]; }
    if (role === "parent") { d.child = v("child"); d.childClass = Number(v("childClass")); if (d.child.length < 2) return [null, "Вкажіть ім'я дитини.", "child"]; }
    if (v("contact")) d.contact = v("contact");
    if (v("note")) d.note = v("note");
    return [d];
  }
  function fillProfile(form, p) {
    if (!p) return;
    const r = form.querySelector(`input[name=role][value="${p.role}"]`); if (r) r.checked = true;
    ["name", "subject", "child", "contact", "note"].forEach(k => { if (form.elements[k]) form.elements[k].value = p[k] || ""; });
    if (p.cls) form.elements.cls.value = String(p.cls);
    if (p.childClass) form.elements.childClass.value = String(p.childClass);
    syncRole(form);
  }
  const formErr = (form, msg) => { $(".err", form).textContent = msg || ""; };
  function authMessage(e) {
    const c = e && e.code || "";
    if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-login-credentials"].includes(c)) return "Невірна пошта або пароль.";
    if (c === "auth/email-already-in-use") return "Ця пошта вже зареєстрована. Увійди на вкладці «Вхід».";
    if (c === "auth/weak-password") return "Пароль закороткий: потрібно щонайменше 6 символів.";
    if (c === "auth/invalid-email" || c === "auth/missing-email") return "Перевір адресу електронної пошти.";
    if (c === "auth/too-many-requests") return "Забагато спроб. Зачекай кілька хвилин.";
    if (c === "auth/network-request-failed") return "Немає інтернету. Перевір з'єднання.";
    return "Щось пішло не так. Спробуй ще раз.";
  }

  /* ----- Вхід / реєстрація ----- */
  function authTab(which) {
    $("#t-login").setAttribute("aria-selected", String(which === "login"));
    $("#t-register").setAttribute("aria-selected", String(which === "register"));
    $("#f-login").hidden = which !== "login";
    $("#f-register").hidden = which !== "register";
  }
  $("#t-login").addEventListener("click", () => authTab("login"));
  $("#t-register").addEventListener("click", () => authTab("register"));

  $("#f-login").addEventListener("submit", async e => {
    e.preventDefault(); const f = e.target; formErr(f);
    const btn = $("button[type=submit]", f); btn.disabled = true;
    try { await signInWithEmailAndPassword(auth, $("#l-email").value.trim(), $("#l-pass").value); }
    catch (ex) { formErr(f, authMessage(ex)); }
    finally { btn.disabled = false; }
  });
  $("#b-reset").addEventListener("click", async () => {
    const f = $("#f-login"), email = $("#l-email").value.trim();
    if (!email) { formErr(f, "Впиши пошту, і ми надішлемо лист для зміни пароля."); $("#l-email").focus(); return; }
    try { await sendPasswordResetEmail(auth, email); formErr(f); toast("Лист для зміни пароля надіслано"); }
    catch (ex) { formErr(f, authMessage(ex)); }
  });

  let registering = false;
  $("#f-register").addEventListener("submit", async e => {
    e.preventDefault(); const f = e.target; formErr(f);
    const email = $("#r-email").value.trim(), pass = $("#r-pass").value;
    if (!email) { formErr(f, "Впиши електронну пошту."); return; }
    if (pass.length < 6) { formErr(f, "Пароль закороткий: потрібно щонайменше 6 символів."); return; }
    const [data, msg, field] = readProfile(f);
    if (!data) { formErr(f, msg); f.elements[field] && f.elements[field].focus(); return; }
    const btn = $("button[type=submit]", f); btn.disabled = true;
    registering = true;
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      try { await setDoc(doc(db, "users", cred.user.uid), data); }
      catch (ex) { console.error(ex); toast("Акаунт створено, але заявка не надійшла. Надішли її ще раз."); }
    } catch (ex) { formErr(f, authMessage(ex)); }
    finally { registering = false; btn.disabled = false; route(); }
  });

  $$("[data-logout]").forEach(b => b.addEventListener("click", () => signOut(auth)));

  /* ----- Стан сесії ----- */
  let me = null, profile, isAdmin = false, editing = false, inPortal = false;
  let sessionSubs = [], portalSubs = [];
  const stopPortal = () => {
    portalSubs.forEach(u => u()); portalSubs = []; chatUnsub && chatUnsub(); chatUnsub = null; inPortal = false;
    current = null; groups = []; dir = {}; dirReady = false; apps = []; appsReady = false;
  };
  const stopAll = () => { sessionSubs.forEach(u => u()); sessionSubs = []; stopPortal(); };

  onAuthStateChanged(auth, async user => {
    stopAll(); me = user; profile = undefined; isAdmin = false; editing = false;
    if (!user) { show("auth"); return; }
    show("loading"); watchLoading();
    await checkAdmin(user);
    if (me !== user) return;
    sessionSubs.push(onSnapshot(doc(db, "users", user.uid),
      s => { profile = s.exists() ? s.data({ serverTimestamps: "estimate" }) : null; route(); },
      e => { console.error(e); showError(e); }));
    // Призначення чи зняття модератора застосовується одразу.
    sessionSubs.push(onSnapshot(doc(db, "mods", user.uid), s => {
      const v = !isAdmin && s.exists();
      if (v === isMod) return;
      isMod = v;
      if (inPortal) { stopPortal(); route(); toast(v ? "Тебе призначено молодшим модератором" : "Тебе знято з модераторів"); }
    }, () => {}));
  });

  /* ----- Адміністратор ----- */
  // isOwner — головний адмін (повна влада), isAdmin — він або доданий у консолі,
  // isMod — молодший модератор (видаляє повідомлення, бачить модерацію).
  let ownerFree = false, isOwner = false, isMod = false, ownerUid = null;
  async function checkAdmin(user) {
    isAdmin = false; isOwner = false; isMod = false; ownerFree = false; ownerUid = null;
    try {
      const owner = await getDoc(doc(db, "meta", "owner"));
      ownerFree = !owner.exists();
      ownerUid = owner.exists() ? owner.data().uid : null;
      isOwner = ownerUid === user.uid;
      isAdmin = isOwner || (await getDoc(doc(db, "admins", user.uid))).exists();
      if (!isAdmin) isMod = (await getDoc(doc(db, "mods", user.uid))).exists();
    } catch (e) { console.error(e); }
    $$("[data-claim]").forEach(b => b.hidden = !ownerFree);
  }
  $$("[data-claim] button").forEach(b => b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      await setDoc(doc(db, "meta", "owner"), { uid: me.uid, createdAt: serverTimestamp() });
      toast("Тепер ти адміністратор порталу");
    } catch (e) { console.error(e); toast("Адміністратор уже є"); }
    await checkAdmin(me); b.disabled = false; route();
  }));

  // Замість нескінченного «Завантаження…» — зрозуміла помилка з підказкою.
  function showError(e) {
    const code = (e && e.code) || "";
    $("#err-text").textContent = code === "permission-denied"
      ? "База даних не пускає. Адміністратору: відкрий Firebase → Firestore Database → Rules, встав правила з файлу firestore.rules і натисни Publish."
      : code === "unavailable" || code === "failed-precondition"
        ? "Немає зв'язку з базою даних. Перевір інтернет. Якщо інтернет є — адміністратору варто перевірити, що в Firebase створено Firestore Database."
        : "Щось пішло не так. Спробуй оновити сторінку.";
    $("#err-code").textContent = code ? `Код помилки: ${code}` : "";
    show("error");
  }
  // Якщо за 20 секунд нічого не завантажилось — теж показуємо помилку.
  let loadTimer = null;
  const watchLoading = () => { clearTimeout(loadTimer); loadTimer = setTimeout(() => { if (!$("#s-loading").hidden) showError({ code: "unavailable" }); }, 20000); };

  function route() {
    if (registering || !me || profile === undefined) return;
    clearTimeout(loadTimer);
    if (profile && (isAdmin || profile.status === "approved")) { enterPortal(); return; }
    if (inPortal) { stopPortal(); if (profile) toast("Доступ до порталу закрито адміністратором"); }
    if (!profile) { openApply(null, null); return; }
    if (profile.status === "rejected") { openApply(profile, "Заявку відхилено. Виправ дані й надішли знову."); return; }
    if (editing) return;
    renderWait(); show("wait");
  }

  /* ----- Заявка для того, хто вже увійшов ----- */
  function openApply(p, note) {
    const f = $("#f-apply"); formErr(f);
    fillProfile(f, p);
    $("#apply-title").textContent = p ? "Виправ заявку" : "Заявка на вступ";
    $("#apply-note").hidden = !note; $("#apply-note").textContent = note || "";
    show("apply");
  }
  $("#f-apply").addEventListener("submit", async e => {
    e.preventDefault(); const f = e.target; formErr(f);
    const [data, msg, field] = readProfile(f);
    if (!data) { formErr(f, msg); f.elements[field] && f.elements[field].focus(); return; }
    const btn = $("button[type=submit]", f); btn.disabled = true;
    try { await setDoc(doc(db, "users", me.uid), data); editing = false; toast("Заявку надіслано"); route(); }
    catch (ex) { console.error(ex); formErr(f, "Не вдалося надіслати заявку. Перевір дані й інтернет."); }
    finally { btn.disabled = false; }
  });
  $("#b-edit").addEventListener("click", () => { editing = true; openApply(profile, null); });

  function profileRows(p) {
    const rows = [["Роль", ROLE[p.role] || "—"], ["Ім'я", p.name]];
    if (p.role === "student") rows.push(["Клас", `${p.cls} клас`]);
    if (p.role === "teacher") rows.push(["Предмет", p.subject]);
    if (p.role === "parent") rows.push(["Дитина", `${p.child}, ${p.childClass} клас`]);
    if (p.contact) rows.push(["Контакт", p.contact]);
    if (p.note) rows.push(["Коментар", p.note]);
    return rows;
  }
  function fillDetails(dl, p) {
    dl.replaceChildren();
    profileRows(p).forEach(([k, v]) => dl.append(el("dt", null, k), el("dd", null, v || "—")));
  }
  function renderWait() { fillDetails($("#wait-details"), profile); }

  /* ----- Портал ----- */
  const myClass = () => profile.role === "parent" ? profile.childClass : profile.role === "student" ? profile.cls : null;
  // Читати будь-який клас можуть адміністратор, модератори й учителі; писати в чужий клас модератор не може.
  const canPickClass = () => isAdmin || isMod || profile.role === "teacher";
  const canWriteClass = c => isAdmin || profile.role === "teacher" || c === myClass();
  const roleLabel = () => isOwner ? "головний адмін" : isAdmin ? "адміністратор" : isMod ? "мол. модератор" : ROLE[profile.role];
  let lastClass = null;

  function enterPortal() {
    const cls = myClass();
    $("#who").textContent = [profile.name, roleLabel(), cls ? `${cls} клас` : ""].filter(Boolean).join(" · ");
    if (inPortal) {
      if (cls !== lastClass) { lastClass = cls; hintCls = cls || hintCls; setupChat(); setupNewsForm(); renderNews(); setupSchedule(); renderHints(); setupTools(); libCls = cls || libCls; renderLibrary(); }
      return;
    }
    inPortal = true; lastClass = cls;
    show("portal");
    // Заявка самого адміністратора не має висіти серед нових.
    if (isAdmin && profile.status !== "approved") updateDoc(doc(db, "users", me.uid), { status: "approved", reviewedAt: serverTimestamp() }).catch(console.error);
    $(".tab[data-tab=admin]").hidden = !isAdmin;
    $(".tab[data-tab=mod]").hidden = !(isAdmin || isMod);
    startPresence();
    setupDirectory(); setupChat(); setupGroups(); setupNews(); setupSchedule(); setupHints(); setupTools(); setupLibrary();
    if (isAdmin) setupAdmin();
    if (isAdmin || isMod) setupModeration();
    openTab(store.get("tab", "chat"));
  }

  function openTab(id) {
    if (!$("#p-" + id) || (id === "admin" && !isAdmin) || (id === "mod" && !isAdmin && !isMod)) id = "chat";
    $$(".tab").forEach(t => t.setAttribute("aria-selected", String(t.dataset.tab === id)));
    $$(".panel").forEach(p => p.hidden = p.id !== "p-" + id);
    store.set("tab", id);
    if (id === "chat") scrollChat(true);
  }
  $$(".tab").forEach(t => t.addEventListener("click", () => openTab(t.dataset.tab)));

  /* ----- Список учасників (для запрошень і модерації) ----- */
  let dir = {}, dirReady = false;
  function setupDirectory() {
    portalSubs.push(onSnapshot(collection(db, "directory"), s => {
      dir = {}; s.docs.forEach(d => { dir[d.id] = d.data(); }); dirReady = true;
      if (!$("#f-group").hidden) renderPicker();
      const g = current && current.kind === "group" && groups.find(x => x.id === current.id);
      if (g) renderGroupBar(g);
      renderGroupRequests(); renderModeration(); syncDirectory(); renderPicker2();
    }, e => console.error(e)));
  }
  // Адміністратор підтримує список в актуальному стані: схвалені — є, інші — ні.
  function syncDirectory() {
    if (!isAdmin || !dirReady || !appsReady) return;
    apps.forEach(d => {
      const p = d.data();
      if (p.status === "approved") {
        const want = { name: p.name, role: p.role, cls: classOf(p) || null }, have = dir[d.id];
        if (!have || have.name !== want.name || have.role !== want.role || (have.cls || null) !== want.cls) setDoc(doc(db, "directory", d.id), want).catch(console.error);
      } else if (dir[d.id]) deleteDoc(doc(db, "directory", d.id)).catch(console.error);
    });
    Object.keys(dir).forEach(id => { if (!apps.some(d => d.id === id)) deleteDoc(doc(db, "directory", id)).catch(console.error); });
  }
  const who = ids => ids.map(u => u === me.uid ? "ти" : (dir[u] ? dir[u].name + (dir[u].cls ? ` (${dir[u].cls})` : "") : "…")).join(", ");

  /* ----- Чати: чат класу й окремі чати ----- */
  let chatUnsub = null, current = null, groups = [];
  function setupChat() {
    const sel = $("#chat-class");
    sel.innerHTML = classOptions();
    const startCls = canPickClass() ? (Number(store.get("chatCls", 0)) || myClass() || 1) : myClass();
    sel.value = String(startCls);
    if (!current || current.kind === "class") openClassChat(startCls);
    else renderSwitch();
  }
  $("#chat-class").addEventListener("change", e => { store.set("chatCls", Number(e.target.value)); openClassChat(Number(e.target.value)); });
  const classChatCls = () => canPickClass() ? Number($("#chat-class").value) : myClass();

  function renderSwitch() {
    const box = $("#chat-switch"); box.replaceChildren();
    const mk = (text, pressed, onClick, cls = "") => {
      const b = el("button", "chip" + cls, text); b.type = "button";
      b.setAttribute("aria-pressed", String(pressed)); b.addEventListener("click", onClick); box.append(b); return b;
    };
    const c = classChatCls();
    mk(c ? `Чат ${c} класу` : "Чат класу", !!current && current.kind === "class", () => openClassChat(classChatCls()));
    groups.filter(g => g.members.includes(me.uid)).sort((a, b) => a.name.localeCompare(b.name, "uk")).forEach(g => {
      if (g.status === "approved") { mk(g.name, !!current && current.kind === "group" && current.id === g.id, () => openGroupChat(g.id)); return; }
      const b = mk(g.name + (g.status === "pending" ? " · чекає" : " · відхилено"), false,
        () => toast(g.status === "pending" ? "Чат чекає схвалення адміністратора" : "Адміністратор відхилив цей чат"), " muted");
      b.append(el("span", "dot"));
    });
    mk("+ Новий чат", false, () => openGroupForm("create"), " add");
  }
  function setComposer(enabled, note) {
    $("#chat-text").disabled = !enabled;
    $("#f-chat button[type=submit]").disabled = !enabled;
    $("#f-chat").classList.toggle("off", !enabled);
    $("#chat-text").placeholder = enabled ? "Напиши повідомлення…" : note;
  }
  function listen(q, kind) {
    chatUnsub && chatUnsub();
    const box = $("#messages"); box.replaceChildren(emptyEl("Завантаження…"));
    chatUnsub = onSnapshot(q,
      s => renderMessages(s.docs.slice().reverse(), kind),
      e => { console.error(e); box.replaceChildren(emptyEl("Немає доступу до цього чату.")); });
  }
  function showChatBox() { $("#f-group").hidden = true; $("#chat-box").hidden = false; }
  function openClassChat(cls) {
    current = { kind: "class", cls };
    showChatBox();
    $("#chat-title").textContent = `Чат ${cls} класу`;
    $("#chat-class-wrap").hidden = !canPickClass();
    $("#group-bar").hidden = true;
    setComposer(canWriteClass(cls), "Тут можна лише читати — писати можна в чат свого класу");
    listen(query(collection(db, "classes", String(cls), "messages"), orderBy("createdAt", "desc"), limit(200)), "class");
    renderSwitch();
  }
  function openGroupChat(id) {
    const g = groups.find(x => x.id === id); if (!g) return;
    current = { kind: "group", id };
    showChatBox();
    $("#chat-title").textContent = g.name;
    $("#chat-class-wrap").hidden = true;
    renderGroupBar(g);
    setComposer(true);
    listen(query(collection(db, "groups", id, "messages"), orderBy("createdAt", "desc"), limit(200)), "group");
    renderSwitch();
  }
  function renderGroupBar(g) {
    $("#group-bar").hidden = !$("#f-group").hidden;
    $("#group-members").textContent = `Учасники (${g.members.length}): ${who(g.members)}` + ((g.invited || []).length ? ` · чекають схвалення: ${g.invited.length}` : "");
    $("#b-invite").hidden = g.owner !== me.uid;
  }
  $("#b-leave").addEventListener("click", async e => {
    const b = e.currentTarget;
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Точно вийти?"; setTimeout(() => { b.dataset.armed = ""; b.textContent = "Вийти з чату"; }, 3000); return; }
    b.dataset.armed = ""; b.textContent = "Вийти з чату";
    const g = current && groups.find(x => x.id === current.id); if (!g) return;
    try { await updateDoc(g.ref, { members: arrayRemove(me.uid) }); toast("Ти вийшов із чату"); openClassChat(classChatCls()); }
    catch (ex) { console.error(ex); toast("Не вдалося вийти з чату"); }
  });

  function setupGroups() {
    const q = isAdmin ? query(collection(db, "groups"), limit(500)) : query(collection(db, "groups"), where("members", "array-contains", me.uid));
    portalSubs.push(onSnapshot(q, s => {
      groups = s.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));
      if (current && current.kind === "group") {
        const g = groups.find(x => x.id === current.id);
        if (!g || !g.members.includes(me.uid) || g.status !== "approved") openClassChat(classChatCls());
        else { $("#chat-title").textContent = g.name; renderGroupBar(g); }
      }
      renderSwitch(); renderGroupRequests();
    }, e => console.error(e)));
  }

  function scrollChat(force) {
    const box = $("#messages");
    if (force || box.scrollHeight - box.scrollTop - box.clientHeight < 120) box.scrollTop = box.scrollHeight;
  }
  function renderMessages(docs, kind) {
    const box = $("#messages");
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    box.replaceChildren();
    if (!docs.length) { box.append(emptyEl("Тут ще тихо. Напиши перше повідомлення!")); return; }
    let lastDay = "";
    docs.forEach(d => {
      const m = d.data({ serverTimestamps: "estimate" });
      const when = toDate(m.createdAt);
      const day = fmtDay(when);
      if (day && day !== lastDay) { box.append(el("div", "day-sep", day)); lastDay = day; }
      const mine = m.uid === me.uid;
      const wrap = el("div", "msg" + (mine ? " mine" : ""));
      const meta = el("div", "meta");
      meta.append(el("b", null, mine ? "Ти" : m.name));
      if (kind === "group" && !mine && dir[m.uid] && dir[m.uid].cls) meta.append(el("span", null, `${dir[m.uid].cls} клас`));
      if (m.role && m.role !== "student") meta.append(el("span", null, ROLE[m.role]));
      meta.append(el("span", null, fmtTime(when)));
      if (mine || isAdmin || (isMod && kind === "class")) meta.append(confirmButton("видалити", "del", () => deleteDoc(d.ref)));
      wrap.append(meta, el("div", "txt", m.text));
      box.append(wrap);
    });
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }
  $("#f-chat").addEventListener("submit", async e => {
    e.preventDefault();
    const input = $("#chat-text"), text = input.value.trim();
    if (!text || !current) return;
    const col = current.kind === "class" ? collection(db, "classes", String(current.cls), "messages") : collection(db, "groups", current.id, "messages");
    input.value = "";
    try {
      await addDoc(col, { uid: me.uid, name: profile.name, role: profile.role, text: text.slice(0, 500), createdAt: serverTimestamp() });
      scrollChat(true);
    } catch (ex) { console.error(ex); input.value = text; toast("Повідомлення не надіслано"); }
  });

  /* ----- Створення чату й запрошення ----- */
  let gMode = "create", gSel = new Set(), gClass = "all";
  function openGroupForm(mode) {
    gMode = mode; gSel = new Set(); gClass = "all";
    const f = $("#f-group"); formErr(f);
    f.hidden = false; $("#chat-box").hidden = true; $("#group-bar").hidden = true; $("#chat-class-wrap").hidden = true;
    const g = mode === "invite" && current && groups.find(x => x.id === current.id);
    $("#chat-title").textContent = mode === "create" ? "Новий чат" : `Запросити в «${g ? g.name : ""}»`;
    $("#group-form-title").textContent = mode === "create" ? "Хто буде в чаті?" : "Кого ще запросити?";
    $("#g-name-wrap").hidden = mode !== "create";
    $("#g-name").value = ""; $("#g-search").value = "";
    renderPicker();
  }
  function closeGroupForm() {
    $("#f-group").hidden = true;
    if (current && current.kind === "group" && groups.some(x => x.id === current.id)) openGroupChat(current.id);
    else openClassChat(classChatCls());
  }
  $("#g-cancel").addEventListener("click", closeGroupForm);
  $("#b-invite").addEventListener("click", () => openGroupForm("invite"));
  $("#g-search").addEventListener("input", () => renderPicker());
  function renderPicker() {
    const g = gMode === "invite" && current && groups.find(x => x.id === current.id);
    const skip = new Set([me.uid, ...(g ? [...g.members, ...(g.invited || [])] : [])]);
    const people = Object.entries(dir).filter(([id]) => !skip.has(id));
    const classes = [...new Set(people.map(([, p]) => p.cls).filter(Boolean))].sort((a, b) => a - b);
    $("#g-class-filter").innerHTML = [["all", "Усі класи"], ...classes.map(c => [String(c), `${c} клас`])]
      .map(([k, t]) => `<button class="chip" type="button" data-f="${k}" aria-pressed="${k === gClass}">${t}</button>`).join("");
    $$("#g-class-filter .chip").forEach(c => c.addEventListener("click", () => { gClass = c.dataset.f; renderPicker(); }));
    const q = $("#g-search").value.trim().toLowerCase();
    const list = people
      .filter(([, p]) => (gClass === "all" || String(p.cls) === gClass) && (!q || p.name.toLowerCase().includes(q)))
      .sort((a, b) => (a[1].cls || 99) - (b[1].cls || 99) || a[1].name.localeCompare(b[1].name, "uk"));
    const box = $("#g-pick"); box.replaceChildren();
    if (!list.length) box.append(emptyEl(people.length ? "Нікого не знайдено." : "Поки немає кого запросити."));
    list.forEach(([id, p]) => {
      const lab = el("label"), cb = el("input");
      cb.type = "checkbox"; cb.checked = gSel.has(id); cb.value = id;
      cb.addEventListener("change", () => { if (cb.checked) gSel.add(id); else gSel.delete(id); $("#g-count").textContent = `Обрано: ${gSel.size}`; });
      lab.append(cb, el("span", null, p.name), el("small", null, p.cls ? `${p.cls} клас` : (ROLE[p.role] || "")));
      box.append(lab);
    });
    $("#g-count").textContent = `Обрано: ${gSel.size}`;
  }
  $("#f-group").addEventListener("submit", async e => {
    e.preventDefault(); const f = e.target; formErr(f);
    const name = $("#g-name").value.trim();
    if (gMode === "create" && name.length < 2) { formErr(f, "Придумай назву чату."); $("#g-name").focus(); return; }
    if (!gSel.size) { formErr(f, "Обери хоча б одну людину."); return; }
    if (gSel.size > 40) { formErr(f, "Не більше 40 людей за раз."); return; }
    const btn = $("#g-submit"); btn.disabled = true;
    try {
      if (gMode === "create") {
        await addDoc(collection(db, "groups"), { name, owner: me.uid, members: [me.uid], invited: [...gSel], status: "pending", createdAt: serverTimestamp() });
        toast("Чат надіслано адміну на схвалення");
      } else {
        const g = groups.find(x => x.id === current.id);
        await updateDoc(g.ref, { invited: [...new Set([...(g.invited || []), ...gSel])].slice(0, 40) });
        toast("Запрошення надіслано адміну на схвалення");
      }
      closeGroupForm();
    } catch (ex) { console.error(ex); formErr(f, "Не вдалося надіслати. Спробуй ще раз."); }
    finally { btn.disabled = false; }
  });

  /* ----- Підказки ----- */
  let hintCls = null;
  function setupHints() { hintCls = hintCls || myClass() || 6; renderHints(); }
  $("#hints-search").addEventListener("input", () => renderHints());
  function renderHints() {
    if (!hintCls) return;
    const mc = myClass();
    $("#hints-class").innerHTML = CLASSES.map(n => `<button class="chip" type="button" data-c="${n}" aria-pressed="${n === hintCls}">${n} клас${n === mc ? " · твій" : ""}</button>`).join("");
    $$("#hints-class .chip").forEach(c => c.addEventListener("click", () => { hintCls = Number(c.dataset.c); renderHints(); }));
    $("#hints-title").textContent = `Підказки · ${hintCls} клас`;
    const q = $("#hints-search").value.trim().toLowerCase();
    const list = (HINTS[hintCls] || []).filter(h => !q || (h.s + " " + h.t + " " + h.i.join(" ")).toLowerCase().includes(q));
    const box = $("#hints-list"); box.replaceChildren();
    if (!list.length) { box.append(emptyEl("Нічого не знайдено. Спробуй інше слово.")); return; }
    list.forEach(h => {
      const card = el("article", "card hint");
      const ul = el("ul"); h.i.forEach(t => ul.append(el("li", null, t)));
      card.append(el("span", "eyebrow", h.s), el("h3", null, h.t), ul);
      box.append(card);
    });
  }

  /* ----- Оголошення ----- */
  let news = [], newsFilter = "mine";
  function setupNews() {
    setupNewsForm();
    portalSubs.push(onSnapshot(query(collection(db, "announcements"), orderBy("createdAt", "desc"), limit(100)),
      s => { news = s.docs; renderNews(); },
      e => { console.error(e); $("#news-list").replaceChildren(emptyEl("Не вдалося завантажити оголошення.")); }));
  }
  function setupNewsForm() {
    const sel = $("#n-cls");
    if (canPickClass()) { sel.innerHTML = classOptions(true); sel.disabled = false; }
    else { sel.innerHTML = `<option value="${myClass()}">${myClass()} клас (твій)</option>`; sel.disabled = true; }
    if (!myClass() && newsFilter === "mine") newsFilter = "all";
  }
  function renderNews() {
    const mc = myClass();
    const filters = [...(mc ? [["mine", "Мій клас"]] : []), ["school", "Уся школа"], ["other", mc ? "Інші класи" : "Класи"], ["all", "Усі"]];
    $("#news-filter").innerHTML = filters.map(([k, t]) => `<button class="chip" type="button" data-f="${k}" aria-pressed="${k === newsFilter}">${t}</button>`).join("");
    $$("#news-filter .chip").forEach(c => c.addEventListener("click", () => { newsFilter = c.dataset.f; renderNews(); }));
    const list = news.filter(d => {
      const c = d.data().cls;
      return newsFilter === "all" || (newsFilter === "mine" && c === mc) || (newsFilter === "school" && c === 0) || (newsFilter === "other" && c !== 0 && c !== mc);
    });
    const box = $("#news-list"); box.replaceChildren();
    if (!list.length) { box.append(emptyEl("Оголошень поки немає.")); return; }
    list.forEach(d => {
      const n = d.data({ serverTimestamps: "estimate" });
      const card = el("article", "card post");
      const top = el("div", "top-line");
      top.append(el("h3", null, n.title), n.cls === 0 ? pill("Уся школа", "info") : pill(`${n.cls} клас` + (n.cls === mc ? " · твій" : ""), n.cls === mc ? "ok" : "warn"));
      const by = el("div", "by");
      const author = el("span", null, `${n.name} · ${ROLE[n.role] || ""}`);
      const right = el("span"); right.append(`${fmtDay(toDate(n.createdAt))} ${fmtTime(toDate(n.createdAt))}`);
      by.append(author, right);
      card.append(top, el("p", "txt", n.text), by);
      if (n.uid === me.uid || isAdmin || isMod) { const a = el("div", "acts"); a.append(confirmButton("Видалити", "btn ghost sm", () => deleteDoc(d.ref))); card.append(a); }
      box.append(card);
    });
  }
  $("#f-news").addEventListener("submit", async e => {
    e.preventDefault(); const f = e.target; formErr(f);
    const title = $("#n-title").value.trim(), text = $("#n-text").value.trim(), cls = Number($("#n-cls").value);
    if (title.length < 2) { formErr(f, "Додай заголовок."); return; }
    if (!text) { formErr(f, "Додай текст оголошення."); return; }
    const btn = $("button[type=submit]", f); btn.disabled = true;
    try {
      await addDoc(collection(db, "announcements"), { cls, title, text, uid: me.uid, name: profile.name, role: profile.role, createdAt: serverTimestamp() });
      $("#n-title").value = ""; $("#n-text").value = ""; toast("Оголошення опубліковано");
      newsFilter = cls === 0 ? "school" : cls === myClass() ? "mine" : "other"; renderNews();
    } catch (ex) { console.error(ex); formErr(f, "Не вдалося опублікувати. Можна писати лише для свого класу."); }
    finally { btn.disabled = false; }
  });

  /* ----- Розклад (поки є лише для 6 класу) ----- */
  const BELLS = [["09:00","09:40"],["09:50","10:30"],["10:40","11:20"],["11:30","12:10"],["12:20","13:00"],["13:10","13:50"],["14:30","15:10"]];
  const TIMETABLE = { 6: [
    ["Українська мова","Німецька мова","Технології","Математика","Українська література","Інформатика","Англійська мова"],
    ["Курс «Історія»","Математика","Українська мова","Українська мова","Інформатика","Фізична культура","Англійська мова"],
    ["Українська мова","Математика","Українська література","Пізнаємо природу","Фізична культура","Образотворче мистецтво","Англійська мова"],
    ["Математика","Музичне мистецтво","ЗБД","Зарубіжна література","Географія","Пізнаємо природу","Англійська мова"],
    ["Курс «Історія»","Німецька мова","Математика","Географія","Англійська мова","Проєктна діяльність","Фізична культура"]
  ] };
  const REGIME = [["08:30","08:45","Сніданок"],["10:30","10:40","Перерва · фруктівка"],["13:50","14:30","Обід"],["15:10","16:30","Самопідготовка · гуртки"],["16:30","16:45","Вечеря"],["16:45","18:00","Самопідготовка · гуртки"]];
  const DAYS = ["Понеділок", "Вівторок", "Середа", "Четвер", "П'ятниця"];
  const toMin = hm => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
  let schedCls = null, schedDay = [0, 1, 2, 3, 4].includes(new Date().getDay() - 1) ? new Date().getDay() - 1 : 0, lessonTimer = null;
  function setupSchedule() {
    schedCls = TIMETABLE[myClass()] ? myClass() : canPickClass() ? 6 : null;
    $("#sched-title").textContent = schedCls ? `Розклад ${schedCls} класу` : "Розклад";
    renderSchedule();
    clearInterval(lessonTimer); updateLesson(); lessonTimer = setInterval(updateLesson, 20000);
    portalSubs.push(() => { clearInterval(lessonTimer); $("#lesson").textContent = ""; });
  }
  function renderSchedule() {
    const body = $("#sched-body"); body.replaceChildren();
    $("#day-chips").innerHTML = schedCls ? DAYS.map((d, i) => `<button class="chip" type="button" data-d="${i}" aria-pressed="${i === schedDay}">${d.slice(0, 2)}</button>`).join("") : "";
    $$("#day-chips .chip").forEach(c => c.addEventListener("click", () => { schedDay = Number(c.dataset.d); renderSchedule(); }));
    if (!schedCls) { body.append(emptyEl(`Розклад для ${myClass()} класу ще не додано. Попроси адміністратора.`)); return; }
    const card = el("div", "card"); card.append(el("p", "eyebrow", DAYS[schedDay]));
    const rows = [...TIMETABLE[schedCls][schedDay].map((s, i) => ({ a: BELLS[i][0], b: BELLS[i][1], n: String(i + 1), s, extra: false })),
      ...REGIME.map(r => ({ a: r[0], b: r[1], n: "", s: r[2], extra: true }))].sort((x, y) => toMin(x.a) - toMin(y.a));
    const now = new Date(), mins = now.getHours() * 60 + now.getMinutes(), today = now.getDay() - 1 === schedDay;
    rows.forEach(r => {
      const row = el("div", "lesson" + (r.extra ? " extra" : "") + (today && mins >= toMin(r.a) && mins < toMin(r.b) ? " now" : ""));
      row.append(el("span", "n", r.n), el("span", "t", `${r.a}–${r.b}`), el("span", "s", r.s));
      card.append(row);
    });
    body.append(card);
  }
  function updateLesson() {
    const out = $("#lesson"); out.textContent = "";
    if (!schedCls) return;
    const now = new Date(), wd = now.getDay(), mins = now.getHours() * 60 + now.getMinutes();
    if (wd === 0 || wd === 6) { out.textContent = "Вихідний! Уроки — у понеділок о 09:00"; return; }
    const day = TIMETABLE[schedCls][wd - 1];
    for (let i = 0; i < day.length; i++) {
      const a = toMin(BELLS[i][0]), b = toMin(BELLS[i][1]);
      if (mins >= a && mins < b) { out.textContent = `Іде ${i + 1}-й урок: ${day[i]} · до дзвоника ${b - mins} хв`; return; }
      if (mins < a) { out.textContent = `Далі ${i + 1}-й урок: ${day[i]} о ${BELLS[i][0]} (через ${a - mins} хв)`; return; }
    }
    const r = REGIME.find(x => mins >= toMin(x[0]) && mins < toMin(x[1]));
    out.textContent = r ? `${r[2]} · до ${r[1]}` : "Уроки на сьогодні закінчились";
  }

  /* ----- Заявки (лише адміністратор) ----- */
  let apps = [], appFilter = "pending", appsReady = false;
  function setupAdmin() {
    portalSubs.push(onSnapshot(query(collection(db, "users"), orderBy("createdAt", "desc"), limit(500)),
      s => { apps = s.docs; appsReady = true; renderAdmin(); syncDirectory(); },
      e => { console.error(e); $("#admin-list").replaceChildren(emptyEl("Не вдалося завантажити заявки.")); }));
  }
  function renderAdmin() {
    appPending = apps.filter(d => d.data().status === "pending").length;
    updateAdminBadge();
    const filters = [["pending", "Нові"], ["approved", "Схвалені"], ["rejected", "Відхилені"], ["all", "Усі"]];
    $("#admin-filter").innerHTML = filters.map(([k, t]) => `<button class="chip" type="button" data-f="${k}" aria-pressed="${k === appFilter}">${t}</button>`).join("");
    $$("#admin-filter .chip").forEach(c => c.addEventListener("click", () => { appFilter = c.dataset.f; renderAdmin(); }));
    const list = apps.filter(d => appFilter === "all" || d.data().status === appFilter);
    const box = $("#admin-list"); box.replaceChildren();
    if (!list.length) { box.append(emptyEl(appFilter === "pending" ? "Нових заявок немає." : "Тут порожньо.")); return; }
    list.forEach(d => {
      const p = d.data({ serverTimestamps: "estimate" });
      const card = el("article", "card post");
      const top = el("div", "top-line");
      const [st, sc] = STATUS[p.status] || STATUS.pending;
      top.append(el("h3", null, `${ROLE[p.role] || ""} · ${p.name}`), pill(st, sc));
      const dl = el("dl", "details"); fillDetails(dl, p);
      const acts = el("div", "acts");
      const set = status => async () => { await updateDoc(d.ref, { status, reviewedAt: serverTimestamp() }); toast(status === "approved" ? "Заявку схвалено" : "Заявку відхилено"); };
      if (p.status !== "approved") { const b = el("button", "btn okb sm", "Схвалити"); b.type = "button"; b.addEventListener("click", async () => { b.disabled = true; try { await set("approved")(); } catch (ex) { console.error(ex); toast("Не вдалося"); b.disabled = false; } }); acts.append(b); }
      if (p.status !== "rejected" && d.id !== me.uid) acts.append(confirmButton(p.status === "approved" ? "Закрити доступ" : "Відхилити", "btn badb sm", set("rejected")));
      if (d.id !== me.uid) acts.append(confirmButton("Видалити", "btn ghost sm", async () => { await deleteDoc(d.ref); toast("Заявку видалено"); }));
      card.append(top, el("span", "by", `Подано ${fmtDay(toDate(p.createdAt))} ${fmtTime(toDate(p.createdAt))}`), dl, acts);
      box.append(card);
    });
  }

  /* ----- Хто й коли заходив ----- */
  function startPresence() {
    const touch = () => { if (me && document.visibilityState === "visible") setDoc(doc(db, "presence", me.uid), { lastSeen: serverTimestamp() }).catch(console.error); };
    touch();
    const timer = setInterval(touch, 4 * 60 * 1000);
    const onVis = () => { if (document.visibilityState === "visible") touch(); };
    document.addEventListener("visibilitychange", onVis);
    portalSubs.push(() => { clearInterval(timer); document.removeEventListener("visibilitychange", onVis); });
  }

  /* ----- Бібліотека ----- */
  // Перевірені безкоштовні джерела. ВШО — офіційна платформа МОН, УкрЛіб — тексти шкільної програми.
  const OFFICIAL = c => [
    c >= 2 && { icon: "🎓", title: "Всеукраїнська школа онлайн", note: `Уроки, конспекти й тести за програмою ${c} класу. Офіційна платформа МОН, безкоштовна.`, url: "https://lms.e-school.net.ua/course_category/" },
    c >= 5 && { icon: "📖", title: `Українська література · ${c} клас`, note: "Тексти всіх творів шкільної програми.", url: `https://www.ukrlib.com.ua/school/?klas=${c}` },
    c >= 5 && { icon: "🌍", title: `Зарубіжна література · ${c} клас`, note: "Твори зарубіжних авторів з програми.", url: `https://www.ukrlib.com.ua/school-zl/?klas=${c}` },
    c < 5 && { icon: "🧚", title: "Українські народні казки", note: "Казки, легенди й загадки.", url: "https://www.ukrlib.com.ua/narod/" },
    { icon: "🎧", title: "Аудіокниги", note: "Слухай твори української літератури.", url: "https://www.ukrlib.com.ua/audio/" }
  ].filter(Boolean);
  let libCls = null, libSubject = "all", books = [];
  const canAddBooks = () => isAdmin || isMod;
  function setupLibrary() {
    libCls = libCls || myClass() || 6;
    $("#f-book").hidden = !canAddBooks();
    $("#b-cls").innerHTML = `<option value="0">Усі класи</option>` + classOptions();
    portalSubs.push(onSnapshot(query(collection(db, "books"), orderBy("createdAt", "desc"), limit(500)),
      s => { books = s.docs; renderLibrary(); },
      e => { console.error(e); $("#lib-books").replaceChildren(emptyEl("Не вдалося завантажити книги.")); }));
    renderLibrary();
  }
  $("#lib-search").addEventListener("input", () => renderLibrary());
  function renderLibrary() {
    if (!libCls) return;
    const mc = myClass();
    $("#lib-title").textContent = `Бібліотека · ${libCls} клас`;
    $("#lib-class").innerHTML = CLASSES.map(n => `<button class="chip" type="button" data-c="${n}" aria-pressed="${n === libCls}">${n} клас${n === mc ? " · твій" : ""}</button>`).join("");
    $$("#lib-class .chip").forEach(c => c.addEventListener("click", () => { libCls = Number(c.dataset.c); libSubject = "all"; $("#b-cls").value = String(libCls); renderLibrary(); }));
    const q = $("#lib-search").value.trim().toLowerCase();
    const off = $("#lib-official"); off.replaceChildren();
    OFFICIAL(libCls).filter(r => !q || (r.title + " " + r.note).toLowerCase().includes(q)).forEach(r => {
      const card = el("article", "card res");
      const a = el("a", "btn sm", "Відкрити"); a.href = r.url; a.target = "_blank"; a.rel = "noopener";
      card.append(el("span", "eyebrow", r.icon + " Офіційне джерело"), el("h3", null, r.title), el("p", "small muted", r.note), a);
      off.append(card);
    });
    const forClass = books.map(d => ({ d, b: d.data() })).filter(x => x.b.cls === libCls || x.b.cls === 0);
    const subjects = [...new Set(forClass.map(x => x.b.subject))].sort((a, b) => a.localeCompare(b, "uk"));
    if (libSubject !== "all" && !subjects.includes(libSubject)) libSubject = "all";
    $("#lib-subjects").innerHTML = subjects.length ? [["all", "Усі предмети"], ...subjects.map(s => [s, s])].map(([k, t]) => `<button class="chip" type="button" data-s="${esc(k)}" aria-pressed="${k === libSubject}">${esc(t)}</button>`).join("") : "";
    $$("#lib-subjects .chip").forEach(c => c.addEventListener("click", () => { libSubject = c.dataset.s; renderLibrary(); }));
    $("#b-subjects").innerHTML = [...new Set([...subjects, ...SUBJECTS_LIST])].map(s => `<option value="${esc(s)}">`).join("");
    const list = forClass
      .filter(x => libSubject === "all" || x.b.subject === libSubject)
      .filter(x => !q || [x.b.title, x.b.author || "", x.b.subject].join(" ").toLowerCase().includes(q))
      .sort((a, b) => a.b.subject.localeCompare(b.b.subject, "uk") || a.b.title.localeCompare(b.b.title, "uk"));
    const box = $("#lib-books"); box.replaceChildren();
    if (!list.length) { box.append(emptyEl(canAddBooks() ? "Тут ще немає книг. Додай першу у формі нижче." : "Тут ще немає книг. Адмін скоро додасть.")); return; }
    list.forEach(({ d, b }) => {
      const card = el("article", "card book");
      const a = el("a", null, b.title); a.href = b.url; a.target = "_blank"; a.rel = "noopener";
      const info = el("div"); info.append(a, el("small", null, [b.subject, b.author, b.cls ? `${b.cls} клас` : "усі класи"].filter(Boolean).join(" · ")));
      card.append(el("span", "ic", "📘"), info);
      if (canAddBooks()) card.append(confirmButton("Видалити", "btn ghost sm", () => deleteDoc(d.ref)));
      else card.append(el("span"));
      box.append(card);
    });
  }
  const SUBJECTS_LIST = ["Математика", "Алгебра", "Геометрія", "Українська мова", "Українська література", "Зарубіжна література", "Англійська мова", "Німецька мова", "Історія", "Географія", "Біологія", "Фізика", "Хімія", "Пізнаємо природу", "Інформатика", "Мистецтво", "ЗБД"];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  $("#f-book").addEventListener("submit", async e => {
    e.preventDefault(); const f = e.target; formErr(f);
    const title = $("#b-title").value.trim(), subject = $("#b-subject").value.trim(), author = $("#b-author").value.trim(), url = $("#b-url").value.trim();
    const cls = Number($("#b-cls").value);
    if (title.length < 2) { formErr(f, "Впиши назву книги."); return; }
    if (subject.length < 2) { formErr(f, "Вкажи предмет."); return; }
    if (!/^https:\/\/\S+$/.test(url)) { formErr(f, "Посилання має починатися з https://"); return; }
    const btn = $("button[type=submit]", f); btn.disabled = true;
    try {
      const data = { title, subject, cls, url, uid: me.uid, name: profile.name, createdAt: serverTimestamp() };
      if (author) data.author = author;
      await addDoc(collection(db, "books"), data);
      ["b-title", "b-author", "b-url"].forEach(id => $("#" + id).value = "");
      toast("Книгу додано");
    } catch (ex) { console.error(ex); formErr(f, "Не вдалося додати. Перевір дані."); }
    finally { btn.disabled = false; }
  });

  /* ----- Корисне ----- */
  let toolsReady = false;
  function setupTools() {
    // Telegram з домашкою — лише для свого класу, якщо посилання вказане в config.js
    const tg = (SCHOOL.telegram || {})[myClass()];
    $("#t-telegram").hidden = !tg;
    if (tg) $("#tg-link").href = tg;
    renderPicker2();
    if (toolsReady) return;
    toolsReady = true;
    setupGradeCalc(); setupBreaks(); setupPomodoro(); setupConverter(); setupTrainer();
    $("#rp-go").addEventListener("click", pickRandom);
  }

  // Калькулятор оцінок
  function setupGradeCalc() {
    $("#gc-target").innerHTML = Array.from({ length: 12 }, (_, i) => 12 - i).map(n => `<option ${n === 10 ? "selected" : ""}>${n}</option>`).join("");
    ["gc-grades", "gc-target", "gc-left"].forEach(id => $("#" + id).addEventListener("input", calcGrades));
    $("#gc-grades").value = store.get("grades", "");
    calcGrades();
  }
  function calcGrades() {
    const raw = $("#gc-grades").value; store.set("grades", raw);
    const cur = raw.split(/[,\s;]+/).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 12);
    const target = Number($("#gc-target").value), n = Number($("#gc-left").value), out = $("#gc-result");
    if (!cur.length) { out.textContent = "Впиши свої оцінки — порахую, що треба отримати."; return; }
    const sem = a => Math.min(12, Math.max(1, Math.floor(a.reduce((x, y) => x + y, 0) / a.length + 0.5)));
    const need = Math.ceil(((target - 0.5) * (cur.length + n) - cur.reduce((x, y) => x + y, 0)) / n - 1e-9);
    out.replaceChildren();
    if (need <= 1) { out.append(el("span", "num", "✓"), `«${target}» майже в кишені: навіть з 1 вийде не нижче.`); }
    else if (need > 12) { const best = sem([...cur, ...Array(n).fill(12)]); out.append(el("span", "num", String(best)), `Навіть з усіма «12» вийде максимум ${best}. Спитай учителя про додаткову роботу.`); }
    else out.append(el("span", "num", String(need)), `Треба щонайменше ${need}${n > 1 ? ` за кожну з ${n} робіт` : " за наступну роботу"}, щоб вийшло ${target}.`);
  }

  // Відлік до канікул
  function setupBreaks() {
    const tick = () => {
      const now = new Date();
      const next = (SCHOOL.breaks || []).map(b => ({ ...b, start: new Date(b.from + "T00:00:00"), end: new Date(b.to + "T23:59:59") })).find(b => b.end > now);
      if (!next) { $("#br-name").textContent = "Канікули ще не вказані"; return; }
      const fmt = d => d.toLocaleDateString("uk-UA", { day: "numeric", month: "long" });
      $("#br-dates").textContent = `${fmt(next.start)} — ${fmt(next.end)} (орієнтовно)`;
      if (next.start <= now) { $("#br-name").textContent = `${next.name} уже йдуть! 🎉`; ["d", "h", "m"].forEach(k => $("#br-" + k).textContent = "0"); return; }
      $("#br-name").textContent = `До: ${next.name.toLowerCase()}`;
      let s = Math.floor((next.start - now) / 1000);
      $("#br-d").textContent = Math.floor(s / 86400); s %= 86400;
      $("#br-h").textContent = Math.floor(s / 3600); s %= 3600;
      $("#br-m").textContent = Math.floor(s / 60);
    };
    tick(); setInterval(tick, 30000);
  }

  // Таймер 25/5
  let pmLeft = 25 * 60, pmWork = true, pmTimer = null;
  function beep() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      [880, 1175, 1568].forEach((f, i) => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f; o.connect(g); g.connect(ac.destination); const t = ac.currentTime + i * .25; g.gain.setValueAtTime(.2, t); g.gain.exponentialRampToValueAtTime(.001, t + .3); o.start(t); o.stop(t + .35); });
    } catch {}
  }
  function pmShow() {
    $("#pm-time").textContent = `${String(Math.floor(pmLeft / 60)).padStart(2, "0")}:${String(pmLeft % 60).padStart(2, "0")}`;
    $("#pm-mode").textContent = pmWork ? "Робота · 25 хв" : "Перерва · 5 хв";
  }
  function setupPomodoro() {
    $("#pm-start").addEventListener("click", () => {
      if (pmTimer) { clearInterval(pmTimer); pmTimer = null; $("#pm-start").textContent = "Продовжити"; return; }
      $("#pm-start").textContent = "Пауза";
      pmTimer = setInterval(() => {
        pmLeft--;
        if (pmLeft <= 0) { beep(); pmWork = !pmWork; pmLeft = (pmWork ? 25 : 5) * 60; toast(pmWork ? "Перерва скінчилась — до роботи!" : "Час відпочити 5 хвилин"); }
        pmShow();
      }, 1000);
    });
    $("#pm-reset").addEventListener("click", () => { clearInterval(pmTimer); pmTimer = null; pmWork = true; pmLeft = 25 * 60; $("#pm-start").textContent = "Старт"; pmShow(); });
    pmShow();
  }

  // Перетворювач одиниць (усе зводимо до базової одиниці)
  const UNITS = {
    "Довжина": { "мм": 0.001, "см": 0.01, "дм": 0.1, "м": 1, "км": 1000 },
    "Маса": { "г": 0.001, "кг": 1, "ц": 100, "т": 1000 },
    "Час": { "с": 1, "хв": 60, "год": 3600, "доба": 86400, "тиждень": 604800 },
    "Площа": { "см²": 0.0001, "дм²": 0.01, "м²": 1, "а (сотка)": 100, "га": 10000, "км²": 1000000 }
  };
  let cvKind = "Довжина";
  function setupConverter() {
    const fill = () => {
      $("#cv-kind").innerHTML = Object.keys(UNITS).map(k => `<button class="chip" type="button" data-k="${k}" aria-pressed="${k === cvKind}">${k}</button>`).join("");
      $$("#cv-kind .chip").forEach(c => c.addEventListener("click", () => { cvKind = c.dataset.k; fill(); }));
      const names = Object.keys(UNITS[cvKind]);
      $("#cv-from").innerHTML = names.map(n => `<option>${n}</option>`).join("");
      $("#cv-to").innerHTML = names.map(n => `<option>${n}</option>`).join("");
      $("#cv-from").value = names[cvKind === "Час" ? 2 : 3] || names[0]; $("#cv-to").value = names[cvKind === "Час" ? 1 : 1];
      convert();
    };
    ["cv-val", "cv-from", "cv-to"].forEach(id => $("#" + id).addEventListener("input", convert));
    fill();
  }
  function convert() {
    const v = Number(String($("#cv-val").value).replace(",", ".")), u = UNITS[cvKind];
    const from = $("#cv-from").value, to = $("#cv-to").value;
    if (!Number.isFinite(v)) { $("#cv-result").textContent = "Впиши число"; return; }
    const r = v * u[from] / u[to];
    const nice = Number.isInteger(r) ? r : Number(r.toPrecision(8));
    $("#cv-result").textContent = `${String(v).replace(".", ",")} ${from} = ${nice.toLocaleString("uk-UA", { maximumFractionDigits: 8 })} ${to}`;
  }

  // Хто відповідає?
  function classmates() {
    const c = myClass();
    return Object.entries(dir).filter(([, p]) => c ? p.cls === c : true).map(([, p]) => p.name);
  }
  function renderPicker2() {
    const n = classmates().length;
    $("#rp-note").textContent = n ? `Обираю з ${n} ${myClass() ? `учнів ${myClass()} класу` : "учасників"} порталу.` : "Список з'явиться, коли однокласники приєднаються до порталу.";
  }
  function pickRandom() {
    const names = classmates();
    if (!names.length) { renderPicker2(); return; }
    let i = 0; const btn = $("#rp-go"); btn.disabled = true;
    const spin = setInterval(() => {
      $("#rp-name").textContent = names[Math.floor(Math.random() * names.length)];
      if (++i > 14) { clearInterval(spin); btn.disabled = false; }
    }, 70);
  }

  // Тренажер таблиці множення
  let mt = null;
  function setupTrainer() {
    const next = () => { mt.a = 2 + Math.floor(Math.random() * 8); mt.b = 2 + Math.floor(Math.random() * 8); $("#mt-q").textContent = `${mt.a} × ${mt.b} = ?`; $("#mt-a").value = ""; $("#mt-a").focus(); };
    $("#mt-form").addEventListener("submit", e => {
      e.preventDefault();
      if (!mt) { mt = { n: 0, ok: 0, t0: Date.now() }; $("#mt-a").disabled = false; $("#mt-btn").textContent = "Відповісти"; $("#mt-score").textContent = "Приклад 1 з 10"; next(); return; }
      const ans = Number($("#mt-a").value);
      if (!$("#mt-a").value.trim()) return;
      const right = ans === mt.a * mt.b;
      if (right) mt.ok++; else toast(`${mt.a} × ${mt.b} = ${mt.a * mt.b}`);
      mt.n++;
      if (mt.n >= 10) {
        const sec = Math.round((Date.now() - mt.t0) / 1000);
        $("#mt-q").textContent = mt.ok === 10 ? "Ідеально! 🏆" : `${mt.ok} з 10`;
        $("#mt-score").textContent = `Правильно: ${mt.ok} з 10 за ${sec} с. Ще раз?`;
        $("#mt-a").disabled = true; $("#mt-btn").textContent = "Почати"; mt = null; return;
      }
      $("#mt-score").textContent = `Приклад ${mt.n + 1} з 10 · правильно ${mt.ok}`;
      next();
    });
  }

  /* ----- Чати й запрошення на схвалення (адміністратор) ----- */
  let appPending = 0, groupPending = 0;
  function updateAdminBadge() {
    const n = appPending + groupPending, badge = $("#pending-count");
    badge.textContent = n; badge.hidden = !n;
  }
  function renderGroupRequests() {
    if (!isAdmin || !inPortal) return;
    const pend = groups.filter(g => g.status === "pending");
    const inv = groups.filter(g => g.status === "approved" && (g.invited || []).length);
    groupPending = pend.length + inv.length;
    $("#group-req-count").textContent = groupPending;
    updateAdminBadge();
    const box = $("#group-requests"); box.replaceChildren();
    if (!groupPending) { box.append(emptyEl("Нових чатів і запрошень немає.")); return; }
    const card = (g, title, lines, approve, reject) => {
      const c = el("article", "post");
      const top = el("div", "top-line"); top.append(el("h3", null, title), pill("чекає", "warn"));
      c.append(top);
      lines.forEach(l => c.append(el("p", "small", l)));
      const acts = el("div", "acts");
      const ok = el("button", "btn okb sm", "Схвалити"); ok.type = "button";
      ok.addEventListener("click", async () => { ok.disabled = true; try { await updateDoc(g.ref, approve); toast("Схвалено"); } catch (e) { console.error(e); toast("Не вдалося"); ok.disabled = false; } });
      acts.append(ok, confirmButton("Відхилити", "btn badb sm", async () => { await updateDoc(g.ref, reject); toast("Відхилено"); }));
      c.append(acts); box.append(c);
    };
    pend.forEach(g => card(g, `Новий чат «${g.name}»`, [`Створив: ${who([g.owner])}`, `Запрошує: ${who(g.invited || [])}`],
      { status: "approved", members: arrayUnion(...(g.invited || [])), invited: [] }, { status: "rejected", invited: [] }));
    inv.forEach(g => card(g, `Запрошення в «${g.name}»`, [`Від: ${who([g.owner])}`, `Кого: ${who(g.invited)}`],
      { members: arrayUnion(...g.invited), invited: [] }, { invited: [] }));
  }

  /* ----- Модерація: адміністратор і молодші модератори ----- */
  let seen = {}, modClass = "all", mods = new Set();
  function setupModeration() {
    portalSubs.push(onSnapshot(collection(db, "presence"),
      s => { seen = {}; s.docs.forEach(d => { seen[d.id] = toDate(d.data({ serverTimestamps: "estimate" }).lastSeen); }); renderModeration(); },
      e => console.error(e)));
    portalSubs.push(onSnapshot(collection(db, "mods"),
      s => { mods = new Set(s.docs.map(d => d.id)); renderModeration(); },
      e => console.error(e)));
    const tick = setInterval(renderModeration, 60 * 1000);
    portalSubs.push(() => clearInterval(tick));
    $("#mod-head").innerHTML = `<th>Ім'я</th><th>Клас</th><th>Заходив</th>${isOwner ? "<th>Права</th>" : ""}`;
    $("#mod-note").textContent = isOwner
      ? "Клас змінюється одразу: у людини відкриються чат і оголошення нового класу. Молодші модератори можуть видаляти повідомлення й оголошення та читати чати всіх класів, але не схвалюють заявки й не змінюють класи."
      : isAdmin ? "Клас змінюється одразу: у людини відкриються чат і оголошення нового класу."
      : "Ти молодший модератор: бачиш учасників, читаєш чати всіх класів і можеш видаляти повідомлення та оголошення. Класи змінює лише адміністратор.";
  }
  $("#mod-search").addEventListener("input", () => renderModeration());
  const classOf = p => p.role === "parent" ? p.childClass : p.role === "student" ? p.cls : null;
  function seenText(d) {
    if (!d) return ["ще не заходив", ""];
    const min = Math.floor((Date.now() - d.getTime()) / 60000);
    if (min < 5) return ["онлайн", "on"];
    if (min < 60) return [`${min} хв тому`, ""];
    if (min < 24 * 60) return [`${Math.floor(min / 60)} год тому`, ""];
    return [`${fmtDay(d)} ${fmtTime(d)}`, ""];
  }
  function renderModeration() {
    if (!(isAdmin || isMod) || !inPortal) return;
    const members = Object.entries(dir).map(([id, p]) => ({ id, p }));
    const count = n => members.filter(m => m.p.cls === n).length;
    const online = members.filter(m => seenText(seen[m.id])[1] === "on").length;
    $("#mod-summary").textContent = `Учасників: ${members.length} · онлайн зараз: ${online} · модераторів: ${mods.size}`;
    const chips = [["all", `Усі (${members.length})`], ...CLASSES.filter(n => count(n)).map(n => [String(n), `${n} клас (${count(n)})`])];
    $("#mod-filter").innerHTML = chips.map(([k, t]) => `<button class="chip" type="button" data-f="${k}" aria-pressed="${k === modClass}">${t}</button>`).join("");
    $$("#mod-filter .chip").forEach(c => c.addEventListener("click", () => { modClass = c.dataset.f; renderModeration(); }));
    const q = $("#mod-search").value.trim().toLowerCase();
    const list = members
      .filter(m => modClass === "all" || String(m.p.cls) === modClass)
      .filter(m => !q || m.p.name.toLowerCase().includes(q))
      .sort((a, b) => (seen[b.id] || 0) - (seen[a.id] || 0));
    const cols = isOwner ? 4 : 3;
    const body = $("#mod-rows"); body.replaceChildren();
    if (!list.length) { const tr = el("tr"); const td = el("td", "muted", "Нікого не знайдено."); td.colSpan = cols; tr.append(td); body.append(tr); return; }
    list.forEach(m => {
      const tr = el("tr");
      const tags = [m.id === me.uid ? "ти" : "", ROLE[m.p.role] || "", m.id === ownerUid ? "головний адмін" : "", mods.has(m.id) ? "мол. модератор" : ""].filter(Boolean).join(" · ");
      const name = el("td"); name.append(el("b", null, m.p.name), el("small", null, tags));
      const clsTd = el("td");
      if (m.p.cls && isAdmin) {
        const sel = el("select"); sel.innerHTML = classOptions(); sel.value = String(m.p.cls);
        sel.setAttribute("aria-label", `Клас: ${m.p.name}`);
        sel.addEventListener("change", async () => {
          const n = Number(sel.value), field = m.p.role === "parent" ? "childClass" : "cls";
          sel.disabled = true;
          try { await updateDoc(doc(db, "users", m.id), { [field]: n }); toast(`${m.p.name}: тепер ${n} клас`); }
          catch (e) { console.error(e); toast("Не вдалося змінити клас"); sel.value = String(m.p.cls); }
          finally { sel.disabled = false; }
        });
        clsTd.append(sel);
      } else clsTd.append(el("span", m.p.cls ? null : "muted", m.p.cls ? `${m.p.cls} клас` : "—"));
      const [txt, cls] = seenText(seen[m.id]);
      tr.append(name, clsTd, el("td", "seen " + cls, txt));
      if (isOwner) {
        const td = el("td");
        if (m.id !== me.uid) {
          const isM = mods.has(m.id);
          const b = el("button", "btn sm " + (isM ? "ghost" : "okb"), isM ? "Зняти модератора" : "Зробити модератором"); b.type = "button";
          b.addEventListener("click", async () => {
            b.disabled = true;
            try {
              if (isM) await deleteDoc(doc(db, "mods", m.id)); else await setDoc(doc(db, "mods", m.id), { createdAt: serverTimestamp() });
              toast(isM ? `${m.p.name} більше не модератор` : `${m.p.name} — молодший модератор`);
            } catch (e) { console.error(e); toast("Не вдалося"); b.disabled = false; }
          });
          td.append(b);
        }
        tr.append(td);
      }
      body.append(tr);
    });
  }
}
