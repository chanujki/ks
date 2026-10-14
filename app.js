"use strict";
/* ==========================================================================
   Rikuu Messenger — app.js (v3)
   Firebase data structure অপরিবর্তিত: users, chatIds, presence,
   userChats, messages, calls. নতুন: profile photo/bio, voice message, edit.
   ========================================================================== */

const firebaseConfig = {
  apiKey: "AIzaSyC1kOrTSnHz9m1YzmfE4Zu1KFwGCyQ5kRg",
  authDomain: "rikuu-9fc12.firebaseapp.com",
  databaseURL: "https://rikuu-9fc12-default-rtdb.firebaseio.com",
  projectId: "rikuu-9fc12",
  storageBucket: "rikuu-9fc12.firebasestorage.app",
  messagingSenderId: "501319584733",
  appId: "1:501319584733:web:a15d1dcb53f19a66e50434"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const SV = firebase.database.ServerValue.TIMESTAMP;
const SESSION = "lyuna_session_v2";

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
const cid = (a, b) => [a, b].sort().join("_");
const EMOJIS = "😀 😂 🥹 😍 😎 🤔 😢 😡 👍 👏 🙏 🔥 ❤️ 🎉 ✨ 😊 🙌 💯 👀 😅 🥳 🤝 🌙 ☕ 😴 🤩 💪 🫶".split(" ");
const REACTS = ["❤️", "👍", "😂", "😮", "😢", "🙏"];
const COLORS = ["#6558f5", "#e0457b", "#16a085", "#e67e22", "#2d8cf0", "#8e44ad", "#d35400", "#0ea5a4"];
const colorOf = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
const avatar = (name, seed, big, photo) => {
  if (photo) return `<img class="avatar${big ? " big" : ""}" src="${esc(photo)}" alt="">`;
  const ch = ((name || "").trim()[0]) || "R";
  return `<div class="avatar${big ? " big" : ""}" style="background:linear-gradient(135deg,${colorOf(seed || name)},#9d6bff)">${esc(ch.toUpperCase())}</div>`;
};
const timeOf = t => new Date(Number(t) || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const lastSeenText = t => (Number(t) ? new Date(Number(t)).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "অজানা");
const fmtDur = s => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
function dayLabel(t) {
  const d = new Date(Number(t) || Date.now()), now = new Date(), y = new Date();
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "আজ";
  if (d.toDateString() === y.toDateString()) return "গতকাল";
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}
const linkify = s => esc(s).replace(/(https?:\/\/[^\s<]+)/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
function toast(t, ms = 2800) {
  const el = $("toast");
  el.textContent = t;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), ms);
}
function errText(e) {
  const s = String(e?.message || e);
  return s.includes("PERMISSION_DENIED") ? "Firebase Permission Denied — Realtime Database Rules পরীক্ষা করুন।" : s;
}
function setErr(id, msg) { const el = $(id); el.textContent = msg || ""; el.hidden = !msg; }
async function pinHash(p) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(p));
  return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, "0")).join("");
}
const makeUid = () => (crypto.randomUUID ? crypto.randomUUID() : "u_" + Date.now().toString(36) + Math.random().toString(36).slice(2));
const randomId = () => String(Math.floor(100000 + Math.random() * 900000));
function blobToDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}
function compressImage(file, max = 900, q = 0.72) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL("image/jpeg", q));
    };
    img.onerror = rej;
    img.src = url;
  });
}

/* ---------- state ---------- */
let me = null, active = null, presRef = null, recentRef = null, callWatchRef = null;
let cache = {}, subs = [], replyTo = null, editTarget = null, sheetMsg = null, forceScroll = false;
let typingOn = false, lastTypingSet = 0, typingTimer = null;
let prevUnread = {}, recentReady = false, installPrompt = null, recentList = [];
let pc = null, localStream = null, screenStream = null, currentCall = null, incomingCall = null;
let incomingSeen = new Set(), callTimerId = null, callStart = 0, facing = "user", ringTimer = null;
let searchTimer = null, actx = null, pmPhoto = null;
let recorder = null, recChunks = [], recStart = 0, recTimer = null;

function listen(ref, ev, fn) { ref.on(ev, fn); subs.push(() => ref.off(ev, fn)); }
function clearSubs() { subs.forEach(f => f()); subs = []; }

/* ---------- sounds ---------- */
const soundOn = () => localStorage.getItem("rikuu_sound") !== "off";
function tone(freqs, dur = 0.13, gap = 0.15) {
  if (!soundOn()) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    freqs.forEach((f, i) => {
      const t0 = actx.currentTime + i * gap, o = actx.createOscillator(), g = actx.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.16, t0 + 0.02);
      g.gain.linearRampToValueAtTime(0, t0 + dur);
      o.connect(g).connect(actx.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    });
  } catch (_) {}
}
const playMsgSound = () => tone([880, 1175]);
function startRing() { stopRing(); const r = () => tone([660, 880, 660], 0.14, 0.18); r(); ringTimer = setInterval(r, 2200); }
function stopRing() { clearInterval(ringTimer); ringTimer = null; }

/* ---------- notifications ---------- */
function notifyUser(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, icon: "icons/rikuu-192.png", tag: "rikuu-" + title });
    n.onclick = () => { window.focus(); n.close(); };
  } catch (_) {}
}
async function enableNotifications() {
  if (!("Notification" in window)) return toast("এই browser-এ notification সমর্থিত নয়");
  const p = await Notification.requestPermission();
  toast(p === "granted" ? "নোটিফিকেশন চালু হয়েছে" : "নোটিফিকেশন অনুমতি দেওয়া হয়নি");
}

