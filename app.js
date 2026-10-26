"use strict";
/* ==========================================================================
   Rikuu — Next-gen Social Feed & Messenger (app.js)
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
const auth = firebase.auth();
const db = firebase.database();
const SV = firebase.database.ServerValue.TIMESTAMP;
const SESSION = "lyuna_session_v2";

/* ---------- Helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
const cid = (a, b) => [a, b].sort().join("_");
const EMOJIS = "😀 😂 🥹 😍 😎 🤔 😢 😡 👍 👏 🙏 🔥 ❤️ 🎉 ✨ 😊 🙌 💯 👀 😅 🥳 🤝 🌙 ☕ 😴 🤩 💪 🫶".split(" ");
const COLORS = ["#6366f1", "#ec4899", "#10b981", "#f59e0b", "#3b82f6", "#8b5cf6", "#14b8a6", "#f43f5e"];
const colorOf = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };

const avatar = (name, seed, big, photo) => {
  if (photo) return `<img class="avatar${big ? " big" : ""}" src="${esc(photo)}" alt="">`;
  const ch = ((name || "").trim()[0]) || "R";
  return `<div class="avatar${big ? " big" : ""}" style="background:linear-gradient(135deg,${colorOf(seed || name)},#8b5cf6)">${esc(ch.toUpperCase())}</div>`;
};

const timeOf = t => new Date(Number(t) || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDur = s => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

function dayLabel(t) {
  const d = new Date(Number(t) || Date.now()), now = new Date(), y = new Date();
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "আজ";
  if (d.toDateString() === y.toDateString()) return "গতকাল";
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function toast(t, ms = 2800) {
  const el = $("toast"); el.textContent = t; el.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), ms);
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
    img.onerror = rej; img.src = url;
  });
}

/* ---------- State ---------- */
let me = null, active = null, presRef = null, recentRef = null, callWatchRef = null;
let cache = {}, subs = [], replyTo = null, forceScroll = false;
let typingOn = false, lastTypingSet = 0, typingTimer = null;
let recentList = [], postImgBase64 = null;
let pc = null, localStream = null, currentCall = null, incomingCall = null;
let incomingSeen = new Set(), callTimerId = null, callStart = 0;
let searchTimer = null, pmPhoto = null;
let recorder = null, recChunks = [], recStart = 0, recTimer = null;

function listen(ref, ev, fn) { ref.on(ev, fn); subs.push(() => ref.off(ev, fn)); }
function clearSubs() { subs.forEach(f => f()); subs = []; }

function applyTheme() {
  const dark = localStorage.getItem("rikuu_theme") === "dark";
  document.body.classList.toggle("dark", dark);
}

/* ================= AUTH & GOOGLE SIGN-IN ================= */
async function uniqueId(uid) {
  for (let i = 0; i < 40; i++) {
    const id = randomId();
    const tx = await db.ref("chatIds/" + id).transaction(v => (v === null ? uid : v));
    if (tx.committed && tx.snapshot.val() === uid) return id;
  }
  throw Error("চ্যাট আইডি তৈরি করা যায়নি।");
}

async function loginWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    const result = await auth.signInWithPopup(provider);
    const u = result.user;
    let snap = (await db.ref("users/" + u.uid).once("value")).val();
    if (!snap) {
      const id = await uniqueId(u.uid);
      snap = {
        uid: u.uid,
        chatId: id,
        name: u.displayName || "Google User",
        photo: u.photoURL || "",
        createdAt: SV
      };
      await db.ref("users/" + u.uid).set(snap);
    }
    me = { uid: snap.uid, chatId: snap.chatId, name: snap.name, photo: snap.photo || u.photoURL || "" };
    localStorage.setItem(SESSION, snap.uid);
    await launch();
    toast("Google দিয়ে স্বাগতম, " + me.name);
  } catch (e) {
    toast("Google লগইন ব্যর্থ: " + e.message);
  }
}

