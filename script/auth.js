/* =========================================================
   FocusLab — Firebase Auth (Email/Password) + Firestore "users"
   Load AFTER main.js. It replaces submitSignin() / signOut()
   and keeps the old localStorage keys filled, so every other
   page and the chat keep working unchanged.
========================================================= */
(function () {
    if (typeof firebase === "undefined" || !firebase.auth || !firebase.firestore) return;

    /* Same config as the chat in main.js */
    var firebaseConfig = {
        apiKey: "AIzaSyDlwl5-XURif342D5JQCCTsoqazKLHOl9U",
        authDomain: "focuslab-e25da.firebaseapp.com",
        databaseURL: "https://focuslab-e25da-default-rtdb.firebaseio.com",
        projectId: "focuslab-e25da",
        storageBucket: "focuslab-e25da.firebasestorage.app",
        messagingSenderId: "534017418669",
        appId: "1:534017418669:web:3f034da163d06b90b02d24"
    };
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

    var auth = firebase.auth(), db = firebase.firestore(), LS = localStorage;
    var $ = function (id) { return document.getElementById(id); };
    var stamp = function () { return firebase.firestore.FieldValue.serverTimestamp(); };
    var mode = "signup", busy = false;

    var ERR = {
        "auth/email-already-in-use": "This email already has an account. Log in instead.",
        "auth/invalid-email": "Please enter a valid email address.",
        "auth/weak-password": "Password must be at least 6 characters.",
        "auth/invalid-credential": "Wrong email or password.",
        "auth/wrong-password": "Wrong email or password.",
        "auth/user-not-found": "Wrong email or password.",
        "auth/too-many-requests": "Too many attempts. Try again in a few minutes.",
        "auth/network-request-failed": "No connection. Check your internet and try again.",
        "auth/missing-email": "Type your email first.",
        "auth/operation-not-allowed": "Email/Password sign-in is not enabled in Firebase Authentication yet.",
        "permission-denied": "Firestore blocked saving your profile. Check the Firestore rules."
    };
    function showErr(msg) {
        var e = $("signinError"); if (!e) return;
        e.textContent = msg; e.classList.add("active");
    }
    function clearErr() { var e = $("signinError"); if (e) e.classList.remove("active"); var o = $("authOk"); if (o) o.style.display = "none"; }
    function okMsg(t) { var o = $("authOk"); if (!o) return; o.textContent = t; o.style.display = "block"; }
    try { auth.useDeviceLanguage(); } catch (e) {}

    async function forgot() {
        var em = ($("signinEmail").value || "").trim();
        if (!em) em = (window.prompt("Enter your email to reset your password:") || "").trim();
        if (!em) return;
        $("signinEmail").value = em; clearErr();
        try {
            await auth.sendPasswordResetEmail(em);
            okMsg("Done! Check your email for a link to reset your password (look in Spam too).");
        } catch (e) { showErr(ERR[e.code] || ((e.code ? e.code + " — " : "") + (e.message || "Could not send the email."))); }
    }

    /* ---------- profile -> localStorage (UI + chat read these keys) ---------- */
    function applyProfile(u, d) {
        if (LS.getItem("focusLab_uid") && LS.getItem("focusLab_uid") !== u.uid) {
            /* a different person on this browser: don't inherit the old chat identity */
            ["focusLab_friendId", "focusLab_friendToken", "focusLab_friendName"].forEach(function (k) { LS.removeItem(k); });
        }
        LS.setItem("focusLab_uid", u.uid);
        LS.setItem("focusLab_firstName", d.firstName || "Focus");
        LS.setItem("focusLab_lastName", d.lastName || "User");
        LS.setItem("focusLab_email", d.email || u.email || "");
        if (d.avatar) LS.setItem("focusLab_avatarSrc", d.avatar);
        LS.setItem("focusLab_signedIn", "true");
        showHomeView();
        loadUserInfo();
    }

    function tmo(p, ms) { return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error("timeout")); }, ms); })]); }
    function soft(p) { return tmo(p, 8000).catch(function (e) { console.warn("Firestore:", e && (e.code || e.message)); }); }

    async function enter(u, touch, explicit) {
        var ref = db.collection("users").doc(u.uid), snap = null, d;
        try { snap = await tmo(ref.get(), 8000); } catch (e) { console.warn("Firestore:", e && (e.code || e.message)); }
        if (snap && snap.exists) {
            d = snap.data();
            if (touch) soft(ref.set(explicit ? { lastLogin: stamp(), visits: firebase.firestore.FieldValue.increment(1) } : { lastLogin: stamp() }, { merge: true }));
        } else {
            var p = (u.displayName || "Focus User").split(" ");
            d = { firstName: LS.getItem("focusLab_firstName") || p[0], lastName: LS.getItem("focusLab_lastName") || p.slice(1).join(" ") || "User", email: u.email };
            if (snap) soft(ref.set(Object.assign({ createdAt: stamp(), lastLogin: stamp(), visits: 1 }, d)));
        }
        applyProfile(u, d);
    }

    /* ---------- sign up / log in ---------- */
    window.submitSignin = async function () {
        var v = function (id) { return ($(id) ? $(id).value : "").trim(); };
        var fn = v("signinFirstName"), ln = v("signinLastName"), em = v("signinEmail"), pw = $("signinPassword").value;
        var signup = mode === "signup";
        if (!em || !pw || (signup && (!fn || !ln || !selectedSigninAvatar))) {
            return showErr(signup ? "Please fill in every field and choose an avatar." : "Enter your email and password.");
        }
        clearErr(); busy = true;
        var btn = document.querySelector("#signinView .modal-submit-button");
        if (btn) btn.disabled = true;
        try {
            if (signup) {
                var cred;
                try { cred = await auth.createUserWithEmailAndPassword(em, pw); }
                catch (e1) {
                    if (e1.code !== "auth/email-already-in-use") throw e1;
                    cred = await auth.signInWithEmailAndPassword(em, pw);   /* account exists from an earlier try: just log in */
                }
                cred.user.updateProfile({ displayName: fn + " " + ln }).catch(function () {});
                var d = { firstName: fn, lastName: ln, email: em.toLowerCase() };
                if (/^images\//.test(selectedSigninAvatar)) d.avatar = selectedSigninAvatar;
                await soft(db.collection("users").doc(cred.user.uid).set(Object.assign({ createdAt: stamp(), lastLogin: stamp(), visits: 1 }, d), { merge: true }));
                if (!d.avatar) d.avatar = LS.getItem("focusLab_avatarSrc") || "";
                else LS.setItem("focusLab_avatarSrc", d.avatar);
                applyProfile(cred.user, d);
            } else {
                var c = await auth.signInWithEmailAndPassword(em, pw);
                await enter(c.user, true, true);
            }
            sessionStorage.setItem("fl_seen", "1");
        } catch (e) {
            showErr(ERR[e.code] || ((e.code ? e.code + " — " : "") + (e.message || "Something went wrong.")));
        }
        busy = false;
        if (btn) btn.disabled = false;
    };

    var origSignOut = window.signOut;
    window.signOut = function () {
        sessionStorage.removeItem("fl_seen");
        auth.signOut().catch(function () {});
        if (origSignOut) origSignOut();
    };

    /* ---------- Sign up <-> Log in toggle (injected, same styling) ---------- */
    function setMode(m) {
        mode = m;
        var box = $("signinView"); if (!box) return;
        var login = m === "login", grid = $("signinAvatarGrid");
        $("signinFirstName").closest(".form-grid").style.display = login ? "none" : "";
        grid.style.display = login ? "none" : "";
        if (grid.previousElementSibling) grid.previousElementSibling.style.display = login ? "none" : "";
        box.querySelector("h2").textContent = login ? "Welcome back" : "Create your account";
        box.querySelector(".modal-submit-button").textContent = login ? "Log in" : "Create account";
        $("signinPassword").autocomplete = login ? "current-password" : "new-password";
        $("authToggle").textContent = login ? "New here? Create an account" : "Already have an account? Log in";
        var f = $("authForgot"); if (f) f.style.display = login ? "" : "none";
        clearErr();
    }
    function buildToggle() {
        var btn = document.querySelector("#signinView .modal-submit-button");
        if (!btn || $("authToggle")) return;
        var p = document.createElement("p");
        p.id = "authToggle"; p.className = "modal-description";
        p.style.cssText = "text-align:center;cursor:pointer;margin:14px 0 0;color:#60a5fa";
        p.onclick = function () { setMode(mode === "signup" ? "login" : "signup"); };
        var fg = document.createElement("p");
        fg.id = "authForgot"; fg.className = "modal-description";
        fg.style.cssText = "text-align:center;cursor:pointer;margin:12px 0 0;display:none;color:#60a5fa";
        fg.textContent = "Forgot password?"; fg.onclick = forgot;
        var ok = document.createElement("p");
        ok.id = "authOk"; ok.style.cssText = "display:none;color:#4ade80;font-size:14px;line-height:1.5;margin:10px 0 0;text-align:center";
        var er = $("signinError"); if (er) er.after(ok);
        btn.after(fg); fg.after(p);
        setMode("signup");
    }

    /* ---------- keep the page in step with Firebase ---------- */
    auth.onAuthStateChanged(async function (u) {
        if (busy) return;
        var flag = LS.getItem("focusLab_signedIn") === "true";
        if (!u) {                                   /* no Firebase session */
            if (flag) { LS.removeItem("focusLab_signedIn"); if (typeof showSigninView === "function") showSigninView(); }
            return;
        }
        if (!flag) { auth.signOut(); return; }      /* signed out from another page */
        try {                                       /* session restored: refresh name + lastLogin once per visit */
            await enter(u, !sessionStorage.getItem("fl_seen"));
            sessionStorage.setItem("fl_seen", "1");
        } catch (e) { /* offline: keep the cached profile */ }
    });

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildToggle);
    else buildToggle();
})();