function applyTheme() {
  const dark = localStorage.getItem("rikuu_theme") === "dark";
  document.body.classList.toggle("dark", dark);
  $("themeBtn").textContent = dark ? "☀" : "☾";
  $("soundBtn").textContent = soundOn() ? "🔊" : "🔇";
}

/* ==========================================================================
   AUTH
   ========================================================================== */
async function uniqueId(uid) {
  for (let i = 0; i < 40; i++) {
    const id = randomId();
    const tx = await db.ref("chatIds/" + id).transaction(v => (v === null ? uid : v));
    if (tx.committed && tx.snapshot.val() === uid) return id;
  }
  throw Error("Chat ID তৈরি করা যায়নি।");
}

async function signup() {
  setErr("sErr");
  const name = $("sName").value.trim(), pin = $("sPin").value.trim();
  if (name.length < 2) return setErr("sErr", "সঠিক নাম দিন।");
  if (!/^\d{4,6}$/.test(pin)) return setErr("sErr", "PIN ৪–৬ সংখ্যার হতে হবে।");
  $("signBtn").disabled = true;
  let uid = null, id = null, written = false;
  try {
    uid = makeUid();
    id = await uniqueId(uid);
    await db.ref("users/" + uid).set({ uid, chatId: id, name, pinHash: await pinHash(pin), createdAt: SV });
    written = true;
    me = { uid, chatId: id, name };
    localStorage.setItem(SESSION, uid);
    await launch();
    toast("স্বাগতম! আপনার Chat ID: " + id, 5000);
  } catch (e) {
    if (id) {
      if (written) await db.ref("users/" + uid).remove().catch(() => {});
      await db.ref("chatIds/" + id).remove().catch(() => {});
    }
    setErr("sErr", errText(e));
  } finally {
    $("signBtn").disabled = false;
  }
}

async function login() {
  setErr("lErr");
  const id = $("lId").value.trim(), pin = $("lPin").value.trim();
  if (!/^\d{6}$/.test(id)) return setErr("lErr", "৬ সংখ্যার Chat ID দিন।");
  if (!/^\d{4,6}$/.test(pin)) return setErr("lErr", "সঠিক PIN দিন।");
  $("loginBtn").disabled = true;
  try {
    const uid = (await db.ref("chatIds/" + id).once("value")).val();
    if (!uid) throw Error("Chat ID পাওয়া যায়নি।");
    const u = (await db.ref("users/" + uid).once("value")).val();
    if (!u) throw Error("User profile পাওয়া যায়নি।");
    if ((await pinHash(pin)) !== u.pinHash) throw Error("PIN ভুল।");
    me = { uid: u.uid, chatId: u.chatId, name: u.name };
    localStorage.setItem(SESSION, uid);
    await launch();
  } catch (e) {
    setErr("lErr", errText(e));
  } finally {
    $("loginBtn").disabled = false;
  }
}

async function launch() {
  $("auth").hidden = true;
  $("app").hidden = false;
  const snap = (await db.ref("users/" + me.uid).once("value")).val() || {};
  me.photo = snap.photo || "";
  me.bio = snap.bio || "";
  renderMe();
  applyTheme();
  presRef = db.ref("presence/" + me.uid);
  await presRef.set({ online: true, lastSeen: SV });
  presRef.onDisconnect().set({ online: false, lastSeen: SV });
  watchIncomingCalls();
  loadRecent();
}

function renderMe() {
  $("profile").innerHTML = `<button class="me-btn" id="openProfile" title="প্রোফাইল দেখুন ও বদলান">
    ${avatar(me.name, me.uid, false, me.photo)}
    <div class="me-info"><b>${esc(me.name)}</b><span class="chatid">ID: ${esc(me.chatId)}</span></div>
  </button>`;
  $("openProfile").onclick = openProfile;
}

async function copyId() {
  try { await navigator.clipboard.writeText(me.chatId); toast("Chat ID কপি হয়েছে"); }
  catch (_) { toast("আপনার Chat ID: " + me.chatId); }
}

/* ---------- profile edit ---------- */
function openProfile() {
  pmPhoto = null;
  $("pmAvatar").innerHTML = avatar(me.name, me.uid, true, me.photo);
  $("pmName").value = me.name;
  $("pmBio").value = me.bio || "";
  $("pmId").textContent = "ID: " + me.chatId;
  setErr("pmErr");
  $("profileModal").hidden = false;
  setTimeout(() => $("pmName").focus(), 60);
}
function closeProfile() { $("profileModal").hidden = true; }
async function pickPhoto(file) {
  if (!file || !file.type.startsWith("image/")) return;
  try {
    pmPhoto = await compressImage(file, 256, 0.82);
    $("pmAvatar").innerHTML = avatar(me.name, me.uid, true, pmPhoto);
  } catch (_) { toast("ছবি লোড হয়নি"); }
}
async function saveProfile() {
  const name = $("pmName").value.trim(), bio = $("pmBio").value.trim();
  if (name.length < 2) return setErr("pmErr", "নাম কমপক্ষে ২ অক্ষর হতে হবে।");
  $("pmSave").disabled = true;
  try {
    const upd = { name, bio };
    if (pmPhoto) upd.photo = pmPhoto;
    await db.ref("users/" + me.uid).update(upd);
    me.name = name; me.bio = bio;
    if (pmPhoto) me.photo = pmPhoto;
    // বন্ধুদের chat list-এও নতুন নাম ও ছবি পৌঁছে দিন
    await Promise.all(recentList.map(c =>
      db.ref(`userChats/${c.uid}/${me.uid}`).update({ name, photo: me.photo || null }).catch(() => {})));
    renderMe();
    closeProfile();
    toast("প্রোফাইল আপডেট হয়েছে");
  } catch (e) {
    setErr("pmErr", errText(e));
  } finally {
    $("pmSave").disabled = false;
  }
}

