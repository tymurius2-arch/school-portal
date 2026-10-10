import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, sendPasswordResetEmail, connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc,
  collection, query, orderBy, limit, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, SCHOOL } from "./config.js";

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

/* ---------- Тема ---------- */
const root = document.documentElement;
const isDark = () => root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
const syncTheme = () => { $("#b-theme").textContent = isDark() ? "☀️" : "🌙"; };
if (store.get("theme", null)) root.dataset.theme = store.get("theme");
syncTheme();
$("#b-theme").addEventListener("click", () => { root.dataset.theme = isDark() ? "light" : "dark"; store.set("theme", root.dataset.theme); syncTheme(); });

/* ---------- Екрани ---------- */
const show = id => $$(".screen").forEach(s => s.hidden = s.id !== "s-" + id);
$$(".school-name").forEach(e => e.textContent = SCHOOL.name);
document.title = `Портал класу · ${SCHOOL.name}`;

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
  const stopPortal = () => { portalSubs.forEach(u => u()); portalSubs = []; chatUnsub && chatUnsub(); chatUnsub = null; inPortal = false; };
  const stopAll = () => { sessionSubs.forEach(u => u()); sessionSubs = []; stopPortal(); };

  onAuthStateChanged(auth, async user => {
    stopAll(); me = user; profile = undefined; isAdmin = false; editing = false;
    if (!user) { show("auth"); return; }
    show("loading");
    await checkAdmin(user);
    if (me !== user) return;
    sessionSubs.push(onSnapshot(doc(db, "users", user.uid),
      s => { profile = s.exists() ? s.data({ serverTimestamps: "estimate" }) : null; route(); },
      e => { console.error(e); toast("Немає зв'язку з сервером. Онови сторінку."); }));
  });

  /* ----- Адміністратор ----- */
  let ownerFree = false;
  async function checkAdmin(user) {
    isAdmin = false; ownerFree = false;
    try {
      const owner = await getDoc(doc(db, "meta", "owner"));
      ownerFree = !owner.exists();
      isAdmin = owner.exists() && owner.data().uid === user.uid;
      if (!isAdmin) isAdmin = (await getDoc(doc(db, "admins", user.uid))).exists();
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

  function route() {
    if (registering || !me || profile === undefined) return;
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
  const canPickClass = () => isAdmin || profile.role === "teacher";
  let lastClass = null;

  function enterPortal() {
    const cls = myClass();
    $("#who").textContent = [profile.name, isAdmin ? "адміністратор" : ROLE[profile.role], cls ? `${cls} клас` : ""].filter(Boolean).join(" · ");
    if (inPortal) {
      if (cls !== lastClass) { lastClass = cls; setupChat(); setupNewsForm(); renderNews(); setupSchedule(); }
      return;
    }
    inPortal = true; lastClass = cls;
    show("portal");
    // Заявка самого адміністратора не має висіти серед нових.
    if (isAdmin && profile.status !== "approved") updateDoc(doc(db, "users", me.uid), { status: "approved", reviewedAt: serverTimestamp() }).catch(console.error);
    $(".tab[data-tab=admin]").hidden = !isAdmin;
    setupChat(); setupNews(); setupSchedule();
    if (isAdmin) setupAdmin();
    const saved = store.get("tab", "chat");
    openTab(saved === "admin" && !isAdmin ? "chat" : saved);
  }

  function openTab(id) {
    if (!$("#p-" + id)) id = "chat";
    $$(".tab").forEach(t => t.setAttribute("aria-selected", String(t.dataset.tab === id)));
    $$(".panel").forEach(p => p.hidden = p.id !== "p-" + id);
    store.set("tab", id);
    if (id === "chat") scrollChat(true);
  }
  $$(".tab").forEach(t => t.addEventListener("click", () => openTab(t.dataset.tab)));

  /* ----- Чат класу ----- */
  let chatUnsub = null, chatCls = null;
  function setupChat() {
    const sel = $("#chat-class");
    sel.innerHTML = classOptions();
    $("#chat-class-wrap").hidden = !canPickClass();
    const startCls = canPickClass() ? (Number(store.get("chatCls", 0)) || myClass() || 1) : myClass();
    sel.value = String(startCls);
    openChat(startCls);
  }
  $("#chat-class").addEventListener("change", e => { store.set("chatCls", Number(e.target.value)); openChat(Number(e.target.value)); });

  function openChat(cls) {
    chatUnsub && chatUnsub();
    chatCls = cls;
    $("#chat-title").textContent = `Чат ${cls} класу`;
    const box = $("#messages"); box.replaceChildren(emptyEl("Завантаження…"));
    const q = query(collection(db, "classes", String(cls), "messages"), orderBy("createdAt", "desc"), limit(200));
    chatUnsub = onSnapshot(q,
      s => renderMessages(s.docs.slice().reverse()),
      e => { console.error(e); box.replaceChildren(emptyEl("Немає доступу до цього чату.")); });
  }
  function scrollChat(force) {
    const box = $("#messages");
    if (force || box.scrollHeight - box.scrollTop - box.clientHeight < 120) box.scrollTop = box.scrollHeight;
  }
  function renderMessages(docs) {
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
      if (m.role && m.role !== "student") meta.append(el("span", null, ROLE[m.role]));
      meta.append(el("span", null, fmtTime(when)));
      if (mine || isAdmin) meta.append(confirmButton("видалити", "del", () => deleteDoc(d.ref)));
      wrap.append(meta, el("div", "txt", m.text));
      box.append(wrap);
    });
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }
  $("#f-chat").addEventListener("submit", async e => {
    e.preventDefault();
    const input = $("#chat-text"), text = input.value.trim();
    if (!text || chatCls == null) return;
    input.value = "";
    try {
      await addDoc(collection(db, "classes", String(chatCls), "messages"),
        { uid: me.uid, name: profile.name, role: profile.role, text: text.slice(0, 500), createdAt: serverTimestamp() });
      scrollChat(true);
    } catch (ex) { console.error(ex); input.value = text; toast("Повідомлення не надіслано"); }
  });

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
      if (n.uid === me.uid || isAdmin) { const a = el("div", "acts"); a.append(confirmButton("Видалити", "btn ghost sm", () => deleteDoc(d.ref))); card.append(a); }
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
  let apps = [], appFilter = "pending";
  function setupAdmin() {
    portalSubs.push(onSnapshot(query(collection(db, "users"), orderBy("createdAt", "desc"), limit(500)),
      s => { apps = s.docs; renderAdmin(); },
      e => { console.error(e); $("#admin-list").replaceChildren(emptyEl("Не вдалося завантажити заявки.")); }));
  }
  function renderAdmin() {
    const pending = apps.filter(d => d.data().status === "pending").length;
    const badge = $("#pending-count"); badge.textContent = pending; badge.hidden = !pending;
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
}