async function signup() {
  setErr("sErr");
  const name = $("sName").value.trim(), pin = $("sPin").value.trim();
  if (name.length < 2) return setErr("sErr", "সঠিক নাম দিন।");
  if (!/^\d{4,6}$/.test(pin)) return setErr("sErr", "পিন ৪–৬ সংখ্যার হতে হবে।");
  $("signBtn").disabled = true;
  try {
    const uid = makeUid(), id = await uniqueId(uid);
    await db.ref("users/" + uid).set({ uid, chatId: id, name, pinHash: await pinHash(pin), createdAt: SV });
    me = { uid, chatId: id, name };
    localStorage.setItem(SESSION, uid);
    await launch();
    toast("অ্যাকাউন্ট সফল! আপনার আইডি: " + id, 5000);
  } catch (e) { setErr("sErr", e.message); }
  finally { $("signBtn").disabled = false; }
}

async function login() {
  setErr("lErr");
  const id = $("lId").value.trim(), pin = $("lPin").value.trim();
  if (!/^\d{6}$/.test(id)) return setErr("lErr", "৬ সংখ্যার চ্যাট আইডি দিন।");
  if (!/^\d{4,6}$/.test(pin)) return setErr("lErr", "পিন সঠিক নয়।");
  $("loginBtn").disabled = true;
  try {
    const uid = (await db.ref("chatIds/" + id).once("value")).val();
    if (!uid) throw Error("চ্যাট আইডি পাওয়া যায়নি।");
    const u = (await db.ref("users/" + uid).once("value")).val();
    if (!u) throw Error("প্রোফাইল নেই।");
    if ((await pinHash(pin)) !== u.pinHash) throw Error("পিন ভুল হয়েছে।");
    me = { uid: u.uid, chatId: u.chatId, name: u.name };
    localStorage.setItem(SESSION, uid);
    await launch();
  } catch (e) { setErr("lErr", e.message); }
  finally { $("loginBtn").disabled = false; }
}

async function launch() {
  $("auth").hidden = true;
  $("app").hidden = false;
  const snap = (await db.ref("users/" + me.uid).once("value")).val() || {};
  me.photo = snap.photo || me.photo || "";
  me.bio = snap.bio || "";
  renderMe();
  applyTheme();

  presRef = db.ref("presence/" + me.uid);
  await presRef.set({ online: true, lastSeen: SV });
  presRef.onDisconnect().set({ online: false, lastSeen: SV });

  watchIncomingCalls();
  loadRecent();
  listenPosts();
}

function renderMe() {
  $("profile").innerHTML = `
    ${avatar(me.name, me.uid, false, me.photo)}
    <div><b>${esc(me.name)}</b></div>`;
  $("profile").onclick = openProfile;
  $("createAvatar").innerHTML = avatar(me.name, me.uid, false, me.photo);
}

function logout() {
  if (presRef) presRef.set({ online: false, lastSeen: SV });
  localStorage.removeItem(SESSION);
  auth.signOut().catch(() => {});
  location.reload();
}

/* ================= SOCIAL FEED (POSTS & LIKES) ================= */
async function handleCreatePost() {
  const text = $("postInput").value.trim();
  if (!text && !postImgBase64) return toast("কিছু লিখুন বা ছবি যুক্ত করুন");

  $("submitPost").disabled = true;
  try {
    const postRef = db.ref("posts").push();
    await postRef.set({
      id: postRef.key,
      authorId: me.uid,
      authorName: me.name,
      authorPhoto: me.photo || "",
      text,
      image: postImgBase64 || null,
      createdAt: SV
    });
    $("postInput").value = "";
    removePostImage();
    toast("পোস্ট প্রকাশিত হয়েছে!");
  } catch (e) {
    toast("পোস্ট ব্যর্থ: " + e.message);
  } finally {
    $("submitPost").disabled = false;
  }
}

function removePostImage() {
  postImgBase64 = null;
  $("postImgPreview").src = "";
  $("postImgPreviewBox").hidden = true;
}