async function logout() {
  try { if (presRef) await presRef.set({ online: false, lastSeen: SV }); } catch (_) {}
  localStorage.removeItem(SESSION);
  location.reload();
}

/* ==========================================================================
   SEARCH & CHAT LIST
   ========================================================================== */
async function searchUser() {
  const id = $("search").value.trim(), box = $("searchResults");
  box.innerHTML = "";
  if (!id) return;
  if (!/^\d{6}$/.test(id)) { box.innerHTML = '<div class="empty-note">৬ সংখ্যার ID লিখুন</div>'; return; }
  try {
    const uid = (await db.ref("chatIds/" + id).once("value")).val();
    if (!uid) { box.innerHTML = '<div class="empty-note">এই ID-তে কোনো user নেই</div>'; return; }
    if (uid === me.uid) { box.innerHTML = '<div class="empty-note">এটি আপনার নিজের ID</div>'; return; }
    const u = (await db.ref("users/" + uid).once("value")).val();
    if (!u) throw Error("User profile পাওয়া যায়নি।");
    box.innerHTML = `<button class="chat-item">${avatar(u.name, u.uid, false, u.photo)}
      <div class="ci-main"><b>${esc(u.name)}</b><span class="ci-last">ID: ${esc(u.chatId)}</span></div>
      <span class="pill">Chat</span></button>`;
    box.querySelector("button").onclick = () => { $("search").value = ""; box.innerHTML = ""; openChat(uid); };
  } catch (e) {
    box.innerHTML = `<div class="empty-note">${esc(errText(e))}</div>`;
  }
}

function loadRecent() {
  if (recentRef) recentRef.off();
  recentReady = false;
  recentRef = db.ref("userChats/" + me.uid);
  recentRef.on("value", s => {
    const arr = [];
    s.forEach(x => { arr.push({ ...x.val() }); });
    arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    arr.forEach(c => {
      const was = prevUnread[c.uid] || 0, now = c.unread || 0;
      if (recentReady && now > was && (!active || active.uid !== c.uid)) {
        playMsgSound();
        if (document.hidden) notifyUser(c.name || "নতুন মেসেজ", c.lastMessage || "");
      }
      prevUnread[c.uid] = now;
    });
    recentReady = true;
    recentList = arr;
    renderRecent();
    updateTitle();
  });
}

function updateTitle() {
  const total = Object.values(prevUnread).reduce((a, b) => a + b, 0);
  document.title = total ? `(${total}) Rikuu` : "Rikuu — Messenger";
}

function renderRecent() {
  const box = $("recent");
  if (!recentList.length) {
    box.innerHTML = '<div class="empty-note">এখনো কোনো chat নেই।<br>উপরে Chat ID দিয়ে খুঁজুন।</div>';
    return;
  }
  box.innerHTML = recentList.map(c => {
    const unread = c.unread && active?.uid !== c.uid
      ? `<span class="badge">${c.unread > 99 ? "99+" : c.unread}</span>` : "";
    return `<button class="chat-item ${active?.uid === c.uid ? "active" : ""}" data-uid="${esc(c.uid)}">
      ${avatar(c.name, c.uid, false, c.photo)}
      <div class="ci-main">
        <div class="ci-top"><b>${esc(c.name || "User")}</b><time>${c.updatedAt ? timeOf(c.updatedAt) : ""}</time></div>
        <span class="ci-last">${esc(c.lastMessage || "কথা বলা শুরু করুন")}</span>
      </div>${unread}
    </button>`;
  }).join("");
  box.querySelectorAll(".chat-item").forEach(el => el.onclick = () => openChat(el.dataset.uid));
}

/* ==========================================================================
   OPEN CHAT, PRESENCE, TYPING
   ========================================================================== */
async function openChat(uid) {
  try {
    const u = (await db.ref("users/" + uid).once("value")).val();
    if (!u) throw Error("User profile পাওয়া যায়নি।");
    stopTyping();
    clearSubs();
    hideReply();
    active = u;
    $("empty").hidden = true;
    $("convo").hidden = false;
    $("app").classList.add("chat-open");
    $("headName").textContent = u.name;
    $("headAvatar").innerHTML = avatar(u.name, u.uid, false, u.photo);
    $("headStatus").textContent = "সংযুক্ত হচ্ছে…";
    $("typing").hidden = true;
    watchStatus();
    watchTyping();
    listenMessages();
    clearUnread(uid);
    db.ref(`userChats/${me.uid}/${uid}`).update({ uid, name: u.name, chatId: u.chatId, photo: u.photo || null, updatedAt: SV }).catch(() => {});
    renderRecent();
    $("msg").focus();
  } catch (e) {
    toast(errText(e));
  }
}

function clearUnread(uid) {
  if (!me) return;
  db.ref(`userChats/${me.uid}/${uid}/unread`).set(0).catch(() => {});
}

function watchStatus() {
  const uid = active.uid;
  listen(db.ref("presence/" + uid), "value", s => {
    if (!active || active.uid !== uid) return;
    const p = s.val() || {};
    $("headStatus").innerHTML = p.online ? '<span class="online">● অনলাইন</span>' : "শেষ দেখা: " + lastSeenText(p.lastSeen);
  });
}

