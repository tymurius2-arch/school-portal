import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, sendPasswordResetEmail, connectAuthEmulator, GoogleAuthProvider, signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc,
  collection, query, where, orderBy, limit, onSnapshot, serverTimestamp, arrayUnion, arrayRemove, deleteField, Timestamp,
  getDocs, writeBatch, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, SCHOOL } from "./config.js";
import { HINTS } from "./hints.js";
import { TEXTBOOKS } from "./textbooks.js";
import { QUIZ } from "./quiz.js";
import { clean } from "./profanity.js";
import { setupMiniGames } from "./minigames.js";

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
const STATUS = { pending: ["на розгляді", "warn"], approved: ["схвалено", "ok"], rejected: ["відхилено", "bad"], kicked: ["кікнуто", "bad"] };
const CLASSES = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const classOptions = (withSchool = false) =>
  (withSchool ? `<option value="0">Уся школа</option>` : "") + CLASSES.map(n => `<option value="${n}">${n} клас</option>`).join("");
const toDate = ts => (ts && typeof ts.toDate === "function") ? ts.toDate() : null;
const fmtTime = d => d ? d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" }) : "";
const fmtDay = d => d ? d.toLocaleDateString("uk-UA", { day: "numeric", month: "long" }) : "";
function pill(text, cls) { return el("span", "pill " + cls, text); }
function emptyEl(text) { return el("div", "empty", text); }
/* Кнопка, що просить підтвердження другим натисканням */
// key — щоб «Точно?» не скидалось, коли список перемальовується (наприклад, у чаті).
const armedKeys = new Map();
function confirmButton(label, cls, action, key) {
  const b = el("button", cls, label); b.type = "button";
  const disarm = () => { b.dataset.armed = ""; b.textContent = label; };
  const left = key ? (armedKeys.get(key) || 0) - Date.now() : 0;
  if (left > 0) { b.dataset.armed = "1"; b.textContent = "Точно?"; setTimeout(disarm, left); }
  b.addEventListener("click", async () => {
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Точно?"; if (key) armedKeys.set(key, Date.now() + 3000); setTimeout(disarm, 3000); return; }
    if (key) armedKeys.delete(key);
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

/* ---------- Пристрій: iPhone, встановлений додаток, service worker ---------- */
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(e => console.warn("SW", e));

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
    const inv = v("invite").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (inv) { if (inv.length !== 6) return [null, "Код-запрошення має 6 символів.", "invite"]; d.invite = inv; }
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

  $("#b-google").addEventListener("click", async () => {
    const out = $("#google-err"); out.textContent = "";
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (e) {
      const c = e && e.code || "";
      if (c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request") return;
      out.textContent = c === "auth/operation-not-allowed" ? "Вхід через Google ще не ввімкнено. Адміністратору: Firebase → Authentication → Sign-in method → Google → Enable."
        : c === "auth/popup-blocked" ? "Браузер заблокував вікно входу. Дозволь спливаючі вікна для цього сайту."
        : c === "auth/unauthorized-domain" ? "Цей сайт не доданий у Firebase → Authentication → Settings → Authorized domains."
        : authMessage(e);
    }
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
      try { await submitApplication(cred.user.uid, data); }
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
    if (!user) { show(maint.on ? "maint" : "auth"); return; }
    show("loading"); watchLoading();
    await checkAdmin(user);
    if (me !== user) return;
    applyViewAs();
    sessionSubs.push(onSnapshot(doc(db, "users", user.uid),
      s => {
        profile = s.exists() ? s.data({ serverTimestamps: "estimate" }) : null;
        // Режим «подивитися як учень»: адмін бачить портал очима учня обраного класу.
        if (viewAs && profile) profile = { ...profile, role: "student", cls: viewAs, status: "approved" };
        route();
      },
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
  let ownerFree = false, isOwner = false, isMod = false, ownerUid = null, viewAs = null;
  function applyViewAs() {
    let v = null;
    try { v = Number(sessionStorage.getItem("portal.viewAs")) || null; } catch {}
    viewAs = v && isAdmin ? v : null;
    if (viewAs) { isAdmin = false; isOwner = false; isMod = false; }
  }
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

  /* ----- Технічна перерва ----- */
  let maint = { on: false, message: "" };
  onSnapshot(doc(db, "meta", "maintenance"), s => {
    maint = s.exists() ? s.data() : { on: false, message: "" };
    $("#maint-text").textContent = maint.message || "Ми оновлюємо портал. Скоро все запрацює — сторінку оновлювати не треба.";
    renderMaintBox();
    if (!me) { if (!$("#s-auth").hidden || !$("#s-maint").hidden) show(maint.on ? "maint" : "auth"); return; }
    route();
  }, e => console.error(e));
  function renderMaintBox() {
    $("#maint-banner").hidden = !(maint.on && isAdmin && inPortal);
    $("#maint-state").textContent = maint.on ? "увімкнено" : "вимкнено";
    $("#maint-state").className = "pill " + (maint.on ? "bad" : "ok");
    $("#maint-on").hidden = !!maint.on; $("#maint-off").hidden = !maint.on;
    if (maint.on && document.activeElement !== $("#maint-msg")) $("#maint-msg").value = maint.message || "";
  }
  async function setMaint(on) {
    try {
      await setDoc(doc(db, "meta", "maintenance"), { on, message: $("#maint-msg").value.trim().slice(0, 200), at: serverTimestamp() });
      toast(on ? "Технічну перерву увімкнено" : "Технічну перерву вимкнено");
      logAction(on ? "Увімкнув технічну перерву" : "Вимкнув технічну перерву", "", "");
    } catch (e) { console.error(e); toast("Не вдалося"); }
  }
  $("#maint-on").addEventListener("click", () => setMaint(true));
  $("#maint-off").addEventListener("click", () => setMaint(false));

  function route() {
    if (registering || !me || profile === undefined) return;
    clearTimeout(loadTimer);
    // Під час перерви пускаємо лише адміністратора.
    if (maint.on && !isAdmin) { if (inPortal) stopPortal(); show("maint"); return; }
    if (profile && (isAdmin || profile.status === "approved")) { enterPortal(); renderMaintBox(); return; }
    if (inPortal) { stopPortal(); if (profile && profile.status !== "kicked") toast("Доступ до порталу закрито адміністратором"); }
    if (!profile) { openApply(null, null); return; }
    if (profile.status === "rejected") { openApply(profile, "Заявку відхилено. Виправ дані й надішли знову."); return; }
    if (editing) return;
    renderWait(); show("wait");
  }

  /* ----- Заявка для того, хто вже увійшов ----- */
  function openApply(p, note) {
    const f = $("#f-apply"); formErr(f);
    fillProfile(f, p);
    if (!p && me && me.displayName && !f.elements.name.value) f.elements.name.value = me.displayName;
    $("#apply-title").textContent = p ? "Виправ заявку" : "Заявка на вступ";
    $("#apply-note").hidden = !note; $("#apply-note").textContent = note || "";
    show("apply");
  }
  $("#f-apply").addEventListener("submit", async e => {
    e.preventDefault(); const f = e.target; formErr(f);
    const [data, msg, field] = readProfile(f);
    if (!data) { formErr(f, msg); f.elements[field] && f.elements[field].focus(); return; }
    const btn = $("button[type=submit]", f); btn.disabled = true;
    try { await submitApplication(me.uid, data); editing = false; if (!data.invite) toast("Заявку надіслано"); route(); }
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
  function renderWait() {
    fillDetails($("#wait-details"), profile);
    const kicked = profile.status === "kicked";
    $("#s-wait .wait").classList.toggle("kicked", kicked);
    $("#wait-title").textContent = kicked ? "Тебе кікнуто" : "Очікуй схвалення";
    $("#wait-text").textContent = kicked
      ? "Адміністратор тимчасово закрив тобі доступ. Очікуй, поки модератор знову тебе схвалить — портал відкриється сам."
      : "Заявку отримано. Адмін перевіряє, що ти свій. Щойно тебе впустять, портал відкриється сам — сторінку оновлювати не треба.";
    $("#b-edit").hidden = kicked;
  }

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
      if (cls !== lastClass) { lastClass = cls; hintCls = cls || hintCls; setupChat(); setupNewsForm(); renderNews(); setupSchedule(); renderHints(); setupTools(); libCls = cls || libCls; renderLibrary(); setupQuiz(); syncWatchers(); renderBday(); setupBoard(); renderGames(); }
      return;
    }
    inPortal = true; lastClass = cls;
    show("portal");
    // Заявка самого адміністратора не має висіти серед нових.
    if (isAdmin && profile.status !== "approved") updateDoc(doc(db, "users", me.uid), { status: "approved", reviewedAt: serverTimestamp() }).catch(console.error);
    $(".tab[data-tab=admin]").hidden = !isAdmin;
    $(".tab[data-tab=mod]").hidden = !(isAdmin || isMod);
    $(".tab[data-tab=roster]").hidden = !(isAdmin || isMod);
    startPresence();
    setupDirectory(); setupChat(); setupGroups(); setupNews(); setupSchedule(); setupHints(); setupTools(); setupLibrary();
    setupProfiles(); setupUnread(); setupMyMute(); setupQuiz(); setupLog(); setupUpdates(); setupChatExtras(); if (!viewAs) recordVisit();
    setupDMs(); setupStories(); setupNotes(); setupGames(); setupBoard(); setupSpolls(); setupPopup();
    $("#viewas-banner").hidden = !viewAs; $("#viewas-who").textContent = viewAs ? `учень ${viewAs} класу` : "";
    if (isAdmin || isMod) { setupReports(); setupRoster(); setupQbank(); }
    if (isAdmin) { setupAdmin(); setupStats(); setupInvites(); setupRetention(); setupViewAs(); }
    if (isAdmin || isMod) setupModeration();
    openTab(store.get("tab", "chat"));
  }

  function openTab(id) {
    if (!$("#p-" + id) || (id === "admin" && !isAdmin) || ((id === "mod" || id === "roster") && !isAdmin && !isMod)) id = "chat";
    $$(".tab").forEach(t => t.setAttribute("aria-selected", String(t.dataset.tab === id)));
    $$(".panel").forEach(p => p.hidden = p.id !== "p-" + id);
    store.set("tab", id);
    if (id === "profile") renderProfileView();
    if (id === "updates") { updSeenAtOpen = 0; markUpdatesSeen(); renderUpdates(); }
    if (id === "chat") { scrollChat(true); if (typeof markRead === "function") markRead(curKey()); }
  }
  $$(".tab").forEach(t => t.addEventListener("click", () => { if (t.dataset.tab === "profile") pvUid = null; openTab(t.dataset.tab); }));

  /* ----- Список учасників (для запрошень і модерації) ----- */
  let dir = {}, dirReady = false;
  function setupDirectory() {
    portalSubs.push(onSnapshot(collection(db, "directory"), s => {
      dir = {}; s.docs.forEach(d => { dir[d.id] = d.data(); }); dirReady = true;
      if (!$("#f-group").hidden) renderPicker();
      const g = current && current.kind === "group" && groups.find(x => x.id === current.id);
      if (g) renderGroupBar(g);
      renderGroupRequests(); renderModeration(); syncDirectory(); renderPicker2(); renderBday(); renderRoster(); renderGames();
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
    addBadge(mk(c ? `Чат ${c} класу` : "Чат класу", !!current && current.kind === "class", () => openClassChat(classChatCls())), "c" + c);
    groups.filter(g => g.members.includes(me.uid)).sort((a, b) => a.name.localeCompare(b.name, "uk")).forEach(g => {
      if (g.status === "approved") { addBadge(mk(g.name, !!current && current.kind === "group" && current.id === g.id, () => openGroupChat(g.id)), "g" + g.id); return; }
      const b = mk(g.name + (g.status === "pending" ? " · чекає" : " · відхилено"), false,
        () => toast(g.status === "pending" ? "Чат чекає схвалення адміністратора" : "Адміністратор відхилив цей чат"), " muted");
      b.append(el("span", "dot"));
    });
    dms.slice().sort((a, b) => shortName(dmOther(a.id)).localeCompare(shortName(dmOther(b.id)), "uk"))
      .forEach(d => addBadge(mk("✉ " + shortName(dmOther(d.id)), !!current && current.kind === "dm" && current.id === d.id, () => openDMChat(d.id), " dm"), "d" + d.id));
    mk("+ Новий чат", false, () => openGroupForm("create"), " add");
  }
  const chatRoot = c => c.kind === "class" ? ["classes", String(c.cls)] : c.kind === "dm" ? ["dms", c.id] : ["groups", c.id];
  const msgCol = c => collection(db, ...chatRoot(c), "messages");
  const mediaCol = c => collection(db, ...chatRoot(c), "media");
  function setComposer(enabled, note) {
    if (viewAs) { enabled = false; note = "Режим перегляду — писати не можна"; }
    $("#chat-text").disabled = !enabled;
    $("#f-chat button[type=submit]").disabled = !enabled;
    $("#f-chat").classList.toggle("off", !enabled);
    $("#chat-text").placeholder = enabled ? "Напиши повідомлення…" : note;
  }
  function listen(q, kind) {
    chatUnsub && chatUnsub();
    const box = $("#messages"); box.replaceChildren(emptyEl("Завантаження…"));
    chatUnsub = onSnapshot(q,
      s => { renderMessages(s.docs.slice().reverse(), kind); if (isViewing(curKey())) markRead(curKey()); },
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
    applyMute(); $("#f-poll").hidden = true; watchExtras(curKey()); markRead(curKey());
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
    applyMute(); $("#f-poll").hidden = true; watchExtras(curKey()); markRead(curKey());
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
      renderSwitch(); renderGroupRequests(); syncWatchers();
    }, e => console.error(e)));
  }

  function scrollChat(force) {
    const box = $("#messages");
    if (force || box.scrollHeight - box.scrollTop - box.clientHeight < 120) box.scrollTop = box.scrollHeight;
  }
  /* ===== Оновлення порталу ===== */
  let updates = [], updSeenAtOpen = 0;
  const updKey = () => `updSeen.${me ? me.uid : ""}`;
  function setupUpdates() {
    $("#f-update").hidden = !isAdmin;
    portalSubs.push(onSnapshot(query(collection(db, "updates"), orderBy("at", "desc"), limit(50)), s => {
      updates = s.docs;
      if (!$("#p-updates").hidden) markUpdatesSeen(); else renderUpdBadge();
      renderUpdates();
    }, e => console.error(e)));
  }
  const latestUpd = () => { const d = updates[0]; const t = d && toDate(d.data({ serverTimestamps: "estimate" }).at); return t ? t.getTime() : 0; };
  function renderUpdBadge() { $("#upd-new").hidden = !(latestUpd() > store.get(updKey(), 0)); }
  function markUpdatesSeen() {
    if (!updSeenAtOpen) updSeenAtOpen = store.get(updKey(), 0) || 1;   // що було новим у момент відкриття — підсвічуємо
    store.set(updKey(), Math.max(latestUpd(), Date.now()));
    renderUpdBadge();
  }
  function renderUpdates() {
    const box = $("#upd-list"); box.replaceChildren();
    if (!updates.length) { box.append(emptyEl(isAdmin ? "Тут ще немає оновлень. Опублікуй перше у формі вище." : "Тут з'являтимуться новини про оновлення порталу.")); return; }
    updates.forEach(d => {
      const u = d.data({ serverTimestamps: "estimate" }), t = toDate(u.at);
      const card = el("article", "card upd" + (updSeenAtOpen && t && t.getTime() > updSeenAtOpen ? " fresh" : ""));
      const top = el("div", "top-line");
      const h = el("h3", null, u.title); top.append(h);
      const meta = el("span", "muted small", [u.ver, `${fmtDay(t)} ${fmtTime(t)}`].filter(Boolean).join(" · ")); top.append(meta);
      const lines = String(u.text).split("\n").map(x => x.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
      const body = lines.length > 1 ? el("ul") : el("p", "txt");
      if (lines.length > 1) lines.forEach(l => body.append(el("li", null, l))); else body.textContent = lines[0] || "";
      card.append(top, body);
      if (isAdmin) { const a = el("div", "acts"); a.append(confirmButton("Видалити", "btn ghost sm", async () => { await deleteDoc(d.ref); logAction("Видалив оновлення", "", u.title); })); card.append(a); }
      box.append(card);
    });
  }
  $("#f-update").addEventListener("submit", async e => {
    e.preventDefault(); const f = e.target; formErr(f);
    const ver = $("#up-ver").value.trim(), title = $("#up-title").value.trim(), text = $("#up-text").value.trim();
    if (title.length < 2) { formErr(f, "Додай заголовок."); return; }
    if (!text) { formErr(f, "Напиши, що нового."); return; }
    const btn = $("button[type=submit]", f); btn.disabled = true;
    try {
      await addDoc(collection(db, "updates"), { ver, title, text, by: me.uid, byName: profile.name, at: serverTimestamp() });
      ["up-ver", "up-title", "up-text"].forEach(id => $("#" + id).value = "");
      toast("Оновлення опубліковано"); logAction("Опублікував оновлення", "", title);
    } catch (ex) { console.error(ex); formErr(f, "Не вдалося опублікувати."); }
    finally { btn.disabled = false; }
  });

  /* ===== Банк питань для тесту дня (модератори) ===== */
  let qbank = [];
  function setupQbank() {
    $("#f-qbank").hidden = false;
    $("#qb-cls").innerHTML = classOptions(); $("#qb-cls").value = String(myClass() || 6);
    $("#qb-opts").replaceChildren(...[1, 2, 3, 4].map(i => { const x = el("input"); x.maxLength = 60; x.placeholder = `${i}-й варіант` + (i > 2 ? " (необов'язково)" : ""); x.setAttribute("aria-label", `${i}-й варіант`); return x; }));
    portalSubs.push(onSnapshot(collection(db, "quizbank"), s => { qbank = s.docs; renderQbank(); }, e => console.error(e)));
  }
  $("#qb-cls").addEventListener("change", () => renderQbank());
  function renderQbank() {
    const c = Number($("#qb-cls").value), box = $("#qb-list"); box.replaceChildren();
    const mine = qbank.filter(d => d.data().cls === c);
    box.append(el("span", "muted", `Додано для ${c} класу: ${mine.length} (+ ${(QUIZ[c] || []).length} вбудованих)`));
    mine.slice(-8).forEach(d => {
      const q = d.data(), row = el("div", "invite");
      row.append(el("span", null, `${q.q} → ${q.o[q.a]}`), confirmButton("Видалити", "btn ghost sm", async () => { await deleteDoc(d.ref); logAction("Видалив питання тесту", "", q.q); }));
      box.append(row);
    });
  }
  $("#f-qbank").addEventListener("submit", async e => {
    e.preventDefault(); const f = e.target; formErr(f);
    const q = $("#qb-q").value.trim(), o = $$("#qb-opts input").map(x => x.value.trim()).filter(Boolean), a = Number($("#qb-a").value);
    if (q.length < 3) { formErr(f, "Напиши питання."); return; }
    if (o.length < 2) { formErr(f, "Потрібно щонайменше 2 варіанти."); return; }
    if (a >= o.length) { formErr(f, "Правильна відповідь має бути серед заповнених варіантів."); return; }
    try {
      await addDoc(collection(db, "quizbank"), { cls: Number($("#qb-cls").value), q, o, a, by: me.uid, at: serverTimestamp() });
      $("#qb-q").value = ""; $$("#qb-opts input").forEach(x => { x.value = ""; });
      toast("Питання додано"); logAction("Додав питання тесту", "", q);
    } catch (ex) { console.error(ex); formErr(f, "Не вдалося додати питання."); }
  });

  /* ===== Статистика й резервна копія (адміністратор) ===== */
  let visits = [];
  function recordVisit() {
    const day = isoDay(new Date()), key = `visit.${me.uid}.${day}`;
    if (store.get(key, 0)) return;
    setDoc(doc(db, "visits", `${day}_${me.uid}`), { day, uid: me.uid, at: serverTimestamp() }).catch(() => {}).finally(() => store.set(key, 1));
  }
  function setupStats() {
    $("#stats-box").hidden = false;
    const from = new Date(); from.setDate(from.getDate() - 6);
    portalSubs.push(onSnapshot(query(collection(db, "visits"), where("day", ">=", isoDay(from))), s => { visits = s.docs.map(d => d.data()); renderStats(); }, e => console.error(e)));
    const t = setInterval(renderStats, 60000); portalSubs.push(() => clearInterval(t));
  }
  function renderStats() {
    if (!isAdmin || !inPortal) return;
    const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return d; });
    const per = days.map(d => new Set(visits.filter(v => v.day === isoDay(d)).map(v => v.uid)).size);
    const uniq = new Set(visits.map(v => v.uid)).size;
    const online = Object.keys(dir).filter(id => seenText(seen[id])[1] === "on").length;
    const tiles = [[Object.keys(dir).length, "учасників"], [online, "онлайн зараз"], [per[6], "заходили сьогодні"], [uniq, "різних людей за 7 днів"], [quizMonthDocs.length, "відповідей у тесті дня (місяць)"]];
    $("#stat-tiles").replaceChildren(...tiles.map(([n, t]) => { const d = el("div"); d.append(el("b", null, String(n)), el("span", null, t)); return d; }));
    const max = Math.max(1, ...per), wd = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
    $("#stat-bars").replaceChildren(...days.map((d, i) => {
      const bar = el("div", "bar"); bar.title = `${fmtDay(d)}: ${per[i]}`;
      const col = el("i", "col"); col.style.height = `${Math.round(per[i] / max * 100)}%`;
      bar.append(el("b", null, String(per[i])), col, el("span", null, i === 6 ? "Сьогодні" : wd[d.getDay()]));
      return bar;
    }));
  }
  const plain = v => v && typeof v.toDate === "function" ? v.toDate().toISOString()
    : Array.isArray(v) ? v.map(plain)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v;
  $("#b-backup").addEventListener("click", async e => {
    const b = e.currentTarget; b.disabled = true; toast("Готую резервну копію…");
    const out = { createdAt: new Date().toISOString(), project: firebaseConfig.projectId, data: {} };
    const cols = ["users", "directory", "announcements", "groups", "books", "updates", "roster", "profiles", "quiz", "quizbank", "invites", "reports", "mutes", "mods", "admins", "pins"];
    if (isOwner) cols.push("log");
    for (const c of cols) {
      try { const s = await getDocs(collection(db, c)); out.data[c] = s.docs.map(d => ({ id: d.id, ...plain(d.data()) })); }
      catch (err) { out.data[c] = { error: err.code || String(err) }; }
    }
    out.data.classMessages = {};
    for (const n of CLASSES) {
      try { const s = await getDocs(query(collection(db, "classes", String(n), "messages"), orderBy("createdAt", "desc"), limit(1000))); out.data.classMessages[n] = s.docs.map(d => ({ id: d.id, ...plain(d.data()) })); }
      catch (err) { out.data.classMessages[n] = { error: err.code || String(err) }; }
    }
    out.data.groupMessages = {};
    for (const g of Array.isArray(out.data.groups) ? out.data.groups : []) {
      try { const s = await getDocs(query(collection(db, "groups", g.id, "messages"), orderBy("createdAt", "desc"), limit(1000))); out.data.groupMessages[g.id] = s.docs.map(d => ({ id: d.id, ...plain(d.data()) })); }
      catch (err) { out.data.groupMessages[g.id] = { error: err.code || String(err) }; }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
    a.download = `portal-backup-${isoDay(new Date())}.json`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    b.disabled = false; toast("Резервну копію завантажено"); logAction("Завантажив резервну копію", "", "");
  });

  /* ===== Коди-запрошення (адміністратор) ===== */
  function setupInvites() {
    $("#inv-cls").innerHTML = classOptions(); $("#inv-cls").value = String(myClass() || 6);
    portalSubs.push(onSnapshot(collection(db, "invites"), s => {
      const box = $("#invites"); box.replaceChildren();
      if (!s.size) { box.append(emptyEl("Кодів поки немає.")); return; }
      s.docs.map(d => ({ d, v: d.data({ serverTimestamps: "estimate" }) })).sort((x, y) => (toDate(y.v.at) || 0) - (toDate(x.v.at) || 0)).forEach(({ d, v }) => {
        const exp = toDate(v.expires), dead = (exp && exp < new Date()) || v.uses >= v.max;
        const row = el("div", "invite");
        const info = el("div"); info.append(el("code", null, d.id), el("div", "small muted", `${v.cls} клас · використано ${v.uses}/${v.max} · до ${fmtDay(exp)}`));
        const acts = el("div", "acts");
        if (dead) acts.append(pill(v.uses >= v.max ? "використано" : "прострочено", "bad"));
        const copy = el("button", "btn ghost sm", "Копіювати"); copy.type = "button";
        copy.addEventListener("click", () => navigator.clipboard.writeText(d.id).then(() => toast("Код скопійовано"), () => toast(d.id)));
        acts.append(copy, confirmButton("Видалити", "btn ghost sm", async () => { await deleteDoc(d.ref); logAction("Видалив код-запрошення", "", d.id); }));
        row.append(info, acts); box.append(row);
      });
    }, e => console.error(e)));
  }
  $("#f-invite").addEventListener("submit", async e => {
    e.preventDefault();
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const code = Array.from(crypto.getRandomValues(new Uint32Array(6)), n => A[n % A.length]).join("");
    const max = Math.min(60, Math.max(1, Number($("#inv-max").value) || 1)), days = Math.min(30, Math.max(1, Number($("#inv-days").value) || 7));
    try {
      await setDoc(doc(db, "invites", code), { cls: Number($("#inv-cls").value), max, uses: 0, expires: Timestamp.fromDate(new Date(Date.now() + days * 86400000)), by: me.uid, at: serverTimestamp() });
      toast(`Код ${code} створено`); logAction(`Створив код-запрошення для ${$("#inv-cls").value} класу`, "", code);
    } catch (ex) { console.error(ex); toast("Не вдалося створити код"); }
  });
  // Заявка з кодом: схвалюється одразу, якщо код дійсний; інакше — звичайна заявка.
  async function submitApplication(uid, data) {
    if (data.invite) {
      try {
        const b = writeBatch(db);
        b.set(doc(db, "users", uid), { ...data, status: "approved" });
        b.update(doc(db, "invites", data.invite), { uses: increment(1) });
        await b.commit();
        toast("Код прийнято — ласкаво просимо! 🎉"); return;
      } catch (e) { console.error(e); toast("Код не підійшов — заявку надіслано на звичайне схвалення"); }
      const { invite, ...rest } = data; data = rest;
    }
    await setDoc(doc(db, "users", uid), data);
  }

  /* ===== Особисті повідомлення ===== */
  let dms = [];
  const dmId = uid => [me.uid, uid].sort().join("_");
  const dmOther = id => id.split("_").find(u => u !== me.uid) || me.uid;
  const shortName = uid => dir[uid] ? dir[uid].name : "Учасник";
  const chatLabel = k => k[0] === "c" ? `Чат ${k.slice(1)} класу` : k[0] === "d" ? `✉ ${shortName(dmOther(k.slice(1)))}` : ((groups.find(g => "g" + g.id === k) || {}).name || "Чат");
  function setupDMs() {
    portalSubs.push(onSnapshot(query(collection(db, "dms"), where("members", "array-contains", me.uid)), s => {
      dms = s.docs.map(d => ({ id: d.id, ...d.data() }));
      renderSwitch(); syncWatchers();
    }, e => console.error(e)));
    portalSubs.push(() => { dms = []; });
  }
  async function openDM(uid) {
    if (viewAs) { toast("У режимі перегляду писати не можна"); return; }
    const id = dmId(uid);
    if (!dms.some(d => d.id === id)) {
      try {
        const s = await getDoc(doc(db, "dms", id));
        if (!s.exists()) await setDoc(doc(db, "dms", id), { members: id.split("_"), at: serverTimestamp() });
      } catch (e) { console.error(e); toast("Не вдалося відкрити особисті повідомлення"); return; }
    }
    openTab("chat"); openDMChat(id);
  }
  function openDMChat(id) {
    current = { kind: "dm", id, other: dmOther(id) };
    showChatBox();
    $("#chat-title").textContent = "✉ " + shortName(current.other);
    $("#chat-class-wrap").hidden = true; $("#group-bar").hidden = true;
    setComposer(true);
    applyMute(); $("#f-poll").hidden = true; watchExtras(curKey()); markRead(curKey());
    listen(query(msgCol(current), orderBy("createdAt", "desc"), limit(200)), "dm");
    renderSwitch();
  }

  /* ===== Фото й голосові ===== */
  const mediaCache = new Map();
  const DEFAULT_MEDIA_TEXT = /^(📷 Фото|🎤 Голосове.*)$/u;
  const fmtDur = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  function mediaEl(d, m) {
    const ref = doc(db, d.ref.parent.parent.path, "media", m.media.id), box = el("div");
    const fill = data => {
      if (m.media.kind === "img") {
        const img = el("img", "photo"); img.src = data; img.alt = "Фото з чату";
        img.addEventListener("click", () => { $("#lightbox-img").src = data; $("#lightbox").showModal(); });
        box.replaceChildren(img);
      } else { const a = el("audio"); a.controls = true; a.preload = "metadata"; a.src = data; box.replaceChildren(a); }
    };
    if (mediaCache.has(ref.path)) { fill(mediaCache.get(ref.path)); return box; }
    box.append(el("div", "media-wait", m.media.kind === "img" ? "📷 Завантажую фото…" : "🎤 Завантажую голосове…"));
    let p = mediaCache.get("p:" + ref.path);
    if (!p) {
      p = getDoc(ref).then(s => { const v = s.exists() ? s.data().data : null; if (v) mediaCache.set(ref.path, v); return v; });
      mediaCache.set("p:" + ref.path, p);
      p.catch(() => mediaCache.delete("p:" + ref.path));
    }
    p.then(v => v ? fill(v) : box.replaceChildren(el("div", "media-wait", "Файл видалено")), () => box.replaceChildren(el("div", "media-wait", "Не вдалося завантажити")));
    return box;
  }
  $("#lightbox-x").addEventListener("click", () => $("#lightbox").close());
  $("#lightbox").addEventListener("click", e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  async function sendMedia(ctx, kind, data, dur) {
    const ref = await addDoc(mediaCol(ctx), { uid: me.uid, kind, data, dur, at: serverTimestamp() });
    mediaCache.set(ref.path, data);
    const caption = kind === "img" && ctx === current ? $("#chat-text").value.trim() : "";
    if (caption) $("#chat-text").value = "";
    const ok = await sendText(kind === "img" ? (caption || "📷 Фото") : `🎤 Голосове · ${fmtDur(dur)}`, { media: { kind, id: ref.id, dur } }, ctx);
    if (!ok) deleteDoc(ref).catch(() => {});
  }
  async function shrinkImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      for (const [max, q] of [[1280, .75], [1024, .7], [800, .65], [640, .6]]) {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        const data = c.toDataURL("image/jpeg", q);
        if (data.length <= 400000) return data;
      }
      throw new Error("big");
    } finally { URL.revokeObjectURL(url); }
  }
  $("#b-photo").addEventListener("click", () => { if (current && !viewAs) $("#photo-file").click(); });
  $("#photo-file").addEventListener("change", async e => {
    const f = e.target.files[0], ctx = current; e.target.value = "";
    if (!f || !ctx) return;
    if (!f.type.startsWith("image/")) { toast("Це не картинка"); return; }
    $("#b-photo").disabled = true; toast("Надсилаю фото…");
    try { await sendMedia(ctx, "img", await shrinkImage(f), 0); }
    catch (ex) { console.error(ex); toast(ex.message === "big" ? "Фото завелике навіть після стиснення" : isMutedNow() ? "Ти в муті — зараз не можна писати" : "Не вдалося надіслати фото"); }
    finally { $("#b-photo").disabled = false; }
  });
  let rec = null;
  function renderRec() {
    $("#rec-bar").hidden = !rec;
    $("#b-voice").classList.toggle("rec", !!rec);
    $("#b-voice").textContent = rec ? "⏹" : "🎤";
    $("#b-voice").setAttribute("aria-label", rec ? "Зупинити й надіслати" : "Записати голосове");
    if (rec) $("#rec-time").textContent = fmtDur((Date.now() - rec.t0) / 1000);
  }
  function stopRec(send) { if (!rec || rec.stopping) return; rec.stopping = true; rec.send = send; clearInterval(rec.timer); rec.mr.stop(); }
  $("#rec-x").addEventListener("click", () => stopRec(false));
  $("#b-voice").addEventListener("click", async () => {
    if (rec) { stopRec(true); return; }
    if (!current || viewAs) return;
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast("Цей браузер не вміє записувати голос"); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { toast("Дозволь доступ до мікрофона в налаштуваннях браузера"); return; }
    const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(t => MediaRecorder.isTypeSupported(t)) || "";
    const mr = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 });
    const chunks = [];
    rec = { mr, t0: Date.now(), ctx: current, send: false };
    mr.ondataavailable = ev => { if (ev.data.size) chunks.push(ev.data); };
    mr.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const r = rec; rec = null; renderRec();
      if (!r || !r.send) return;
      const dur = Math.min(120, (Date.now() - r.t0) / 1000);
      if (dur < 1) { toast("Запис закороткий"); return; }
      const blob = new Blob(chunks, { type: (mr.mimeType || type || "audio/webm").split(";")[0] });
      const data = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
      if (data.length > 400000) { toast("Голосове задовге"); return; }
      try { await sendMedia(r.ctx, "audio", data, Math.round(dur)); }
      catch (e) { console.error(e); toast(isMutedNow() ? "Ти в муті — зараз не можна писати" : "Не вдалося надіслати голосове"); }
    };
    mr.start(500); renderRec();
    rec.timer = setInterval(() => { renderRec(); if (rec && Date.now() - rec.t0 > 60000) stopRec(true); }, 250);
  });

  /* ===== Вимкнути сповіщення окремого чату ===== */
  const mutedChats = new Set(store.get("mutedChats", []));
  function renderMuteBtn() {
    const k = curKey(), q = !!k && mutedChats.has(k), b = $("#b-mute-chat");
    b.textContent = q ? "🔕" : "🔔";
    b.title = q ? "Увімкнути сповіщення цього чату" : "Вимкнути сповіщення цього чату";
    b.setAttribute("aria-label", b.title); b.setAttribute("aria-pressed", String(q));
  }
  $("#b-mute-chat").addEventListener("click", () => {
    const k = curKey(); if (!k) return;
    if (mutedChats.has(k)) mutedChats.delete(k); else mutedChats.add(k);
    store.set("mutedChats", [...mutedChats]); renderMuteBtn(); renderSwitch();
    toast(mutedChats.has(k) ? "🔕 Сповіщення цього чату вимкнено" : "🔔 Сповіщення цього чату увімкнено");
  });

  /* ===== Сповіщення браузера ===== */
  const notifOk = () => "Notification" in window && Notification.permission === "granted" && store.get("notif", false);
  function renderNotif() {
    const st = $("#notif-state"), b = $("#b-notif");
    if (!("Notification" in window)) {
      b.hidden = true;
      st.textContent = isIOS() && !isStandalone() ? "На iPhone спершу додай портал на екран «Додому» (нижче) і відкрий його звідти — тоді тут з'явиться кнопка." : "Цей браузер не підтримує сповіщення.";
      return;
    }
    if (Notification.permission === "denied") { b.hidden = true; st.textContent = "Сповіщення заборонені в налаштуваннях браузера для цього сайту."; return; }
    b.hidden = false;
    const on = notifOk();
    b.textContent = on ? "🔕 Вимкнути сповіщення" : "🔔 Увімкнути сповіщення";
    st.textContent = on ? "Увімкнено ✓" : "";
  }
  $("#b-notif").addEventListener("click", async () => {
    if (notifOk()) { store.set("notif", false); renderNotif(); return; }
    let p = "denied";
    try { p = await Notification.requestPermission(); } catch (e) { console.error(e); }
    store.set("notif", p === "granted"); renderNotif();
    if (p === "granted") notify("Сповіщення увімкнено", "Тепер ти не пропустиш нові повідомлення 🎉");
  });
  function notify(title, body) {
    if (!notifOk()) return;
    const opts = { body: String(body).slice(0, 140), icon: "icon-192.png", badge: "icon-192.png", tag: "portal-" + title };
    if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then(r => r.showNotification(title, opts)).catch(console.error);
    else { try { new Notification(title, opts); } catch (e) { console.error(e); } }
  }

  /* ===== Встановлення як додаток ===== */
  let installEvt = null, installOs = isIOS() ? "ios" : /Android/.test(navigator.userAgent) ? "android" : "pc";
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; renderInstall(); });
  window.addEventListener("appinstalled", () => { installEvt = null; toast("Портал встановлено 🎉"); renderInstall(); });
  const INSTALL_STEPS = {
    ios: ["Відкрий портал у <b>Safari</b>.", "Натисни <span class=\"kbd\">Поділитися ⬆️</span> (квадрат зі стрілкою внизу екрана).", "Прокрути вниз і обери <span class=\"kbd\">На екран «Додому» ➕</span>.", "Натисни <span class=\"kbd\">Додати</span> — на екрані з'явиться наш логотип. Відкривай портал звідти."],
    android: ["Відкрий портал у <b>Chrome</b>.", "Натисни кнопку «Встановити» вище або меню <span class=\"kbd\">⋮</span> угорі праворуч.", "Обери <span class=\"kbd\">Встановити додаток</span> чи <span class=\"kbd\">Додати на головний екран</span>.", "Підтверди — значок з'явиться серед додатків."],
    pc: ["Відкрий портал у <b>Chrome</b> або <b>Edge</b> і натисни кнопку «Встановити» вище.", "Або: значок <span class=\"kbd\">⊕</span> праворуч в адресному рядку → <span class=\"kbd\">Встановити</span>.", "На Mac у Safari: меню <span class=\"kbd\">Файл</span> → <span class=\"kbd\">Додати в Dock</span>.", "Портал відкриватиметься окремим вікном — його можна закріпити на панелі завдань."]
  };
  function renderInstall() {
    const done = isStandalone();
    $("#install-text").textContent = done ? "✓ Портал уже відкрито як додаток. Так тримати!" : "Додай портал на робочий стіл — він відкриватиметься окремим вікном з нашим логотипом, як справжній додаток.";
    $("#install-os").hidden = done; $("#install-steps").hidden = done;
    $("#b-install").hidden = done || !installEvt;
    $("#install-os").replaceChildren(...[["ios", "📱 iPhone / iPad"], ["android", "🤖 Android"], ["pc", "💻 Ноутбук"]].map(([k, t]) => {
      const b = el("button", "chip", t); b.type = "button"; b.setAttribute("aria-pressed", String(k === installOs));
      b.addEventListener("click", () => { installOs = k; renderInstall(); }); return b;
    }));
    $("#install-steps").innerHTML = INSTALL_STEPS[installOs].map(s => `<li>${s}</li>`).join("");
  }
  $("#b-install").addEventListener("click", async () => {
    if (!installEvt) return;
    installEvt.prompt();
    try { const r = await installEvt.userChoice; if (r.outcome === "accepted") toast("Встановлюємо… 📲"); } catch {}
    installEvt = null; renderInstall();
  });
  renderInstall(); renderNotif();

  /* ===== Свята: зворотний відлік і святкові теми ===== */
  function renderHolidays() {
    const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const list = (SCHOOL.holidays || []).map(h => {
      let d;
      if (/^\d{4}-/.test(h.date)) d = new Date(h.date + "T00:00:00");
      else { const [m, dd] = h.date.split("-").map(Number); d = new Date(now.getFullYear(), m - 1, dd); if (d < today) d = new Date(now.getFullYear() + 1, m - 1, dd); }
      return { ...h, d, days: Math.round((d - today) / 86400000) };
    }).filter(h => h.days >= 0).sort((a, b) => a.d - b.d).slice(0, 5);
    $("#hol-list").replaceChildren(...list.map(h => {
      const li = el("li"); li.append(el("span", null, `${h.emoji || "🎉"} ${h.name}`), el("b", null, h.days === 0 ? "сьогодні! 🎉" : h.days === 1 ? "завтра" : `через ${h.days} дн.`));
      return li;
    }));
  }
  const SEASON_FX = {
    halloween: { garland: "🎃 🦇 👻 🕸 🍬 🎃 🦇 👻 🕸 🍬 🎃 🦇", fall: ["🍂", "🦇", "🍁", "👻"] },
    newyear: { garland: "🎄 ✨ 🎁 ❄ 🎅 🎄 ✨ 🎁 ❄ 🎅 🎄 ✨", fall: ["❄", "❅", "❆", "✨"] },
    valentine: { garland: "💌 💖 🌹 💘 💌 💖 🌹 💘 💌 💖", fall: ["💖", "💗", "💕"] }
  };
  function currentSeason() {
    const pref = store.get("season", "auto");
    if (pref !== "auto") return SEASON_FX[pref] ? pref : "";
    const d = new Date(), md = (d.getMonth() + 1) * 100 + d.getDate();
    if (md >= 1020 && md <= 1102) return "halloween";
    if (md >= 1210 || md <= 114) return "newyear";
    if (md >= 210 && md <= 215) return "valentine";
    return "";
  }
  function applySeason() {
    const s = currentSeason(), fx = $("#season-fx");
    if (s) root.dataset.season = s; else delete root.dataset.season;
    $("#season-garland").textContent = s ? SEASON_FX[s].garland : "";
    fx.replaceChildren();
    if (!s) return;
    for (let i = 0; i < 14; i++) {
      const sp = el("span", null, SEASON_FX[s].fall[i % SEASON_FX[s].fall.length]);
      sp.style.left = (i * 7 + Math.random() * 5) + "%"; sp.style.fontSize = (14 + Math.random() * 14) + "px";
      sp.style.animationDuration = (10 + Math.random() * 10) + "s"; sp.style.animationDelay = (-Math.random() * 18) + "s";
      fx.append(sp);
    }
  }
  $("#season-sel").value = store.get("season", "auto");
  $("#season-sel").addEventListener("change", e => { store.set("season", e.target.value); applySeason(); });
  applySeason();

  /* ===== Мої нотатки ===== */
  function setupNotes() {
    portalSubs.push(onSnapshot(query(collection(db, "notes", me.uid, "items"), orderBy("at", "desc"), limit(50)), s => {
      const box = $("#notes"); box.replaceChildren();
      if (!s.size) { box.append(emptyEl("Нотаток поки немає.")); return; }
      s.docs.forEach(d => {
        const n = d.data({ serverTimestamps: "estimate" }), row = el("div", "note"), t = el("div");
        t.append(el("p", null, n.text), el("small", null, `${fmtDay(toDate(n.at))} ${fmtTime(toDate(n.at))}`));
        row.append(t, confirmButton("✕", "del", () => deleteDoc(d.ref)));
        box.append(row);
      });
    }, e => console.error(e)));
  }
  $("#f-note").addEventListener("submit", async e => {
    e.preventDefault();
    const t = $("#note-text").value.trim(); if (!t) return;
    try { await addDoc(collection(db, "notes", me.uid, "items"), { text: t.slice(0, 1000), at: serverTimestamp() }); $("#note-text").value = ""; }
    catch (ex) { console.error(ex); toast("Не вдалося зберегти нотатку"); }
  });

  /* ===== Хрестики-нулики ===== */
  let games = [], gameOpen = null, gamesLoaded = false;
  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  const winLine = b => LINES.find(([a, c, e]) => b[a] !== "." && b[a] === b[c] && b[a] === b[e]);
  const mySym = g => g.x === me.uid ? "x" : "o";
  const oppName = g => g.x === me.uid ? g.names.o : g.names.x;
  function setupGames() {
    portalSubs.push(onSnapshot(query(collection(db, "games"), where("players", "array-contains", me.uid)), s => {
      const before = new Set(games.map(g => g.id));
      games = s.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data({ serverTimestamps: "estimate" }) }));
      if (gamesLoaded) games.filter(g => g.status === "invited" && g.o === me.uid && !before.has(g.id)).forEach(g => { toast(`🎮 ${g.names.x} кличе тебе в хрестики-нулики!`); ping(); notify("🎮 Виклик", `${g.names.x} кличе тебе в хрестики-нулики`); });
      gamesLoaded = true;
      // Старі завершені ігри прибираємо самі.
      games.filter(g => g.status === "done" && toDate(g.at) && Date.now() - toDate(g.at) > 2 * 86400000).forEach(g => deleteDoc(g.ref).catch(() => {}));
      renderGames();
    }, e => console.error(e)));
    portalSubs.push(() => { games = []; gameOpen = null; gamesLoaded = false; });
    renderGames();
  }
  function renderGames() {
    if (!inPortal) return;
    const sel = $("#ttt-opp"), keep = sel.value, mc = myClass();
    const people = Object.entries(dir).filter(([id]) => id !== me.uid).sort((a, b) => a[1].name.localeCompare(b[1].name, "uk"));
    const opt = ([id, p]) => `<option value="${id}">${p.name.replace(/[<&>"]/g, "")}${p.cls ? ` (${p.cls})` : ""}</option>`;
    const mine = people.filter(([, p]) => mc && p.cls === mc), rest = people.filter(([, p]) => !(mc && p.cls === mc));
    sel.innerHTML = (people.length ? "" : `<option value="">Поки нікого немає</option>`)
      + (mine.length ? `<optgroup label="Мій клас">${mine.map(opt).join("")}</optgroup>` : "")
      + (rest.length ? `<optgroup label="${mine.length ? "Інші" : "Усі"}">${rest.map(opt).join("")}</optgroup>` : "");
    if (keep && people.some(([id]) => id === keep)) sel.value = keep;
    const list = $("#ttt-list"); list.replaceChildren();
    const order = { invited: 0, playing: 1, done: 2 };
    games.slice().sort((a, b) => order[a.status] - order[b.status] || (toDate(b.at) || 0) - (toDate(a.at) || 0)).forEach(g => {
      const row = el("div", "game-row"), acts = el("div", "acts"), btn = (t, fn, cls = "btn ghost sm") => { const b = el("button", cls, t); b.type = "button"; b.addEventListener("click", fn); acts.append(b); };
      let text;
      if (g.status === "invited" && g.o === me.uid) { text = `🎮 ${g.names.x} кличе тебе!`; btn("Прийняти", () => updateDoc(g.ref, { status: "playing", at: serverTimestamp() }).then(() => openGame(g.id)).catch(gameErr), "btn sm"); btn("Ні", () => updateDoc(g.ref, { status: "done", at: serverTimestamp() }).catch(gameErr)); }
      else if (g.status === "invited") { text = `Чекаємо, поки ${g.names.o} прийме…`; btn("Скасувати", () => deleteDoc(g.ref).catch(gameErr)); }
      else if (g.status === "playing") { text = `Гра з ${oppName(g)} · ${g.turn === mySym(g) ? "твій хід!" : "хід суперника"}`; btn("Відкрити", () => openGame(g.id), "btn sm"); }
      else { text = `${oppName(g)}: ${g.winner === "draw" ? "нічия 🤝" : !g.winner ? "відмовився" : g.winner === mySym(g) ? "ти переміг 🏆" : "ти програв"}`; if (g.winner) btn("Подивитися", () => openGame(g.id)); btn("✕", () => deleteDoc(g.ref).catch(gameErr)); }
      row.append(el("span", null, text), acts); list.append(row);
    });
    const waiting = games.filter(g => (g.status === "invited" && g.o === me.uid) || (g.status === "playing" && g.turn === mySym(g))).length;
    $("#games-count").textContent = String(waiting); $("#games-count").hidden = !waiting;
    renderGame();
  }
  const gameErr = e => { console.error(e); toast("Не вдалося"); };
  function openGame(id) { gameOpen = id; renderGame(); }
  function renderGame() {
    const g = games.find(x => x.id === gameOpen), wrap = $("#ttt-game");
    wrap.hidden = !g; if (!g) return;
    const sym = mySym(g), line = winLine(g.board), myTurn = g.status === "playing" && g.turn === sym;
    $("#ttt-status").textContent = g.status === "playing" ? (myTurn ? `Твій хід (${sym === "x" ? "❌" : "⭕"})` : `Хід ${oppName(g)}…`)
      : g.winner === "draw" ? "Нічия 🤝" : g.winner === sym ? "Ти переміг! 🏆" : g.winner ? `Переміг ${oppName(g)}` : "Гру скасовано";
    $("#ttt-board").replaceChildren(...[...g.board].map((c, i) => {
      const b = el("button", c === "." ? "" : c, c === "x" ? "✕" : c === "o" ? "○" : ""); b.type = "button";
      b.setAttribute("aria-label", `Клітинка ${i + 1}${c === "." ? "" : c === "x" ? ": хрестик" : ": нулик"}`);
      if (line && line.includes(i)) b.classList.add("win");
      b.disabled = !myTurn || c !== ".";
      b.addEventListener("click", () => move(g, i));
      return b;
    }));
    $("#ttt-resign").hidden = g.status !== "playing";
  }
  function move(g, i) {
    const board = g.board.slice(0, i) + mySym(g) + g.board.slice(i + 1), won = winLine(board);
    const winner = won ? mySym(g) : board.includes(".") ? "" : "draw";
    updateDoc(g.ref, { board, turn: mySym(g) === "x" ? "o" : "x", status: winner ? "done" : "playing", winner, at: serverTimestamp() }).catch(gameErr);
  }
  $("#ttt-invite").addEventListener("click", async () => {
    const o = $("#ttt-opp").value;
    if (!o || !dir[o]) { toast("Обери, з ким грати"); return; }
    if (viewAs) { toast("У режимі перегляду грати не можна"); return; }
    if (games.some(g => g.status !== "done" && g.players.includes(o))) { toast("З цією людиною вже є гра"); return; }
    try {
      await addDoc(collection(db, "games"), { x: me.uid, o, players: [me.uid, o], names: { x: profile.name, o: dir[o].name }, board: ".........", turn: "x", status: "invited", winner: "", at: serverTimestamp() });
      toast(`Виклик надіслано: ${dir[o].name}`);
    } catch (e) { gameErr(e); }
  });
  $("#ttt-resign").addEventListener("click", () => { const g = games.find(x => x.id === gameOpen); if (g) updateDoc(g.ref, { status: "done", winner: mySym(g) === "x" ? "o" : "x", at: serverTimestamp() }).catch(gameErr); });
  $("#ttt-close").addEventListener("click", () => { gameOpen = null; renderGame(); });

  /* ===== Вгадай число ===== */
  let guessN = 0, guessTries = 0;
  function newGuess() {
    guessN = 1 + Math.floor(Math.random() * 100); guessTries = 0;
    $("#guess-hint").textContent = "?"; $("#guess-n").value = "";
    const best = store.get("guessBest", 0);
    $("#guess-best").textContent = best ? `Твій рекорд: ${best} спроб` : "Рекорду ще немає.";
  }
  $("#guess-new").addEventListener("click", newGuess);
  $("#f-guess").addEventListener("submit", e => {
    e.preventDefault();
    const n = Number($("#guess-n").value);
    if (!Number.isInteger(n) || n < 1 || n > 100) { toast("Число від 1 до 100"); return; }
    guessTries++;
    if (n < guessN) $("#guess-hint").textContent = `${n}? Більше ⬆`;
    else if (n > guessN) $("#guess-hint").textContent = `${n}? Менше ⬇`;
    else {
      $("#guess-hint").textContent = `🎉 Так, ${n}! Спроб: ${guessTries}`;
      const best = store.get("guessBest", 0);
      if (!best || guessTries < best) { store.set("guessBest", guessTries); $("#guess-best").textContent = `Новий рекорд: ${guessTries} спроб! 🏆`; }
      setTimeout(newGuess, 2500);
    }
    $("#guess-n").select();
  });
  newGuess();
  setupMiniGames($("#minigames"), { store, toast });

  /* ===== Дошка для малювання класу ===== */
  const BD_COLORS = ["#1A1A2E", "#FF4D4D", "#FF9F1C", "#FFD60A", "#2EC4B6", "#3A86FF", "#8338EC", "#FF5FA2", "#6B4423"];
  let bdCls = null, bdStrokes = [], bdUnsub = null, bdColor = BD_COLORS[0], bdCur = null;
  const bdCanvas = $("#bd-canvas"), bdCtx = bdCanvas.getContext("2d");
  $("#bd-colors").replaceChildren(...BD_COLORS.map(c => {
    const b = el("button", "color-chip"); b.type = "button"; b.style.background = c; b.dataset.c = c;
    b.setAttribute("aria-label", "Колір " + c); b.setAttribute("aria-pressed", String(c === bdColor));
    b.addEventListener("click", () => { bdColor = c; $$("#bd-colors .color-chip").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.c === c))); if ($("#bd-w").value === "30") $("#bd-w").value = "7"; });
    return b;
  }));
  function setupBoard() {
    const pick = canPickClass(), sel = $("#bd-cls");
    $("#bd-cls-wrap").hidden = !pick;
    $("#bd-clear").hidden = !(isAdmin || isMod);
    if (pick && !sel.options.length) { sel.innerHTML = classOptions(); sel.value = String(myClass() || 6); }
    openBoard(pick ? Number(sel.value) : myClass());
    if (!setupBoard.cleanup) { setupBoard.cleanup = true; portalSubs.push(() => { bdUnsub && bdUnsub(); bdUnsub = null; bdCls = null; setupBoard.cleanup = false; }); }
  }
  $("#bd-cls").addEventListener("change", e => openBoard(Number(e.target.value)));
  function openBoard(cls) {
    if (!cls || cls === bdCls) return;
    bdUnsub && bdUnsub(); bdCls = cls; bdStrokes = []; drawBoard();
    $("#bd-title").textContent = `Дошка ${cls} класу`;
    bdUnsub = onSnapshot(query(collection(db, "boards", String(cls), "strokes"), orderBy("at"), limit(1500)),
      s => { bdStrokes = s.docs; drawBoard(); }, e => console.error(e));
  }
  function strokePath(pts, color, w) {
    bdCtx.strokeStyle = color; bdCtx.fillStyle = color; bdCtx.lineWidth = w; bdCtx.lineCap = "round"; bdCtx.lineJoin = "round";
    bdCtx.beginPath(); bdCtx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) bdCtx.lineTo(pts[i], pts[i + 1]);
    if (pts.length === 2 || (pts.length === 4 && pts[0] === pts[2] && pts[1] === pts[3])) bdCtx.lineTo(pts[0] + 0.1, pts[1]);
    bdCtx.stroke();
  }
  function drawBoard() {
    bdCtx.fillStyle = "#fff"; bdCtx.fillRect(0, 0, bdCanvas.width, bdCanvas.height);
    bdStrokes.forEach(d => { const s = d.data(); if (Array.isArray(s.pts) && s.pts.length >= 2) strokePath(s.pts, s.color, s.w); });
    if (bdCur) strokePath(bdCur.pts, bdCur.color, bdCur.w);
  }
  const bdPoint = e => { const r = bdCanvas.getBoundingClientRect(); return [Math.round((e.clientX - r.left) / r.width * bdCanvas.width), Math.round((e.clientY - r.top) / r.height * bdCanvas.height)]; };
  bdCanvas.addEventListener("pointerdown", e => {
    if (!bdCls || viewAs) return;
    if (isMutedNow()) { toast("Ти в муті — малювати не можна"); return; }
    bdCanvas.setPointerCapture(e.pointerId);
    const w = Number($("#bd-w").value);
    bdCur = { pts: bdPoint(e), color: w === 30 ? "#FFFFFF" : bdColor, w };
    drawBoard();
  });
  bdCanvas.addEventListener("pointermove", e => {
    if (!bdCur) return;
    const [x, y] = bdPoint(e), p = bdCur.pts, lx = p[p.length - 2], ly = p[p.length - 1];
    if (Math.hypot(x - lx, y - ly) < 4) return;
    p.push(x, y);
    strokePath([lx, ly, x, y], bdCur.color, bdCur.w);
  });
  const bdEnd = async () => {
    if (!bdCur) return;
    let pts = bdCur.pts; const s = bdCur; bdCur = null;
    if (pts.length === 2) pts = [pts[0], pts[1], pts[0], pts[1]];
    while (pts.length > 800) pts = pts.filter((_, i) => Math.floor(i / 2) % 2 === 0 || i >= pts.length - 2);
    try { await addDoc(collection(db, "boards", String(bdCls), "strokes"), { uid: me.uid, color: s.color, w: s.w, pts, at: serverTimestamp() }); }
    catch (e) { console.error(e); toast("Не вдалося намалювати"); drawBoard(); }
  };
  bdCanvas.addEventListener("pointerup", bdEnd);
  bdCanvas.addEventListener("pointercancel", bdEnd);
  $("#bd-undo").addEventListener("click", () => {
    const last = bdStrokes.filter(d => d.data().uid === me.uid).pop();
    if (!last) { toast("Твоїх ліній тут немає"); return; }
    deleteDoc(last.ref).catch(gameErr);
  });
  $("#bd-clear").addEventListener("click", async e => {
    const b = e.currentTarget;
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Точно очистити?"; setTimeout(() => { b.dataset.armed = ""; b.textContent = "🧹 Очистити дошку"; }, 3000); return; }
    b.dataset.armed = ""; b.textContent = "🧹 Очистити дошку"; b.disabled = true;
    try {
      for (let i = 0; i < bdStrokes.length; i += 400) { const bt = writeBatch(db); bdStrokes.slice(i, i + 400).forEach(d => bt.delete(d.ref)); await bt.commit(); }
      toast("Дошку очищено"); logAction(`Очистив дошку ${bdCls} класу`, "", "");
    } catch (ex) { gameErr(ex); }
    b.disabled = false;
  });

  /* ===== Голосування для всієї школи ===== */
  let spolls = [];
  function setupSpolls() {
    $("#b-spoll").hidden = !(isAdmin || isMod);
    portalSubs.push(onSnapshot(query(collection(db, "spolls"), orderBy("at", "desc"), limit(20)), s => { spolls = s.docs; renderSpolls(); }, e => console.error(e)));
  }
  function renderSpolls() {
    const box = $("#spolls"), staff = isAdmin || isMod; box.replaceChildren();
    $("#spolls-box").hidden = !spolls.length && !staff;
    if (!spolls.length) { box.append(emptyEl("Голосувань поки немає.")); return; }
    spolls.forEach(d => {
      const p = d.data(), votes = p.votes || {}, total = Object.keys(votes).length, mine = votes[me.uid], open = mine != null || p.closed || staff;
      const card = el("div", "poll spoll"), top = el("div", "top-line");
      top.append(el("b", null, "🗳 " + clean(p.q)), p.closed ? pill("завершено", "bad") : pill("триває", "ok"));
      card.append(top);
      p.opts.forEach((o, i) => {
        const n = Object.values(votes).filter(v => v === i).length, pct = total ? Math.round(n / total * 100) : 0;
        const b = el("button", "opt" + (mine === i ? " mine" : "")); b.type = "button"; b.disabled = !!p.closed;
        const fill = el("span", "fill"); fill.style.width = (open ? pct : 0) + "%";
        b.append(fill, el("span", null, (mine === i ? "✓ " : "") + clean(o)), el("span", "pct", open ? `${pct}% · ${n}` : ""));
        b.addEventListener("click", () => updateDoc(d.ref, { [`votes.${me.uid}`]: mine === i ? deleteField() : i }).catch(e => { console.error(e); toast("Не вдалося проголосувати"); }));
        card.append(b);
      });
      const foot = el("div", "acts");
      foot.append(el("small", "muted", `Голосів: ${total} · від ${p.name}` + (open ? "" : " · результати — після голосу")));
      if (staff) {
        if (!p.closed) { const c = el("button", "btn ghost sm", "Завершити"); c.type = "button"; c.addEventListener("click", () => updateDoc(d.ref, { closed: true }).catch(gameErr)); foot.append(c); }
        foot.append(confirmButton("Видалити", "btn ghost sm", () => deleteDoc(d.ref)));
      }
      card.append(foot); box.append(card);
    });
  }
  $("#b-spoll").addEventListener("click", () => {
    const f = $("#f-spoll"); f.hidden = !f.hidden; formErr(f);
    $("#sp-opts").replaceChildren(...[1, 2, 3, 4].map(i => { const x = el("input"); x.maxLength = 60; x.placeholder = `${i}-й варіант` + (i > 2 ? " (необов'язково)" : ""); x.setAttribute("aria-label", `${i}-й варіант`); return x; }));
    if (!f.hidden) $("#sp-q").focus();
  });
  $("#sp-cancel").addEventListener("click", () => { $("#f-spoll").hidden = true; });
  $("#f-spoll").addEventListener("submit", async e => {
    e.preventDefault(); const f = e.target; formErr(f);
    const q = $("#sp-q").value.trim(), opts = $$("#sp-opts input").map(x => x.value.trim()).filter(Boolean);
    if (q.length < 2) { formErr(f, "Напиши питання."); return; }
    if (opts.length < 2) { formErr(f, "Потрібно щонайменше 2 варіанти."); return; }
    try {
      await addDoc(collection(db, "spolls"), { q, opts, votes: {}, by: me.uid, name: profile.name, closed: false, at: serverTimestamp() });
      f.hidden = true; $("#sp-q").value = ""; toast("Голосування опубліковано"); logAction("Створив голосування школи", "", q);
    } catch (ex) { console.error(ex); formErr(f, "Не вдалося опублікувати."); }
  });

  /* ===== Вікно для всіх при вході ===== */
  let popupDoc = null;
  function setupPopup() {
    portalSubs.push(onSnapshot(doc(db, "meta", "popup"), s => {
      popupDoc = s.exists() ? s.data() : null;
      const on = !!(popupDoc && popupDoc.on);
      $("#popup-state").textContent = on ? "показується" : "вимкнено"; $("#popup-state").className = "pill " + (on ? "ok" : "");
      if (isAdmin && popupDoc && !$("#pp-title").value && !$("#pp-text").value) { $("#pp-title").value = popupDoc.title || ""; $("#pp-text").value = popupDoc.text || ""; }
      if (!on || store.get("popupSeen", "") === popupDoc.id) return;
      $("#popup-title").textContent = popupDoc.title || "Увага!";
      $("#popup-text").textContent = popupDoc.text || "";
      const dlg = $("#popup-dlg"); dlg.dataset.id = popupDoc.id;
      if (!dlg.open) dlg.showModal();
    }, () => {}));
  }
  const popupSeen = () => store.set("popupSeen", $("#popup-dlg").dataset.id || "");
  $("#popup-ok").addEventListener("click", () => { popupSeen(); $("#popup-dlg").close(); });
  $("#popup-dlg").addEventListener("cancel", popupSeen);
  async function setPopup(on) {
    const title = $("#pp-title").value.trim(), text = $("#pp-text").value.trim();
    if (on && !text) { toast("Напиши текст вікна"); return; }
    const id = on ? Date.now().toString(36) : (popupDoc && popupDoc.id) || "none";
    if (on) store.set("popupSeen", id);
    try {
      await setDoc(doc(db, "meta", "popup"), { on, title: title.slice(0, 80), text: text.slice(0, 600), id, at: serverTimestamp() });
      toast(on ? "Вікно побачать усі при вході" : "Вікно прибрано"); logAction(on ? "Показав вікно для всіх" : "Прибрав вікно для всіх", "", title);
    } catch (e) { gameErr(e); }
  }
  $("#pp-show").addEventListener("click", () => setPopup(true));
  $("#pp-hide").addEventListener("click", () => setPopup(false));

  /* ===== Автовидалення старих повідомлень ===== */
  let retention = 0, cleanupTimer = null;
  function setupRetention() {
    portalSubs.push(onSnapshot(doc(db, "meta", "settings"), s => {
      retention = s.exists() ? s.data().retention || 0 : 0;
      $("#ret-sel").value = String(retention);
      clearTimeout(cleanupTimer); cleanupTimer = setTimeout(() => runCleanup(false), 5000);
    }, () => {}));
    portalSubs.push(() => clearTimeout(cleanupTimer));
  }
  $("#ret-sel").addEventListener("change", async e => {
    const v = Number(e.target.value);
    try {
      await setDoc(doc(db, "meta", "settings"), { retention: v, at: serverTimestamp() });
      toast(v ? `Повідомлення старші за ${e.target.selectedOptions[0].textContent} видалятимуться` : "Автовидалення вимкнено");
      logAction(v ? `Увімкнув автовидалення: ${v} днів` : "Вимкнув автовидалення", "", "");
      if (v) runCleanup(true);
    } catch (ex) { gameErr(ex); }
  });
  async function runCleanup(force) {
    if (!isAdmin || !retention || !inPortal) return;
    const key = "cleanup." + isoDay(new Date());
    if (!force && store.get(key, 0)) return;
    store.set(key, 1);
    const cut = Timestamp.fromDate(new Date(Date.now() - retention * 86400000)), targets = [];
    CLASSES.forEach(n => targets.push([collection(db, "classes", String(n), "messages"), "createdAt"], [collection(db, "classes", String(n), "media"), "at"]));
    groups.forEach(g => targets.push([collection(db, "groups", g.id, "messages"), "createdAt"], [collection(db, "groups", g.id, "media"), "at"]));
    let n = 0;
    for (const [col, f] of targets) {
      try {
        const s = await getDocs(query(col, where(f, "<", cut), limit(400)));
        if (!s.size) continue;
        const b = writeBatch(db); s.docs.forEach(d => b.delete(d.ref)); await b.commit(); n += s.size;
      } catch (e) { console.error(e); }
    }
    if (n) { toast(`Автоочистка: видалено старих записів — ${n}`); logAction(`Автоочистка: видалено ${n}`, "", ""); }
  }

  /* ===== Подивитися як учень ===== */
  function setupViewAs() {
    $("#va-cls").innerHTML = classOptions(); $("#va-cls").value = String(myClass() || 6);
  }
  $("#va-go").addEventListener("click", () => {
    try { sessionStorage.setItem("portal.viewAs", $("#va-cls").value); } catch {}
    location.reload();
  });
  $("#viewas-exit").addEventListener("click", () => {
    try { sessionStorage.removeItem("portal.viewAs"); } catch {}
    location.reload();
  });

  /* ===== Чемпіон минулого місяця (рамка) ===== */
  let champOf = {};
  async function loadChamps(mc) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
    const prev = isoDay(d).slice(0, 7), box = $("#qz-champ");
    try {
      const s = await getDocs(query(collection(db, "quiz"), where("month", "==", prev), where("cls", "==", mc)));
      const score = {};
      s.docs.forEach(x => { const r = x.data(); if (r.ok) { score[r.uid] = score[r.uid] || { name: r.name, n: 0 }; score[r.uid].n++; } });
      const best = Math.max(0, ...Object.values(score).map(v => v.n));
      const champs = best ? Object.entries(score).filter(([, v]) => v.n === best) : [];
      champOf = {}; champs.forEach(([u]) => { champOf[u] = prev; });
      box.textContent = champs.length ? `🏅 Чемпіон минулого місяця: ${champs.map(([, v]) => v.name).join(", ")} (${best} ✓). Нагорода — рамка «Чемпіон»!` : "";
      box.hidden = !champs.length;
      if (inPortal) { renderProfileForm(); if (!$("#p-profile").hidden) renderProfileView(); }
    } catch (e) { console.error(e); }
  }

  /* ===== Історії (як в Instagram) ===== */
  const STORY_TTL = 24 * 3600 * 1000, STORY_MAX_SEC = 15, PART = 680000;
  let stories = [], storyQueue = [], svGroup = 0, svIdx = 0, svTimer = null, svRaf = null;
  const storyBlobs = new Map(), storyGone = new Set();
  const storyAge = s => Date.now() - (toDate(s.at) || new Date()).getTime();
  function setupStories() {
    portalSubs.push(onSnapshot(query(collection(db, "stories"), orderBy("at", "desc"), limit(300)), s => {
      stories = s.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data({ serverTimestamps: "estimate" }) }));
      // Прострочені історії прибирає автор або модератор.
      stories.filter(x => storyAge(x) > STORY_TTL && (x.uid === me.uid || isAdmin || isMod) && !storyGone.has(x.id))
        .forEach(x => { storyGone.add(x.id); deleteStory(x.ref, x.parts).catch(() => {}); });
      renderStoriesBar();
    }, e => console.error(e)));
    portalSubs.push(() => { stories = []; closeStory(); });
  }
  const liveStories = () => stories.filter(x => storyAge(x) <= STORY_TTL);
  function storyGroups() {
    const by = {};
    liveStories().slice().reverse().forEach(x => { (by[x.uid] = by[x.uid] || []).push(x); });
    return Object.entries(by).map(([uid, list]) => ({ uid, list, unseen: uid !== me.uid && list.some(x => !(x.seen || {})[me.uid]), last: Math.max(...list.map(x => (toDate(x.at) || new Date()).getTime())) }))
      .sort((a, b) => (b.uid === me.uid) - (a.uid === me.uid) || b.unseen - a.unseen || b.last - a.last);
  }
  function storyAva(uid) { const p = profs[uid] || {}; return { emoji: p.emoji || "🙂", color: COLORS[p.color] || "" }; }
  function renderStoriesBar() {
    const box = $("#stories"); if (!box) return;
    const groups = storyGroups(), chips = [];
    if (!viewAs) {
      const add = el("button", "story-chip add"); add.type = "button";
      const ring = el("span", "story-ring"); ring.append(el("span", null, "＋"));
      add.append(ring, el("small", null, "Твоя історія"));
      add.addEventListener("click", openStoryNew);
      chips.push(add);
    }
    groups.forEach((g, gi) => {
      const b = el("button", "story-chip" + (g.unseen || g.uid === me.uid ? "" : " seen")); b.type = "button";
      const a = storyAva(g.uid), ring = el("span", "story-ring"), face = el("span", null, a.emoji);
      if (a.color) face.style.background = `color-mix(in srgb, ${a.color} 35%, var(--surface))`;
      ring.append(face);
      b.append(ring, el("small", null, g.uid === me.uid ? "Ти" : (dir[g.uid] ? dir[g.uid].name : g.list[0].name).split(" ")[0]));
      b.setAttribute("aria-label", `Історії: ${g.list[0].name}`);
      b.addEventListener("click", () => openStory(gi));
      chips.push(b);
    });
    box.replaceChildren(...chips);
    box.hidden = !chips.length;
  }

  // ---- Перегляд ----
  function openStory(gi) {
    storyQueue = storyGroups(); svGroup = gi;
    const g = storyQueue[gi]; if (!g) return;
    const firstUnseen = g.list.findIndex(x => !(x.seen || {})[me.uid]);
    svIdx = g.uid !== me.uid && firstUnseen >= 0 ? firstUnseen : 0;
    const dlg = $("#story-view"); if (!dlg.open) dlg.showModal();
    showStory();
  }
  function stopStoryMedia() {
    clearTimeout(svTimer); cancelAnimationFrame(svRaf);
    $$("#sv-media video").forEach(v => v.pause());
  }
  function closeStory() { stopStoryMedia(); const d = $("#story-view"); if (d && d.open) d.close(); $("#sv-media").replaceChildren(); renderStoriesBar(); }
  function stepStory(dir) {
    const g = storyQueue[svGroup]; if (!g) return closeStory();
    svIdx += dir;
    if (svIdx >= g.list.length) { svGroup++; svIdx = 0; if (!storyQueue[svGroup]) return closeStory(); }
    else if (svIdx < 0) { svGroup--; if (svGroup < 0) { svGroup = 0; svIdx = 0; } else svIdx = storyQueue[svGroup].list.length - 1; }
    showStory();
  }
  async function storyUrl(s) {
    if (storyBlobs.has(s.id)) return storyBlobs.get(s.id);
    const snap = await getDocs(collection(db, "stories", s.id, "parts"));
    const parts = snap.docs.filter(d => d.data().uid === s.uid).sort((a, b) => Number(a.id) - Number(b.id)).map(d => d.data().data);
    if (parts.length < s.parts) throw new Error("parts");
    const bin = atob(parts.join("")), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: s.mime }));
    storyBlobs.set(s.id, url);
    return url;
  }
  function setBar(i, frac) { const b = $$("#sv-bars i b")[i]; if (b) b.style.width = Math.min(100, frac * 100) + "%"; }
  async function showStory() {
    stopStoryMedia();
    const g = storyQueue[svGroup], s = g && g.list[svIdx]; if (!s) return closeStory();
    const mine = s.uid === me.uid, a = storyAva(s.uid);
    $("#sv-bars").replaceChildren(...g.list.map((_, i) => { const t = el("i"); const b = el("b"); b.style.width = i < svIdx ? "100%" : "0"; t.append(b); return t; }));
    $("#sv-ava").textContent = a.emoji; $("#sv-ava").style.background = a.color || "";
    $("#sv-name").textContent = mine ? "Ти" : s.name;
    const ago = Math.max(1, Math.round(storyAge(s) / 60000));
    $("#sv-time").textContent = ago < 60 ? `${ago} хв тому` : `${Math.round(ago / 60)} год тому`;
    $("#sv-cap").textContent = s.caption ? clean(s.caption) : "";
    const likes = Object.keys(s.likes || {}).length, views = Object.keys(s.seen || {}).length, liked = !!(s.likes || {})[me.uid];
    $("#sv-like").textContent = liked ? "❤️" : "🤍"; $("#sv-like").hidden = mine;
    $("#sv-views").textContent = mine ? `👁 ${views} · ❤️ ${likes}` : (likes ? `❤️ ${likes}` : "");
    $("#sv-del").hidden = !(mine || isAdmin || isMod);
    $("#sv-report").hidden = mine;
    if (!mine && !(s.seen || {})[me.uid] && !viewAs) updateDoc(s.ref, { [`seen.${me.uid}`]: true }).catch(() => {});
    const media = $("#sv-media"); media.replaceChildren(el("span", "muted", "Завантаження…"));
    let url;
    try { url = await storyUrl(s); } catch (e) { console.error(e); media.replaceChildren(el("span", "muted", "Не вдалося завантажити історію")); svTimer = setTimeout(() => stepStory(1), 2500); return; }
    if (storyQueue[svGroup] !== g || g.list[svIdx] !== s) return;
    if (s.kind === "img") {
      const img = el("img"); img.src = url; img.alt = s.caption || "Історія"; media.replaceChildren(img);
      const t0 = performance.now(), D = 5000;
      const tick = () => { const f = (performance.now() - t0) / D; setBar(svIdx, f); if (f >= 1) stepStory(1); else svRaf = requestAnimationFrame(tick); };
      svRaf = requestAnimationFrame(tick);
    } else {
      const v = el("video"); v.src = url; v.playsInline = true; v.autoplay = true; v.setAttribute("playsinline", "");
      media.replaceChildren(v);
      v.addEventListener("ended", () => stepStory(1));
      v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
      const tick = () => { const d = isFinite(v.duration) && v.duration ? v.duration : (s.dur || 15); setBar(svIdx, v.currentTime / d); svRaf = requestAnimationFrame(tick); };
      svRaf = requestAnimationFrame(tick);
    }
  }
  const curStory = () => { const g = storyQueue[svGroup]; return g && g.list[svIdx]; };
  $("#sv-x").addEventListener("click", closeStory);
  $("#story-view").addEventListener("cancel", e => { e.preventDefault(); closeStory(); });
  $("#sv-next").addEventListener("click", () => stepStory(1));
  $("#sv-prev").addEventListener("click", () => stepStory(-1));
  $("#story-view").addEventListener("keydown", e => { if (e.key === "ArrowRight") stepStory(1); if (e.key === "ArrowLeft") stepStory(-1); });
  $("#sv-like").addEventListener("click", () => {
    const s = curStory(); if (!s || viewAs) return;
    const on = !(s.likes || {})[me.uid];
    s.likes = { ...(s.likes || {}) }; if (on) s.likes[me.uid] = true; else delete s.likes[me.uid];
    $("#sv-like").textContent = on ? "❤️" : "🤍";
    updateDoc(s.ref, { [`likes.${me.uid}`]: on ? true : deleteField() }).catch(e => { console.error(e); toast("Не вдалося"); });
  });
  $("#sv-del").addEventListener("click", async e => {
    const b = e.currentTarget, s = curStory(); if (!s) return;
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Точно?"; setTimeout(() => { b.dataset.armed = ""; b.textContent = "Видалити"; }, 3000); return; }
    b.dataset.armed = ""; b.textContent = "Видалити";
    try {
      await deleteStory(s.ref, s.parts);
      if (s.uid !== me.uid) logAction("Видалив історію", s.uid, s.name);
      toast("Історію видалено"); closeStory();
    } catch (ex) { console.error(ex); toast("Не вдалося видалити"); }
  });
  $("#sv-report").addEventListener("click", async e => {
    const b = e.currentTarget, s = curStory(); if (!s) return;
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Точно?"; setTimeout(() => { b.dataset.armed = ""; b.textContent = "Поскаржитися"; }, 3000); return; }
    b.dataset.armed = ""; b.textContent = "Поскаржитися";
    try {
      await addDoc(collection(db, "reports"), { path: s.ref.path, text: (s.kind === "video" ? "🎬 Історія-відео" : "📷 Історія-фото") + (s.caption ? `: ${s.caption}` : ""), author: s.uid, authorName: s.name, by: me.uid, byName: profile.name, status: "open", createdAt: serverTimestamp() });
      toast("Скаргу надіслано модераторам");
    } catch (ex) { console.error(ex); toast("Не вдалося надіслати скаргу"); }
  });
  async function deleteStory(ref, parts = 5) {
    const b = writeBatch(db);
    for (let i = 0; i < Math.max(1, Math.min(5, parts || 5)); i++) b.delete(doc(db, ref.path, "parts", String(i)));
    b.delete(ref);
    await b.commit();
  }

  // ---- Нова історія ----
  let snPending = null, snStream = null, snRec = null, snFacing = "user";
  function snReset() {
    snStopCam();
    if (snPending && snPending.url) URL.revokeObjectURL(snPending.url);
    snPending = null; $("#sn-post").disabled = true; $("#sn-err").textContent = "";
    $("#sn-preview").replaceChildren(el("span", "muted small", "Обери фото чи відео або зніми нове."));
    $("#sn-cam-ctl").hidden = true;
  }
  function openStoryNew() {
    if (viewAs) { toast("У режимі перегляду публікувати не можна"); return; }
    if (isMutedNow()) { toast("Ти в муті — зараз не можна публікувати"); return; }
    snReset(); $("#sn-cap").value = "";
    $("#story-new").showModal();
  }
  function snSetPending(p) {
    if (snPending && snPending.url) URL.revokeObjectURL(snPending.url);
    snPending = p; p.url = URL.createObjectURL(p.blob);
    const prev = $("#sn-preview");
    if (p.kind === "img") { const i = el("img"); i.src = p.url; i.alt = "Попередній перегляд"; prev.replaceChildren(i); }
    else { const v = el("video"); v.src = p.url; v.controls = true; v.playsInline = true; v.setAttribute("playsinline", ""); prev.replaceChildren(v); }
    $("#sn-post").disabled = false;
  }
  const snErr = t => { $("#sn-err").textContent = t || ""; };
  $("#sn-cancel").addEventListener("click", () => { snReset(); $("#story-new").close(); });
  $("#story-new").addEventListener("close", () => snStopCam());
  $("#sn-photo").addEventListener("click", () => { snStopCam(); $("#sn-file-img").click(); });
  $("#sn-video").addEventListener("click", () => { snStopCam(); $("#sn-file-vid").click(); });
  $("#sn-file-img").addEventListener("change", async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return; snErr();
    try {
      const data = await shrinkImage(f);
      const blob = await (await fetch(data)).blob();
      snSetPending({ kind: "img", blob, mime: "image/jpeg", dur: 5 });
    } catch (ex) { console.error(ex); snErr("Не вдалося відкрити фото"); }
  });
  $("#sn-file-vid").addEventListener("change", async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return; snErr();
    $("#sn-post").disabled = true;
    const prog = el("span", "muted small", "Обробляю відео…"); $("#sn-preview").replaceChildren(prog);
    try {
      const r = await transcodeVideo(f, sec => { prog.textContent = `Обробляю відео… ${Math.floor(sec)} з ${STORY_MAX_SEC} с`; });
      snSetPending({ kind: "video", blob: r.blob, mime: r.mime, dur: r.dur });
      if (r.cut) toast(`Відео обрізано до ${STORY_MAX_SEC} секунд`);
    } catch (ex) { console.error(ex); snErr(ex.message === "big" ? "Відео завелике — спробуй коротше." : "Цей браузер не зміг обробити відео. Спробуй «Зняти відео»."); $("#sn-preview").replaceChildren(); }
  });
  const recType = () => ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
  // Перекодовує відео з галереї в маленьке (до 480 px, до 15 с), щоб воно вмістилося в базу.
  async function transcodeVideo(file, onProgress) {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) throw new Error("unsupported");
    const src = URL.createObjectURL(file), v = document.createElement("video");
    v.src = src; v.playsInline = true; v.preload = "auto";
    try {
      await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error("load")); });
      const k = Math.min(1, 480 / Math.max(v.videoWidth || 480, v.videoHeight || 480));
      const c = document.createElement("canvas");
      c.width = Math.max(2, Math.round((v.videoWidth || 480) * k / 2) * 2); c.height = Math.max(2, Math.round((v.videoHeight || 480) * k / 2) * 2);
      const g = c.getContext("2d"), stream = c.captureStream(24);
      let ac = null;
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        const dest = ac.createMediaStreamDestination();
        ac.createMediaElementSource(v).connect(dest);
        dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
      } catch (e) { console.warn("audio", e); v.muted = true; }
      const type = recType(), chunks = [];
      const mr = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 450000, audioBitsPerSecond: 32000 });
      mr.ondataavailable = ev => { if (ev.data.size) chunks.push(ev.data); };
      const limit = Math.min(isFinite(v.duration) ? v.duration : STORY_MAX_SEC, STORY_MAX_SEC);
      const done = new Promise(res => { mr.onstop = res; });
      try { await v.play(); } catch { v.muted = true; await v.play(); }
      if (ac && ac.state === "suspended") await ac.resume().catch(() => {});
      mr.start(500);
      await new Promise(res => {
        const draw = () => {
          g.drawImage(v, 0, 0, c.width, c.height); onProgress && onProgress(v.currentTime);
          if (v.ended || v.currentTime >= limit) return res();
          requestAnimationFrame(draw);
        };
        draw();
      });
      v.pause(); mr.stop(); await done;
      ac && ac.close().catch(() => {});
      const blob = new Blob(chunks, { type: (mr.mimeType || type || "video/webm").split(";")[0] });
      if (blob.size > PART * 5 * 3 / 4) throw new Error("big");
      return { blob, mime: blob.type || "video/webm", dur: Math.round(Math.min(limit, v.currentTime) * 10) / 10, cut: isFinite(v.duration) && v.duration > STORY_MAX_SEC + 0.5 };
    } finally { URL.revokeObjectURL(src); }
  }
  // ---- Камера ----
  async function snStartCam() {
    snStopCam();
    if (!navigator.mediaDevices || !window.MediaRecorder) { snErr("Цей браузер не вміє знімати відео"); return; }
    try { snStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: snFacing, width: { ideal: 480 }, height: { ideal: 640 } }, audio: true }); }
    catch (e) { console.error(e); snErr("Дозволь доступ до камери й мікрофона в налаштуваннях браузера"); return; }
    const v = el("video"); v.muted = true; v.playsInline = true; v.autoplay = true; v.setAttribute("playsinline", ""); v.srcObject = snStream;
    $("#sn-preview").replaceChildren(v); v.play().catch(() => {});
    $("#sn-cam-ctl").hidden = false; $("#sn-rec").textContent = "⏺ Почати запис"; $("#sn-rec").classList.remove("rec"); $("#sn-rec-t").textContent = "";
    $("#sn-post").disabled = true;
  }
  function snStopCam() {
    if (snRec) { snRec.cancel = true; clearInterval(snRec.timer); try { snRec.mr.stop(); } catch {} snRec = null; }
    if (snStream) { snStream.getTracks().forEach(t => t.stop()); snStream = null; }
  }
  $("#sn-cam").addEventListener("click", () => { snErr(); snStartCam(); });
  $("#sn-flip").addEventListener("click", () => { if (snRec) return; snFacing = snFacing === "user" ? "environment" : "user"; snStartCam(); });
  $("#sn-rec").addEventListener("click", () => {
    if (snRec) { snRec.mr.stop(); return; }
    if (!snStream) return;
    const type = recType(), chunks = [];
    const mr = new MediaRecorder(snStream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 450000, audioBitsPerSecond: 32000 });
    const rec = snRec = { mr, t0: Date.now() };
    mr.ondataavailable = ev => { if (ev.data.size) chunks.push(ev.data); };
    mr.onstop = () => {
      clearInterval(rec.timer);
      const dur = Math.min(STORY_MAX_SEC, (Date.now() - rec.t0) / 1000);
      if (snRec === rec) snRec = null;
      if (rec.cancel) return;
      if (snStream) { snStream.getTracks().forEach(t => t.stop()); snStream = null; }
      $("#sn-cam-ctl").hidden = true;
      if (dur < 1) { snErr("Запис закороткий"); return; }
      const blob = new Blob(chunks, { type: (mr.mimeType || type || "video/webm").split(";")[0] });
      if (blob.size > PART * 5 * 3 / 4) { snErr("Відео завелике — спробуй коротше."); return; }
      snSetPending({ kind: "video", blob, mime: blob.type || "video/webm", dur: Math.round(dur * 10) / 10 });
    };
    mr.start(500);
    $("#sn-rec").textContent = "⏹ Зупинити"; $("#sn-rec").classList.add("rec");
    rec.timer = setInterval(() => {
      const t = (Date.now() - rec.t0) / 1000;
      $("#sn-rec-t").textContent = `${Math.floor(t)} / ${STORY_MAX_SEC} с`;
      if (t >= STORY_MAX_SEC) mr.stop();
    }, 200);
  });
  // ---- Публікація ----
  async function blobToB64(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  }
  $("#sn-post").addEventListener("click", async () => {
    const p = snPending; if (!p) return;
    const btn = $("#sn-post"); btn.disabled = true; btn.textContent = "Публікую…"; snErr();
    try {
      const b64 = await blobToB64(p.blob), parts = [];
      for (let i = 0; i < b64.length; i += PART) parts.push(b64.slice(i, i + PART));
      if (parts.length > 5) throw new Error("big");
      const ref = doc(collection(db, "stories")), batch = writeBatch(db);
      parts.forEach((data, i) => batch.set(doc(db, "stories", ref.id, "parts", String(i)), { uid: me.uid, data }));
      const cap = clean($("#sn-cap").value.trim()).slice(0, 120);
      batch.set(ref, { uid: me.uid, name: profile.name, kind: p.kind, mime: p.mime, parts: parts.length, dur: Math.min(16, p.dur || 0), ...(cap ? { caption: cap } : {}), cls: myClass() || 0, seen: {}, likes: {}, at: serverTimestamp() });
      await batch.commit();
      storyBlobs.set(ref.id, URL.createObjectURL(p.blob));
      snReset(); $("#story-new").close(); toast("Історію опубліковано ✨");
    } catch (ex) { console.error(ex); snErr(ex.message === "big" ? "Файл завеликий — спробуй коротше відео." : isMutedNow() ? "Ти в муті — зараз не можна публікувати." : "Не вдалося опублікувати. Перевір інтернет."); }
    finally { btn.textContent = "Опублікувати"; btn.disabled = !snPending; }
  });

  /* ===== Учні: порівняння списку класу з тими, хто на порталі ===== */
  let rosters = {}, roCls = null;
  function setupRoster() {
    roCls = roCls || myClass() || 6;
    $("#f-roster").hidden = !isAdmin;
    portalSubs.push(onSnapshot(collection(db, "roster"), s => {
      rosters = {}; s.docs.forEach(d => { rosters[d.id] = d.data().names || []; });
      if (document.activeElement !== $("#ro-names")) $("#ro-names").value = (rosters[roCls] || []).join("\n");
      renderRoster();
    }, e => console.error(e)));
  }
  // «Коваленко Андрій» і «андрій коваленко» — та сама людина.
  const nameTokens = n => String(n).toLowerCase().replace(/[ʼ’'`]/g, "'").replace(/ё/g, "е").split(/[\s,.-]+/).filter(Boolean);
  function rosterMatch(rosterName, people) {
    const rt = nameTokens(rosterName);
    const hits = people.filter(p => {
      const pt = nameTokens(p.name), inter = pt.filter(t => rt.includes(t)).length;
      return inter > 0 && inter === Math.min(pt.length, rt.length);
    });
    // Якщо збіг лише за одним словом (наприклад, тільки ім'я) — приймаємо, коли він єдиний.
    const strong = hits.filter(p => nameTokens(p.name).filter(t => rt.includes(t)).length >= 2);
    return strong[0] || (hits.length === 1 ? hits[0] : null);
  }
  function renderRoster() {
    if (!(isAdmin || isMod) || !inPortal || !roCls) return;
    // Хто на порталі: адмін бачить усі заявки, модератор — лише схвалених.
    const people = isAdmin
      ? apps.map(d => ({ id: d.id, ...d.data() })).filter(p => classOf(p) === roCls).map(p => ({ id: p.id, name: p.name, status: p.status }))
      : Object.entries(dir).filter(([, p]) => p.cls === roCls).map(([id, p]) => ({ id, name: p.name, status: "approved" }));
    $("#ro-class").innerHTML = CLASSES.map(n => {
      const list = rosters[String(n)] || [];
      return `<button class="chip" type="button" data-c="${n}" aria-pressed="${n === roCls}">${n} клас${list.length ? ` (${list.length})` : ""}</button>`;
    }).join("");
    $$("#ro-class .chip").forEach(c => c.addEventListener("click", () => { roCls = Number(c.dataset.c); $("#ro-names").value = (rosters[roCls] || []).join("\n"); renderRoster(); }));
    const names = rosters[String(roCls)] || [];
    $("#ro-title").textContent = `Учні · ${roCls} клас`;
    const used = new Set(), body = $("#ro-rows"); body.replaceChildren();
    let reg = 0;
    if (!names.length) {
      const tr = el("tr"), td = el("td", "muted", isAdmin ? "Список класу ще не додано. Встав його у формі нижче." : "Адміністратор ще не додав список цього класу.");
      td.colSpan = 3; tr.append(td); body.append(tr);
    }
    const ST = { approved: ["✅ на порталі", "ok"], pending: ["⏳ подав заявку", "wait"], kicked: ["🚫 кікнутий", "bad"], rejected: ["✖ заявку відхилено", "bad"] };
    names.forEach(n => {
      const p = rosterMatch(n, people.filter(x => !used.has(x.id)));
      if (p) used.add(p.id);
      if (p && p.status === "approved") reg++;
      const [txt, cls] = p ? (ST[p.status] || ST.pending) : ["❌ ще не зареєструвався", "no"];
      const tr = el("tr");
      tr.append(el("td", null, n), el("td", "st " + cls, txt), el("td", p ? null : "muted", p ? p.name : "—"));
      body.append(tr);
    });
    $("#ro-summary").textContent = names.length ? `На порталі: ${reg} з ${names.length}` : "";
    const extra = people.filter(p => !used.has(p.id) && p.status === "approved");
    $("#ro-extra-box").hidden = !names.length || !extra.length;
    $("#ro-extra").replaceChildren(...extra.map(p => el("div", "small", `${p.name} — можливо, ім'я записано інакше або це не учень цього класу`)));
  }
  $("#f-roster").addEventListener("submit", async e => {
    e.preventDefault(); const f = e.target; formErr(f);
    const names = [...new Set($("#ro-names").value.split("\n").map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean))].map(s => s.slice(0, 60));
    if (names.length > 60) { formErr(f, "Не більше 60 учнів в одному класі."); return; }
    const btn = $("button[type=submit]", f); btn.disabled = true;
    try {
      await setDoc(doc(db, "roster", String(roCls)), { names, at: serverTimestamp() });
      $("#ro-names").value = names.join("\n");
      toast(`Список ${roCls} класу збережено: ${names.length}`);
      logAction(`Оновив список ${roCls} класу (${names.length})`, "", "");
    } catch (ex) { console.error(ex); formErr(f, "Не вдалося зберегти список."); }
    finally { btn.disabled = false; }
  });

  /* ===== Профіль: аватарка-емодзі, колір, день народження ===== */
  const COLORS = { violet: "#9C8CFF", pink: "#FF6FD8", cyan: "#4FD3EA", green: "#4FD08F", yellow: "#FFC93C", orange: "#FF9F43", red: "#FF7A82", blue: "#6FA8FF" };
  const COLOR_NAMES = { violet: "Фіолетовий", pink: "Рожевий", cyan: "Бірюзовий", green: "Зелений", yellow: "Жовтий", orange: "Помаранчевий", red: "Червоний", blue: "Синій" };
  const EMOJIS = ["😎", "🦊", "🐱", "🐶", "🐼", "🦁", "🐸", "🐧", "🦄", "🐲", "👾", "🤖", "👻", "🚀", "⚽", "🏀", "🎮", "🎧", "🎨", "📚", "🌟", "🔥", "🍕", "🌈"];
  const MONTHS = ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"];
  let profs = {}, pfEmoji = null, pfColor = null, pfFrame = null, pfLoaded = false, lastDocs = null, lastKind = null, myQuizTotal = 0;
  // Рамки аватарки: відкриваються за правильні відповіді в тесті дня (за весь час).
  const FRAMES = [["none", "Без рамки", 0], ["bronze", "Бронзова", 1], ["silver", "Срібна", 5], ["gold", "Золота", 10], ["neon", "Неонова", 15], ["rainbow", "Веселкова", 20], ["champ", "Чемпіон 🏅", -1]];
  const frameOpen = need => isAdmin || (need < 0 ? !!champOf[me.uid] : myQuizTotal >= need);
  async function loadQuizTotal() {
    try { const s = await getDocs(query(collection(db, "quiz"), where("uid", "==", me.uid), where("ok", "==", true))); myQuizTotal = s.size; }
    catch (e) { console.error(e); }
    if (inPortal) { renderProfileForm(); if (!$("#p-profile").hidden) renderProfileView(); }
  }
  const pad2 = n => String(n).padStart(2, "0");
  function setupProfiles() {
    setupRoleBadges();
    $("#pf-day").innerHTML = `<option value="">—</option>` + Array.from({ length: 31 }, (_, i) => `<option>${i + 1}</option>`).join("");
    $("#pf-month").innerHTML = `<option value="">—</option>` + MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("");
    portalSubs.push(onSnapshot(collection(db, "profiles"), s => {
      profs = {}; s.docs.forEach(d => { profs[d.id] = d.data(); });
      if (!pfLoaded) {
        const p = profs[me.uid] || {};
        // Не перетираємо те, що людина вже встигла обрати, поки профіль вантажився.
        pfEmoji = pfEmoji || p.emoji || null; pfColor = pfColor || p.color || null; pfFrame = pfFrame || p.frame || null;
        if (p.bio && !$("#pf-bio").value) $("#pf-bio").value = p.bio;
        if (p.bday && !$("#pf-day").value && !$("#pf-month").value) { const [m, d] = p.bday.split("-").map(Number); $("#pf-day").value = String(d); $("#pf-month").value = String(m); }
        pfLoaded = true;
      }
      renderProfileForm(); renderBday(); renderStoriesBar(); if (!$("#p-profile").hidden) renderProfileView();
      if (lastDocs) renderMessages(lastDocs, lastKind);
    }, e => console.error(e)));
    portalSubs.push(() => { pfLoaded = false; pfEmoji = null; pfColor = null; pfFrame = null; profs = {}; lastDocs = null; myQuizTotal = 0; });
    loadQuizTotal();
  }
  function renderProfileForm() {
    const pv = $("#pf-preview"); pv.textContent = `${pfEmoji || "🙂"} ${profile.name}`;
    pv.style.color = COLORS[pfColor] || "";
    const g = $("#pf-emoji"); g.replaceChildren();
    EMOJIS.forEach(e => { const b = el("button", null, e); b.type = "button"; b.setAttribute("aria-pressed", String(e === pfEmoji)); b.addEventListener("click", () => { pfEmoji = e; renderProfileForm(); }); g.append(b); });
    $("#pf-color").innerHTML = Object.keys(COLORS).map(k => `<button class="chip" type="button" data-c="${k}" aria-pressed="${k === pfColor}" style="color:${COLORS[k]}">● ${COLOR_NAMES[k]}</button>`).join("");
    $$("#pf-color .chip").forEach(c => c.addEventListener("click", () => { pfColor = c.dataset.c; renderProfileForm(); }));
    $("#pf-frames").replaceChildren(...FRAMES.map(([k, t, need]) => {
      const b = el("button"); b.type = "button"; b.dataset.f = k;
      b.setAttribute("aria-pressed", String(k === (pfFrame || "none")));
      b.disabled = !frameOpen(need);
      b.title = frameOpen(need) ? t : need < 0 ? "Для чемпіона минулого місяця в тесті дня" : `Відкриється після ${need} правильних відповідей у тесті дня (зараз ${myQuizTotal})`;
      b.append(el("i", "fr-" + k), el("span", null, frameOpen(need) ? t : need < 0 ? "🔒 чемпіон" : `🔒 ${need} ✓`));
      b.addEventListener("click", () => { pfFrame = k; renderProfileForm(); });
      return b;
    }));
  }
  $("#pf-save").addEventListener("click", async () => {
    const d = Number($("#pf-day").value), m = Number($("#pf-month").value);
    const data = { emoji: pfEmoji || "🙂", color: pfColor || "violet" };
    if (pfFrame && pfFrame !== "none") data.frame = pfFrame;
    const bio = $("#pf-bio").value.trim().slice(0, 150); if (bio) data.bio = bio;
    if (d && m) {
      if (d > new Date(2024, m, 0).getDate()) { toast("У цьому місяці немає такого дня"); return; }
      data.bday = `${pad2(m)}-${pad2(d)}`;
    }
    try { await setDoc(doc(db, "profiles", me.uid), data); toast("Профіль збережено"); }
    catch (e) { console.error(e); toast("Не вдалося зберегти профіль"); }
  });
  function renderBday() {
    const now = new Date(), today = `${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`, mc = myClass();
    const names = Object.entries(profs)
      .filter(([uid, p]) => p.bday === today && uid !== me.uid && dir[uid] && (!mc || dir[uid].cls === mc))
      .map(([uid]) => dir[uid].name);
    const mine = profs[me.uid] && profs[me.uid].bday === today;
    const box = $("#bday");
    box.textContent = mine ? `🎉 З днем народження, ${profile.name}! Увесь портал вітає тебе!`
      : names.length ? `🎂 Сьогодні день народження: ${names.join(", ")}! Привітай у чаті класу` : "";
    box.hidden = !box.textContent;
  }

  /* ===== Профіль як у Telegram, корони для адмінів ===== */
  let pvUid = null, adminSet = new Set(), modSet = new Set(), quizMonthDocs = [];
  function setupRoleBadges() {
    portalSubs.push(onSnapshot(collection(db, "admins"), s => { adminSet = new Set(s.docs.map(d => d.id)); refreshNames(); }, () => {}));
    portalSubs.push(onSnapshot(collection(db, "mods"), s => { modSet = new Set(s.docs.map(d => d.id)); refreshNames(); }, () => {}));
  }
  function refreshNames() { if (lastDocs) renderMessages(lastDocs, lastKind); if (!$("#p-profile").hidden) renderProfileView(); }
  const isAdminUid = uid => uid === ownerUid || adminSet.has(uid);
  const roleMark = uid => isAdminUid(uid) ? "👑" : modSet.has(uid) ? "🛡" : "";
  function openProfile(uid) { pvUid = uid === me.uid ? null : uid; openTab("profile"); }
  function renderProfileView() {
    const uid = pvUid || me.uid, isMe = uid === me.uid;
    const p = profs[uid] || {};
    const d = isMe ? { name: profile.name, role: profile.role, cls: myClass() } : (dir[uid] || { name: "Учасник", role: "student", cls: null });
    $("#pv-back").hidden = isMe;
    $("#profile-box").hidden = !isMe;
    const ava = $("#pv-ava"); ava.textContent = p.emoji || "🙂";
    ava.style.background = COLORS[p.color] || "";
    ava.className = "pv-ava" + (p.frame && p.frame !== "none" ? " fr-" + p.frame : "");
    $("#pv-name").textContent = d.name + (roleMark(uid) ? " " + roleMark(uid) : "");
    $("#pv-name").style.color = COLORS[p.color] || "";
    const badges = $("#pv-badges"); badges.replaceChildren();
    if (uid === ownerUid) badges.append(pill("👑 Головний адмін", "info"));
    else if (adminSet.has(uid)) badges.append(pill("👑 Адміністратор", "info"));
    if (modSet.has(uid)) badges.append(pill("🛡 Молодший модератор", "ok"));
    if (isMe) badges.append(pill("це ти", "warn"));
    const sub = [ROLE[d.role] || "", d.cls ? `${d.cls} клас` : ""].filter(Boolean);
    if ((isAdmin || isMod) && !isMe) { const st = seenText(seen[uid]); sub.push(st[0] === "онлайн" ? "в мережі" : `заходив ${st[0]}`); }
    if (isMe) sub.push("в мережі");
    $("#pv-sub").textContent = sub.join(" · ");
    $("#pv-bio").textContent = p.bio || (isMe ? "Розкажи про себе в полі «Про себе» нижче." : "");
    $("#pv-bio").className = "pv-bio" + (p.bio ? "" : " muted");
    const rows = $("#pv-rows"); rows.replaceChildren();
    const row = (k, v) => { const r = el("div"); r.append(el("span", null, k), el("b", null, v)); rows.append(r); };
    if (p.bday) { const [m, dd] = p.bday.split("-").map(Number); row("🎂 День народження", `${dd} ${MONTHS[m - 1]}`); }
    const quizOk = quizMonthDocs.filter(q => { const r = q.data(); return r.uid === uid && r.ok; }).length;
    row("🏆 Тест дня (цей місяць)", `✓ ${quizOk}`);
    if (d.cls) row("🏫 Клас", `${d.cls} клас`);
    $("#pv-achv").replaceChildren(...achievements(uid, p, quizOk).map(([i, t, hint]) => { const s = el("span", null, `${i} ${t}`); s.title = hint; return s; }));
    const acts = $("#pv-acts"); acts.replaceChildren();
    if (!isMe) {
      const chat = el("button", "btn", "💬 Створити чат"); chat.type = "button";
      chat.addEventListener("click", () => { openTab("chat"); openGroupForm("create"); gSel.add(uid); $("#g-name").value = `${profile.name.split(" ")[0]} і ${d.name.split(" ")[0]}`; renderPicker(); });
      const dm = el("button", "btn", "✉ Написати"); dm.type = "button";
      dm.addEventListener("click", () => openDM(uid));
      const play = el("button", "btn ghost", "🎮 Зіграти"); play.type = "button";
      play.addEventListener("click", () => { openTab("games"); $("#ttt-opp").value = uid; $("#ttt-invite").focus(); });
      acts.append(dm, chat);
      if (dir[uid]) acts.append(play);
    }
  }
  // Досягнення: що людина вже зробила на порталі.
  function achievements(uid, p, quizOk) {
    const out = [["🌱", "На порталі", "Схвалений учасник порталу"]];
    if (isAdminUid(uid)) out.push(["👑", "Адмін", "Адміністратор порталу"]);
    if (modSet.has(uid)) out.push(["🛡", "Модератор", "Молодший модератор"]);
    if (p.emoji && p.color) out.push(["🎨", "Стиліст", "Обрав аватарку й колір"]);
    if (p.bio) out.push(["📝", "Про себе", "Заповнив «Про себе»"]);
    if (p.bday) out.push(["🎂", "Іменинник", "Вказав день народження"]);
    if (quizOk >= 1) out.push(["🧠", "Перша відповідь", "Правильна відповідь у тесті дня"]);
    if (quizOk >= 5) out.push(["🔥", "Розумник", "5 правильних відповідей за місяць"]);
    if (quizOk >= 15) out.push(["🚀", "Геній", "15 правильних відповідей за місяць"]);
    const score = {}; quizMonthDocs.forEach(d => { const r = d.data(); if (r.ok) score[r.uid] = (score[r.uid] || 0) + 1; });
    const cls = dir[uid] && dir[uid].cls, best = Object.entries(score).filter(([u]) => dir[u] && dir[u].cls === cls).sort((a, b) => b[1] - a[1])[0];
    if (cls && best && best[0] === uid) out.push(["🏆", "Чемпіон класу", "Перше місце в тесті дня цього місяця"]);
    if (champOf[uid]) out.push(["🏅", "Чемпіон місяця", "Найкращий у тесті дня минулого місяця"]);
    if (p.frame && p.frame !== "none") out.push(["🖼", "Рамка", "Має рамку аватарки"]);
    return out;
  }
  $("#pv-back").addEventListener("click", () => { pvUid = null; renderProfileView(); });

  /* ===== Реакції, опитування, скарги ===== */
  const REACTS = ["👍", "😂", "❤️", "🔥", "😮"];
  function nameEl(uid, name, mine) {
    const p = profs[uid] || {};
    const mark = roleMark(uid);
    const b = el("b", "who-link", (p.emoji ? p.emoji + " " : "") + (mine ? "Ти" : name) + (mark ? " " + mark : ""));
    if (COLORS[p.color]) b.style.color = COLORS[p.color];
    b.title = "Відкрити профіль";
    b.addEventListener("click", () => openProfile(uid));
    return b;
  }
  function react(d, r, e) {
    updateDoc(d.ref, { [`r.${me.uid}`]: r[me.uid] === e ? deleteField() : e }).catch(err => { console.error(err); toast("Не вдалося"); });
  }
  function renderReacts(d, m) {
    const row = el("div", "reacts"), r = m.r || {}, counts = {};
    Object.values(r).forEach(e => { counts[e] = (counts[e] || 0) + 1; });
    REACTS.filter(e => counts[e]).forEach(e => {
      const b = el("button", "react" + (r[me.uid] === e ? " on" : ""), `${e} ${counts[e]}`); b.type = "button";
      b.addEventListener("click", () => react(d, r, e)); row.append(b);
    });
    const add = el("button", "react add", "＋"); add.type = "button"; add.title = "Реакція"; add.setAttribute("aria-label", "Додати реакцію");
    add.addEventListener("click", () => {
      const old = row.querySelector(".pick"); if (old) { old.remove(); return; }
      const p = el("span", "pick");
      REACTS.forEach(e => { const b = el("button", "react", e); b.type = "button"; b.addEventListener("click", () => react(d, r, e)); p.append(b); });
      row.append(p);
    });
    row.append(add);
    return row;
  }
  function renderPoll(d, m) {
    const box = el("div", "poll"); box.append(el("b", null, "📊 " + m.text));
    const votes = m.votes || {}, total = Object.keys(votes).length, mine = votes[me.uid];
    m.opts.forEach((o, i) => {
      const n = Object.values(votes).filter(v => v === i).length, pct = total ? Math.round(n / total * 100) : 0;
      const b = el("button", "opt" + (mine === i ? " mine" : "")); b.type = "button";
      const fill = el("span", "fill"); fill.style.width = pct + "%";
      b.append(fill, el("span", null, (mine === i ? "✓ " : "") + o), el("span", "pct", total ? `${pct}% · ${n}` : ""));
      b.addEventListener("click", () => updateDoc(d.ref, { [`votes.${me.uid}`]: mine === i ? deleteField() : i }).catch(e => { console.error(e); toast("Не вдалося проголосувати"); }));
      box.append(b);
    });
    box.append(el("small", "muted", `Голосів: ${total}`));
    return box;
  }
  async function report(d, m) {
    try {
      await addDoc(collection(db, "reports"), { path: d.ref.path, text: String(m.text || "").slice(0, 500), author: m.uid, authorName: m.name, by: me.uid, byName: profile.name, status: "open", createdAt: serverTimestamp() });
      toast("Скаргу надіслано модераторам");
    } catch (e) { console.error(e); toast("Не вдалося надіслати скаргу"); }
  }
  /* ===== Повідомлення: відповіді, редагування, стікери, згадки, ✓✓, закріплення ===== */
  let replyTo = null, msgEdit = null, chatQuery = "", othersReadAt = 0, typers = [], lastTypingSent = 0;
  let extrasUnsubs = [], readWriteAt = {}, mentionFlag = {};
  const STICKERS = ["😂", "🤣", "😍", "😎", "🥳", "😭", "😡", "🤯", "👍", "👎", "🙏", "👏", "🔥", "💯", "❤️", "💔", "🎉", "⚽", "🎮", "📚", "🍕", "🐱", "🦄", "🚀"];
  const bigEmoji = t => /\p{Extended_Pictographic}/u.test(t) && /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|️|‍|\s)+$/u.test(t) && [...t.replace(/\s/g, "")].length <= 8;
  function mentionsMe(text) {
    const t = String(text || "").toLowerCase();
    return nameTokens(profile.name).some(tok => tok.length > 1 && t.includes("@" + tok));
  }
  function richText(text) {
    text = clean(text);
    const frag = document.createDocumentFragment(), re = /@[\p{L}'’ʼ-]+(?:\s[\p{L}'’ʼ-]+)?/gu;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.append(text.slice(last, m.index));
      frag.append(el("span", "mention", m[0])); last = m.index + m[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    return frag;
  }
  function jumpTo(id) {
    const t = document.getElementById("m-" + id);
    if (!t) { toast("Це повідомлення вже далеко вгорі"); return; }
    t.scrollIntoView({ block: "center", behavior: "smooth" });
    t.classList.add("flash"); setTimeout(() => t.classList.remove("flash"), 1600);
  }
  function startReply(id, m) {
    replyTo = { id, name: String(m.name || "").slice(0, 60), text: String((m.opts ? "📊 " : "") + (m.text || "")).slice(0, 100) };
    $("#reply-text").textContent = `↩ ${replyTo.name}: ${replyTo.text}`;
    $("#reply-bar").hidden = false; $("#chat-text").focus();
  }
  function clearReply() { replyTo = null; $("#reply-bar").hidden = true; }
  $("#reply-x").addEventListener("click", clearReply);
  function editBox(d, m) {
    const box = el("div", "edit-box"), inp = el("input");
    inp.maxLength = 500; inp.value = msgEdit.draft; inp.setAttribute("aria-label", "Новий текст");
    inp.addEventListener("input", () => { msgEdit.draft = inp.value; });
    const acts = el("div", "acts");
    const save = el("button", "btn sm", "Зберегти"); save.type = "button";
    const cancel = el("button", "btn ghost sm", "Скасувати"); cancel.type = "button";
    save.addEventListener("click", async () => {
      const t = inp.value.trim(); if (!t) return;
      save.disabled = true;
      try { await updateDoc(d.ref, { text: t.slice(0, 500), edited: true }); msgEdit = null; if (lastDocs) renderMessages(lastDocs, lastKind); }
      catch (e) { console.error(e); toast(isMutedNow() ? "Ти в муті — редагувати не можна" : "Не вдалося змінити"); save.disabled = false; }
    });
    cancel.addEventListener("click", () => { msgEdit = null; renderMessages(lastDocs, lastKind); });
    inp.addEventListener("keydown", e => { if (e.key === "Enter") save.click(); if (e.key === "Escape") cancel.click(); });
    acts.append(save, cancel); box.append(inp, acts);
    setTimeout(() => inp.focus(), 0);
    return box;
  }
  function renderMessages(docs, kind) {
    lastDocs = docs; lastKind = kind;
    const box = $("#messages");
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    box.replaceChildren();
    const q = chatQuery.trim().toLowerCase();
    const list = q ? docs.filter(d => { const m = d.data(); return String(m.text || "").toLowerCase().includes(q) || String(m.name || "").toLowerCase().includes(q); }) : docs;
    if (q) box.append(el("div", "day-sep", `Знайдено: ${list.length}`));
    if (!list.length) { box.append(emptyEl(q ? "Нічого не знайдено." : "Тут ще тихо. Напиши перше повідомлення!")); return; }
    let lastDay = "";
    list.forEach(d => {
      const m = d.data({ serverTimestamps: "estimate" });
      const when = toDate(m.createdAt), day = fmtDay(when);
      if (day && day !== lastDay) { box.append(el("div", "day-sep", day)); lastDay = day; }
      const mine = m.uid === me.uid, big = !m.opts && bigEmoji(m.text || "");
      const wrap = el("div", "msg" + (mine ? " mine" : "") + (m.opts ? " is-poll" : "") + (big ? " big" : "") + (!mine && mentionsMe(m.text) ? " mentions-me" : ""));
      wrap.id = "m-" + d.id;
      const meta = el("div", "meta");
      meta.append(nameEl(m.uid, m.name, mine));
      if (kind === "group" && !mine && dir[m.uid] && dir[m.uid].cls) meta.append(el("span", null, `${dir[m.uid].cls} клас`));
      if (m.role && m.role !== "student") meta.append(el("span", null, ROLE[m.role]));
      meta.append(el("span", m.edited ? "edited" : null, fmtTime(when) + (m.edited ? " · змінено" : "")));
      if (mine) { const tk = el("span", "ticks"); tk.dataset.at = when ? String(when.getTime()) : ""; meta.append(tk); }
      const act = (label, fn, title) => { const b = el("button", "del", label); b.type = "button"; if (title) b.title = title; b.addEventListener("click", fn); meta.append(b); };
      act("відповісти", () => startReply(d.id, m));
      if (mine && !m.opts && !(m.media && m.media.kind === "audio")) act("редагувати", () => { msgEdit = { id: d.id, draft: m.text }; renderMessages(lastDocs, lastKind); });
      if ((isAdmin || isMod) && (kind === "class" || (isAdmin && kind === "group"))) act("📌", () => pinMessage(d.id, m), "Закріпити");
      if (!mine) meta.append(confirmButton("поскаржитися", "del", () => report(d, m), "rep:" + d.id));
      if (mine || (kind !== "dm" && (isAdmin || (isMod && kind === "class")))) meta.append(confirmButton("видалити", "del", async () => {
        await deleteDoc(d.ref);
        if (!mine) logAction("Видалив повідомлення", m.uid, m.name);
      }, "del:" + d.id));
      wrap.append(meta);
      if (m.reply) {
        const qd = el("div", "quote"); qd.append(el("b", null, m.reply.name + ": "), m.reply.text);
        qd.addEventListener("click", () => jumpTo(m.reply.id)); wrap.append(qd);
      }
      if (m.opts) wrap.append(renderPoll(d, m));
      else if (msgEdit && msgEdit.id === d.id) wrap.append(editBox(d, m));
      else {
        if (m.media) wrap.append(mediaEl(d, m));
        if (!m.media || !DEFAULT_MEDIA_TEXT.test(m.text || "")) { const t = el("div", "txt"); t.append(richText(m.text || "")); wrap.append(t); }
      }
      wrap.append(renderReacts(d, m));
      box.append(wrap);
    });
    updateTicks();
    if (nearBottom && !q && !msgEdit) box.scrollTop = box.scrollHeight;
  }
  // ✓ — надіслано, ✓✓ — хтось інший уже прочитав. Оновлюємо на місці, щоб не збивати кнопки.
  function updateTicks() {
    $$("#messages .ticks").forEach(t => {
      const read = !!t.dataset.at && othersReadAt >= Number(t.dataset.at);
      t.classList.toggle("read", read); t.textContent = read ? "✓✓" : "✓";
      t.title = read ? "Прочитано" : "Надіслано";
    });
  }
  $("#chat-search").addEventListener("input", e => { chatQuery = e.target.value; if (lastDocs) renderMessages(lastDocs, lastKind); });

  // Закріплене повідомлення, «друкує…» і хто прочитав — для відкритого чату.
  function setupChatExtras() {
    const t = setInterval(renderTyping, 2000);
    portalSubs.push(() => { clearInterval(t); extrasUnsubs.forEach(u => u()); extrasUnsubs = []; });
  }
  function watchExtras(key) {
    extrasUnsubs.forEach(u => u()); extrasUnsubs = [];
    if (rec) stopRec(false);
    renderMuteBtn();
    clearReply(); msgEdit = null; chatQuery = ""; $("#chat-search").value = ""; othersReadAt = 0; typers = []; renderTyping();
    $("#stickers").hidden = true; $("#mentions").hidden = true;
    if (!key) return;
    extrasUnsubs.push(onSnapshot(doc(db, "pins", key), s => {
      const bar = $("#pin-bar");
      if (!s.exists()) { bar.hidden = true; return; }
      const p = s.data();
      bar.hidden = false;
      $("#pin-go").textContent = `📌 ${p.name}: ${p.text}`;
      $("#pin-go").onclick = () => jumpTo(p.msgId);
      $("#pin-x").hidden = !((isAdmin || isMod) && (key.startsWith("c") || isAdmin));
      $("#pin-x").onclick = async () => { try { await deleteDoc(doc(db, "pins", key)); logAction("Відкріпив повідомлення", "", p.name); } catch (e) { console.error(e); toast("Не вдалося"); } };
    }, () => { $("#pin-bar").hidden = true; }));
    extrasUnsubs.push(onSnapshot(collection(db, "typing", key, "users"), s => {
      typers = s.docs.filter(x => x.id !== me.uid).map(x => { const v = x.data({ serverTimestamps: "estimate" }); return { name: v.name, at: toDate(v.at) }; });
      renderTyping();
    }, () => {}));
    extrasUnsubs.push(onSnapshot(query(collection(db, "reads"), where("chat", "==", key)), s => {
      othersReadAt = 0;
      s.docs.forEach(x => { const v = x.data({ serverTimestamps: "estimate" }); if (v.uid !== me.uid) { const t = toDate(v.at); if (t) othersReadAt = Math.max(othersReadAt, t.getTime()); } });
      updateTicks();
    }, () => {}));
  }
  function renderTyping() {
    const now = Date.now(), act = typers.filter(t => t.at && now - t.at.getTime() < 6000).map(t => String(t.name).split(" ").pop());
    $("#typing").textContent = !act.length ? "" : act.length === 1 ? `${act[0]} друкує…` : act.length === 2 ? `${act[0]} і ${act[1]} друкують…` : "Кілька людей друкують…";
  }
  function sendTyping() {
    const k = curKey(); if (!k || Date.now() - lastTypingSent < 3000 || isMutedNow()) return;
    lastTypingSent = Date.now();
    setDoc(doc(db, "typing", k, "users", me.uid), { at: serverTimestamp(), name: profile.name }).catch(() => {});
  }
  let readTimer = null;
  function writeRead(k) {
    if (!k || k !== curKey()) return;
    // Не частіше разу на 4 с, але останнє прочитання все одно записуємо.
    const wait = 4000 - (Date.now() - (readWriteAt[k] || 0));
    if (wait > 0) { if (!readTimer) readTimer = setTimeout(() => { readTimer = null; if (isViewing(k)) writeRead(k); }, wait); return; }
    readWriteAt[k] = Date.now();
    setDoc(doc(db, "reads", `${k}_${me.uid}`), { chat: k, uid: me.uid, at: serverTimestamp() }).catch(() => {});
  }
  async function pinMessage(id, m) {
    const k = curKey(); if (!k) return;
    try {
      await setDoc(doc(db, "pins", k), { msgId: id, text: String((m.opts ? "📊 " : "") + (m.text || "")).slice(0, 300), name: String(m.name || "").slice(0, 60), by: me.uid, at: serverTimestamp() });
      toast("Повідомлення закріплено"); logAction("Закріпив повідомлення", m.uid, m.name);
    } catch (e) { console.error(e); toast("Не вдалося закріпити"); }
  }

  // Стікери
  $("#b-sticker").addEventListener("click", () => {
    const box = $("#stickers");
    if (!box.hidden) { box.hidden = true; return; }
    box.replaceChildren(...STICKERS.map(s => { const b = el("button", null, s); b.type = "button"; b.addEventListener("click", () => { box.hidden = true; sendText(s); }); return b; }));
    box.hidden = false;
  });

  // Підказки @згадок
  function mentionCandidates() {
    if (!current) return [];
    if (current.kind === "dm") return [shortName(current.other)];
    if (current.kind === "class") return Object.entries(dir).filter(([id, p]) => id !== me.uid && p.cls === current.cls).map(([, p]) => p.name);
    const g = groups.find(x => x.id === current.id);
    return g ? g.members.filter(u => u !== me.uid && dir[u]).map(u => dir[u].name) : [];
  }
  $("#chat-text").addEventListener("input", e => {
    const inp = e.target;
    if (inp.value.trim()) sendTyping();
    const before = inp.value.slice(0, inp.selectionStart), m = before.match(/@([\p{L}'’ʼ-]*)$/u), box = $("#mentions");
    if (!m) { box.hidden = true; return; }
    const qq = m[1].toLowerCase();
    const list = mentionCandidates().filter(n => nameTokens(n).some(t => t.startsWith(qq))).slice(0, 6);
    if (!list.length) { box.hidden = true; return; }
    box.replaceChildren(...list.map(n => {
      const b = el("button", null, "@" + n); b.type = "button";
      b.addEventListener("click", () => {
        const start = before.length - m[0].length;
        inp.value = inp.value.slice(0, start) + "@" + n + " " + inp.value.slice(inp.selectionStart);
        box.hidden = true; inp.focus();
      });
      return b;
    }));
    box.hidden = false;
  });

  async function sendText(text, extra = {}, ctx = current) {
    if (!text || !ctx || viewAs) return false;
    const col = msgCol(ctx);
    const data = { uid: me.uid, name: profile.name, role: profile.role, text: clean(text).slice(0, 500), createdAt: serverTimestamp(), ...extra };
    const rp = ctx === current ? replyTo : null;
    if (rp) data.reply = rp;
    clearReply();
    try { await addDoc(col, data); scrollChat(true); return true; }
    catch (ex) { console.error(ex); if (rp) startReply(rp.id, { name: rp.name, text: rp.text }); toast(isMutedNow() ? "Ти в муті — зараз не можна писати" : "Повідомлення не надіслано"); return false; }
  }

  /* ----- Створення опитування ----- */
  function pollOptInput(v = "") {
    const i = el("input"); i.maxLength = 60; i.placeholder = "Варіант"; i.value = v; i.className = "poll-opt";
    i.setAttribute("aria-label", "Варіант відповіді");
    return i;
  }
  $("#b-poll").addEventListener("click", () => {
    const f = $("#f-poll"); formErr(f); f.hidden = false;
    $("#poll-q").value = ""; $("#poll-opts").replaceChildren(pollOptInput(), pollOptInput());
    $("#poll-q").focus();
  });
  $("#poll-add").addEventListener("click", () => { if ($$("#poll-opts input").length < 6) $("#poll-opts").append(pollOptInput()); });
  $("#poll-cancel").addEventListener("click", () => { $("#f-poll").hidden = true; });
  $("#f-poll").addEventListener("submit", async e => {
    e.preventDefault(); const f = e.target; formErr(f);
    const q = $("#poll-q").value.trim(), opts = $$("#poll-opts input").map(i => i.value.trim()).filter(Boolean);
    if (q.length < 2) { formErr(f, "Напиши питання."); return; }
    if (opts.length < 2) { formErr(f, "Потрібно щонайменше 2 варіанти."); return; }
    if (!current) return;
    const col = msgCol(current);
    try {
      await addDoc(col, { uid: me.uid, name: profile.name, role: profile.role, text: q.slice(0, 200), opts: opts.slice(0, 6), createdAt: serverTimestamp() });
      f.hidden = true; scrollChat(true);
    } catch (ex) { console.error(ex); formErr(f, isMutedNow() ? "Ти в муті — зараз не можна писати." : "Не вдалося опублікувати."); }
  });

  /* ===== Мут ===== */
  let myMute = null, mutes = {};
  const isMutedNow = () => !!myMute && myMute > new Date();
  function setupMyMute() {
    portalSubs.push(onSnapshot(doc(db, "mutes", me.uid), s => { myMute = s.exists() ? toDate(s.data().until) : null; applyMute(); }, () => {}));
    const t = setInterval(applyMute, 30000);
    portalSubs.push(() => { clearInterval(t); myMute = null; });
  }
  function applyMute() {
    const until = isMutedNow() ? `${fmtTime(myMute)}${myMute.toDateString() !== new Date().toDateString() ? " " + fmtDay(myMute) : ""}` : "";
    $("#f-news button[type=submit]").disabled = !!until || !!viewAs;
    $("#b-poll").disabled = !!until;
    if (!current) return;
    if (until) { setComposer(false, `Ти в муті до ${until}`); return; }
    if (current.kind === "class") setComposer(canWriteClass(current.cls), "Тут можна лише читати — писати можна в чат свого класу");
    else setComposer(true);
  }
  const MUTE_OPTS = [["", "Мут…"], ["10", "10 хв"], ["60", "1 год"], ["1440", "1 день"], ["10080", "7 днів"]];
  function muteControl(m) {
    const until = mutes[m.id];
    if (until && until > new Date()) {
      const b = el("button", "btn ghost sm", `Зняти мут (до ${fmtTime(until)})`); b.type = "button";
      b.addEventListener("click", async () => {
        b.disabled = true;
        try { await deleteDoc(doc(db, "mutes", m.id)); logAction("Зняв мут", m.id, m.p.name); toast(`${m.p.name}: мут знято`); }
        catch (e) { console.error(e); toast("Не вдалося"); b.disabled = false; }
      });
      return b;
    }
    const sel = el("select", "mute-sel"); sel.innerHTML = MUTE_OPTS.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
    sel.setAttribute("aria-label", `Мут: ${m.p.name}`);
    sel.addEventListener("change", async () => {
      const min = Number(sel.value); if (!min) return;
      sel.disabled = true;
      try {
        await setDoc(doc(db, "mutes", m.id), { until: Timestamp.fromDate(new Date(Date.now() + min * 60000)), by: me.uid, at: serverTimestamp() });
        logAction(`Замутив на ${sel.options[sel.selectedIndex].text}`, m.id, m.p.name);
        toast(`${m.p.name}: мут на ${sel.options[sel.selectedIndex].text}`);
      } catch (e) { console.error(e); toast("Не вдалося замутити"); sel.disabled = false; sel.value = ""; }
    });
    return sel;
  }

  /* ===== Скарги (адмін і модератори) ===== */
  let reports = [];
  function setupReports() {
    portalSubs.push(onSnapshot(query(collection(db, "reports"), where("status", "==", "open"), limit(100)),
      s => { reports = s.docs; renderReports(); }, e => console.error(e)));
    portalSubs.push(onSnapshot(collection(db, "mutes"),
      s => { mutes = {}; s.docs.forEach(d => { mutes[d.id] = toDate(d.data().until); }); renderModeration(); }, e => console.error(e)));
  }
  function renderReports() {
    const n = reports.length, b = $("#report-count");
    b.textContent = n; b.hidden = !n; $("#reports-count").textContent = n;
    const box = $("#reports"); box.replaceChildren();
    if (!n) { box.append(emptyEl("Скарг немає 👍")); return; }
    reports.forEach(d => {
      const r = d.data({ serverTimestamps: "estimate" });
      const place = r.path.startsWith("classes/") ? `чат ${r.path.split("/")[1]} класу` : r.path.startsWith("stories/") ? "історія" : r.path.startsWith("dms/") ? "особисті" : "окремий чат";
      const card = el("article", "post");
      const top = el("div", "top-line"); top.append(el("h3", null, `Скарга на: ${r.authorName}`), pill(place, "warn"));
      const acts = el("div", "acts");
      const done = async (action) => { await updateDoc(d.ref, { status: "done" }); logAction(action, r.author, r.authorName); };
      if (isAdmin || /^(classes|stories|dms)\//.test(r.path)) acts.append(confirmButton(r.path.startsWith("stories/") ? "Видалити історію" : "Видалити повідомлення", "btn badb sm", async () => {
        await (r.path.startsWith("stories/") ? deleteStory(doc(db, r.path)) : deleteDoc(doc(db, r.path))).catch(e => console.error(e));
        await done("Видалив повідомлення за скаргою"); toast("Повідомлення видалено");
      }));
      const keep = el("button", "btn ghost sm", "Залишити"); keep.type = "button";
      keep.addEventListener("click", async () => { keep.disabled = true; try { await done("Відхилив скаргу"); toast("Скаргу закрито"); } catch (e) { console.error(e); keep.disabled = false; } });
      acts.append(keep);
      card.append(top, el("p", "txt", `«${r.text}»`), el("span", "by", `Від: ${r.byName} · ${fmtDay(toDate(r.createdAt))} ${fmtTime(toDate(r.createdAt))}`), acts);
      box.append(card);
    });
  }

  /* ===== Журнал дій ===== */
  function logAction(action, target, targetName) {
    if (!(isAdmin || isMod) || !profile) return;
    addDoc(collection(db, "log"), { action: String(action).slice(0, 120), target: target || "", targetName: String(targetName || "").slice(0, 80), by: me.uid, byName: profile.name, at: serverTimestamp() }).catch(console.error);
  }
  function setupLog() {
    $("#log-box").hidden = !isOwner;
    if (!isOwner) return;
    portalSubs.push(onSnapshot(query(collection(db, "log"), orderBy("at", "desc"), limit(100)), s => {
      const box = $("#log"); box.replaceChildren();
      if (!s.size) { box.append(emptyEl("Поки що порожньо.")); return; }
      s.docs.forEach(d => {
        const l = d.data({ serverTimestamps: "estimate" }), t = toDate(l.at);
        const row = el("div"); const tm = el("time", null, `${fmtDay(t)} ${fmtTime(t)}`);
        row.append(tm, `${l.byName}: ${l.action}${l.targetName ? " — " + l.targetName : ""}`);
        box.append(row);
      });
    }, e => console.error(e)));
  }

  /* ===== Непрочитані повідомлення ===== */
  let watch = {}, unread = {}, soundOn = store.get("msgSound", true);
  $("#msg-sound").checked = soundOn;
  $("#msg-sound").addEventListener("change", e => { soundOn = e.target.checked; store.set("msgSound", soundOn); });
  const lrKey = k => `lr.${me ? me.uid : ""}.${k}`;
  const curKey = () => current ? (current.kind === "class" ? "c" + current.cls : current.kind === "dm" ? "d" + current.id : "g" + current.id) : null;
  const isViewing = k => k === curKey() && !$("#p-chat").hidden && $("#f-group").hidden && document.visibilityState === "visible";
  function markRead(k) {
    if (!k) return;
    store.set(lrKey(k), Date.now());
    if (isViewing(k)) writeRead(k);
    if (unread[k]) { unread[k] = 0; renderUnread(); }
  }
  function setupUnread() {
    const onVis = () => { if (document.visibilityState === "visible") markRead(curKey()); };
    document.addEventListener("visibilitychange", onVis);
    portalSubs.push(() => {
      document.removeEventListener("visibilitychange", onVis);
      Object.values(watch).forEach(u => u()); watch = {}; unread = {};
      document.title = "Підпільний портал учнів";
    });
  }
  function syncWatchers() {
    if (!inPortal || !me) return;
    const want = {}, mc = myClass();
    if (mc) want["c" + mc] = collection(db, "classes", String(mc), "messages");
    groups.filter(g => g.status === "approved" && g.members.includes(me.uid)).forEach(g => { want["g" + g.id] = collection(db, "groups", g.id, "messages"); });
    dms.forEach(d => { want["d" + d.id] = collection(db, "dms", d.id, "messages"); });
    Object.keys(watch).forEach(k => { if (!want[k]) { watch[k](); delete watch[k]; delete unread[k]; } });
    Object.entries(want).forEach(([k, col]) => {
      if (watch[k]) return;
      let first = true;
      watch[k] = onSnapshot(query(col, orderBy("createdAt", "desc"), limit(50)), s => {
        if (isViewing(k)) { markRead(k); first = false; return; }
        const lr = store.get(lrKey(k), 0);
        const fresh = s.docs.filter(d => { const m = d.data({ serverTimestamps: "estimate" }), t = toDate(m.createdAt); return m.uid !== me.uid && t && t.getTime() > lr; });
        const n = fresh.length, ment = fresh.filter(d => mentionsMe(d.data().text)).length;
        const grew = !first && n > (unread[k] || 0), quiet = mutedChats.has(k);
        if (!first && !quiet && ment > (mentionFlag[k] || 0)) toast("📣 Тебе згадали в чаті");
        unread[k] = n; mentionFlag[k] = ment; first = false; renderUnread();
        if (grew && !quiet) {
          ping();
          const m = fresh[0] && fresh[0].data();
          if (m && document.visibilityState !== "visible") notify(chatLabel(k), `${m.name}: ${clean(m.text)}`);
        }
      }, e => console.error(e));
    });
    renderUnread();
  }
  function renderUnread() {
    const total = Object.values(unread).reduce((a, b) => a + b, 0);
    const b = $("#chat-unread"); b.textContent = total > 99 ? "99+" : String(total); b.hidden = !total;
    document.title = (total ? `(${total}) ` : "") + "Підпільний портал учнів";
    renderSwitch();
  }
  function addBadge(chip, k) {
    const n = unread[k];
    if (mutedChats.has(k)) chip.append(el("span", "quiet", "🔕"));
    if (n) chip.append(el("span", "badge", n > 99 ? "99+" : String(n)));
  }
  function ping() {
    if (!soundOn) return;
    try {
      const ac = ping.ac = ping.ac || new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 880; o.type = "sine";
      o.connect(g); g.connect(ac.destination); g.gain.setValueAtTime(.12, ac.currentTime); g.gain.exponentialRampToValueAtTime(.001, ac.currentTime + .25);
      o.start(); o.stop(ac.currentTime + .3);
    } catch {}
  }

  /* ===== Тест дня ===== */
  let quizUnsub = null;
  const isoDay = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  async function setupQuiz() {
    quizUnsub && quizUnsub(); quizUnsub = null;
    const run = setupQuiz.run = (setupQuiz.run || 0) + 1;
    const mc = myClass() || 6, now = new Date(), day = isoDay(now), month = day.slice(0, 7);
    loadChamps(mc);
    let qs = QUIZ[mc] || QUIZ[6];
    try {
      const s = await getDocs(query(collection(db, "quizbank"), where("cls", "==", mc)));
      const extra = s.docs.slice().sort((a, b) => a.id.localeCompare(b.id)).map(d => d.data()).filter(x => Array.isArray(x.o) && x.o[x.a] != null);
      qs = qs.concat(extra);
    } catch (e) { console.error(e); }
    const doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    const q = qs[doy % qs.length], ref = doc(db, "quiz", `${day}_${me.uid}`);
    $("#qz-cls").textContent = `Тест дня · ${mc} клас`;
    $("#qz-q").textContent = q.q;
    const show = ans => {
      const box = $("#qz-opts"); box.replaceChildren();
      q.o.forEach((o, i) => {
        const b = el("button", "btn ghost", o); b.type = "button";
        if (ans != null) { b.disabled = true; if (i === q.a) b.classList.add("okb"); else if (i === ans) b.classList.add("badb"); }
        b.addEventListener("click", async () => {
          $$("#qz-opts button").forEach(x => { x.disabled = true; });
          try {
            await setDoc(ref, { uid: me.uid, name: profile.name, cls: mc, day, month, ok: i === q.a, at: serverTimestamp() });
            show(i); if (i === q.a) loadQuizTotal();
          } catch (e) { console.error(e); toast("Не вдалося зберегти відповідь"); show(null); }
        });
        box.append(b);
      });
      $("#qz-msg").textContent = ans == null ? "Одна спроба на день." : ans === q.a ? "Правильно! +1 до рейтингу 🏆" : `Не вгадав. Правильна відповідь: ${q.o[q.a]}. Завтра — нове питання!`;
    };
    show(null);
    try { const s = await getDoc(ref); if (s.exists()) show(s.data().ok ? q.a : (q.a + 1) % q.o.length); } catch (e) { console.error(e); }
    if (run !== setupQuiz.run) return;
    quizUnsub = onSnapshot(query(collection(db, "quiz"), where("month", "==", month), limit(1000)), s => {
      quizMonthDocs = s.docs; if (isAdmin) renderStats();
      const score = {};
      s.docs.forEach(d => { const r = d.data(); if (r.cls === mc && r.ok) { score[r.uid] = score[r.uid] || { name: r.name, n: 0 }; score[r.uid].n++; } });
      const top = Object.entries(score).sort((a, b) => b[1].n - a[1].n).slice(0, 10);
      const ol = $("#qz-top"); ol.replaceChildren();
      if (!top.length) { ol.append(el("li", "muted", "Ще ніхто не відповів правильно цього місяця.")); return; }
      top.forEach(([uid, v]) => { const li = el("li"); li.append(nameEl(uid, v.name, uid === me.uid), ` — ${v.n}`); ol.append(li); });
    }, e => console.error(e));
    if (!setupQuiz.cleanup) { setupQuiz.cleanup = true; portalSubs.push(() => { quizUnsub && quizUnsub(); quizUnsub = null; setupQuiz.cleanup = false; }); }
  }

  $("#f-chat").addEventListener("submit", async e => {
    e.preventDefault();
    const input = $("#chat-text"), text = input.value.trim();
    if (!text || !current) return;
    input.value = ""; $("#mentions").hidden = true;
    if (!(await sendText(text))) input.value = text;
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
    // Відкладені оголошення з'являються самі, коли настає їхній час.
    const t = setInterval(() => { if (news.some(d => { const w = toDate(d.data().showAt); return w && w <= new Date() && w > new Date(Date.now() - 61000); })) renderNews(); }, 30000);
    portalSubs.push(() => clearInterval(t));
  }
  const canSchedule = () => isAdmin || isMod || profile.role === "teacher";
  const newsAt = n => toDate(n.showAt) || toDate(n.createdAt);
  function setupNewsForm() {
    const sel = $("#n-cls");
    if (canPickClass()) { sel.innerHTML = classOptions(true); sel.disabled = false; }
    else { sel.innerHTML = `<option value="${myClass()}">${myClass()} клас (твій)</option>`; sel.disabled = true; }
    if (!myClass() && newsFilter === "mine") newsFilter = "all";
    $("#n-when-wrap").hidden = !canSchedule();
  }
  function renderNews() {
    const mc = myClass();
    const filters = [...(mc ? [["mine", "Мій клас"]] : []), ["school", "Уся школа"], ["other", mc ? "Інші класи" : "Класи"], ["all", "Усі"]];
    $("#news-filter").innerHTML = filters.map(([k, t]) => `<button class="chip" type="button" data-f="${k}" aria-pressed="${k === newsFilter}">${t}</button>`).join("");
    $$("#news-filter .chip").forEach(c => c.addEventListener("click", () => { newsFilter = c.dataset.f; renderNews(); }));
    const now = new Date();
    const list = news.filter(d => {
      const n = d.data(), c = n.cls, w = toDate(n.showAt);
      if (w && w > now && n.uid !== me.uid && !isAdmin && !isMod) return false;
      return newsFilter === "all" || (newsFilter === "mine" && c === mc) || (newsFilter === "school" && c === 0) || (newsFilter === "other" && c !== 0 && c !== mc);
    });
    const box = $("#news-list"); box.replaceChildren();
    if (!list.length) { box.append(emptyEl("Оголошень поки немає.")); return; }
    list.sort((a, b) => (newsAt(b.data({ serverTimestamps: "estimate" })) || 0) - (newsAt(a.data({ serverTimestamps: "estimate" })) || 0));
    list.forEach(d => {
      const n = d.data({ serverTimestamps: "estimate" });
      const card = el("article", "card post");
      const top = el("div", "top-line");
      top.append(el("h3", null, clean(n.title)), n.cls === 0 ? pill("Уся школа", "info") : pill(`${n.cls} клас` + (n.cls === mc ? " · твій" : ""), n.cls === mc ? "ok" : "warn"));
      const by = el("div", "by");
      const author = el("span", null, `${n.name} · ${ROLE[n.role] || ""}`);
      const at = newsAt(n), later = toDate(n.showAt) && toDate(n.showAt) > now;
      const right = el("span");
      if (later) right.append(pill(`⏰ вийде ${fmtDay(at)} о ${fmtTime(at)}`, "warn"));
      else right.append(`${fmtDay(at)} ${fmtTime(at)}`);
      by.append(author, right);
      card.append(top, el("p", "txt", clean(n.text)), by);
      if (n.uid === me.uid || isAdmin || isMod) { const a = el("div", "acts"); a.append(confirmButton("Видалити", "btn ghost sm", async () => { await deleteDoc(d.ref); if (n.uid !== me.uid) logAction("Видалив оголошення", n.uid, n.name); })); card.append(a); }
      box.append(card);
    });
  }
  $("#f-news").addEventListener("submit", async e => {
    e.preventDefault(); const f = e.target; formErr(f);
    const title = $("#n-title").value.trim(), text = $("#n-text").value.trim(), cls = Number($("#n-cls").value);
    if (title.length < 2) { formErr(f, "Додай заголовок."); return; }
    if (!text) { formErr(f, "Додай текст оголошення."); return; }
    const data = { cls, title, text, uid: me.uid, name: profile.name, role: profile.role, createdAt: serverTimestamp() };
    const when = canSchedule() && $("#n-when").value ? new Date($("#n-when").value) : null;
    if (when) {
      if (isNaN(when) || when < new Date(Date.now() + 60000)) { formErr(f, "Час публікації має бути в майбутньому."); return; }
      if (when > new Date(Date.now() + 30 * 86400000)) { formErr(f, "Можна запланувати щонайбільше на 30 днів уперед."); return; }
      data.showAt = Timestamp.fromDate(when);
    }
    const btn = $("button[type=submit]", f); btn.disabled = true;
    try {
      await addDoc(collection(db, "announcements"), data);
      $("#n-title").value = ""; $("#n-text").value = ""; $("#n-when").value = "";
      toast(when ? `Оголошення вийде ${fmtDay(when)} о ${fmtTime(when)}` : "Оголошення опубліковано");
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
      s => { apps = s.docs; appsReady = true; renderAdmin(); syncDirectory(); renderRoster(); },
      e => { console.error(e); $("#admin-list").replaceChildren(emptyEl("Не вдалося завантажити заявки.")); }));
  }
  function renderAdmin() {
    appPending = apps.filter(d => d.data().status === "pending").length;
    updateAdminBadge();
    const filters = [["pending", "Нові"], ["approved", "Схвалені"], ["kicked", "Кікнуті"], ["rejected", "Відхилені"], ["all", "Усі"]];
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
      const set = status => async () => { await updateDoc(d.ref, { status, reviewedAt: serverTimestamp() }); toast({ approved: "Заявку схвалено", kicked: `${p.name}: кікнуто`, rejected: "Заявку відхилено" }[status]); logAction({ approved: p.status === "kicked" ? "Повернув після кіку" : "Схвалив заявку", kicked: "Кікнув", rejected: "Відхилив заявку" }[status], d.id, p.name); };
      if (p.status !== "approved") { const b = el("button", "btn okb sm", p.status === "kicked" ? "Повернути" : "Схвалити"); b.type = "button"; b.addEventListener("click", async () => { b.disabled = true; try { await set("approved")(); } catch (ex) { console.error(ex); toast("Не вдалося"); b.disabled = false; } }); acts.append(b); }
      if (p.status === "approved" && d.id !== me.uid) acts.append(confirmButton("Кікнути", "btn badb sm", set("kicked")));
      if (p.status === "pending") acts.append(confirmButton("Відхилити", "btn badb sm", set("rejected")));
      if (d.id !== me.uid) acts.append(confirmButton("Видалити", "btn ghost sm", async () => { await deleteDoc(d.ref); toast("Заявку видалено"); logAction("Видалив заявку", d.id, p.name); }));
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
    const tb = $("#lib-textbooks"); tb.replaceChildren();
    const tbList = (TEXTBOOKS[libCls] || []).filter(b => !q || [b.t, b.a, b.s].join(" ").toLowerCase().includes(q));
    $("#lib-tb-title").hidden = !tbList.length;
    tbList.forEach(b => {
      const card = el("article", "card book");
      const a = el("a", null, b.t); a.href = b.url; a.target = "_blank"; a.rel = "noopener";
      const info = el("div"); info.append(a, el("small", null, [b.s, b.a].filter(Boolean).join(" · ")));
      card.append(el("span", "ic", "📗"), info, el("span"));
      tb.append(card);
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
      if (canAddBooks()) card.append(confirmButton("Видалити", "btn ghost sm", async () => { await deleteDoc(d.ref); logAction("Видалив книгу", "", b.title); }));
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
      renderHolidays();
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
      ok.addEventListener("click", async () => { ok.disabled = true; try { await updateDoc(g.ref, approve); toast("Схвалено"); logAction(`Схвалив: ${title}`, g.owner, dir[g.owner] ? dir[g.owner].name : ""); } catch (e) { console.error(e); toast("Не вдалося"); ok.disabled = false; } });
      acts.append(ok, confirmButton("Відхилити", "btn badb sm", async () => { await updateDoc(g.ref, reject); toast("Відхилено"); logAction(`Відхилив: ${title}`, g.owner, dir[g.owner] ? dir[g.owner].name : ""); }));
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
    $("#mod-head").innerHTML = `<th>Ім'я</th><th>Клас</th><th>Заходив</th>${isAdmin || isMod ? "<th>Дії</th>" : ""}`;
    $("#maint-box").hidden = !isAdmin; renderMaintBox();
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
    const cols = isAdmin || isMod ? 4 : 3;
    const body = $("#mod-rows"); body.replaceChildren();
    if (!list.length) { const tr = el("tr"); const td = el("td", "muted", "Нікого не знайдено."); td.colSpan = cols; tr.append(td); body.append(tr); return; }
    list.forEach(m => {
      const tr = el("tr");
      const tags = [m.id === me.uid ? "ти" : "", ROLE[m.p.role] || "", m.id === ownerUid ? "головний адмін" : "", mods.has(m.id) ? "мол. модератор" : ""].filter(Boolean).join(" · ");
      const name = el("td"); const nb = nameEl(m.id, m.p.name, false); name.append(nb, el("small", null, tags));
      const clsTd = el("td");
      if (m.p.cls && isAdmin) {
        const sel = el("select"); sel.innerHTML = classOptions(); sel.value = String(m.p.cls);
        sel.setAttribute("aria-label", `Клас: ${m.p.name}`);
        sel.addEventListener("change", async () => {
          const n = Number(sel.value), field = m.p.role === "parent" ? "childClass" : "cls";
          sel.disabled = true;
          try { await updateDoc(doc(db, "users", m.id), { [field]: n }); toast(`${m.p.name}: тепер ${n} клас`); logAction(`Змінив клас на ${n}`, m.id, m.p.name); }
          catch (e) { console.error(e); toast("Не вдалося змінити клас"); sel.value = String(m.p.cls); }
          finally { sel.disabled = false; }
        });
        clsTd.append(sel);
      } else clsTd.append(el("span", m.p.cls ? null : "muted", m.p.cls ? `${m.p.cls} клас` : "—"));
      const [txt, cls] = seenText(seen[m.id]);
      tr.append(name, clsTd, el("td", "seen " + cls, txt));
      if (isAdmin || isMod) {
        const cell = el("td"), td = el("div", "acts"); cell.append(td);
        if (m.id !== me.uid && m.id !== ownerUid && !mods.has(m.id)) td.append(muteControl(m));
        if (isAdmin && m.id !== me.uid && m.id !== ownerUid) td.append(confirmButton("Кікнути", "btn badb sm", async () => {
          await updateDoc(doc(db, "users", m.id), { status: "kicked", reviewedAt: serverTimestamp() });
          toast(`${m.p.name}: кікнуто`); logAction("Кікнув", m.id, m.p.name);
        }));
        if (isOwner && m.id !== me.uid) {
          const isM = mods.has(m.id);
          const b = el("button", "btn sm " + (isM ? "ghost" : "okb"), isM ? "Зняти модератора" : "Зробити модератором"); b.type = "button";
          b.addEventListener("click", async () => {
            b.disabled = true;
            try {
              if (isM) await deleteDoc(doc(db, "mods", m.id)); else await setDoc(doc(db, "mods", m.id), { createdAt: serverTimestamp() });
              toast(isM ? `${m.p.name} більше не модератор` : `${m.p.name} — молодший модератор`);
              logAction(isM ? "Зняв модератора" : "Призначив модератором", m.id, m.p.name);
            } catch (e) { console.error(e); toast("Не вдалося"); b.disabled = false; }
          });
          td.append(b);
        }
        tr.append(cell);
      }
      body.append(tr);
    });
  }
}