function listenPosts() {
  db.ref("posts").limitToLast(50).on("value", s => {
    const arr = [];
    s.forEach(ch => { arr.push({ id: ch.key, ...ch.val() }); });
    arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    renderPosts(arr);
  });
}

function renderPosts(posts) {
  const box = $("postsStream");
  if (!posts.length) {
    box.innerHTML = '<div style="text-align:center; padding: 40px; color:var(--text-muted)">এখনো কোনো পোস্ট নেই। প্রথম পোস্টটি আপনিই করুন!</div>';
    return;
  }

  box.innerHTML = posts.map(p => {
    const likes = p.likes || {};
    const likeCount = Object.keys(likes).length;
    const isLiked = !!likes[me.uid];
    const imgHtml = p.image ? `<img class="post-img" src="${p.image}" alt="পোস্ট ছবি" onclick="openLightbox('${p.image}')">` : "";

    return `
      <article class="post-card">
        <div class="post-header">
          <div class="post-author">
            ${avatar(p.authorName, p.authorId, false, p.authorPhoto)}
            <div>
              <span class="post-author-name">${esc(p.authorName)}</span>
              <time class="post-time">${dayLabel(p.createdAt)} · ${timeOf(p.createdAt)}</time>
            </div>
          </div>
          ${p.authorId !== me.uid ? `<button class="chat-with-user-btn" onclick="openChatFromFeed('${esc(p.authorId)}')">💬 চ্যাট</button>` : ""}
        </div>

        <div class="post-body">
          ${p.text ? `<p>${esc(p.text)}</p>` : ""}
          ${imgHtml}
        </div>

        <div class="post-footer">
          <button class="like-btn ${isLiked ? "liked" : ""}" onclick="toggleLike('${p.id}')">
            <svg class="icon" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            <span>${likeCount > 0 ? likeCount : ""} Like</span>
          </button>
        </div>
      </article>`;
  }).join("");
}

async function toggleLike(postId) {
  const ref = db.ref(`posts/${postId}/likes/${me.uid}`);
  const snap = (await ref.once("value")).val();
  if (snap) await ref.remove();
  else await ref.set(true);
}

function openChatFromFeed(uid) {
  switchTab("chat");
  openChat(uid);
}

/* ================= CHATS & MESSENGER ================= */
function switchTab(t) {
  const isFeed = t === "feed";
  $("tabFeed").classList.toggle("active", isFeed);
  $("tabChat").classList.toggle("active", !isFeed);
  $("feedView").hidden = !isFeed;
  $("chatView").hidden = isFeed;
  if (!isFeed) $("unreadDot").hidden = true;
}

function loadRecent() {
  if (recentRef) recentRef.off();
  recentRef = db.ref("userChats/" + me.uid);
  recentRef.on("value", s => {
    const arr = [];
    s.forEach(x => { arr.push({ ...x.val() }); });
    arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    recentList = arr;
    renderRecent();
    renderStoryStrip();
  });
}

function renderStoryStrip() {
  const strip = $("storyStrip");
  if (!recentList.length) { strip.hidden = true; return; }
  strip.hidden = false;
  strip.innerHTML = recentList.map(c => `
    <div class="story-item" onclick="openChat('${esc(c.uid)}')">
      <div class="story-ring">${avatar(c.name, c.uid, false, c.photo)}</div>
      <span class="story-name">${esc((c.name || "").split(" ")[0])}</span>
    </div>
  `).join("");
}

function renderRecent() {
  const box = $("recent");
  if (!recentList.length) {
    box.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-muted); font-size:0.85rem">এখনো কোনো চ্যাট নেই।<br>আইডি বা নাম দিয়ে খুঁজুন।</div>';
    return;
  }
  box.innerHTML = recentList.map(c => {
    const unread = c.unread && active?.uid !== c.uid ? `<span class="badge-unread">${c.unread}</span>` : "";
    return `
      <div class="chat-card ${active?.uid === c.uid ? "active" : ""}" onclick="openChat('${esc(c.uid)}')">
        ${avatar(c.name, c.uid, false, c.photo)}
        <div class="chat-card-info">
          <div class="chat-top-row">
            <b>${esc(c.name || "ইউজার")}</b>
            <time>${c.updatedAt ? timeOf(c.updatedAt) : ""}</time>
          </div>
          <span class="chat-last-msg">${esc(c.lastMessage || "কথা শুরু করুন…")}</span>
        </div>
        ${unread}
      </div>`;
  }).join("");
}