function watchTyping() {
  const uid = active.uid;
  listen(db.ref(`typing/${cid(me.uid, uid)}/${uid}`), "value", s => {
    if (!active || active.uid !== uid) return;
    $("typing").hidden = !s.val();
    if (s.val()) scrollToBottomIfNear();
  });
}

function sendTyping() {
  if (!active || !me) return;
  const ref = db.ref(`typing/${cid(me.uid, active.uid)}/${me.uid}`);
  if (!typingOn || Date.now() - lastTypingSet > 2500) {
    typingOn = true;
    lastTypingSet = Date.now();
    ref.set(Date.now()).catch(() => {});
    ref.onDisconnect().remove();
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, 3000);
}

function stopTyping() {
  clearTimeout(typingTimer);
  if (typingOn && active && me) db.ref(`typing/${cid(me.uid, active.uid)}/${me.uid}`).remove().catch(() => {});
  typingOn = false;
}

/* ==========================================================================
   MESSAGES
   ========================================================================== */
function listenMessages() {
  const uid = active.uid, key = cid(me.uid, uid);
  cache = {};
  forceScroll = true;
  $("messages").innerHTML = '<div class="loading">লোড হচ্ছে…</div>';
  const ref = db.ref("messages/" + key).limitToLast(300);
  let ready = false;
  ref.once("value", () => { ready = true; renderMessages(); });

  listen(ref, "child_added", s => {
    const m = { key: s.key, ...(s.val() || {}) };
    cache[s.key] = m;
    if (m.senderId !== me.uid) {
      if (!m.deliveredAt) db.ref(`messages/${key}/${s.key}/deliveredAt`).set(SV).catch(() => {});
      if (ready) {
        if (!document.hidden) {
          playMsgSound();
          markSeen(key, m);
          clearUnread(uid);
        } else {
          notifyUser(active?.name || "Rikuu", previewOf(m));
        }
      }
    }
    renderMessages();
  });
  listen(ref, "child_changed", s => { cache[s.key] = { key: s.key, ...(s.val() || {}) }; renderMessages(); });
  listen(ref, "child_removed", s => { delete cache[s.key]; renderMessages(); });
}

const previewOf = m => m.type === "image" ? "📷 ছবি" : m.type === "voice" ? "🎤 ভয়েস মেসেজ" : (m.text || "নতুন মেসেজ").slice(0, 120);

function markSeen(key, m) {
  if (m.seenAt || m.senderId === me.uid) return;
  db.ref(`messages/${key}/${m.key}/seenAt`).set(SV).catch(() => {});
}

function tickHtml(m) {
  if (m.seenAt) return '<span class="tick seen" title="দেখা হয়েছে">✓✓</span>';
  if (m.deliveredAt) return '<span class="tick" title="পৌঁছেছে">✓✓</span>';
  return '<span class="tick" title="পাঠানো হয়েছে">✓</span>';
}

function reactHtml(m) {
  const list = Object.values(m.reactions || {});
  if (!list.length || m.deleted) return "";
  const counts = {};
  list.forEach(e => { counts[e] = (counts[e] || 0) + 1; });
  return `<div class="reacts">${Object.entries(counts).map(([e, c]) => `<span>${esc(e)}${c > 1 ? " " + c : ""}</span>`).join("")}</div>`;
}

function scrollToBottomIfNear() {
  const box = $("messages");
  if (box.scrollHeight - box.scrollTop - box.clientHeight < 160) box.scrollTop = box.scrollHeight;
}

function renderMessages() {
  const box = $("messages");
  const list = Object.values(cache).sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
  if (!list.length) {
    box.innerHTML = '<div class="welcome"><div class="wave">👋</div><b>হ্যালো বলুন!</b><span>এই chat-এ প্রথম মেসেজ পাঠান।</span></div>';
    return;
  }
  const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  let html = "", lastDay = "", prev = null;

  for (const m of list) {
    const day = dayLabel(m.createdAt);
    if (day !== lastDay) { html += `<div class="day"><span>${day}</span></div>`; lastDay = day; prev = null; }

    if (m.type === "call") {
      html += `<div class="call-log">📞 ${esc(m.text)} · ${timeOf(m.createdAt)}</div>`;
      prev = null;
      continue;
    }

    const mine = m.senderId === me.uid;
    const grp = prev && prev.senderId === m.senderId;
    const quote = m.replyTo && !m.deleted
      ? `<div class="quote"><b>${esc(m.replyTo.name)}</b><span>${esc(m.replyTo.text)}</span></div>` : "";
    const img = !m.deleted && m.image ? `<img class="msg-img" src="${m.image}" alt="ছবি" loading="lazy">` : "";
    const body = m.deleted ? "<i>🚫 মেসেজটি মুছে ফেলা হয়েছে</i>"
      : m.type === "voice" ? `<div class="voice"><audio controls preload="metadata" src="${m.audio}"></audio></div>`
      : (m.text ? `<p>${linkify(m.text)}</p>` : "");
    const edited = m.edited && !m.deleted ? '<span class="edited">সম্পাদিত</span>' : "";

    html += `<div class="row ${mine ? "mine" : ""} ${grp ? "grp" : ""}" data-k="${esc(m.key)}">
      <div class="bubble ${m.deleted ? "deleted" : ""}">
        ${quote}${img}${body}
        <div class="meta">${edited}<time>${timeOf(m.createdAt)}</time>${mine ? tickHtml(m) : ""}</div>
        ${reactHtml(m)}
      </div>
    </div>`;
    prev = m;
  }

  box.innerHTML = html;
  box.querySelectorAll(".row").forEach(r => {
    r.onclick = () => { const m = cache[r.dataset.k]; if (m) openSheet(m); };
  });
  box.querySelectorAll("audio").forEach(a => {
    a.onclick = e => e.stopPropagation();
    a.onplay = () => box.querySelectorAll("audio").forEach(o => { if (o !== a) o.pause(); });
  });
  if (stick || forceScroll) { box.scrollTop = box.scrollHeight; forceScroll = false; }
}

