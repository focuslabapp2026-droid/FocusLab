"use strict";
/* =========================================================
   FOCUSLAB FRIENDS — Firebase Realtime Database
   - unique ID per user + presence (online / not online)
   - realtime chat: text, images and voice (stored as Base64
     inside normal database messages — no Cloud Storage)
   - P2P voice calls (WebRTC) with signalling through the DB
   - incoming-call banner on EVERY page of the site
   Loaded on every page (after the Firebase SDK scripts).
========================================================= */
(function () {

    if (typeof firebase === "undefined") return;
    if (localStorage.getItem("focusLab_signedIn") !== "true") return;

    var firebaseConfig = {
        apiKey: "AIzaSyDlwl5-XURif342D5JQCCTsoqazKLHOl9U",
        authDomain: "focuslab-e25da.firebaseapp.com",
        databaseURL: "https://focuslab-e25da-default-rtdb.firebaseio.com",
        projectId: "focuslab-e25da",
        storageBucket: "focuslab-e25da.firebasestorage.app",
        messagingSenderId: "534017418669",
        appId: "1:534017418669:web:3f034da163d06b90b02d24"
    };

    /* Voice calls need STUN. If some networks fail to connect, add a TURN server here. */
    var ICE = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };

    try { if (!firebase.apps.length) firebase.initializeApp(firebaseConfig); } catch (e) { return; }

    var database = firebase.database();
    var TS = firebase.database.ServerValue.TIMESTAMP;
    var IN_PAGES = location.pathname.indexOf("/pages/") > -1;
    var ROOT = IN_PAGES ? "../" : "";
    var FRIENDS_URL = IN_PAGES ? "friends.html" : "pages/friends.html";
    var HAS_UI = !!document.getElementById("frRoot");
    var LS = localStorage;
    var $ = function (id) { return document.getElementById(id); };

    var me = { id: "", name: "", avatar: "" };
    var token = LS.getItem("focusLab_friendToken");
    if (!token) { token = Math.random().toString(36).slice(2) + Date.now().toString(36); LS.setItem("focusLab_friendToken", token); }

    var autoAccept = new URLSearchParams(location.search).get("accept");

    /* ---------- helpers ---------- */
    function cleanId(s) { return String(s || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 16); }
    function genId() { return "FL-" + Math.floor(10000 + Math.random() * 90000); }
    function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
    function initials(n) { return String(n || "?").trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join("").toUpperCase(); }
    function avSrc(a) {
        if (!a) return "";
        if (/^(data:|https?:)/.test(a)) return a;
        return ROOT + a.replace(/^(\.\.\/)+/, "").replace(/^\//, "");
    }
    function avatarEl(u) {
        var d = document.createElement("div");
        d.className = "fr-av";
        var hue = hash(u.id || "x") % 360;
        d.style.background = "linear-gradient(135deg,hsl(" + hue + ",70%,45%),hsl(" + (hue + 40) + ",75%,62%))";
        d.textContent = initials(u.name);
        var src = avSrc(u.avatar);
        if (src) { var i = new Image(); i.alt = ""; i.onload = function () { d.textContent = ""; d.appendChild(i); }; i.src = src; }
        return d;
    }
    function fmt(s) { return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
    function pairKey(a, b) { return [a, b].sort().join("__"); }
    function fetchUser(id) {
        return database.ref("users/" + id).once("value").then(function (s) {
            var v = s.val(); if (!v) return null;
            return { id: id, name: v.name || id, avatar: v.avatar || "", online: v.online === true };
        });
    }
    function toast(t) {
        var e = $("frToast"); if (!e) return;
        e.textContent = t; e.classList.add("show");
        clearTimeout(toast.t); toast.t = setTimeout(function () { e.classList.remove("show"); }, 2400);
    }

    /* ---------- identity ---------- */
    function claim(id) {
        return database.ref("users/" + id + "/owner").transaction(function (cur) {
            return (cur === null || cur === token) ? token : undefined;
        }).then(function (r) { return r.committed && r.snapshot.val() === token; });
    }
    async function ensureId() {
        var id = cleanId(LS.getItem("focusLab_friendId")) || genId();
        for (var n = 0; n < 10; n++) {
            if (await claim(id)) return id;
            id = genId();
        }
        throw new Error("Could not get an ID");
    }
    function readProfile() {
        var first = LS.getItem("focusLab_firstName") || "Focus", last = LS.getItem("focusLab_lastName") || "User";
        me.name = (LS.getItem("focusLab_friendName") || (first + " " + last)).trim();
        me.avatar = LS.getItem("focusLab_avatarSrc") || "images/avatars/avatar1.jpeg";
    }

    /* ---------- incoming-call banner (every page) ---------- */
    var bannerEl = null, incoming = null;
    function buildBanner() {
        var st = document.createElement("style");
        st.textContent =
            ".fr-av{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:800;flex-shrink:0;overflow:hidden;border:2px solid rgba(96,165,250,.45)}" +
            ".fr-av img{width:100%;height:100%;object-fit:cover;display:block}" +
            "#frBanner{position:fixed;left:50%;top:calc(12px + env(safe-area-inset-top,0px));transform:translate(-50%,-170%);z-index:3000;width:min(460px,calc(100vw - 24px));display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:18px;background:#111c31;color:#f8fafc;border:1px solid rgba(96,165,250,.4);box-shadow:0 22px 60px rgba(0,0,0,.5);transition:transform .45s cubic-bezier(.22,1,.36,1);font-family:Inter,system-ui,sans-serif}" +
            "#frBanner.show{transform:translate(-50%,0)}" +
            "#frBanner .fr-w{flex:1;min-width:0}#frBanner strong{display:block;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#frBanner small{color:#94a3b8;font-size:12px}" +
            "#frBanner button{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;color:#fff;cursor:pointer;flex-shrink:0;border:0}" +
            "#frBanner .no{background:#dc2626}#frBanner .yes{background:#16a34a;animation:frp 1.2s infinite}" +
            "#frBanner svg{width:24px;height:24px}@keyframes frp{50%{box-shadow:0 0 0 9px rgba(22,163,74,.25)}}";
        document.head.appendChild(st);
        bannerEl = document.createElement("div");
        bannerEl.id = "frBanner";
        bannerEl.innerHTML =
            '<div id="frBnAv"></div><div class="fr-w"><strong id="frBnName"></strong><small>is calling you…</small></div>' +
            '<button class="no" id="frBnNo" aria-label="Decline"><svg viewBox="0 0 24 24" fill="none"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg></button>' +
            '<button class="yes" id="frBnYes" aria-label="Accept"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5L10 17.5L19 7" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
        document.body.appendChild(bannerEl);
        $("frBnNo").onclick = function () { declineCall(incoming); };
        $("frBnYes").onclick = function () {
            var inc = incoming; hideBanner();
            if (HAS_UI) acceptCall(inc); else location.href = FRIENDS_URL + "?accept=" + encodeURIComponent(inc.callId);
        };
    }
    function showBanner(v) {
        incoming = v;
        fetchUser(v.from).then(function (u) {
            if (!incoming || incoming.callId !== v.callId) return;
            u = u || { id: v.from, name: v.from, avatar: "" };
            var box = $("frBnAv"); box.innerHTML = ""; box.appendChild(avatarEl(u));
            $("frBnName").textContent = u.name;
            bannerEl.classList.add("show");
        });
    }
    function hideBanner() { incoming = null; if (bannerEl) bannerEl.classList.remove("show"); }
    function declineCall(v) {
        hideBanner(); if (!v) return;
        database.ref("calls/" + v.callId + "/status").set("declined");
        database.ref("incoming/" + me.id).remove();
    }
    function listenIncoming() {
        database.ref("incoming/" + me.id).on("value", function (s) {
            var v = s.val();
            if (!v) { hideBanner(); return; }
            if (callActive) { declineCall(v); return; }
            if (autoAccept && v.callId === autoAccept && HAS_UI) { autoAccept = null; acceptCall(v); return; }
            showBanner(v);
        });
    }

    /* ---------- call engine (friends page) ---------- */
    var callActive = false, pc = null, localStream = null, remoteStream = null, callId = null, role = "";
    var peer = null, callRefs = [], pendingCands = [], ringT = null, callTimer = null, callSec = 0, connected = false;
    var muted = false, spkOn = false, actx = null, gainNode = null, srcNode = null;

    function getMic() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error("no-mic"));
        return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    }
    function openCallUI(u, status) {
        $("frClAv").innerHTML = ""; $("frClAv").appendChild(avatarEl(u));
        $("frClName").textContent = u.name; $("frClSt").textContent = status;
        muted = false; spkOn = false;
        $("frClMute").classList.remove("on"); $("frClSpk").classList.remove("on");
        $("frCall").classList.add("open");
    }
    function makePc() {
        pc = new RTCPeerConnection(ICE);
        remoteStream = null; pendingCands = []; connected = false;
        localStream.getTracks().forEach(function (t) { pc.addTrack(t, localStream); });
        pc.ontrack = function (e) {
            remoteStream = e.streams[0];
            var a = $("frAudio"); a.srcObject = remoteStream; a.muted = false; a.volume = 1;
            var p = a.play(); if (p && p.catch) p.catch(function () {});
            if (spkOn) applySpeaker();
        };
        pc.onconnectionstatechange = function () {
            if (!pc) return;
            if (pc.connectionState === "connected" && !connected) {
                connected = true; clearTimeout(ringT); callSec = 0; $("frClSt").textContent = "0:00";
                callTimer = setInterval(function () { callSec++; $("frClSt").textContent = fmt(callSec); }, 1000);
            } else if (pc.connectionState === "failed") hangup("Connection failed — try again");
        };
        return pc;
    }
    function addCand(c) {
        if (pc && pc.remoteDescription) pc.addIceCandidate(new RTCIceCandidate(c)).catch(function () {});
        else pendingCands.push(c);
    }
    function flushCands() { var l = pendingCands; pendingCands = []; l.forEach(addCand); }
    function watch(ref, ev, fn) { ref.on(ev, fn); callRefs.push({ ref: ref, ev: ev, fn: fn }); }

    async function startCall(u) {
        if (callActive) return;
        if (!u.online) { toast(u.name + " is not online"); return; }
        callActive = true; role = "caller"; peer = u; openCallUI(u, "Calling…");
        try { localStream = await getMic(); } catch (e) { hangup("Microphone permission is needed", true); return; }
        callId = database.ref("calls").push().key;
        var cref = database.ref("calls/" + callId);
        makePc();
        pc.onicecandidate = function (e) { if (e.candidate) cref.child("callerCand").push(e.candidate.toJSON()); };
        var offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await cref.set({ caller: me.id, callee: u.id, offer: { type: offer.type, sdp: offer.sdp }, status: "ringing", ts: TS });
        var inc = database.ref("incoming/" + u.id);
        inc.onDisconnect().remove();
        inc.set({ callId: callId, from: me.id, ts: TS });
        watch(cref, "value", function (s) {
            var v = s.val(); if (!v || !callActive) return;
            if (v.answer && pc && !pc.remoteDescription) { pc.setRemoteDescription(v.answer).then(flushCands); }
            if (v.status === "declined") hangup(u.name + " declined", false, true);
            else if (v.status === "ended") hangup("Call ended", false, true);
        });
        watch(cref.child("calleeCand"), "child_added", function (s) { addCand(s.val()); });
        ringT = setTimeout(function () { if (!connected) hangup("No answer"); }, 45000);
    }
    async function acceptCall(v) {
        if (callActive || !v) return;
        callActive = true; role = "callee"; callId = v.callId;
        database.ref("incoming/" + me.id).remove();
        var cref = database.ref("calls/" + callId);
        var data = (await cref.once("value")).val();
        if (!data || data.status !== "ringing") { callActive = false; toast("The call has already ended"); return; }
        peer = (await fetchUser(data.caller)) || { id: data.caller, name: data.caller, avatar: "" };
        openCallUI(peer, "Connecting…");
        try { localStream = await getMic(); } catch (e) { hangup("Microphone permission is needed"); return; }
        makePc();
        pc.onicecandidate = function (e) { if (e.candidate) cref.child("calleeCand").push(e.candidate.toJSON()); };
        await pc.setRemoteDescription(data.offer);
        var ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        await cref.update({ answer: { type: ans.type, sdp: ans.sdp }, status: "connected" });
        flushCands();
        watch(cref.child("callerCand"), "child_added", function (s) { addCand(s.val()); });
        watch(cref.child("status"), "value", function (s) {
            if (s.val() === "ended" && callActive) hangup("Call ended", false, true);
        });
        ringT = setTimeout(function () { if (!connected) hangup("Could not connect"); }, 20000);
    }
    function hangup(reason, silentDb, remoteDone) {
        if (!callActive && !callId) return;
        var cid = callId, p = peer, r = role;
        callActive = false; callId = null;
        clearTimeout(ringT); clearInterval(callTimer);
        callRefs.forEach(function (w) { try { w.ref.off(w.ev, w.fn); } catch (e) {} });
        callRefs = [];
        if (cid && !silentDb) {
            if (!remoteDone) database.ref("calls/" + cid + "/status").set("ended");
            if (r === "caller" && p) { database.ref("incoming/" + p.id).onDisconnect().cancel(); database.ref("incoming/" + p.id).remove(); }
            setTimeout(function () { database.ref("calls/" + cid).remove(); }, 4000);
        }
        if (srcNode) { try { srcNode.disconnect(); } catch (e) {} srcNode = null; gainNode = null; }
        if (localStream) { localStream.getTracks().forEach(function (t) { t.stop(); }); localStream = null; }
        if (pc) { try { pc.close(); } catch (e) {} pc = null; }
        var a = $("frAudio"); if (a) { a.srcObject = null; a.muted = false; }
        remoteStream = null; connected = false; callSec = 0;
        if ($("frCall")) $("frCall").classList.remove("open");
        if (reason) toast(reason);
    }
    function applySpeaker() {
        var a = $("frAudio");
        if (srcNode) { try { srcNode.disconnect(); } catch (e) {} srcNode = null; gainNode = null; }
        if (spkOn && remoteStream) {
            try {
                if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
                if (actx.state === "suspended") actx.resume();
                srcNode = actx.createMediaStreamSource(remoteStream);
                gainNode = actx.createGain(); gainNode.gain.value = 3;
                srcNode.connect(gainNode); gainNode.connect(actx.destination);
                a.muted = true;
            } catch (e) { spkOn = false; a.muted = false; $("frClSpk").classList.remove("on"); toast("Speaker boost isn’t supported on this browser"); }
        } else if (a) a.muted = false;
    }

    /* ---------- friends page UI ---------- */
    var chatPeer = null, chatRef = null, chatFn = null, watchOff = [], inbox = {}, list = [];
    function loadList() { try { list = JSON.parse(LS.getItem("focusLab_friendList") || "[]"); } catch (e) { list = []; } if (!Array.isArray(list)) list = []; }
    function saveList() { LS.setItem("focusLab_friendList", JSON.stringify(list)); }
    function lastRead() { try { return JSON.parse(LS.getItem("focusLab_friendRead") || "{}"); } catch (e) { return {}; } }
    function addFriend(id) { if (id && id !== me.id && list.indexOf(id) < 0) { list.unshift(id); saveList(); renderList(); } }

    var PHONE = '<svg viewBox="0 0 24 24" fill="none"><path d="M6.5 4H9.5L11 8L9 9.5C9.9 11.5 12.5 14.1 14.5 15L16 13L20 14.5V17.5C20 18.6 19.1 19.5 18 19.5C10.8 19.5 4.5 13.2 4.5 6C4.5 4.9 5.4 4 6.5 4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
    var CHAT = '<svg viewBox="0 0 24 24" fill="none"><path d="M4 6.5C4 5.4 4.9 4.5 6 4.5H18C19.1 4.5 20 5.4 20 6.5V15C20 16.1 19.1 17 18 17H10L6 20.5V17C4.9 17 4 16.1 4 15V6.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 9H16M8 12.5H13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

    function userBar(u, extra) {
        var bar = document.createElement("div");
        bar.className = "fr-bar " + (u.online ? "on" : "off");
        bar.appendChild(avatarEl(u));
        var w = document.createElement("div"); w.className = "fr-who";
        var n = document.createElement("strong"); n.textContent = u.name;
        var s = document.createElement("div"); s.className = "fr-st"; s.innerHTML = "<i></i>";
        s.appendChild(document.createTextNode(u.online ? "Online" : "Not online"));
        w.appendChild(n); w.appendChild(s);
        if (extra) { var x = document.createElement("span"); x.className = "fr-new"; x.textContent = "New"; w.appendChild(x); }
        bar.appendChild(w);
        var c = document.createElement("button"); c.className = "fr-ico"; c.title = "Chat"; c.innerHTML = CHAT;
        var p = document.createElement("button"); p.className = "fr-ico"; p.title = u.online ? "Call" : "Not online"; p.innerHTML = PHONE; p.disabled = !u.online;
        c.onclick = function () { openChat(u); };
        p.onclick = function () { startCall(u); };
        bar.appendChild(c); bar.appendChild(p);
        return bar;
    }
    function renderList() {
        var box = $("frList"); if (!box) return;
        watchOff.forEach(function (f) { f(); }); watchOff = [];
        box.innerHTML = "";
        if (!list.length) { box.innerHTML = '<div class="fr-empty">No chats yet — search a friend’s ID above.</div>'; return; }
        list.forEach(function (id) {
            var holder = document.createElement("div"); box.appendChild(holder);
            var ref = database.ref("users/" + id);
            var fn = ref.on("value", function (s) {
                var v = s.val(); if (!v) return;
                var u = { id: id, name: v.name || id, avatar: v.avatar || "", online: v.online === true };
                var unread = inbox[id] && inbox[id] !== lastRead()[id];
                holder.innerHTML = ""; holder.appendChild(userBar(u, unread));
            });
            watchOff.push(function () { ref.off("value", fn); });
        });
    }
    var searchOff = null;
    function search(raw) {
        var box = $("frResult"), id = cleanId(raw);
        if (searchOff) { searchOff(); searchOff = null; }
        if (!id) { box.innerHTML = ""; return; }
        if (id === me.id) { box.innerHTML = '<div class="fr-empty">That’s your own ID.</div>'; return; }
        var ref = database.ref("users/" + id);
        ref.once("value").then(function (s) {
            var v = s.val();
            if (!v) { box.innerHTML = '<div class="fr-empty">No user found with this ID. Check the number and try again.</div>'; return; }
            var fn = ref.on("value", function (s2) {
                var d = s2.val(); if (!d) return;
                box.innerHTML = ""; box.appendChild(userBar({ id: id, name: d.name || id, avatar: d.avatar || "", online: d.online === true }));
            });
            searchOff = function () { ref.off("value", fn); };
        });
    }

    /* chat */
    function timeLabel(ts) { var d = new Date(ts || Date.now()); return d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0"); }
    function renderMsg(m) {
        var box = $("frMsgs"), mine = m.from === me.id;
        var d = document.createElement("div"); d.className = "fr-m" + (mine ? " me" : "");
        if (m.type === "img") { var im = new Image(); im.src = m.data; im.alt = "Photo"; d.appendChild(im); }
        else if (m.type === "voice") { var au = document.createElement("audio"); au.controls = true; au.preload = "metadata"; au.src = m.data; d.appendChild(au); }
        else { var sp = document.createElement("span"); sp.textContent = m.text || ""; d.appendChild(sp); }
        var t = document.createElement("small"); t.textContent = timeLabel(m.ts); d.appendChild(t);
        var atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 140 || mine;
        box.appendChild(d);
        if (atBottom) box.scrollTop = box.scrollHeight;
    }
    function markRead(id) { if (!inbox[id]) return; var r = lastRead(); r[id] = inbox[id]; LS.setItem("focusLab_friendRead", JSON.stringify(r)); }
    function openChat(u) {
        closeChat(true);
        chatPeer = u; addFriend(u.id);
        var head = $("frChHead"); head.innerHTML = "";
        head.appendChild(avatarEl(u));
        var w = document.createElement("div"); w.className = "fr-who"; w.innerHTML = "<strong></strong><div class='fr-st'><i></i><span></span></div>";
        w.querySelector("strong").textContent = u.name; head.appendChild(w);
        var stRef = database.ref("users/" + u.id + "/online");
        var stFn = stRef.on("value", function (s) {
            u.online = s.val() === true; head.className = "fr-chhead " + (u.online ? "on" : "off");
            w.querySelector("span").textContent = u.online ? "Online" : "Not online"; $("frChCall").disabled = !u.online;
        });
        chatPeer.stOff = function () { stRef.off("value", stFn); };
        $("frMsgs").innerHTML = ""; $("frChat").classList.add("open");
        chatRef = database.ref("chats/" + pairKey(me.id, u.id)).limitToLast(150);
        chatFn = chatRef.on("child_added", function (s) { renderMsg(s.val()); markRead(u.id); });
        markRead(u.id); renderList();
    }
    function closeChat(keepUi) {
        if (chatRef && chatFn) chatRef.off("child_added", chatFn);
        if (chatPeer && chatPeer.stOff) chatPeer.stOff();
        chatRef = null; chatFn = null; chatPeer = null;
        if (!keepUi) { $("frChat").classList.remove("open"); renderList(); }
    }
    function send(msg) {
        if (!chatPeer) return;
        msg.from = me.id; msg.ts = TS;
        database.ref("chats/" + pairKey(me.id, chatPeer.id)).push(msg).catch(function () { toast("Message failed — it may be too large"); });
        database.ref("inbox/" + chatPeer.id + "/" + me.id).set(TS);
    }
    function sendImage(file) {
        var r = new FileReader();
        r.onload = function () {
            var img = new Image();
            img.onload = function () {
                var k = Math.min(1, 900 / Math.max(img.width, img.height)), c = document.createElement("canvas");
                c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
                c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
                send({ type: "img", data: c.toDataURL("image/jpeg", 0.72) });
            };
            img.onerror = function () { toast("Couldn’t read that image"); };
            img.src = r.result;
        };
        r.readAsDataURL(file);
    }

    /* voice messages */
    var rec = null, recChunks = [], recStream = null, recStart = 0, recTick = null, recCancel = false;
    function stopRecUi() { clearInterval(recTick); $("frCin").classList.remove("recording"); $("frMic").classList.remove("rec"); }
    function startRec() {
        if (!window.MediaRecorder) { toast("Voice messages aren’t supported on this browser"); return; }
        getMic().then(function (st) {
            recStream = st; recChunks = []; recCancel = false;
            var mt = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].filter(function (t) { return MediaRecorder.isTypeSupported(t); })[0];
            rec = new MediaRecorder(st, mt ? { mimeType: mt, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 });
            rec.ondataavailable = function (e) { if (e.data && e.data.size) recChunks.push(e.data); };
            rec.onstop = function () {
                recStream.getTracks().forEach(function (t) { t.stop(); });
                if (recCancel || !recChunks.length) return;
                var blob = new Blob(recChunks, { type: rec.mimeType || "audio/webm" }), fr = new FileReader();
                fr.onload = function () { send({ type: "voice", data: fr.result, dur: Math.max(1, Math.round((Date.now() - recStart) / 1000)) }); };
                fr.readAsDataURL(blob);
            };
            rec.start(); recStart = Date.now();
            $("frCin").classList.add("recording"); $("frMic").classList.add("rec"); $("frRecT").textContent = "0:00";
            recTick = setInterval(function () {
                var s = Math.round((Date.now() - recStart) / 1000); $("frRecT").textContent = fmt(s);
                if (s >= 120) finishRec(false);
            }, 500);
        }).catch(function () { toast("Microphone permission is needed"); });
    }
    function finishRec(cancel) { if (!rec || rec.state === "inactive") return; recCancel = cancel; stopRecUi(); rec.stop(); }

    function initUI() {
        loadList();
        $("frMyId").textContent = me.id;
        $("frName").value = me.name; $("frIdIn").value = me.id;
        $("frCopy").onclick = function () {
            if (navigator.clipboard) navigator.clipboard.writeText(me.id).then(function () { toast("ID copied"); }, function () { toast(me.id); }); else toast(me.id);
        };
        $("frEditBtn").onclick = function () { $("frEdit").classList.toggle("open"); };
        $("frSave").onclick = async function () {
            var nm = $("frName").value.trim().slice(0, 30) || me.name, nid = cleanId($("frIdIn").value);
            if (nid.length < 3) { toast("ID needs at least 3 letters or numbers"); return; }
            LS.setItem("focusLab_friendName", nm);
            if (nid !== me.id) {
                if (!(await claim(nid))) { toast("That ID is taken — choose another"); return; }
                database.ref("users/" + me.id).remove(); LS.setItem("focusLab_friendId", nid);
            }
            location.reload();
        };
        $("frForm").onsubmit = function (e) { e.preventDefault(); search($("frQ").value); };
        database.ref("inbox/" + me.id).on("value", function (s) {
            inbox = s.val() || {};
            Object.keys(inbox).forEach(function (id) { if (list.indexOf(id) < 0) { list.unshift(id); saveList(); } });
            if (chatPeer) markRead(chatPeer.id);
            renderList();
        });
        renderList();

        $("frBack").onclick = function () { closeChat(); };
        $("frChCall").onclick = function () { if (chatPeer) startCall(chatPeer); };
        $("frSend").onclick = sendText;
        $("frTxt").onkeydown = function (e) { if (e.key === "Enter") sendText(); };
        $("frImg").onchange = function () { var f = this.files[0]; this.value = ""; if (f && /^image\//.test(f.type)) sendImage(f); };
        ["😀", "😂", "😍", "👍", "🔥", "🎉", "📚", "💪", "😴", "🙏", "❤️", "✅"].forEach(function (e) {
            var b = document.createElement("button"); b.type = "button"; b.textContent = e;
            b.onclick = function () { $("frTxt").value += e; $("frEmojis").classList.remove("open"); $("frTxt").focus(); };
            $("frEmojis").appendChild(b);
        });
        $("frEmBtn").onclick = function () { $("frEmojis").classList.toggle("open"); };
        $("frMic").onclick = function () { if ($("frCin").classList.contains("recording")) finishRec(false); else startRec(); };
        $("frRecCancel").onclick = function () { finishRec(true); };

        $("frClEnd").onclick = function () { hangup(""); };
        $("frClMute").onclick = function () {
            muted = !muted; this.classList.toggle("on", muted);
            if (localStream) localStream.getAudioTracks().forEach(function (t) { t.enabled = !muted; });
        };
        $("frClSpk").onclick = function () { spkOn = !spkOn; this.classList.toggle("on", spkOn); applySpeaker(); toast(spkOn ? "Speaker boost on" : "Speaker boost off"); };
    }
    function sendText() { var v = $("frTxt").value.trim(); if (!v) return; $("frTxt").value = ""; send({ type: "text", text: v.slice(0, 2000) }); }

    /* ---------- start ---------- */
    window.addEventListener("beforeunload", function () { if (callActive && callId) database.ref("calls/" + callId + "/status").set("ended"); });

    ensureId().then(function (id) {
        me.id = id; LS.setItem("focusLab_friendId", id); readProfile();
        var uRef = database.ref("users/" + id);
        uRef.update({ name: me.name, avatar: me.avatar });
        database.ref(".info/connected").on("value", function (s) {
            if (s.val() !== true) return;
            var on = uRef.child("online");
            on.onDisconnect().set(false).then(function () { on.set(true); });
            uRef.child("lastSeen").onDisconnect().set(TS);
        });
        buildBanner();
        listenIncoming();
        if (HAS_UI) initUI();
    }).catch(function () { /* offline or database rules blocked access */ });

})();