async function searchUser() {
  const q = $("search").value.trim(), box = $("searchResults");
  box.innerHTML = "";
  if (!q) return;

  const matched = recentList.filter(c => (c.name || "").toLowerCase().includes(q.toLowerCase()));
  if (matched.length && !/^\d{6}$/.test(q)) {
    box.innerHTML = matched.map(c => `
      <div class="chat-card" onclick="openChat('${c.uid}')">
        ${avatar(c.name, c.uid, false, c.photo)}
        <div class="chat-card-info"><b>${esc(c.name)}</b><span style="font-size:0.75rem;color:var(--text-muted)">চ্যাটলিস্টে আছে</span></div>
      </div>
    `).join("");
    return;
  }

  if (/^\d{6}$/.test(q)) {
    try {
      const uid = (await db.ref("chatIds/" + q).once("value")).val();
      if (!uid || uid === me.uid) { box.innerHTML = '<div style="padding:8px;font-size:0.8rem;color:var(--text-muted)">কোনো ইউজার পাওয়া যায়নি</div>'; return; }
      const u = (await db.ref("users/" + uid).once("value")).val();
      box.innerHTML = `
        <div class="chat-card" onclick="openChat('${u.uid}')">
          ${avatar(u.name, u.uid, false, u.photo)}
          <div class="chat-card-info"><b>${esc(u.name)}</b><span style="font-size:0.75rem;color:var(--brand-primary)">চ্যাট শুরু করুন</span></div>
        </div>`;
    } catch (_) {}
  }
}

async function openChat(uid) {
  try {
    const u = (await db.ref("users/" + uid).once("value")).val();
    if (!u) return toast("প্রোফাইল নেই");
    clearSubs();
    active = u;
    $("empty").hidden = true;
    $("convo").hidden = false;
    $("app").classList.add("chat-open");
    $("headName").textContent = u.name;
    $("headAvatar").innerHTML = avatar(u.name, u.uid, false, u.photo);
    $("headStatus").textContent = "সংযোগ হচ্ছে…";

    listen(db.ref("presence/" + active.uid), "value", s => {
      const p = s.val() || {};
      $("headStatus").innerHTML = p.online ? '<span class="status-dot-on">অনলাইন</span>' : "শেষ দেখা: " + (p.lastSeen ? timeOf(p.lastSeen) : "অজানা");
    });

    listen(db.ref(`typing/${cid(me.uid, active.uid)}/${active.uid}`), "value", s => {
      $("typing").hidden = !s.val();
    });

    listenMessages();
    clearUnread(uid);
    renderRecent();
    $("msg").focus();
  } catch (e) { toast(e.message); }
}

function clearUnread(uid) {
  if (!me) return;
  db.ref(`userChats/${me.uid}/${uid}/unread`).set(0).catch(() => {});
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
  typingTimer = setTimeout(() => {
    ref.remove().catch(() => {});
    typingOn = false;
  }, 2500);
}

/* ================= MESSAGES ================= */
function listenMessages() {
  const key = cid(me.uid, active.uid);
  cache = {};
  forceScroll = true;
  $("messages").innerHTML = '<div style="margin:auto;color:var(--text-muted)">লোড হচ্ছে…</div>';
  const ref = db.ref("messages/" + key).limitToLast(150);

  listen(ref, "child_added", s => {
    const m = { key: s.key, ...(s.val() || {}) };
    cache[s.key] = m;
    if (m.senderId !== me.uid && !m.seenAt) {
      db.ref(`messages/${key}/${s.key}/seenAt`).set(SV).catch(() => {});
    }
    renderMessages();
  });
  listen(ref, "child_changed", s => { cache[s.key] = { key: s.key, ...(s.val() || {}) }; renderMessages(); });
  listen(ref, "child_removed", s => { delete cache[s.key]; renderMessages(); });
}