async function sendPayload(extra, preview) {
  const target = active;
  if (!me || !target) return false;
  const key = cid(me.uid, target.uid);
  const data = { senderId: me.uid, receiverId: target.uid, text: "", createdAt: SV, ...extra };
  if (replyTo) data.replyTo = { key: replyTo.key, name: replyTo.name, text: replyTo.text.slice(0, 140) };
  hideReply();
  forceScroll = true;
  try {
    await db.ref("messages/" + key).push().set(data);
    await Promise.all([
      db.ref(`userChats/${me.uid}/${target.uid}`).update({ uid: target.uid, name: target.name, chatId: target.chatId, photo: target.photo || null, lastMessage: preview, updatedAt: SV }),
      db.ref(`userChats/${target.uid}/${me.uid}`).update({ uid: me.uid, name: me.name, chatId: me.chatId, photo: me.photo || null, lastMessage: preview, updatedAt: SV })
    ]);
    db.ref(`userChats/${target.uid}/${me.uid}/unread`).transaction(v => (v || 0) + 1);
    return true;
  } catch (e) {
    toast("পাঠানো যায়নি: " + errText(e));
    return false;
  }
}

async function sendMessage() {
  const input = $("msg"), text = input.value.trim();
  if (!text || !active) return;
  if (editTarget) {
    const key = editTarget.key;
    hideReply();
    input.value = ""; autosize();
    db.ref(`messages/${cid(me.uid, active.uid)}/${key}`).update({ text, edited: true })
      .catch(e => toast(errText(e)));
    input.focus();
    return;
  }
  input.value = ""; autosize(); stopTyping();
  const ok = await sendPayload({ type: "text", text }, text);
  if (!ok) { input.value = text; autosize(); }
  input.focus();
}

async function sendImage(file) {
  if (!file || !active) return;
  if (!file.type.startsWith("image/")) return toast("শুধু ছবি পাঠানো যাবে");
  toast("ছবি প্রস্তুত হচ্ছে…");
  try {
    const data = await compressImage(file);
    if (data.length > 900000) return toast("ছবিটি বড়, ছোট ছবি বেছে নিন");
    await sendPayload({ type: "image", image: data, text: "" }, "📷 ছবি");
  } catch (e) {
    toast("ছবি পাঠানো যায়নি");
  }
}

/* ---------- voice messages ---------- */
async function startRecording() {
  if (!active) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast("এই browser-এ ভয়েস রেকর্ড সমর্থিত নয়");
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (_) { return toast("মাইক্রোফোনের অনুমতি দিন"); }
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(t => MediaRecorder.isTypeSupported(t)) || "";
  recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
  recChunks = [];
  recorder.ondataavailable = e => { if (e.data.size) recChunks.push(e.data); };
  recorder.start();
  recStart = Date.now();
  $("recBar").hidden = false;
  $("micBtn").textContent = "⏹";
  $("micBtn").classList.add("recording");
  $("recTime").textContent = "00:00";
  recTimer = setInterval(() => {
    const s = Math.floor((Date.now() - recStart) / 1000);
    $("recTime").textContent = fmtDur(s);
    if (s >= 60) stopRecording(true);
  }, 250);
}

function stopRecording(send) {
  const rec = recorder;
  if (!rec) return;
  recorder = null;
  clearInterval(recTimer);
  const dur = Math.max(1, Math.round((Date.now() - recStart) / 1000));
  const chunks = recChunks;
  rec.onstop = async () => {
    rec.stream.getTracks().forEach(t => t.stop());
    $("recBar").hidden = true;
    $("micBtn").textContent = "🎤";
    $("micBtn").classList.remove("recording");
    if (!send || !chunks.length) return;
    const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
    if (blob.size > 700000) return toast("ভয়েস মেসেজ বড় হয়ে গেছে, ছোট করে পাঠান");
    try {
      const data = await blobToDataURL(blob);
      await sendPayload({ type: "voice", audio: data, duration: dur }, "🎤 ভয়েস মেসেজ");
    } catch (_) { toast("ভয়েস মেসেজ পাঠানো যায়নি"); }
  };
  rec.stop();
}

/* ---------- reply / edit / reactions / delete ---------- */
function setReply(m) {
  editTarget = null;
  replyTo = {
    key: m.key,
    name: m.senderId === me.uid ? me.name : (active?.name || "User"),
    text: m.deleted ? "মুছে ফেলা মেসেজ" : (m.text || previewOf(m))
  };
  $("replyName").textContent = "↩ " + replyTo.name;
  $("replyText").textContent = replyTo.text;
  $("replyBar").hidden = false;
  $("msg").focus();
}

function setEdit(m) {
  replyTo = null;
  editTarget = m;
  $("replyName").textContent = "✏️ মেসেজ সম্পাদনা";
  $("replyText").textContent = m.text;
  $("replyBar").hidden = false;
  $("msg").value = m.text;
  autosize();
  $("msg").focus();
}

function hideReply() {
  replyTo = null;
  editTarget = null;
  $("replyBar").hidden = true;
  $("replyName").textContent = "";
}