function renderMessages() {
  const box = $("messages");
  const list = Object.values(cache).sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
  if (!list.length) {
    box.innerHTML = '<div style="margin:auto;text-align:center;color:var(--text-muted);font-size:0.9rem">👋 কোনো মেসেজ নেই!<br>কথা বলা শুরু করুন।</div>';
    return;
  }

  let html = "", lastDay = "";
  for (const m of list) {
    const day = dayLabel(m.createdAt);
    if (day !== lastDay) { html += `<div class="day-divider">${day}</div>`; lastDay = day; }

    const mine = m.senderId === me.uid;
    const media = m.image ? `<img class="msg-media" src="${m.image}" alt="ছবি" onclick="openLightbox('${m.image}')">` : "";
    const voice = m.type === "voice" ? `<div class="audio-capsule"><audio controls src="${m.audio}"></audio></div>` : "";
    const text = m.text ? `<p>${esc(m.text)}</p>` : "";
    const quote = m.replyTo ? `<div class="quote-box"><b>${esc(m.replyTo.name)}</b>: ${esc(m.replyTo.text)}</div>` : "";
    const reacts = m.reactions ? `<div class="react-pill">${Object.values(m.reactions).join(" ")}</div>` : "";
    const tick = mine ? `<span class="tick ${m.seenAt ? "seen" : ""}">${m.seenAt ? "✓✓" : "✓"}</span>` : "";

    html += `
      <div class="msg-row ${mine ? "mine" : "theirs"}" data-key="${m.key}">
        <div class="msg-bubble" ondblclick="quickHeartReact('${m.key}')">
          ${quote}${media}${voice}${text}
          <div class="msg-meta"><time>${timeOf(m.createdAt)}</time>${tick}</div>
        </div>
        ${reacts}
      </div>`;
  }

  box.innerHTML = html;
  if (forceScroll) { box.scrollTop = box.scrollHeight; forceScroll = false; }
}

async function quickHeartReact(key) {
  const ref = db.ref(`messages/${cid(me.uid, active.uid)}/${key}/reactions/${me.uid}`);
  const snap = (await ref.once("value")).val();
  if (snap === "❤️") ref.remove();
  else ref.set("❤️");
}

async function sendMessage() {
  const input = $("msg"), text = input.value.trim();
  if (!text || !active) return;
  input.value = "";
  const key = cid(me.uid, active.uid);
  const data = {
    senderId: me.uid, receiverId: active.uid,
    text, type: "text", createdAt: SV
  };
  if (replyTo) { data.replyTo = replyTo; hideReply(); }

  forceScroll = true;
  await db.ref("messages/" + key).push().set(data);
  await Promise.all([
    db.ref(`userChats/${me.uid}/${active.uid}`).update({ uid: active.uid, name: active.name, chatId: active.chatId, photo: active.photo || null, lastMessage: text, updatedAt: SV }),
    db.ref(`userChats/${active.uid}/${me.uid}`).update({ uid: me.uid, name: me.name, chatId: me.chatId, photo: me.photo || null, lastMessage: text, updatedAt: SV })
  ]);
  db.ref(`userChats/${active.uid}/${me.uid}/unread`).transaction(v => (v || 0) + 1);
}

/* ================= VOICE RECORDING ================= */
async function startRecording() {
  if (!active || !navigator.mediaDevices?.getUserMedia) return toast("মাইক্রোফোন নেই");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(stream);
    recChunks = [];
    recorder.ondataavailable = e => recChunks.push(e.data);
    recorder.start();
    recStart = Date.now();
    $("recBar").hidden = false;
    recTimer = setInterval(() => {
      $("recTime").textContent = fmtDur(Math.floor((Date.now() - recStart) / 1000));
    }, 500);
  } catch (_) { toast("মাইক্রোফোনের অনুমতি দিন"); }
}

function stopRecording(send) {
  if (!recorder) return;
  const rec = recorder; recorder = null;
  clearInterval(recTimer);
  rec.onstop = async () => {
    rec.stream.getTracks().forEach(t => t.stop());
    $("recBar").hidden = true;
    if (!send || !recChunks.length) return;
    const blob = new Blob(recChunks, { type: "audio/webm" });
    const data = await blobToDataURL(blob);
    forceScroll = true;
    await db.ref("messages/" + cid(me.uid, active.uid)).push().set({
      senderId: me.uid, receiverId: active.uid,
      audio: data, type: "voice", createdAt: SV
    });
  };
  rec.stop();
}

/* ================= LIGHTBOX & PROFILE ================= */
function openLightbox(src) {
  $("lbImg").src = src; $("lightbox").hidden = false;
}
$("lbClose").onclick = () => { $("lightbox").hidden = true; };

function openProfile() {
  pmPhoto = null;
  $("pmAvatar").innerHTML = avatar(me.name, me.uid, true, me.photo);
  $("pmName").value = me.name;
  $("pmBio").value = me.bio || "";
  $("pmId").textContent = "ID: #" + me.chatId;
  $("profileModal").hidden = false;
}
function closeProfile() { $("profileModal").hidden = true; }

async function saveProfile() {
  const name = $("pmName").value.trim(), bio = $("pmBio").value.trim();
  if (name.length < 2) return setErr("pmErr", "নাম লিখুন");
  try {
    const upd = { name, bio };
    if (pmPhoto) upd.photo = pmPhoto;
    await db.ref("users/" + me.uid).update(upd);
    me.name = name; me.bio = bio;
    if (pmPhoto) me.photo = pmPhoto;
    renderMe(); closeProfile(); toast("প্রোফাইল সংরক্ষিত হয়েছে");
  } catch (e) { setErr("pmErr", e.message); }
}

/* ================= CALLS (WEBRTC) ================= */
async function startCall(video) {
  if (!active || !me) return;
  if (!navigator.mediaDevices?.getUserMedia) return toast("ক্যামেরা/মাইক নেই");
  const ref = db.ref("calls").push();
  currentCall = { id: ref.key, ref, role: "caller" };
  $("callName").textContent = active.name;
  $("callTitle").textContent = "কল হচ্ছে…";
  $("call").hidden = false;

  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
  $("localVideo").srcObject = localStream;
  pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.ontrack = e => { $("remoteVideo").srcObject = e.streams[0]; };

  pc.onicecandidate = e => {
    if (e.candidate) ref.child("callerCandidates").push(e.candidate.toJSON());
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await ref.set({ caller: me.uid, callee: active.uid, offer: { type: offer.type, sdp: offer.sdp }, createdAt: SV });

  ref.on("value", async s => {
    const d = s.val();
    if (d?.answer && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(d.answer));
      $("callTitle").textContent = "সংযুক্ত";
      startCallTimer();
    }
  });
  ref.child("calleeCandidates").on("child_added", s => { pc?.addIceCandidate(new RTCIceCandidate(s.val())); });
}

function watchIncomingCalls() {
  callWatchRef = db.ref("calls").orderByChild("callee").equalTo(me.uid);
  callWatchRef.on("child_added", async s => {
    const d = s.val();
    if (!d || d.answer || incomingSeen.has(s.key)) return;
    incomingSeen.add(s.key);
    incomingCall = { id: s.key, data: d };
    const u = (await db.ref("users/" + d.caller).once("value")).val();
    $("incAvatar").innerHTML = avatar(u?.name || "User", d.caller, true, u?.photo);
    $("incomingTitle").textContent = u?.name || "কল আসছে…";
    $("incoming").hidden = false;
  });
}