async function react(m, emoji) {
  const ref = db.ref(`messages/${cid(me.uid, active.uid)}/${m.key}/reactions/${me.uid}`);
  const current = (m.reactions || {})[me.uid];
  try { await (current === emoji ? ref.remove() : ref.set(emoji)); }
  catch (e) { toast(errText(e)); }
}

function openSheet(m) {
  sheetMsg = m;
  const mine = m.senderId === me.uid;
  $("sheetReacts").innerHTML = m.deleted ? "" : REACTS.map(r => `<button data-r="${r}" aria-label="${r}">${r}</button>`).join("");
  $("sheetReacts").querySelectorAll("button").forEach(b => b.onclick = () => { react(m, b.dataset.r); closeSheet(); });
  $("sheetReacts").hidden = !!m.deleted;
  $("sheetReply").hidden = !!m.deleted;
  $("sheetEdit").hidden = !mine || !!m.deleted || m.type !== "text";
  $("sheetCopy").hidden = !m.text;
  $("sheetDelete").hidden = !mine || !!m.deleted;
  $("sheet").hidden = false;
  requestAnimationFrame(() => $("sheet").classList.add("show"));
}
function closeSheet() {
  $("sheet").classList.remove("show");
  setTimeout(() => { $("sheet").hidden = true; }, 200);
}

/* ==========================================================================
   CALLS (WebRTC + Firebase signaling)
   ========================================================================== */
const fmtCallLabel = (video, secs) => `${video ? "ভিডিও" : "অডিও"} কল · ${secs > 0 ? fmtDur(secs) : "গৃহীত হয়নি"}`;

function showCallUI(name, seed, video, status, photo = "") {
  $("callName").textContent = name;
  $("callTitle").textContent = status;
  $("callTimer").textContent = "";
  $("callAvatar").innerHTML = avatar(name, seed, true, photo);
  $("call").classList.toggle("audio", !video);
  $("toggleCam").hidden = !video;
  $("flipCam").hidden = !video;
  $("shareScreen").hidden = !video;
  $("call").hidden = false;
  setCtrl("toggleMic", "🎙️", false);
  setCtrl("toggleCam", "📷", false);
  setCtrl("shareScreen", "🖥️", false);
}
function setCtrl(id, icon, off) { const b = $(id); b.textContent = icon; b.classList.toggle("off", off); }

function startTimer() {
  clearInterval(callTimerId);
  callStart = Date.now();
  callTimerId = setInterval(() => { $("callTimer").textContent = fmtDur(Math.floor((Date.now() - callStart) / 1000)); }, 1000);
}

async function createPeer(video, ref, role) {
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
  pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  $("local").srcObject = localStream;
  pc.ontrack = e => { $("remote").srcObject = e.streams[0]; };
  pc.onicecandidate = e => {
    if (e.candidate) ref.child(role === "caller" ? "offerCandidates" : "answerCandidates").push(e.candidate.toJSON()).catch(() => {});
  };
  pc.onconnectionstatechange = () => {
    if (!pc) return;
    if (pc.connectionState === "connected") {
      $("callTitle").textContent = "সংযুক্ত";
      if (!callStart) startTimer();
    }
    if (pc.connectionState === "failed") { toast("কল সংযোগ বিচ্ছিন্ন হয়েছে"); endCall(true); }
  };
}

async function startCall(video) {
  if (!active || !me) return;
  if (currentCall || incomingCall) return toast("একটি call চলছে");
  if (!navigator.mediaDevices?.getUserMedia) return toast("HTTPS এবং camera/microphone permission প্রয়োজন");
  const peer = active;
  const ref = db.ref("calls").push(), id = ref.key;
  currentCall = { id, ref, role: "caller", video, peer: peer.uid };
  showCallUI(peer.name, peer.uid, video, "কল করা হচ্ছে…", peer.photo || "");
  try {
    await createPeer(video, ref, "caller");
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await ref.set({ caller: me.uid, callee: peer.uid, video, offer: { type: offer.type, sdp: offer.sdp }, createdAt: SV });
    listen(ref.child("answerCandidates"), "child_added", s => { pc?.addIceCandidate(new RTCIceCandidate(s.val())).catch(() => {}); });
    ref.on("value", async s => {
      const d = s.val();
      if (d?.answer && pc && !pc.currentRemoteDescription) {
        await pc.setRemoteDescription(new RTCSessionDescription(d.answer)).catch(() => {});
        $("callTitle").textContent = "সংযুক্ত হচ্ছে…";
      }
      if (!d && currentCall?.id === id) endCall(false);
    });
  } catch (e) {
    toast("Call চালু হয়নি: " + errText(e));
    endCall(true);
  }
}

function watchIncomingCalls() {
  if (callWatchRef) callWatchRef.off();
  callWatchRef = db.ref("calls").orderByChild("callee").equalTo(me.uid);
  callWatchRef.on("child_added", async s => {
    const d = s.val();
    if (!d || d.answer || incomingSeen.has(s.key) || currentCall || incomingCall) return;
    incomingSeen.add(s.key);
    if (Date.now() - (Number(d.createdAt) || 0) > 60000) return;
    let u = null;
    try { u = (await db.ref("users/" + d.caller).once("value")).val(); } catch (_) {}
    incomingCall = { id: s.key, data: d, peerName: u?.name || "কেউ", peerPhoto: u?.photo || "" };
    $("incAvatar").innerHTML = avatar(incomingCall.peerName, d.caller, true, incomingCall.peerPhoto);
    $("incomingTitle").textContent = incomingCall.peerName;
    $("incomingText").textContent = (d.video ? "ভিডিও" : "অডিও") + " কল আসছে…";
    $("incoming").hidden = false;
    startRing();
    if (document.hidden) notifyUser("কল আসছে — " + incomingCall.peerName, d.video ? "ভিডিও কল" : "অডিও কল");
  });
  callWatchRef.on("child_removed", s => {
    if (incomingCall?.id === s.key) hideIncoming();
  });
}

function hideIncoming() { $("incoming").hidden = true; stopRing(); }

async function acceptCall() {
  if (!incomingCall) return;
  const c = incomingCall, d = c.data;
  incomingCall = null;
  hideIncoming();
  if (!navigator.mediaDevices?.getUserMedia) { toast("এই browser-এ call সমর্থিত নয়"); return db.ref("calls/" + c.id).remove().catch(() => {}); }
  const ref = db.ref("calls/" + c.id);
  currentCall = { id: c.id, ref, role: "callee", video: !!d.video, peer: d.caller };
  showCallUI(c.peerName, d.caller, !!d.video, "সংযুক্ত হচ্ছে…", c.peerPhoto);
  try {
    await createPeer(!!d.video, ref, "callee");
    await pc.setRemoteDescription(new RTCSessionDescription(d.offer));
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    await ref.update({ answer: { type: ans.type, sdp: ans.sdp } });
    listen(ref.child("offerCandidates"), "child_added", s => { pc?.addIceCandidate(new RTCIceCandidate(s.val())).catch(() => {}); });
    ref.on("value", s => { if (!s.val() && currentCall?.id === c.id) endCall(false); });
  } catch (e) {
    toast("Call accept হয়নি: " + errText(e));
    endCall(true);
  }
}

function declineCall() {
  if (!incomingCall) return;
  const id = incomingCall.id;
  incomingSeen.add(id);
  incomingCall = null;
  hideIncoming();
  db.ref("calls/" + id).remove().catch(() => {});
}

function logCall(peer, video, secs) {
  if (!me || !peer) return;
  db.ref("messages/" + cid(me.uid, peer)).push()
    .set({ senderId: me.uid, receiverId: peer, type: "call", text: fmtCallLabel(video, secs), createdAt: SV })
    .catch(() => {});
}

function endCall(removeRemote = true) {
  const c = currentCall;
  currentCall = null;
  if (c) {
    if (c.ref) {
      c.ref.off();
      if (removeRemote) c.ref.remove().catch(() => {});
    }
    if (c.role === "caller") {
      const secs = callStart ? Math.floor((Date.now() - callStart) / 1000) : 0;
      logCall(c.peer, c.video, secs);
    }
  }
  if (pc) {
    pc.onicecandidate = null; pc.ontrack = null; pc.onconnectionstatechange = null;
    pc.close(); pc = null;
  }
  [localStream, screenStream].forEach(s => s?.getTracks().forEach(t => t.stop()));
  localStream = null; screenStream = null;
  clearInterval(callTimerId); callTimerId = null; callStart = 0;
  stopRing();
  $("call").hidden = true;
  $("local").srcObject = null;
  $("remote").srcObject = null;
}

function toggleMic() {
  const t = localStream?.getAudioTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  setCtrl("toggleMic", t.enabled ? "🎙️" : "🔇", !t.enabled);
}
function toggleCam() {
  const t = localStream?.getVideoTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  setCtrl("toggleCam", t.enabled ? "📷" : "🚫", !t.enabled);
}
async function flipCamera() {
  if (!pc || !localStream) return;
  facing = facing === "user" ? "environment" : "user";
  try {
    const ns = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } });
    const nt = ns.getVideoTracks()[0];
    const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
    if (sender) await sender.replaceTrack(nt);
    localStream.getVideoTracks().forEach(t => { localStream.removeTrack(t); t.stop(); });
    localStream.addTrack(nt);
    $("local").srcObject = localStream;
  } catch (e) { toast("ক্যামেরা বদলানো যায়নি"); }
}
async function toggleShare() {
  if (!pc) return;
  const sender = pc.getSenders().find(s => s.track?.kind === "video");
  if (!sender) return toast("শুধু ভিডিও কলে স্ক্রিন শেয়ার সম্ভব");
  try {
    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop());
      screenStream = null;
      const cam = localStream?.getVideoTracks()[0];
      if (cam) await sender.replaceTrack(cam);
      setCtrl("shareScreen", "🖥️", false);
      return;
    }
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const st = screenStream.getVideoTracks()[0];
    st.onended = () => { if (screenStream) toggleShare(); };
    await sender.replaceTrack(st);
    setCtrl("shareScreen", "🖥️", true);
  } catch (e) {
    screenStream = null;
    toast("স্ক্রিন শেয়ার শুরু হয়নি");
  }
}

/* ==========================================================================
   SESSION RESTORE, INSTALL, SERVICE WORKER
   ========================================================================== */
(async () => {
  const uid = localStorage.getItem(SESSION);
  if (!uid) return;
  try {
    const u = (await db.ref("users/" + uid).once("value")).val();
    if (u && u.uid === uid && u.chatId && u.name) {
      me = { uid: u.uid, chatId: u.chatId, name: u.name };
      await launch();
    } else localStorage.removeItem(SESSION);
  } catch (e) {
    console.warn(e);
    toast("Session restore হয়নি; আবার Login করুন।");
  }
})();

window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  installPrompt = e;
  $("installBtn").hidden = false;
});

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("service-worker.js");
      const offer = w => {
        $("updateBanner").hidden = false;
        $("updateNow").onclick = () => w.postMessage({ type: "SKIP_WAITING" });
      };
      if (reg.waiting) offer(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w?.addEventListener("statechange", () => {
          if (w.state === "installed" && navigator.serviceWorker.controller) offer(w);
        });
      });
      navigator.serviceWorker.addEventListener("controllerchange", () => location.reload());
    } catch (e) { console.warn("SW registration failed", e); }
  });
}