function endCall() {
  if (currentCall?.ref) currentCall.ref.remove().catch(() => {});
  if (pc) { pc.close(); pc = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  $("call").hidden = true;
  $("incoming").hidden = true;
  clearInterval(callTimerId);
}

function startCallTimer() {
  callStart = Date.now();
  callTimerId = setInterval(() => {
    $("callTimer").textContent = fmtDur(Math.floor((Date.now() - callStart) / 1000));
  }, 1000);
}

/* ================= EVENT LISTENERS ================= */
$("tabFeed").onclick = () => switchTab("feed");
$("tabChat").onclick = () => switchTab("chat");

$("googleBtn").onclick = loginWithGoogle;
$("tabSign").onclick = () => { $("tabSign").classList.add("active"); $("tabLogin").classList.remove("active"); $("signBox").hidden = false; $("loginBox").hidden = true; };
$("tabLogin").onclick = () => { $("tabLogin").classList.add("active"); $("tabSign").classList.remove("active"); $("loginBox").hidden = false; $("signBox").hidden = true; };
$("signBtn").onclick = signup;
$("loginBtn").onclick = login;
$("logoutBtn").onclick = logout;

$("themeBtn").onclick = () => {
  const isDark = document.body.classList.toggle("dark");
  localStorage.setItem("rikuu_theme", isDark ? "dark" : "light");
};

// Post handlers
$("submitPost").onclick = handleCreatePost;
$("addPostImgBtn").onclick = () => $("postImgFile").click();
$("postImgFile").onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  postImgBase64 = await compressImage(f, 1080, 0.78);
  $("postImgPreview").src = postImgBase64;
  $("postImgPreviewBox").hidden = false;
};
$("removePostImg").onclick = removePostImage;

// Chat listeners
$("search").oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(searchUser, 300); };
$("send").onclick = sendMessage;
$("msg").onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
$("msg").oninput = sendTyping;
$("micBtn").onclick = () => recorder ? stopRecording(true) : startRecording();
$("recCancel").onclick = () => stopRecording(false);
$("attach").onclick = () => $("imgInput").click();
$("imgInput").onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  const compressed = await compressImage(file);
  forceScroll = true;
  await db.ref("messages/" + cid(me.uid, active.uid)).push().set({
    senderId: me.uid, receiverId: active.uid,
    image: compressed, type: "image", createdAt: SV
  });
};
$("back").onclick = () => { $("app").classList.remove("chat-open"); active = null; clearSubs(); };

$("pmPhotoBtn").onclick = () => $("pmPhotoInput").click();
$("pmPhotoInput").onchange = async e => {
  if (e.target.files[0]) {
    pmPhoto = await compressImage(e.target.files[0], 256, 0.85);
    $("pmAvatar").innerHTML = avatar(me.name, me.uid, true, pmPhoto);
  }
};
$("pmClose").onclick = closeProfile;
$("pmSave").onclick = saveProfile;
$("pmCopy").onclick = () => { navigator.clipboard.writeText(me.chatId); toast("আইডি কপি হয়েছে"); };

$("audioBtn").onclick = () => startCall(false);
$("videoBtn").onclick = () => startCall(true);
$("hangup").onclick = endCall;
$("decline").onclick = endCall;
$("accept").onclick = () => { $("incoming").hidden = true; toast("কল গৃহীত হচ্ছে…"); };

$("emojiBtn").onclick = () => { $("emojiPanel").hidden = !$("emojiPanel").hidden; };
$("emojiPanel").innerHTML = EMOJIS.map(e => `<button onclick="insertEmoji('${e}')">${e}</button>`).join("");
window.insertEmoji = function(e) { $("msg").value += e; $("msg").focus(); };

/* Auto-login session restore */
(async () => {
  applyTheme();
  const uid = localStorage.getItem(SESSION);
  if (!uid) return;
  try {
    const u = (await db.ref("users/" + uid).once("value")).val();
    if (u) { me = { uid: u.uid, chatId: u.chatId, name: u.name, photo: u.photo || "" }; await launch(); }
  } catch (_) {}
})();