/* ==========================================================================
   UI
   ========================================================================== */
function switchTab(t) {
  const s = t === "sign";
  $("tabSign").classList.toggle("active", s);
  $("tabLogin").classList.toggle("active", !s);
  $("signBox").hidden = !s;
  $("loginBox").hidden = s;
}
function autosize() {
  const t = $("msg");
  t.style.height = "auto";
  t.style.height = Math.min(t.scrollHeight, 140) + "px";
}
function buildEmoji() {
  const panel = $("emojiPanel");
  panel.innerHTML = EMOJIS.map(e => `<button aria-label="${e}">${e}</button>`).join("");
  panel.querySelectorAll("button").forEach(b => b.onclick = () => insertAtCursor(b.textContent));
}
function insertAtCursor(t) {
  const i = $("msg");
  const s = i.selectionStart ?? i.value.length, e = i.selectionEnd ?? s;
  i.value = i.value.slice(0, s) + t + i.value.slice(e);
  i.focus();
  i.setSelectionRange(s + t.length, s + t.length);
  autosize();
  sendTyping();
}
function hideChat() {
  $("app").classList.remove("chat-open");
  stopTyping();
  clearSubs();
  active = null;
  cache = {};
  hideReply();
  $("convo").hidden = true;
  $("empty").hidden = false;
  renderRecent();
}

buildEmoji();
applyTheme();

$("tabSign").onclick = () => switchTab("sign");
$("tabLogin").onclick = () => switchTab("login");
$("signBtn").onclick = signup;
$("loginBtn").onclick = login;
$("sPin").onkeydown = e => { if (e.key === "Enter") signup(); };
$("lPin").onkeydown = e => { if (e.key === "Enter") login(); };
$("logoutBtn").onclick = logout;
$("notifyBtn").onclick = enableNotifications;
$("soundBtn").onclick = () => { localStorage.setItem("rikuu_sound", soundOn() ? "off" : "on"); applyTheme(); };
$("themeBtn").onclick = () => {
  localStorage.setItem("rikuu_theme", document.body.classList.contains("dark") ? "light" : "dark");
  applyTheme();
};
$("installBtn").onclick = async () => {
  if (!installPrompt) return toast("Browser menu থেকে Add to Home Screen বেছে নিন");
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $("installBtn").hidden = true;
};

$("search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(searchUser, 300);
});

$("back").onclick = hideChat;
$("send").onclick = sendMessage;
$("msg").addEventListener("input", () => {
  autosize();
  if ($("msg").value.trim()) sendTyping(); else stopTyping();
});
$("msg").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
$("emojiBtn").onclick = () => { $("emojiPanel").hidden = !$("emojiPanel").hidden; };
$("attach").onclick = () => $("imgInput").click();
$("imgInput").onchange = e => {
  const f = e.target.files[0];
  e.target.value = "";
  sendImage(f);
};
$("micBtn").onclick = () => (recorder ? stopRecording(true) : startRecording());
$("recCancel").onclick = () => stopRecording(false);
$("replyClose").onclick = hideReply;

$("audioBtn").onclick = () => startCall(false);
$("videoBtn").onclick = () => startCall(true);
$("accept").onclick = acceptCall;
$("decline").onclick = declineCall;
$("hangup").onclick = () => endCall(true);
$("toggleMic").onclick = toggleMic;
$("toggleCam").onclick = toggleCam;
$("flipCam").onclick = flipCamera;
$("shareScreen").onclick = toggleShare;

$("sheet").onclick = e => { if (e.target.id === "sheet") closeSheet(); };
$("sheetReply").onclick = () => { if (sheetMsg) setReply(sheetMsg); closeSheet(); };
$("sheetEdit").onclick = () => { const m = sheetMsg; closeSheet(); if (m) setEdit(m); };
$("sheetCopy").onclick = async () => {
  const m = sheetMsg; closeSheet();
  if (!m?.text) return;
  try { await navigator.clipboard.writeText(m.text); toast("কপি হয়েছে"); }
  catch (_) { toast("কপি করা যায়নি"); }
};
$("sheetDelete").onclick = async () => {
  const m = sheetMsg; closeSheet();
  if (!m || !active || !confirm("মেসেজটি মুছে ফেলবেন?")) return;
  await db.ref(`messages/${cid(me.uid, active.uid)}/${m.key}`)
    .update({ deleted: true, text: "", image: null, audio: null, reactions: null })
    .catch(e => toast(errText(e)));
};

$("pmClose").onclick = closeProfile;
$("pmCancel").onclick = closeProfile;
$("pmCopy").onclick = copyId;
$("pmPhotoBtn").onclick = () => $("pmPhotoInput").click();
$("pmPhotoInput").onchange = e => { const f = e.target.files[0]; e.target.value = ""; pickPhoto(f); };
$("pmSave").onclick = saveProfile;
$("pmName").addEventListener("keydown", e => { if (e.key === "Enter") saveProfile(); });
$("profileModal").onclick = e => { if (e.target.id === "profileModal") closeProfile(); };

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    closeSheet();
    closeProfile();
    $("emojiPanel").hidden = true;
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !me) return;
  presRef?.update({ online: true, lastSeen: SV }).catch(() => {});
  if (active) {
    const key = cid(me.uid, active.uid);
    Object.values(cache).forEach(m => markSeen(key, m));
    clearUnread(active.uid);
  }
});
