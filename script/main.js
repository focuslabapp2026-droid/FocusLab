"use strict";

/* =========================================================
   FOCUSLAB GLOBAL DATA
========================================================= */

let tasks = [];
let currentFilter = "All";

let activeTimerTaskId = null;
let globalTimerInterval = null;

let breakInterval = null;
let breakSeconds = 0;

let currentMusicAudioEl = null;
let musicPositionSaveInterval = null;


/* =========================================================
   HELPERS
========================================================= */

function isTasksPage() {
    return !!document.getElementById("tasksListContainer");
}

/*
 * True when the current file lives inside /pages/
 * (e.g. pages/tasks.html), false for the root index.html.
 * Used so the same script can resolve "images/..." paths
 * correctly no matter which page loaded it.
 */
function isInPagesFolder() {
    return window.location.pathname.includes("/pages/");
}

function getTasks() {
    try {
        const stored = localStorage.getItem("focusLab_tasks");
        const parsed = stored ? JSON.parse(stored) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveTasks() {
    localStorage.setItem("focusLab_tasks", JSON.stringify(tasks));
}

function createTaskId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatSeconds(seconds) {
    seconds = Math.max(0, Math.floor(seconds));

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const mm = String(minutes).padStart(2, "0");
    const ss = String(secs).padStart(2, "0");

    /*
     * Under an hour: MM:SS (unchanged).
     * One hour or more: H:MM:SS — e.g. a 120 minute task shows
     * 2:00:00 instead of 120:00.
     */
    return hours > 0
        ? hours + ":" + mm + ":" + ss
        : mm + ":" + ss;
}


/* =========================================================
   HOURS + MINUTES  (focus time / break time)
   Times are still STORED as a plain number of minutes (so old
   tasks keep working). These helpers only change how a time is
   typed and shown:
     45 min      -> "45"      unit "min"
     60 min      -> "1"       unit "hr"
     90 min      -> "1:30"    unit "hr"
     120 min     -> "2"       unit "hr"
     121 min     -> "2:01"    unit "hr"
========================================================= */

function normalizeDigits(value) {
    /* Arabic-Indic (٠-٩) and Persian (۰-۹) digits -> 0-9 */
    return String(value ?? "")
        .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632))
        .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 1776));
}

/*
 * Understands what a person may type in the time box:
 *   "90"  "1:30"  "2h"  "2 hr"  "1h 30m"  "45 min"
 * Returns total minutes, or null when it can't be read.
 */
function parseTimeText(value) {

    const raw = normalizeDigits(value).trim().toLowerCase();

    if (!raw) return null;

    let match = raw.match(/^(\d+):(\d{1,2})$/);

    if (match) {
        return Number(match[1]) * 60 + Number(match[2]);
    }

    match = raw.match(
        /^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)(?:\s*(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)?)?$/
    );

    if (match) {
        return Number(match[1]) * 60 + Number(match[2] || 0);
    }

    match = raw.match(
        /^(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)?$/
    );

    if (match) {
        return Number(match[1]);
    }

    return null;
}

/* What goes inside the time box: "45", "1", "1:30", "2" ... */
function formatMinutesForInput(minutes) {

    if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) {
        return "";
    }

    if (minutes < 60) {
        return String(Math.round(minutes * 100) / 100);
    }

    const total = Math.round(minutes);
    const hours = Math.floor(total / 60);
    const rest = total % 60;

    return rest === 0
        ? String(hours)
        : hours + ":" + String(rest).padStart(2, "0");
}

/* The wording shown on the task row: "45 min", "2 hours", "1 hr 30 min" */
function formatMinutesLabel(minutes) {

    const value = Number(minutes);

    if (!Number.isFinite(value) || value <= 0) return "";

    if (value < 60) {
        return (Math.round(value * 100) / 100) + " min";
    }

    const total = Math.round(value);
    const hours = Math.floor(total / 60);
    const rest = total % 60;

    if (rest === 0) {
        return hours + (hours === 1 ? " hour" : " hours");
    }

    return hours + " hr " + rest + " min";
}

function getAssetPath(path) {

    const fallback =
        isInPagesFolder()
            ? "../images/avatars/avatar1.jpeg"
            : "images/avatars/avatar1.jpeg";

    if (!path) return fallback;

    if (
        path.startsWith("http://") ||
        path.startsWith("https://") ||
        path.startsWith("data:")
    ) {
        return path;
    }

    /*
     * Normalize whatever was stored ("images/...",
     * "../images/...", "/images/...") down to a clean
     * "images/..." form, then prefix correctly for
     * whichever page is currently resolving it.
     */
    let clean = path.replace(/^(\.\.\/)+/, "").replace(/^\//, "");

    if (!clean.startsWith("images/")) {
        return path;
    }

    return isInPagesFolder() ? "../" + clean : clean;
}


/* =========================================================
   MIGRATION
========================================================= */

function normalizeTasks() {

    let changed = false;

    tasks = tasks.map(task => {

        const normalized = {
            id: task.id || createTaskId(),
            text: task.text || "Untitled Task",
            focusTime:
                task.focusTime === null ||
                task.focusTime === undefined ||
                task.focusTime === ""
                    ? null
                    : Number(task.focusTime),

            breakTime:
                task.breakTime === null ||
                task.breakTime === undefined ||
                task.breakTime === ""
                    ? null
                    : Number(task.breakTime),

            priority: task.priority || "Normal",
            completed: Boolean(task.completed),

            timerRunning: Boolean(task.timerRunning),
            timerEndAt: task.timerEndAt || null,
            timerFinished: Boolean(task.timerFinished),
            timerNotified: Boolean(task.timerNotified),

            /*
             * Remaining seconds kept aside while the
             * timer is manually paused via the toggle button.
             */
            pausedRemaining:
                task.pausedRemaining === null ||
                task.pausedRemaining === undefined
                    ? null
                    : Number(task.pausedRemaining)
        };

        /*
         * Older tasks do not have timer state.
         * We deliberately DO NOT start old tasks automatically.
         * Only newly created tasks start automatically.
         */

        if (
            normalized.timerRunning &&
            normalized.timerEndAt &&
            Date.now() >= normalized.timerEndAt
        ) {
            normalized.timerRunning = false;
            normalized.timerEndAt = null;
            normalized.timerFinished = true;
        }

        if (
            normalized.id !== task.id ||
            normalized.timerRunning !== Boolean(task.timerRunning)
        ) {
            changed = true;
        }

        return normalized;
    });

    if (changed) {
        saveTasks();
    }
}


/* =========================================================
   USER / AVATAR
========================================================= */

function loadUserInfo() {

    const firstName =
        localStorage.getItem("focusLab_firstName") || "Focus";

    const lastName =
        localStorage.getItem("focusLab_lastName") || "User";

    const avatar =
        localStorage.getItem("focusLab_avatarSrc") ||
        "images/avatars/avatar1.jpeg";

    const fullName = `${firstName} ${lastName}`.trim();

    const homeName = document.getElementById("homeUserName");
    if (homeName) {
        homeName.textContent = fullName;
    }

    const homeAvatar = document.getElementById("homeAvatar");
    if (homeAvatar) {
        homeAvatar.src = getAssetPath(avatar);
    }

    const sidebarName = document.getElementById("sidebar-user-name");
    if (sidebarName) {
        sidebarName.textContent = fullName;
    }

    const sidebarAvatar = document.getElementById("sidebar-avatar");
    if (sidebarAvatar) {
        sidebarAvatar.src = getAssetPath(avatar);
    }

    const headerAvatar = document.getElementById("user-avatar-display");
    if (headerAvatar) {
        headerAvatar.src = getAssetPath(avatar);
    }
}


/* =========================================================
   SIGN IN / HOME — now ONE file (index.html).
   Signing in no longer navigates anywhere: it just swaps
   which section of the page is visible.
========================================================= */

let selectedSigninAvatar = null;

function isSignedIn() {
    return localStorage.getItem("focusLab_signedIn") === "true";
}

function showHomeView() {
    document.documentElement.classList.remove("is-guest");
    document.documentElement.classList.add("is-signed-in");
}

function showSigninView() {
    document.documentElement.classList.remove("is-signed-in");
    document.documentElement.classList.add("is-guest");
}

function applyAuthView() {

    /* Only relevant on the merged index.html page. */
    if (!document.getElementById("signinView")) return;

    if (isSignedIn()) {
        showHomeView();
    } else {
        showSigninView();
    }
}

function selectSigninAvatar(button) {

    document
        .querySelectorAll("#signinAvatarGrid .background-option")
        .forEach(option => option.classList.remove("selected"));

    button.classList.add("selected");
    selectedSigninAvatar = button.dataset.avatar;
}


/* =========================================================
   AVATAR PHOTO UPLOAD
   Lets the person pick their own photo instead of one of the
   four built-in code-drawn avatars. The photo is cropped to a
   square and downsized on a canvas, then kept as a small data
   URL — so it works with the exact same storage key
   (focusLab_avatarSrc) as the built-in avatars.
========================================================= */

const AVATAR_PHOTO_SIZE = 240;

function processAvatarFile(file) {

    return new Promise((resolve, reject) => {

        const reader = new FileReader();

        reader.onload = () => {

            const img = new Image();

            img.onload = () => {

                const size = AVATAR_PHOTO_SIZE;
                const canvas = document.createElement("canvas");

                canvas.width = size;
                canvas.height = size;

                const ctx = canvas.getContext("2d");

                const minSide = Math.min(img.width, img.height);
                const sx = (img.width - minSide) / 2;
                const sy = (img.height - minSide) / 2;

                ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);

                resolve(canvas.toDataURL("image/jpeg", 0.87));
            };

            img.onerror = () => reject(new Error("Could not read that image."));

            img.src = reader.result;
        };

        reader.onerror = () => reject(new Error("Could not read that file."));

        reader.readAsDataURL(file);
    });
}

/* --- Used inside the sign-in avatar grid (5th "Add" tile) --- */

function triggerSigninAvatarUpload() {

    const input = document.getElementById("signinAvatarFileInput");

    if (input) input.click();
}

async function handleSigninAvatarFileSelected(event) {

    const file = event.target.files && event.target.files[0];

    event.target.value = "";

    if (!file) return;

    if (!file.type.startsWith("image/")) {
        alert("Please choose an image file.");
        return;
    }

    try {

        const dataUrl = await processAvatarFile(file);

        const addButton = document.getElementById("signinAvatarAddBtn");

        if (addButton) {

            addButton.innerHTML = `<img src="${dataUrl}" alt="Your photo">`;
            addButton.dataset.avatar = dataUrl;

            selectSigninAvatar(addButton);
        }

    } catch {
        alert("Couldn't use that photo. Please try another image.");
    }
}

/* --- Used for changing the avatar from inside the app
       (click your avatar in the header or sidebar) --- */

function openAvatarEditModal() {

    /* Only available once signed in. */
    if (!isSignedIn()) return;

    const modal = document.getElementById("avatarEditModal");

    if (modal) {
        modal.classList.add("active");
    }

    markSelectedAvatarInEditGrid();
}

function closeAvatarEditModal() {

    const modal = document.getElementById("avatarEditModal");

    if (modal) {
        modal.classList.remove("active");
    }
}

function markSelectedAvatarInEditGrid() {

    const current = localStorage.getItem("focusLab_avatarSrc") || "";

    document
        .querySelectorAll("#avatarEditGrid .background-option[data-avatar]")
        .forEach(button => {
            button.classList.toggle("selected", button.dataset.avatar === current);
        });

    const addButton = document.getElementById("avatarEditAddBtn");

    if (!addButton) return;

    if (current.startsWith("data:")) {

        addButton.innerHTML = `<img src="${current}" alt="Your photo">`;
        addButton.classList.add("selected");

    } else {

        addButton.innerHTML = `
            <span class="avatar-add-icon">+</span>
            <span class="avatar-add-label">Add</span>
        `;

        addButton.classList.remove("selected");
    }
}

function applyAvatarChoice(button) {

    const avatar = button.dataset.avatar;

    if (!avatar) return;

    localStorage.setItem("focusLab_avatarSrc", avatar);

    loadUserInfo();

    closeAvatarEditModal();
}

function triggerAvatarEditUpload() {

    const input = document.getElementById("avatarEditFileInput");

    if (input) input.click();
}

async function handleAvatarEditFileSelected(event) {

    const file = event.target.files && event.target.files[0];

    event.target.value = "";

    if (!file) return;

    if (!file.type.startsWith("image/")) {
        alert("Please choose an image file.");
        return;
    }

    try {

        const dataUrl = await processAvatarFile(file);

        localStorage.setItem("focusLab_avatarSrc", dataUrl);

        loadUserInfo();

        closeAvatarEditModal();

    } catch {
        alert("Couldn't use that photo. Please try another image.");
    }
}

function submitSignin() {

    const firstName = document.getElementById("signinFirstName")?.value.trim();
    const lastName = document.getElementById("signinLastName")?.value.trim();
    const email = document.getElementById("signinEmail")?.value.trim();
    const password = document.getElementById("signinPassword")?.value.trim();
    const errorText = document.getElementById("signinError");

    if (!firstName || !lastName || !email || !password || !selectedSigninAvatar) {

        if (errorText) {
            errorText.classList.add("active");
        }

        return;
    }

    if (errorText) {
        errorText.classList.remove("active");
    }

    localStorage.setItem("focusLab_firstName", firstName);
    localStorage.setItem("focusLab_lastName", lastName);
    localStorage.setItem("focusLab_email", email);
    localStorage.setItem("focusLab_avatarSrc", selectedSigninAvatar);
    localStorage.setItem("focusLab_signedIn", "true");

    showHomeView();
    loadUserInfo();
}

function signOut() {

    localStorage.removeItem("focusLab_signedIn");

    closeSettingsModal();

    try { stopMusic(); } catch { /* nothing was playing */ }

    if (document.getElementById("signinView")) {
        /* index.html: swap to the sign-in form. */
        showSigninView();
    } else {
        /* Any other page: go back to index.html, which shows the sign-in form. */
        window.location.href = isInPagesFolder() ? "../index.html" : "index.html";
    }
}


/* =========================================================
   SIDEBAR
========================================================= */

function toggleSidebar() {

    const sidebar = document.getElementById("sidebar");

    if (!sidebar) return;

    if (window.innerWidth <= 800) {
        sidebar.classList.toggle("open");
    } else {

        sidebar.classList.toggle("closed");

        /*
         * Desktop only: when the sidebar is closed, the main
         * board + footer smoothly expand to fill the freed-up
         * space (via the ".sidebar-collapsed" CSS rules).
         * Reopening the sidebar removes the class, so the
         * same transition plays in reverse.
         */
        const appScreen = document.getElementById("app-screen");

        if (appScreen) {
            appScreen.classList.toggle(
                "sidebar-collapsed",
                sidebar.classList.contains("closed")
            );
        }
    }
}


/* =========================================================
   SETTINGS
   A "Settings" button (gear) in the burger menu opens a small
   window with two switches:
     - Sound: mutes / unmutes ALL the site's sound (the focus
       music and the YouTube videos). Remembered between pages.
     - Full screen: makes the whole browser page full-screen
       (for phones/tablets that have no F11 key).
========================================================= */

function isSoundMuted() {
    return localStorage.getItem("focusLab_soundMuted") === "true";
}

/* Pushes the current mute state into whatever is playing now. */
function applySoundState() {

    const muted = isSoundMuted();

    if (currentMusicAudioEl) {
        currentMusicAudioEl.muted = muted;
    }

    if (youtubePlayer && typeof youtubePlayer.mute === "function") {

        try {
            if (muted) {
                youtubePlayer.mute();
            } else {
                youtubePlayer.unMute();
            }
        } catch {
            /* The player is not ready yet — it applies the state itself when it is. */
        }
    }

    updateSettingsUI();
}

function toggleSiteSound() {

    localStorage.setItem("focusLab_soundMuted", String(!isSoundMuted()));

    applySoundState();
}

function getFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
}

/*
 * Browsers only allow full-screen for the whole page on desktop,
 * Android and iPad. iPhone Safari does not offer it at all — there
 * the switch is greyed out with a short note.
 */
function canUseFullscreen() {

    const el = document.documentElement;

    return Boolean(el.requestFullscreen || el.webkitRequestFullscreen);
}

function toggleSiteFullscreen() {

    if (!canUseFullscreen()) return;

    try {

        let result;

        if (getFullscreenElement()) {

            result = document.exitFullscreen
                ? document.exitFullscreen()
                : document.webkitExitFullscreen();

        } else {

            const el = document.documentElement;

            result = el.requestFullscreen
                ? el.requestFullscreen()
                : el.webkitRequestFullscreen();
        }

        if (result && typeof result.catch === "function") {
            result.catch(() => {});
        }

    } catch {
        /* Refused by the browser — nothing to do. */
    }
}

function updateSettingsUI() {

    updateThemeUI();

    const muted = isSoundMuted();

    const soundButton = document.getElementById("settingsSoundBtn");
    const soundHint = document.getElementById("settingsSoundHint");

    if (soundButton) {
        soundButton.classList.toggle("on", !muted);
        soundButton.setAttribute("aria-checked", String(!muted));
    }

    if (soundHint) {
        soundHint.textContent = muted ? "Sound is off" : "Sound is on";
    }

    const fullscreenButton = document.getElementById("settingsFullscreenBtn");
    const fullscreenHint = document.getElementById("settingsFullscreenHint");

    if (!fullscreenButton) return;

    if (!canUseFullscreen()) {

        fullscreenButton.disabled = true;
        fullscreenButton.classList.remove("on");
        fullscreenButton.setAttribute("aria-checked", "false");

        if (fullscreenHint) {
            fullscreenHint.textContent = "Not supported by this browser (iPhone Safari has no full screen).";
        }

        return;
    }

    const isFullscreen = Boolean(getFullscreenElement());

    fullscreenButton.disabled = false;
    fullscreenButton.classList.toggle("on", isFullscreen);
    fullscreenButton.setAttribute("aria-checked", String(isFullscreen));

    if (fullscreenHint) {
        fullscreenHint.textContent = isFullscreen
            ? "Full screen is on"
            : "Fill the whole screen with the site";
    }
}

function openSettingsModal() {

    const modal = document.getElementById("settingsModal");

    if (!modal) return;

    /* On phones, tuck the menu away behind the window. */
    const sidebar = document.getElementById("sidebar");

    if (sidebar && window.innerWidth <= 800) {
        sidebar.classList.remove("open");
    }

    updateSettingsUI();

    modal.classList.add("active");
}

function closeSettingsModal() {

    const modal = document.getElementById("settingsModal");

    if (modal) {
        modal.classList.remove("active");
    }
}

/* Keeps the full-screen switch correct when full-screen is
   entered / left in any way (the switch, Esc, F11 ...). */
["fullscreenchange", "webkitfullscreenchange"].forEach(name =>
    document.addEventListener(name, updateSettingsUI)
);


/* =========================================================
   ADD TASK MODAL
========================================================= */

function openAddTaskModal() {

    const modal = document.getElementById("addTaskModal");

    if (!modal) return;

    modal.classList.add("active");

    setTimeout(() => {
        const input = document.getElementById("taskTextInput");
        if (input) input.focus();
    }, 100);
}

function closeAddTaskModal() {

    const modal = document.getElementById("addTaskModal");

    if (modal) {
        modal.classList.remove("active");
    }
}

/*
 * The three priority choices (Normal / Important / Study) are
 * bordered buttons. The chosen one is kept in the hidden
 * #priorityInput, so everything that reads the priority still
 * works exactly as before.
 */
function selectPriority(value) {

    const input = document.getElementById("priorityInput");

    if (input) {
        input.value = value;
    }

    document
        .querySelectorAll("#priorityOptions .priority-chip")
        .forEach(chip => {
            chip.classList.toggle("active", chip.dataset.priority === value);
        });

    const label = document.getElementById("prioLabel");
    const dot = document.getElementById("prioDot");

    if (label) label.textContent = value;
    if (dot) dot.className = "prio-dot p-" + value.toLowerCase();
}

/* Opens / closes the little priority pop-up under the button. */
function togglePrioMenu(force) {

    const dd = document.getElementById("prioDd");
    const btn = document.getElementById("prioBtn");

    if (!dd) return;

    const open = typeof force === "boolean" ? force : !dd.classList.contains("open");

    dd.classList.toggle("open", open);
    if (btn) btn.setAttribute("aria-expanded", String(open));
}

document.addEventListener("click", function (e) {
    if (!e.target.closest || !e.target.closest("#prioDd")) togglePrioMenu(false);
});


/* =========================================================
   CREATE TASK
   TIMER STARTS AUTOMATICALLY
========================================================= */

function createTask() {

    const textInput = document.getElementById("taskTextInput");
    const focusInput = document.getElementById("focusTimeInput");
    const breakInput = document.getElementById("breakTimeInput");
    const priorityInput = document.getElementById("priorityInput");

    if (!textInput) return;

    const text = textInput.value.trim();

    if (!text) {
        textInput.focus();
        return;
    }

    /*
     * The time boxes accept minutes ("90"), hours and minutes
     * ("1:30", "2h") — getTimeInputMinutes turns any of them into
     * a plain number of minutes.
     */
    const focusValue = getTimeInputMinutes(focusInput);

    const breakValue = getTimeInputMinutes(breakInput);

    const focusTime =
        focusValue !== null && Number.isFinite(focusValue) && focusValue > 0
            ? focusValue
            : null;

    const breakTime =
        breakValue !== null && Number.isFinite(breakValue) && breakValue > 0
            ? breakValue
            : null;

    const newTask = {

        id: createTaskId(),

        text: text,

        focusTime: focusTime,

        breakTime: breakTime,

        priority:
            priorityInput?.value ||
            "Normal",

        completed: false,

        /*
         * IMPORTANT:
         * The timer starts at the exact moment
         * the task is created.
         */
        timerRunning: Boolean(focusTime),

        timerEndAt:
            focusTime
                ? Date.now() + focusTime * 60 * 1000
                : null,

        timerFinished: false,

        timerNotified: false,

        pausedRemaining: null
    };

    tasks.unshift(newTask);

    saveTasks();

    closeAddTaskModal();

    clearTaskForm();

    loadTasks();

    if (newTask.timerRunning) {
        startGlobalTimerUpdater();
    }
}

function clearTaskForm() {

    const taskInput = document.getElementById("taskTextInput");
    const focusInput = document.getElementById("focusTimeInput");
    const breakInput = document.getElementById("breakTimeInput");

    if (taskInput) taskInput.value = "";
    if (focusInput) {
        focusInput.value = "";
        focusInput.dataset.normalized = "0";
        delete focusInput.dataset.minutes;
        updateTimeInputUnit(focusInput);
    }

    if (breakInput) {
        breakInput.value = "";
        breakInput.dataset.normalized = "0";
        delete breakInput.dataset.minutes;
        updateTimeInputUnit(breakInput);
    }

    selectPriority("Normal");
}


/* =========================================================
   TIME BOXES (Focus time / Break) — hours & minutes
   The two boxes in the "Create New Task" window. While the
   number is under 60 it is minutes ("45" + "min"). From 60 up it
   turns into hours: "1" + "hr" at 60, then 1:01, 1:02 ... 1:59,
   then "2" + "hr" at 120, and so on. You can step with the
   little arrows (hold to keep going), the Up/Down keys, or just
   type: "90", "1:30", "2h", "1h 30m" all work.
   Nothing about the layout changes — the boxes look the same;
   only the small arrows' styling is added from here.
========================================================= */

const TIME_INPUT_IDS = ["focusTimeInput", "breakTimeInput"];

const TIME_STEPPER_ARROW_UP = `
    <svg viewBox="0 0 10 10" width="8" height="8" fill="none">
        <path d="M2 6.5L5 3.5L8 6.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
`;

const TIME_STEPPER_ARROW_DOWN = `
    <svg viewBox="0 0 10 10" width="8" height="8" fill="none">
        <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
`;

function ensureTimeInputStyles() {

    if (document.getElementById("focusLabTimeInputStyles")) return;

    const style = document.createElement("style");

    style.id = "focusLabTimeInputStyles";

    style.textContent = `
        .input-with-unit input[data-time-input] {
            padding-right: 68px;
        }

        .time-stepper {
            position: absolute;
            right: 42px;
            top: 50%;
            transform: translateY(-50%);
            display: flex;
            flex-direction: column;
            gap: 2px;
            opacity: 0;
            transition: opacity .2s;
        }

        .input-with-unit:hover .time-stepper,
        .input-with-unit:focus-within .time-stepper {
            opacity: 1;
        }

        .time-stepper button {
            width: 20px;
            height: 15px;
            border-radius: 5px;
            display: grid;
            place-items: center;
            background: rgba(255,255,255,.06);
            color: #94a3b8;
            cursor: pointer;
            transition: .15s;
            touch-action: manipulation;
        }

        .time-stepper button:hover {
            background: rgba(59,130,246,.2);
            color: #60a5fa;
        }

        /* Phones have no hover and no spinner — people just type. */
        @media (hover: none) {
            .time-stepper {
                display: none;
            }
        }
    `;

    document.head.appendChild(style);
}

/*
 * The real number of minutes in a time box. Once the box has been
 * tidied up ("1" next to "hr"), the exact minutes are kept aside,
 * because the text "1" alone would be read as one minute.
 */
function getTimeInputMinutes(input) {

    if (!input) return null;

    if (input.dataset.normalized === "1" && input.dataset.minutes) {
        return Number(input.dataset.minutes);
    }

    return parseTimeText(input.value);
}

function updateTimeInputUnit(input) {

    const wrapper = input.parentElement;

    const unit = wrapper
        ? wrapper.querySelector(":scope > span")
        : null;

    if (!unit) return;

    const text = normalizeDigits(input.value).trim();
    const minutes = getTimeInputMinutes(input);

    /*
     * Plain digits while typing still mean minutes, so the unit
     * only flips to "hr" once the box has been tidied up (on
     * leaving the box, or with the arrows) or the person typed
     * the hours themselves ("1:30", "2h").
     */
    const meansHours =
        minutes !== null &&
        minutes >= 60 &&
        (input.dataset.normalized === "1" || /[:h]/.test(text));

    unit.textContent = meansHours ? "hr" : "min";
}

function setTimeInputMinutes(input, minutes) {

    input.value = formatMinutesForInput(minutes);
    input.dataset.normalized = "1";
    input.dataset.minutes = String(minutes);

    updateTimeInputUnit(input);
}

function normalizeTimeInput(input) {

    const text = input.value.trim();

    if (!text) {
        input.dataset.normalized = "0";
        updateTimeInputUnit(input);
        return;
    }

    const minutes = getTimeInputMinutes(input);

    if (minutes === null) {
        input.value = "";
        input.dataset.normalized = "0";
        updateTimeInputUnit(input);
        return;
    }

    setTimeInputMinutes(input, minutes);
}

function stepTimeInput(input, delta) {

    const current = getTimeInputMinutes(input);

    const base = current === null ? 0 : Math.floor(current);

    setTimeInputMinutes(input, Math.max(0, base + delta));
}

function setupTimeInput(input) {

    if (!input || input.dataset.timeInput) return;

    const wrapper = input.parentElement;

    input.dataset.timeInput = "1";
    input.dataset.normalized = "0";

    input.type = "text";
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.removeAttribute("min");

    input.addEventListener("input", () => {
        input.dataset.normalized = "0";
        updateTimeInputUnit(input);
    });

    input.addEventListener("blur", () => normalizeTimeInput(input));

    input.addEventListener("focus", () => {
        setTimeout(() => {
            try { input.select(); } catch {}
        }, 0);
    });

    input.addEventListener("keydown", event => {

        if (event.key === "ArrowUp" || event.key === "ArrowDown") {

            event.preventDefault();

            const size = event.shiftKey ? 10 : 1;

            stepTimeInput(input, event.key === "ArrowUp" ? size : -size);

        } else if (event.key === "Enter") {

            normalizeTimeInput(input);
        }
    });

    if (!wrapper || wrapper.querySelector(".time-stepper")) return;

    const stepper = document.createElement("div");

    stepper.className = "time-stepper";

    stepper.innerHTML = `
        <button type="button" tabindex="-1" data-dir="1" aria-label="More time">${TIME_STEPPER_ARROW_UP}</button>
        <button type="button" tabindex="-1" data-dir="-1" aria-label="Less time">${TIME_STEPPER_ARROW_DOWN}</button>
    `;

    stepper.querySelectorAll("button").forEach(button => {

        const direction = Number(button.dataset.dir);

        let delayTimer = null;
        let repeatTimer = null;
        let ticks = 0;

        const stop = () => {
            clearTimeout(delayTimer);
            clearInterval(repeatTimer);
            delayTimer = null;
            repeatTimer = null;
            ticks = 0;
        };

        /* Keep focus in the box while the arrows are used. */
        button.addEventListener("mousedown", event => event.preventDefault());

        button.addEventListener("pointerdown", event => {

            event.preventDefault();

            stop();

            stepTimeInput(input, direction);

            /* Hold the arrow to keep going — faster after a moment. */
            delayTimer = setTimeout(() => {

                repeatTimer = setInterval(() => {

                    ticks++;

                    stepTimeInput(input, direction * (ticks > 25 ? 5 : 1));

                }, 70);

            }, 400);
        });

        ["pointerup", "pointerleave", "pointercancel"].forEach(name =>
            button.addEventListener(name, stop)
        );
    });

    wrapper.appendChild(stepper);
}

function initTimeInputs() {

    ensureTimeInputStyles();

    TIME_INPUT_IDS.forEach(id =>
        setupTimeInput(document.getElementById(id))
    );
}


/* =========================================================
   TIMER TOGGLE ICONS
   A simple round control: a triangle to play,
   two bars to pause — used for both task timers
   and the music player.
========================================================= */

const PLAY_ICON_SVG = `
    <svg viewBox="0 0 24 24" fill="none">
        <path d="M8 5.5V18.5L19 12L8 5.5Z"
              stroke="currentColor" stroke-width="1.6"
              stroke-linejoin="round" fill="currentColor"/>
    </svg>
`;

const PAUSE_ICON_SVG = `
    <svg viewBox="0 0 24 24" fill="none">
        <path d="M8 5.5V18.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
        <path d="M16 5.5V18.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
    </svg>
`;


/* =========================================================
   LOAD TASKS
========================================================= */

/*
 * Builds one task row exactly as it appears in the Tasks
 * list — name, priority, focus/break labels, the timer
 * button + play/pause toggle, the complete button, and the
 * delete button. Shared by the Tasks page and by the "task
 * you're working on" card pinned inside the video player, so
 * both are always identical and both stay in sync through the
 * same update functions (updateAllTaskTimerButtons, etc.).
 */
function buildTaskItemElement(task, targetTaskId = null) {

    const item = document.createElement("div");

    item.className = "task-item";

    item.dataset.taskId = task.id;

    if (task.completed) {
        item.classList.add("completed");
    }

    if (targetTaskId === task.id) {
        item.classList.add("task-search-highlight");
    }

    const priorityClass =
        task.priority === "Important"
            ? "important"
            : task.priority === "Study"
                ? "study"
                : "";

    let timerHTML = "";

    if (
        task.focusTime &&
        task.focusTime > 0
    ) {

        const remaining =
            getTaskRemainingSeconds(task);

        let timerText =
            formatSeconds(remaining);

        let timerClass = "";

        if (task.timerRunning) {
            timerClass = "timer-running";
        }

        if (task.timerFinished) {
            timerClass = "timer-finished";
            timerText = "00:00";
        }

        timerHTML = `
            <button
                class="task-timer-btn ${timerClass}"
                onclick="handleTimerButtonClick('${task.id}')"
                ${task.completed ? "disabled" : ""}
            >
                ${timerText}
            </button>

            <button
                class="task-timer-toggle-btn"
                onclick="toggleTaskTimerRunning('${task.id}')"
                aria-label="${task.timerRunning ? "Pause timer" : "Start timer"}"
                ${task.completed || task.timerFinished ? "disabled" : ""}
            >
                ${task.timerRunning ? PAUSE_ICON_SVG : PLAY_ICON_SVG}
            </button>
        `;
    }

    item.innerHTML = `

        <button
            class="task-check-button"
            onclick="toggleTaskDone('${task.id}')"
            aria-label="Complete task"
        >
            <svg viewBox="0 0 24 24" fill="none">
                <path
                    d="M6 12.5L10 16.5L18 8"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />
            </svg>
        </button>

        <div class="task-info">

            <div class="task-name">
                ${escapeHTML(task.text)}
            </div>

            <div class="task-meta">

                <span class="task-priority ${priorityClass}">
                    ${escapeHTML(task.priority)}
                </span>

                ${
                    task.focusTime
                        ? `<span class="task-focus-label">
                            ${formatMinutesLabel(task.focusTime)} focus
                           </span>`
                        : ""
                }

                ${
                    task.breakTime
                        ? `<span class="task-focus-label">
                            ${formatMinutesLabel(task.breakTime)} break
                           </span>`
                        : ""
                }

            </div>

        </div>

        ${timerHTML}

        <button
            class="task-delete-btn"
            onclick="deleteTask('${task.id}')"
            aria-label="Delete task"
        >
            <svg viewBox="0 0 24 24" fill="none">
                <path
                    d="M4 7H20"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linecap="round"
                />
                <path
                    d="M9 7V5H15V7"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linecap="round"
                />
                <path
                    d="M7 7L8 20H16L17 7"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linejoin="round"
                />
                <path
                    d="M10 11V16M14 11V16"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linecap="round"
                />
            </svg>
        </button>
    `;

    return item;
}

/* The "Total" box next to the Delete All / Add Task buttons —
   always the number of ALL tasks, whatever is being shown. */
function updateTotalTasksCount() {

    const total = document.getElementById("tasksTotalCount");

    if (total) {
        total.textContent = String(tasks.length);
    }
}

function loadTasks(targetTaskId = null) {

    if (!isTasksPage()) return;

    const container =
        document.getElementById("tasksListContainer");

    const empty =
        document.getElementById("emptyTasksState");

    const countText =
        document.getElementById("tasksCountText");

    if (!container) return;

    updateTotalTasksCount();

    let visibleTasks = tasks.filter(task => {

        if (currentFilter === "All") return true;

        if (currentFilter === "Completed") return task.completed === true;

        return task.priority === currentFilter;
    });

    /*
     * Search from Home:
     * selected task goes FIRST.
     */
    if (targetTaskId) {

        const targetIndex =
            visibleTasks.findIndex(
                task => task.id === targetTaskId
            );

        if (targetIndex > -1) {

            const targetTask =
                visibleTasks.splice(targetIndex, 1)[0];

            visibleTasks.unshift(targetTask);
        }
    }

    container.innerHTML = "";

    if (countText) {
        countText.textContent =
            `${visibleTasks.length} ${
                visibleTasks.length === 1
                    ? "task"
                    : "tasks"
            }`;
    }

    if (!visibleTasks.length) {

        if (empty) {
            empty.classList.add("active");
        }

        return;

    } else {

        if (empty) {
            empty.classList.remove("active");
        }
    }

    visibleTasks.forEach(task => {

        const item = buildTaskItemElement(task, targetTaskId);

        container.appendChild(item);
    });

    updateAllTaskTimerButtons();

    if (targetTaskId) {

        setTimeout(() => {

            const target =
                container.querySelector(
                    `[data-task-id="${targetTaskId}"]`
                );

            if (target) {
                target.scrollIntoView({
                    behavior: "smooth",
                    block: "center"
                });
            }

        }, 100);
    }
}


/* =========================================================
   TIMER
========================================================= */

function getTaskRemainingSeconds(task) {

    if (!task) return 0;

    if (
        task.timerRunning &&
        task.timerEndAt
    ) {
        return Math.max(
            0,
            Math.ceil(
                (task.timerEndAt - Date.now()) / 1000
            )
        );
    }

    if (task.timerFinished) {
        return 0;
    }

    if (
        task.pausedRemaining !== null &&
        task.pausedRemaining !== undefined
    ) {
        return task.pausedRemaining;
    }

    if (
        task.focusTime &&
        task.focusTime > 0
    ) {
        return task.focusTime * 60;
    }

    return 0;
}


function startGlobalTimerUpdater() {

    if (globalTimerInterval) return;

    globalTimerInterval =
        setInterval(() => {

            updateAllTaskTimers();

        }, 250);
}


function stopGlobalTimerUpdaterIfUnused() {

    const running =
        tasks.some(
            task =>
                task.timerRunning &&
                task.timerEndAt
        );

    if (!running && globalTimerInterval) {

        clearInterval(globalTimerInterval);

        globalTimerInterval = null;
    }
}


function updateAllTaskTimers() {

    let changed = false;

    tasks.forEach(task => {

        if (
            !task.timerRunning ||
            !task.timerEndAt
        ) {
            return;
        }

        const remaining =
            getTaskRemainingSeconds(task);

        if (remaining <= 0) {

            task.timerRunning = false;
            task.timerEndAt = null;
            task.timerFinished = true;
            task.pausedRemaining = null;

            changed = true;

            /*
             * Show failure animation ONLY ONCE.
             */
            if (!task.timerNotified && !task.completed) {

                task.timerNotified = true;

                showTaskResultAnimation(
                    "failure",
                    task
                );
            }
        }
    });

    if (changed) {
        saveTasks();
    }

    updateAllTaskTimerButtons();
    updateOpenTimerDisplay();

    stopGlobalTimerUpdaterIfUnused();
}


function updateAllTaskTimerButtons() {

    tasks.forEach(task => {

        const item =
            document.querySelector(
                `.task-item[data-task-id="${task.id}"]`
            );

        if (!item) return;

        const button =
            item.querySelector(".task-timer-btn");

        if (button) {

            const remaining =
                getTaskRemainingSeconds(task);

            button.textContent =
                formatSeconds(remaining);

            button.classList.toggle(
                "timer-running",
                Boolean(task.timerRunning)
            );

            button.classList.toggle(
                "timer-finished",
                Boolean(task.timerFinished)
            );
        }

        const toggleButton =
            item.querySelector(".task-timer-toggle-btn");

        if (toggleButton) {

            toggleButton.innerHTML =
                task.timerRunning
                    ? PAUSE_ICON_SVG
                    : PLAY_ICON_SVG;

            toggleButton.disabled =
                Boolean(task.completed || task.timerFinished);
        }
    });
}


/* =========================================================
   TIMER TOGGLE BUTTON
   Starts / pauses the countdown by hand.
   Does nothing else.
========================================================= */

function toggleTaskTimerRunning(taskId) {

    const task =
        tasks.find(
            item => item.id === taskId
        );

    if (
        !task ||
        task.completed ||
        task.timerFinished ||
        !task.focusTime
    ) {
        return;
    }

    if (task.timerRunning) {

        /*
         * PAUSE: freeze the remaining time.
         */
        const remaining =
            getTaskRemainingSeconds(task);

        task.timerRunning = false;
        task.timerEndAt = null;
        task.pausedRemaining = remaining;

    } else {

        /*
         * RESUME / START from where it left off.
         */
        const remaining =
            task.pausedRemaining !== null &&
            task.pausedRemaining !== undefined
                ? task.pausedRemaining
                : task.focusTime * 60;

        task.timerRunning = true;
        task.timerEndAt = Date.now() + remaining * 1000;
        task.pausedRemaining = null;

        startGlobalTimerUpdater();
    }

    saveTasks();

    updateAllTaskTimerButtons();

    if (activeTimerTaskId === taskId) {
        updateOpenTimerDisplay();
    }
}


/* =========================================================
   TIMER BUTTON
   Clicking it only OPENS the timer.
   It does NOT start/restart it.
========================================================= */

function handleTimerButtonClick(taskId) {

    const task =
        tasks.find(
            item => item.id === taskId
        );

    if (!task) return;

    openFocusTimer(taskId);
}


function openFocusTimer(taskId) {

    const task =
        tasks.find(
            item => item.id === taskId
        );

    if (!task) return;

    activeTimerTaskId = taskId;

    const modal =
        document.getElementById("focusTimerModal");

    const title =
        document.getElementById("timerTaskTitle");

    const status =
        document.getElementById("timerStatusText");

    if (title) {
        title.textContent = task.text;
    }

    if (status) {

        if (task.completed) {
            status.textContent = "Task completed.";
        } else if (task.timerFinished) {
            status.textContent = "Time is up.";
        } else if (!task.timerRunning) {
            status.textContent = "Timer is paused.";
        } else {
            status.textContent =
                "Your timer is running automatically.";
        }
    }

    if (modal) {
        modal.classList.add("active");
    }

    updateOpenTimerDisplay();
}


function updateOpenTimerDisplay() {

    if (!activeTimerTaskId) return;

    const task =
        tasks.find(
            item => item.id === activeTimerTaskId
        );

    if (!task) return;

    const display =
        document.getElementById("timerDisplay");

    const status =
        document.getElementById("timerStatusText");

    if (display) {

        display.textContent =
            formatSeconds(
                getTaskRemainingSeconds(task)
            );
    }

    if (status) {

        if (task.completed) {
            status.textContent =
                "Task completed.";
        } else if (task.timerFinished) {
            status.textContent =
                "Time is up.";
        } else if (!task.timerRunning) {
            status.textContent =
                "Timer is paused.";
        } else {
            status.textContent =
                "Your timer is running automatically.";
        }
    }
}


function closeFocusTimer() {

    const modal =
        document.getElementById("focusTimerModal");

    if (modal) {
        modal.classList.remove("active");
    }

    activeTimerTaskId = null;
}


/* =========================================================
   DONE
   Stops timer immediately.
   Shows success.
   Starts break afterwards.
========================================================= */

function toggleTaskDone(taskId) {

    const task =
        tasks.find(
            item => item.id === taskId
        );

    if (!task) return;

    /*
     * Already completed:
     * do nothing.
     */
    if (task.completed) return;

    task.completed = true;

    /*
     * STOP TIMER IMMEDIATELY.
     */
    task.timerRunning = false;
    task.timerEndAt = null;
    task.pausedRemaining = null;

    saveTasks();

    if (activeTimerTaskId === taskId) {
        closeFocusTimer();
    }

    updateAllTaskTimerButtons();

    refreshVideoPinnedTaskIfNeeded(taskId);

    showTaskResultAnimation(
        "success",
        task,
        () => {

            loadTasks();

            if (
                task.breakTime &&
                task.breakTime > 0
            ) {
                startBreak(task.breakTime);
            }
        }
    );
}


/* =========================================================
   SUCCESS / FAILURE
========================================================= */

function showTaskResultAnimation(
    type,
    task,
    callback = null
) {

    const overlay =
        document.getElementById("taskResultOverlay");

    const circle =
        document.getElementById("taskResultCircle");

    const title =
        document.getElementById("taskResultTitle");

    const subtitle =
        document.getElementById("taskResultSubtitle");

    const svg =
        document.getElementById("taskResultSvg");

    const path =
        document.getElementById("taskResultPath");

    if (
        !overlay ||
        !circle ||
        !title ||
        !subtitle ||
        !svg ||
        !path
    ) {
        if (callback) callback();
        return;
    }

    circle.classList.remove(
        "success",
        "failure"
    );

    if (type === "success") {

        circle.classList.add("success");

        title.textContent =
            "Task Complete!";

        subtitle.textContent =
            "Great job. Keep going.";

        svg.setAttribute(
            "viewBox",
            "0 0 64 64"
        );

        path.setAttribute(
            "d",
            "M18 33L27 42L47 21"
        );

        /*
         * Confetti.
         */
        if (typeof confetti === "function") {

            setTimeout(() => {

                confetti({
                    particleCount: 170,
                    spread: 100,
                    startVelocity: 38,
                    origin: {
                        x: 0.5,
                        y: 0.52
                    }
                });

            }, 120);

            setTimeout(() => {

                confetti({
                    particleCount: 90,
                    spread: 65,
                    startVelocity: 30,
                    origin: {
                        x: 0.2,
                        y: 0.6
                    }
                });

                confetti({
                    particleCount: 90,
                    spread: 65,
                    startVelocity: 30,
                    origin: {
                        x: 0.8,
                        y: 0.6
                    }
                });

            }, 350);
        }

    } else {

        circle.classList.add("failure");

        title.textContent =
            "Time's Up";

        subtitle.textContent =
            "The focus time ended before you finished.";

        path.setAttribute(
            "d",
            "M20 20L44 44M44 20L20 44"
        );
    }

    /*
     * Restart animation.
     */
    const animation =
        circle.animate(
            [
                {
                    transform: "scale(.2)",
                    opacity: 0
                },
                {
                    transform: "scale(1.12)",
                    opacity: 1
                },
                {
                    transform: "scale(1)",
                    opacity: 1
                }
            ],
            {
                duration: 650,
                easing: "cubic-bezier(.17,.89,.32,1.4)"
            }
        );

    overlay.classList.add("active");

    const duration =
        type === "success"
            ? 1900
            : 1700;

    setTimeout(() => {

        overlay.classList.remove("active");

        if (callback) {
            callback();
        }

    }, duration);
}


/* =========================================================
   BREAK TIMER
========================================================= */

function startBreak(minutes) {

    const overlay =
        document.getElementById("breakOverlay");

    const display =
        document.getElementById("breakDisplay");

    if (!overlay || !display) return;

    breakSeconds =
        Math.max(
            1,
            Math.round(Number(minutes) * 60)
        );

    overlay.classList.add("active");

    updateBreakDisplay();

    clearInterval(breakInterval);

    breakInterval =
        setInterval(() => {

            breakSeconds--;

            updateBreakDisplay();

            if (breakSeconds <= 0) {

                finishBreak();

            }

        }, 1000);
}


function updateBreakDisplay() {

    const display =
        document.getElementById("breakDisplay");

    if (display) {
        display.textContent =
            formatSeconds(breakSeconds);
    }
}


function finishBreak() {

    clearInterval(breakInterval);

    breakInterval = null;
    breakSeconds = 0;

    const overlay =
        document.getElementById("breakOverlay");

    if (overlay) {
        overlay.classList.remove("active");
    }
}


function skipBreak() {

    finishBreak();
}


/* =========================================================
   DELETE
========================================================= */

function deleteTask(taskId) {

    const task =
        tasks.find(
            item => item.id === taskId
        );

    if (!task) return;

    const confirmed =
        confirm(
            `Delete "${task.text}"?`
        );

    if (!confirmed) return;

    if (activeTimerTaskId === taskId) {
        closeFocusTimer();
    }

    tasks =
        tasks.filter(
            item => item.id !== taskId
        );

    saveTasks();

    loadTasks();

    refreshVideoPinnedTaskIfNeeded(taskId);

    stopGlobalTimerUpdaterIfUnused();
}


function deleteAllTasks() {

    if (!tasks.length) {
        alert("There are no tasks to delete.");
        return;
    }

    const confirmed =
        confirm(
            "Delete ALL tasks?\n\nThis cannot be undone."
        );

    if (!confirmed) return;

    closeFocusTimer();
    skipBreak();

    tasks = [];

    saveTasks();

    loadTasks();

    clearVideoActiveTask();

    stopGlobalTimerUpdaterIfUnused();
}


/* =========================================================
   FILTERS
========================================================= */

function filterTasksByCategory(category) {

    currentFilter = category;

    document
        .querySelectorAll(".filter-item")
        .forEach(button => {
            button.classList.remove("active");
        });

    const buttons =
        document.querySelectorAll(".filter-item");

    buttons.forEach(button => {

        if (
            button.textContent
                .trim()
                .toLowerCase()
                .startsWith(
                    category === "All"
                        ? "all"
                        : category.toLowerCase()
                )
        ) {
            button.classList.add("active");
        }
    });

    const title =
        document.getElementById("tasksPageTitle");

    if (title) {

        title.textContent =
            category === "All"
                ? "My Tasks"
                : category + " Tasks";
    }

    loadTasks();

    if (window.innerWidth <= 800) {

        const sidebar =
            document.getElementById("sidebar");

        if (sidebar) {
            sidebar.classList.remove("open");
        }
    }
}


/* =========================================================
   TASK SEARCH (shared by the home hero search
   AND the header nav search)
========================================================= */

function setupTaskSearchInput(inputId, suggestionsId) {

    const input =
        document.getElementById(inputId);

    const suggestions =
        document.getElementById(suggestionsId);

    if (!input || !suggestions) return;

    input.addEventListener(
        "input",
        function () {

            const query =
                this.value
                    .trim()
                    .toLowerCase();

            suggestions.innerHTML = "";

            if (query.length < 2) {

                suggestions.classList.remove("active");

                return;
            }

            const allTasks =
                getTasks();

            const matches =
                allTasks
                    .filter(task =>
                        String(task.text)
                            .toLowerCase()
                            .includes(query)
                    )
                    .slice(0, 7);

            if (!matches.length) {

                suggestions.innerHTML = `
                    <div class="home-search-result">
                        <div class="home-search-result-icon">
                            <svg viewBox="0 0 24 24" fill="none">
                                <circle cx="11" cy="11" r="6.5"
                                    stroke="currentColor"
                                    stroke-width="1.7"/>
                                <path d="M16 16L21 21"
                                    stroke="currentColor"
                                    stroke-width="1.7"
                                    stroke-linecap="round"/>
                            </svg>
                        </div>
                        <div class="home-search-result-text">
                            <strong>No matching tasks</strong>
                            <small>Try another search</small>
                        </div>
                    </div>
                `;

                suggestions.classList.add("active");

                return;
            }

            matches.forEach(task => {

                const result =
                    document.createElement("button");

                result.type = "button";

                result.className =
                    "home-search-result";

                result.innerHTML = `

                    <div class="home-search-result-icon">
                        <svg viewBox="0 0 24 24" fill="none">
                            <rect x="5" y="3" width="14" height="18" rx="3"
                                stroke="currentColor"
                                stroke-width="1.6"/>
                            <path d="M8 9L10 11L13 8"
                                stroke="currentColor"
                                stroke-width="1.6"
                                stroke-linecap="round"
                                stroke-linejoin="round"/>
                            <path d="M8 15H16"
                                stroke="currentColor"
                                stroke-width="1.6"
                                stroke-linecap="round"/>
                        </svg>
                    </div>

                    <div class="home-search-result-text">
                        <strong>
                            ${escapeHTML(task.text)}
                        </strong>
                        <small>
                            ${escapeHTML(task.priority || "Normal")}
                        </small>
                    </div>
                `;

                result.addEventListener(
                    "click",
                    () => {

                        const targetHref =
                            isTasksPage()
                                ? "?taskId=" + encodeURIComponent(task.id)
                                : "pages/tasks.html?taskId=" + encodeURIComponent(task.id);

                        window.location.href = targetHref;

                    }
                );

                suggestions.appendChild(result);
            });

            suggestions.classList.add("active");
        }
    );

    document.addEventListener(
        "click",
        event => {

            if (
                !event.target.closest(`#${inputId}`) &&
                !event.target.closest(`#${suggestionsId}`)
            ) {
                suggestions.classList.remove(
                    "active"
                );
            }
        }
    );
}


/* =========================================================
   TASK PAGE SEARCH
========================================================= */

function searchTasksOnPage(value) {

    const query =
        String(value || "")
            .trim()
            .toLowerCase();

    document
        .querySelectorAll(".task-item")
        .forEach(item => {

            const name =
                item
                    .querySelector(".task-name")
                    ?.textContent
                    .toLowerCase() || "";

            item.style.display =
                !query ||
                name.includes(query)
                    ? ""
                    : "none";
        });
}


/* =========================================================
   HOME -> TASKS TARGET
========================================================= */

function loadTargetTaskFromURL() {

    if (!isTasksPage()) return;

    const params =
        new URLSearchParams(
            window.location.search
        );

    const taskId =
        params.get("taskId");

    if (!taskId) {
        loadTasks();
        return;
    }

    loadTasks(taskId);
}


/* =========================================================
   BACKGROUNDS
   Four built-in wallpapers, plus an "Add" tile so the person
   can upload as many of their own background photos as they
   like. Custom photos are kept in IndexedDB (falls back to a
   session-only in-memory list if that isn't available) and
   the gallery scrolls so every background stays reachable no
   matter how many have been added.
   (The "Backgrounds" button was taken out of the burger menu;
   a background that was chosen earlier still gets applied.)
========================================================= */

const BACKGROUND_THEMES = {

    aurora: {
        label: "Aurora",
        file: "images/backgrounds/aurora.jpg"
    },

    nebula: {
        label: "Nebula",
        file: "images/backgrounds/nebula.jpg"
    },

    sunset: {
        label: "Sunset",
        file: "images/backgrounds/sunset.jpg"
    },

    ocean: {
        label: "Ocean",
        file: "images/backgrounds/ocean.jpg"
    },

    forest: {
        label: "Forest",
        file: "images/backgrounds/forest.jpeg"
    },

    cosmic: {
        label: "Cosmic",
        file: "images/backgrounds/cosmic.jpeg"
    },

    ember: {
        label: "Ember",
        file: "images/backgrounds/ember.jpeg"
    },

    arctic: {
        label: "Arctic",
        file: "images/backgrounds/arctic.jpeg"
    }
};

const BG_DB_NAME = "focusLabAssetsDB";
const BG_DB_VERSION = 1;
const BG_STORE = "customBackgrounds";

let bgDBPromise = null;
let bgDBFailed = false;
let inMemoryBackgrounds = [];
let currentCustomBgObjectURL = null;
let customBgThumbnailURLs = [];

function openBackgroundsDB() {

    if (bgDBFailed) return Promise.reject(new Error("IndexedDB unavailable"));

    if (bgDBPromise) return bgDBPromise;

    bgDBPromise = new Promise((resolve, reject) => {

        if (typeof indexedDB === "undefined") {
            reject(new Error("IndexedDB not supported"));
            return;
        }

        const request = indexedDB.open(BG_DB_NAME, BG_DB_VERSION);

        request.onupgradeneeded = event => {

            const db = event.target.result;

            if (!db.objectStoreNames.contains(BG_STORE)) {
                db.createObjectStore(BG_STORE, { keyPath: "id" });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("IndexedDB blocked"));
    });

    bgDBPromise.catch(() => {
        bgDBFailed = true;
        bgDBPromise = null;
    });

    return bgDBPromise;
}

/*
 * These four helpers are the ones every other background
 * function calls. Each one tries IndexedDB first and — if
 * that ever fails, for any reason — quietly switches to a
 * plain in-memory list for the rest of the session instead
 * of doing nothing. That keeps "Add" always working, even in
 * a browser/context where IndexedDB isn't available.
 */

async function bgAddCustom(file) {

    const id = createTaskId();
    const record = { id, name: file.name, blob: file, addedAt: Date.now() };

    if (!bgDBFailed) {

        try {

            const db = await openBackgroundsDB();

            await new Promise((resolve, reject) => {
                const tx = db.transaction(BG_STORE, "readwrite");
                tx.objectStore(BG_STORE).put(record);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });

            return id;

        } catch {
            bgDBFailed = true;
        }
    }

    inMemoryBackgrounds.push(record);

    return id;
}

async function bgGetAll() {

    if (!bgDBFailed) {

        try {

            const db = await openBackgroundsDB();

            const list = await new Promise((resolve, reject) => {
                const tx = db.transaction(BG_STORE, "readonly");
                const request = tx.objectStore(BG_STORE).getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });

            return list.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));

        } catch {
            bgDBFailed = true;
        }
    }

    return [...inMemoryBackgrounds].sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
}

async function bgGetBlob(id) {

    if (!bgDBFailed) {

        try {

            const db = await openBackgroundsDB();

            const blob = await new Promise((resolve, reject) => {
                const tx = db.transaction(BG_STORE, "readonly");
                const request = tx.objectStore(BG_STORE).get(id);
                request.onsuccess = () => resolve(request.result ? request.result.blob : null);
                request.onerror = () => reject(request.error);
            });

            if (blob) return blob;

        } catch {
            bgDBFailed = true;
        }
    }

    const found = inMemoryBackgrounds.find(item => item.id === id);

    return found ? found.blob : null;
}

async function bgDeleteCustom(id) {

    if (!bgDBFailed) {

        try {

            const db = await openBackgroundsDB();

            await new Promise((resolve, reject) => {
                const tx = db.transaction(BG_STORE, "readwrite");
                tx.objectStore(BG_STORE).delete(id);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });

        } catch {
            bgDBFailed = true;
        }
    }

    inMemoryBackgrounds = inMemoryBackgrounds.filter(item => item.id !== id);
}

function revokeCustomBgThumbnailURLs() {
    customBgThumbnailURLs.forEach(url => URL.revokeObjectURL(url));
    customBgThumbnailURLs = [];
}

function triggerBackgroundUpload() {

    const input = document.getElementById("backgroundFileInput");

    if (input) input.click();
}

async function handleBackgroundFileSelected(event) {

    const files = Array.from(event.target.files || []);

    event.target.value = "";

    if (!files.length) return;

    const validFiles = files.filter(file => file.type.startsWith("image/"));
    const rejectedCount = files.length - validFiles.length;

    for (const file of validFiles) {
        await bgAddCustom(file);
    }

    await renderBackgroundGrid();

    if (rejectedCount > 0) {
        alert(`${rejectedCount} file(s) were skipped — please choose image files.`);
    }
}

async function removeCustomBackground(id, event) {

    if (event) event.stopPropagation();

    const confirmed = confirm("Delete this background?");

    if (!confirmed) return;

    await bgDeleteCustom(id);

    if (localStorage.getItem("focusLab_bgTheme") === `custom:${id}`) {
        localStorage.removeItem("focusLab_bgTheme");
        await applyBackground("aurora");
    }

    await renderBackgroundGrid();
}

/*
 * Rebuilds the whole background gallery: the 4 built-in
 * wallpapers, then every custom photo the person has added,
 * then the "Add" tile. The grid itself scrolls (see main.css)
 * so the list stays reachable no matter how long it gets.
 */
async function renderBackgroundGrid() {

    const grid = document.getElementById("backgroundGrid");

    if (!grid) return;

    const builtInHtml =
        Object.entries(BACKGROUND_THEMES)
            .map(([key, theme]) => `
                <button class="background-option theme-option" data-theme="${key}"
                        onclick="changeBackground('${key}')" aria-label="${theme.label} background">
                    <img src="${getAssetPath(theme.file)}" alt="${theme.label} background">
                </button>
            `)
            .join("");

    const customBackgrounds = await bgGetAll();

    revokeCustomBgThumbnailURLs();

    const customHtml =
        customBackgrounds
            .map(bg => {

                const url = URL.createObjectURL(bg.blob);

                customBgThumbnailURLs.push(url);

                return `
                    <div class="background-option-wrapper">
                        <button class="background-option theme-option" data-theme="custom:${bg.id}"
                                onclick="changeBackground('custom:${bg.id}')" aria-label="${escapeHTML(bg.name)}">
                            <img src="${url}" alt="${escapeHTML(bg.name)}">
                        </button>
                        <button class="bg-delete-btn" onclick="removeCustomBackground('${bg.id}', event)" aria-label="Delete background">
                            ✕
                        </button>
                    </div>
                `;
            })
            .join("");

    const addTileHtml = `
        <button type="button" class="background-option bg-add-option" onclick="triggerBackgroundUpload()">
            <span class="avatar-add-icon">+</span>
            <span class="avatar-add-label">Add</span>
        </button>
    `;

    grid.innerHTML = builtInHtml + customHtml + addTileHtml;

    markSelectedThemeSwatch(getSavedThemeKey());
}

async function openBackgroundModal() {

    const modal =
        document.getElementById("backgroundModal");

    if (modal) {
        modal.classList.add("active");
    }

    await renderBackgroundGrid();
}

function closeBackgroundModal() {

    const modal =
        document.getElementById("backgroundModal");

    if (modal) {
        modal.classList.remove("active");
    }
}

function getSavedThemeKey() {
    return localStorage.getItem("focusLab_bgTheme") || "aurora";
}

async function changeBackground(themeKey) {

    if (!themeKey) return;

    if (!themeKey.startsWith("custom:") && !BACKGROUND_THEMES[themeKey]) return;

    localStorage.setItem("focusLab_bgTheme", themeKey);

    await applyBackground(themeKey);

    markSelectedThemeSwatch(themeKey);

    closeBackgroundModal();
}

function resetBackground() {

    localStorage.removeItem("focusLab_bgTheme");

    const appScreen =
        document.getElementById("app-screen");

    if (appScreen) {
        appScreen.style.backgroundImage = "none";
        appScreen.style.backgroundColor = "#0f172a";
    }

    if (currentCustomBgObjectURL) {
        URL.revokeObjectURL(currentCustomBgObjectURL);
        currentCustomBgObjectURL = null;
    }

    markSelectedThemeSwatch(null);

    closeBackgroundModal();
}

async function applyBackground(themeKey) {

    const appScreen =
        document.getElementById("app-screen");

    if (!appScreen) return;

    let backgroundUrl = null;

    if (themeKey && themeKey.startsWith("custom:")) {

        const id = themeKey.slice("custom:".length);
        const blob = await bgGetBlob(id);

        if (blob) {

            if (currentCustomBgObjectURL) {
                URL.revokeObjectURL(currentCustomBgObjectURL);
            }

            currentCustomBgObjectURL = URL.createObjectURL(blob);
            backgroundUrl = currentCustomBgObjectURL;
        }
    }

    if (!backgroundUrl) {

        const theme =
            BACKGROUND_THEMES[themeKey] ||
            BACKGROUND_THEMES.aurora;

        backgroundUrl = getAssetPath(theme.file);
    }

    appScreen.style.backgroundImage = `
        linear-gradient(rgba(15,23,42,.55), rgba(15,23,42,.82)),
        url("${backgroundUrl}")
    `;

    appScreen.style.backgroundColor = "#0f172a";
}

function markSelectedThemeSwatch(themeKey) {

    document
        .querySelectorAll(".theme-option")
        .forEach(button => {

            button.classList.toggle(
                "selected",
                Boolean(themeKey) && button.dataset.theme === themeKey
            );
        });
}

function loadSavedBackground() {

    const savedTheme =
        localStorage.getItem("focusLab_bgTheme");

    if (savedTheme) {
        applyBackground(savedTheme);
    }
}


/* =========================================================
   MUSIC — lives inside the burger sidebar.
   Opening it hides the sidebar and shows the panel
   in the exact same place; closing it brings the
   sidebar back. Accepts MP3 and MP4 audio files.

   Storage: tracks are kept in IndexedDB first — built for
   large binary data, so a real library (hundreds of songs)
   fits comfortably and survives page changes and restarts.
   If IndexedDB genuinely isn't usable in this browser/
   context, it automatically falls back to localStorage
   instead (the same reliable mechanism the rest of this site
   uses), so "Add Music" never silently fails — that fallback
   just holds fewer songs, since a whole song has to fit in
   the browser's small localStorage quota instead of a
   database built for this.
========================================================= */

/*
 * Any normal song is welcome — not only MP3/MP4. The list below
 * covers what phones and music apps actually save (MP3, M4A/AAC,
 * WAV, OGG/OPUS, FLAC, MP4 ...). A file is also accepted when its
 * own type says it is audio or video, whatever its extension is.
 */
const MUSIC_MIME_BY_EXTENSION = {
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".m4a": "audio/mp4",
    ".m4b": "audio/mp4",
    ".aac": "audio/aac",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".opus": "audio/ogg",
    ".flac": "audio/flac",
    ".weba": "audio/webm",
    ".webm": "audio/webm",
    ".3gp": "audio/3gpp",
    ".3gpp": "audio/3gpp",
    ".aif": "audio/aiff",
    ".aiff": "audio/aiff",
    ".caf": "audio/x-caf",
    ".mka": "audio/x-matroska"
};

const ACCEPTED_MUSIC_EXTENSIONS = Object.keys(MUSIC_MIME_BY_EXTENSION);

/*
 * What the "Add Music" file picker offers. "audio/*" makes phones
 * open their normal audio browser (Downloads, Drive, music-app
 * folders, SD card ...) instead of only videos; the extensions
 * are listed too so MP4 and the other formats stay selectable.
 */
const MUSIC_FILE_INPUT_ACCEPT =
    "audio/*,video/mp4," + ACCEPTED_MUSIC_EXTENSIONS.join(",");

function configureMusicFileInput() {

    const fileInput = document.getElementById("musicFileInput");

    if (!fileInput) return;

    fileInput.setAttribute("accept", MUSIC_FILE_INPUT_ACCEPT);
    fileInput.multiple = true;
}

function getFileExtension(name) {

    const lower = String(name || "").toLowerCase();
    const dot = lower.lastIndexOf(".");

    return dot >= 0 ? lower.slice(dot) : "";
}

/*
 * Gives the saved song a proper audio type. Some phones hand
 * over songs with an empty type, which can make playback fail
 * later — so when the type is missing, it is set from the extension.
 */
function getMusicMimeType(file) {

    const type = String(file.type || "").toLowerCase();

    if (type.startsWith("audio/") || type.startsWith("video/")) {
        return type;
    }

    return MUSIC_MIME_BY_EXTENSION[getFileExtension(file.name)] || "audio/mpeg";
}

const MUSIC_DB_NAME = "focusLabMusicDB";
const MUSIC_DB_VERSION = 1;
const MUSIC_META_STORE = "trackMeta";
const MUSIC_BLOB_STORE = "trackBlobs";

let currentMusicObjectURL = null;
let musicDBPromise = null;
let musicDBFailed = false;

function openMusicDB() {

    if (musicDBFailed) return Promise.reject(new Error("IndexedDB unavailable"));

    if (musicDBPromise) return musicDBPromise;

    musicDBPromise = new Promise((resolve, reject) => {

        if (typeof indexedDB === "undefined") {
            reject(new Error("IndexedDB not supported"));
            return;
        }

        const request =
            indexedDB.open(MUSIC_DB_NAME, MUSIC_DB_VERSION);

        request.onupgradeneeded = event => {

            const db = event.target.result;

            if (!db.objectStoreNames.contains(MUSIC_META_STORE)) {
                db.createObjectStore(MUSIC_META_STORE, { keyPath: "id" });
            }

            if (!db.objectStoreNames.contains(MUSIC_BLOB_STORE)) {
                db.createObjectStore(MUSIC_BLOB_STORE, { keyPath: "id" });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("IndexedDB blocked"));
    });

    /*
     * If opening the database ever fails, don't keep re-using
     * this same failed promise forever — mark it unavailable
     * so every helper below falls back to localStorage instead
     * for the rest of this page's lifetime.
     */
    musicDBPromise.catch(() => {
        musicDBFailed = true;
        musicDBPromise = null;
    });

    return musicDBPromise;
}

function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

function dataURLToBlob(dataUrl) {

    const [header, base64] = dataUrl.split(",");
    const mimeMatch = header.match(/data:(.*);base64/);
    const mime = mimeMatch ? mimeMatch[1] : "audio/mpeg";

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return new Blob([bytes], { type: mime });
}

function getMusicFallbackList() {
    try {
        const stored = localStorage.getItem("focusLab_musicFallbackList");
        const parsed = stored ? JSON.parse(stored) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveMusicFallbackList(list) {
    localStorage.setItem("focusLab_musicFallbackList", JSON.stringify(list));
}

/*
 * These four helpers are the ones the rest of the music
 * player calls. Each tries IndexedDB first (large capacity,
 * survives reloads/navigation) and — only if that genuinely
 * isn't usable — falls back to localStorage instead, which
 * still persists, just with far less room.
 */

async function musicAddTrack(meta, blob) {

    if (!musicDBFailed) {

        try {

            const db = await openMusicDB();

            await new Promise((resolve, reject) => {

                const tx = db.transaction(
                    [MUSIC_META_STORE, MUSIC_BLOB_STORE],
                    "readwrite"
                );

                tx.objectStore(MUSIC_META_STORE).put(meta);
                tx.objectStore(MUSIC_BLOB_STORE).put({ id: meta.id, blob });

                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });

            return;

        } catch {
            musicDBFailed = true;
        }
    }

    try {

        const dataUrl = await blobToDataURL(blob);
        const list = getMusicFallbackList();

        list.push({ id: meta.id, name: meta.name, addedAt: meta.addedAt, dataUrl });

        saveMusicFallbackList(list);

    } catch {

        alert(`"${meta.name}" couldn't be saved permanently — your browser's storage is full. Try removing a song first, or use a smaller/fewer files.`);
    }
}

async function musicGetAllMeta() {

    if (!musicDBFailed) {

        try {

            const db = await openMusicDB();

            const list = await new Promise((resolve, reject) => {

                const tx = db.transaction(MUSIC_META_STORE, "readonly");
                const request = tx.objectStore(MUSIC_META_STORE).getAll();

                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });

            return list.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));

        } catch {
            musicDBFailed = true;
        }
    }

    return getMusicFallbackList()
        .map(track => ({ id: track.id, name: track.name, addedAt: track.addedAt }))
        .sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
}

async function musicGetBlob(trackId) {

    if (!musicDBFailed) {

        try {

            const db = await openMusicDB();

            const blob = await new Promise((resolve, reject) => {

                const tx = db.transaction(MUSIC_BLOB_STORE, "readonly");
                const request = tx.objectStore(MUSIC_BLOB_STORE).get(trackId);

                request.onsuccess = () =>
                    resolve(request.result ? request.result.blob : null);

                request.onerror = () => reject(request.error);
            });

            if (blob) return blob;

        } catch {
            musicDBFailed = true;
        }
    }

    const fallbackTrack = getMusicFallbackList().find(track => track.id === trackId);

    return fallbackTrack ? dataURLToBlob(fallbackTrack.dataUrl) : null;
}

async function musicDeleteTrack(trackId) {

    if (!musicDBFailed) {

        try {

            const db = await openMusicDB();

            await new Promise((resolve, reject) => {

                const tx = db.transaction(
                    [MUSIC_META_STORE, MUSIC_BLOB_STORE],
                    "readwrite"
                );

                tx.objectStore(MUSIC_META_STORE).delete(trackId);
                tx.objectStore(MUSIC_BLOB_STORE).delete(trackId);

                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });

        } catch {
            musicDBFailed = true;
        }
    }

    const fallbackList = getMusicFallbackList();
    const filteredFallback = fallbackList.filter(track => track.id !== trackId);

    if (filteredFallback.length !== fallbackList.length) {
        saveMusicFallbackList(filteredFallback);
    }
}


function getMusicManifest() {
    return typeof MUSIC_MANIFEST !== "undefined" && Array.isArray(MUSIC_MANIFEST)
        ? MUSIC_MANIFEST
        : [];
}

function getMusicAssetPath(file) {
    return isInPagesFolder() ? "../music/" + file : "music/" + file;
}

/*
 * Combines the owner-managed permanent songs (music/manifest.js)
 * with whatever the visitor has added themselves, so both show
 * up together in one list. Permanent songs always come first and
 * can't be deleted from the site — only uploaded ones can.
 */
async function getMergedMusicList() {

    const permanentTracks = getMusicManifest().map(entry => ({
        id: "permanent:" + encodeURIComponent(entry.file),
        name: entry.name,
        permanent: true
    }));

    const uploadedTracks = (await musicGetAllMeta())
        .map(track => ({ ...track, permanent: false }));

    return permanentTracks.concat(uploadedTracks);
}

function toggleMusicPanel() {

    const panel =
        document.getElementById("musicSidebarPanel");

    if (!panel) return;

    if (panel.classList.contains("active")) {
        closeMusicSidebarPanel();
        return;
    }

    const sidebar =
        document.getElementById("sidebar");

    if (sidebar) {
        sidebar.classList.add("panel-hidden");
    }

    panel.classList.remove("panel-hidden");
    panel.classList.add("active");

    renderMusicList();
}

function closeMusicSidebarPanel() {

    const sidebar =
        document.getElementById("sidebar");

    const panel =
        document.getElementById("musicSidebarPanel");

    if (panel) {
        panel.classList.remove("active");
        panel.classList.add("panel-hidden");
    }

    if (sidebar) {
        sidebar.classList.remove("panel-hidden");
    }
}

function triggerAddMusic() {

    const fileInput =
        document.getElementById("musicFileInput");

    if (fileInput) {
        fileInput.click();
    }
}

function isAcceptedMusicFile(file) {

    const type = String(file.type || "").toLowerCase();

    const hasAcceptedExtension =
        ACCEPTED_MUSIC_EXTENSIONS.includes(getFileExtension(file.name));

    const hasAcceptedType =
        type.startsWith("audio/") ||
        type === "video/mp4";

    return hasAcceptedExtension || hasAcceptedType;
}

/*
 * Accepts one, a few, or well over a thousand files at once
 * (the file input has the "multiple" attribute) and stores
 * every valid audio file straight into IndexedDB as a Blob —
 * no size-limited base64 copy, no cap on how many songs the
 * playlist can hold.
 */
async function handleMusicFileSelected(event) {

    const files = Array.from(event.target.files || []);

    event.target.value = "";

    if (!files.length) return;

    const accepted = files.filter(isAcceptedMusicFile);
    const rejectedCount = files.length - accepted.length;

    if (!accepted.length) {
        alert("Please choose audio files (MP3, M4A, WAV, OGG, FLAC, MP4 ...).");
        return;
    }

    let firstNewTrackId = null;
    let addedAt = Date.now();

    for (const file of accepted) {

        const id = createTaskId();

        const mimeType = getMusicMimeType(file);

        const blob =
            file.type === mimeType
                ? file
                : file.slice(0, file.size, mimeType);

        await musicAddTrack(
            { id, name: file.name, addedAt: addedAt++ },
            blob
        );

        if (!firstNewTrackId) {
            firstNewTrackId = id;
        }
    }

    await renderMusicList();

    if (rejectedCount > 0) {
        alert(`${rejectedCount} file(s) were skipped — they aren't audio files.`);
    }

    const isPlaying =
        localStorage.getItem("focusLab_musicPlaying") === "true";

    if (!isPlaying && firstNewTrackId) {
        await playMusicTrack(firstNewTrackId);
    }
}

async function renderMusicList() {

    const container =
        document.getElementById("musicListContainer");

    if (!container) return;

    const list = await getMergedMusicList();

    const currentId =
        localStorage.getItem("focusLab_musicCurrentId");

    const isPlaying =
        localStorage.getItem("focusLab_musicPlaying") === "true";

    if (!list.length) {

        container.innerHTML =
            `<p class="music-empty-text">No music added yet.</p>`;

        return;
    }

    container.innerHTML = `
        <p class="music-hint">${list.length} song${list.length === 1 ? "" : "s"} in your library</p>
    ` +
        list.map(track => {

            const playing =
                track.id === currentId && isPlaying;

            const deleteButtonHTML = track.permanent
                ? ""
                : `
                    <button
                        class="music-item-delete-btn"
                        onclick="deleteMusicItem('${track.id}')"
                        aria-label="Delete track"
                    >
                        ✕
                    </button>
                `;

            return `
                <div class="music-list-item">
                    <button
                        class="music-item-play-btn"
                        onclick="toggleMusicTrack('${track.id}')"
                        aria-label="${playing ? "Pause" : "Play"}"
                    >
                        ${playing ? PAUSE_ICON_SVG : PLAY_ICON_SVG}
                    </button>
                    <span class="music-item-name">
                        ${escapeHTML(track.name)}
                    </span>
                    ${
                        track.permanent
                            ? `<span class="music-item-permanent-badge" title="Always available on this site">Site song</span>`
                            : ""
                    }
                    ${deleteButtonHTML}
                </div>
            `;

        }).join("");
}

async function toggleMusicTrack(trackId) {

    const currentId =
        localStorage.getItem("focusLab_musicCurrentId");

    const isPlaying =
        localStorage.getItem("focusLab_musicPlaying") === "true";

    if (currentId === trackId && isPlaying) {
        pauseMusic();
    } else {
        await playMusicTrack(trackId);
    }

    renderMusicList();
}

async function playMusicTrack(trackId) {

    stopCurrentAudioElement();

    if (trackId.startsWith("permanent:")) {

        const file = decodeURIComponent(trackId.slice("permanent:".length));

        currentMusicAudioEl = new Audio(getMusicAssetPath(file));

    } else {

        const blob = await musicGetBlob(trackId);

        if (!blob) return;

        const url = URL.createObjectURL(blob);

        currentMusicObjectURL = url;
        currentMusicAudioEl = new Audio(url);
    }

    currentMusicAudioEl.loop = true;

    /* Respect the Sound switch in Settings. */
    currentMusicAudioEl.muted = isSoundMuted();

    watchMusicPlaybackError(currentMusicAudioEl);

    currentMusicAudioEl
        .play()
        .catch(() => {
            /* Autoplay may be blocked until the user interacts. */
        });

    localStorage.setItem("focusLab_musicCurrentId", trackId);
    localStorage.setItem("focusLab_musicPlaying", "true");
    localStorage.setItem("focusLab_musicPosition", "0");
    localStorage.setItem("focusLab_musicStartedAt", String(Date.now()));

    startMusicPositionSaver();
}

/*
 * If the browser can't decode a song (a rare audio format),
 * say so once instead of failing silently.
 */
function watchMusicPlaybackError(audioEl) {

    audioEl.addEventListener("error", () => {

        if (audioEl !== currentMusicAudioEl) return;

        localStorage.setItem("focusLab_musicPlaying", "false");

        stopMusicPositionSaver();

        renderMusicList();

        alert("This song's format can't be played by your browser. Try an MP3 or M4A version of it.");

    }, { once: true });
}

function pauseMusic() {

    if (currentMusicAudioEl) {

        localStorage.setItem(
            "focusLab_musicPosition",
            String(currentMusicAudioEl.currentTime || 0)
        );

        currentMusicAudioEl.pause();
    }

    localStorage.setItem("focusLab_musicPlaying", "false");

    stopMusicPositionSaver();
}

function stopMusic() {

    stopCurrentAudioElement();

    localStorage.setItem("focusLab_musicPlaying", "false");
    localStorage.setItem("focusLab_musicPosition", "0");

    stopMusicPositionSaver();

    renderMusicList();
}

function stopCurrentAudioElement() {

    if (currentMusicAudioEl) {

        try {
            currentMusicAudioEl.pause();
        } catch {}

        currentMusicAudioEl = null;
    }

    if (currentMusicObjectURL) {

        URL.revokeObjectURL(currentMusicObjectURL);

        currentMusicObjectURL = null;
    }
}

async function deleteMusicItem(trackId) {

    /* Permanent (site-provided) songs can't be removed from
       the site itself — there's no delete button for them,
       but guard here too in case this is ever called directly. */
    if (trackId.startsWith("permanent:")) return;

    await musicDeleteTrack(trackId);

    const currentId =
        localStorage.getItem("focusLab_musicCurrentId");

    if (currentId === trackId) {
        stopMusic();
        localStorage.removeItem("focusLab_musicCurrentId");
    }

    renderMusicList();
}

function startMusicPositionSaver() {

    if (musicPositionSaveInterval) return;

    musicPositionSaveInterval =
        setInterval(() => {

            if (
                currentMusicAudioEl &&
                !currentMusicAudioEl.paused
            ) {
                localStorage.setItem(
                    "focusLab_musicPosition",
                    String(currentMusicAudioEl.currentTime || 0)
                );

                localStorage.setItem(
                    "focusLab_musicStartedAt",
                    String(Date.now())
                );
            }

        }, 2000);
}

function stopMusicPositionSaver() {

    if (musicPositionSaveInterval) {
        clearInterval(musicPositionSaveInterval);
        musicPositionSaveInterval = null;
    }
}

/*
 * Resumes playback on every page load so the music
 * keeps going across navigation and reloads.
 */
async function initMusicPlayback() {

    const isPlaying =
        localStorage.getItem("focusLab_musicPlaying") === "true";

    if (!isPlaying) return;

    const trackId =
        localStorage.getItem("focusLab_musicCurrentId");

    if (!trackId) return;

    let audioSrc = null;

    if (trackId.startsWith("permanent:")) {

        const file = decodeURIComponent(trackId.slice("permanent:".length));

        audioSrc = getMusicAssetPath(file);

    } else {

        const blob = await musicGetBlob(trackId);

        if (!blob) return;

        audioSrc = URL.createObjectURL(blob);
        currentMusicObjectURL = audioSrc;
    }

    const savedPosition =
        Number(localStorage.getItem("focusLab_musicPosition") || 0);

    const startedAt =
        Number(localStorage.getItem("focusLab_musicStartedAt") || Date.now());

    const elapsed =
        Math.max(0, (Date.now() - startedAt) / 1000);

    let resumeAt = savedPosition + elapsed;

    currentMusicAudioEl = new Audio(audioSrc);
    currentMusicAudioEl.loop = true;

    /* Respect the Sound switch in Settings. */
    currentMusicAudioEl.muted = isSoundMuted();

    currentMusicAudioEl.addEventListener(
        "loadedmetadata",
        () => {

            if (
                currentMusicAudioEl.duration &&
                resumeAt >= currentMusicAudioEl.duration
            ) {
                resumeAt = resumeAt % currentMusicAudioEl.duration;
            }

            currentMusicAudioEl.currentTime = resumeAt;

            currentMusicAudioEl
                .play()
                .catch(() => {});
        }
    );

    startMusicPositionSaver();
}


/* =========================================================
   VIDEOS PAGE
   The video library is owner-managed, not visitor-managed:
   there is no upload or delete button on this page. Videos
   come from a YouTube playlist listed in videos/manifest.js
   (Lofi Study, Anime Study, or anything else) — each entry is
   just a YouTube video ID or link. To add a video: add one
   line to that manifest — see that file for the exact format.
   Visitors can only browse, search, and play what's listed
   there. Playback uses YouTube's own IFrame Player API, so
   the usual play/pause/volume/fullscreen controls are
   YouTube's native ones.
========================================================= */

function isVideosPage() {
    return !!document.getElementById("videoGridContainer");
}

function getVideoManifest() {
    return typeof VIDEO_MANIFEST !== "undefined" && Array.isArray(VIDEO_MANIFEST)
        ? VIDEO_MANIFEST
        : [];
}

/*
 * Accepts a bare 11-character YouTube ID, or a full/short
 * YouTube URL in any common form, and returns just the ID —
 * so the manifest can hold whichever is easiest to paste.
 */
function extractYoutubeId(value) {

    const raw = String(value || "").trim();

    if (/^[\w-]{11}$/.test(raw)) {
        return raw;
    }

    const patterns = [
        /youtu\.be\/([\w-]{11})/,
        /youtube\.com\/watch\?v=([\w-]{11})/,
        /youtube\.com\/embed\/([\w-]{11})/,
        /youtube\.com\/shorts\/([\w-]{11})/
    ];

    for (const pattern of patterns) {
        const match = raw.match(pattern);
        if (match) return match[1];
    }

    return raw;
}

function getYoutubeThumbnailURL(youtubeId) {
    return `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
}

const VIDEO_THUMB_ICON_SVG = `
    <svg viewBox="0 0 24 24" fill="none">
        <path d="M9 8L16 12L9 16V8Z" fill="currentColor"/>
    </svg>
`;

const FULLSCREEN_ENTER_ICON_SVG = `
    <svg viewBox="0 0 24 24" fill="none">
        <path d="M4 9V5C4 4.45 4.45 4 5 4H9M15 4H19C19.55 4 20 4.45 20 5V9M20 15V19C20 19.55 19.55 20 19 20H15M9 20H5C4.45 20 4 19.55 4 19V15"
              stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
`;

const FULLSCREEN_EXIT_ICON_SVG = `
    <svg viewBox="0 0 24 24" fill="none">
        <path d="M9 4V8C9 8.55 8.55 9 8 9H4M15 4V8C15 8.55 15.45 9 16 9H20M20 15H16C15.45 15 15 15.45 15 16V20M4 15H8C8.55 15 9 15.45 9 16V20"
              stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
`;

function renderVideoGrid() {

    const container = document.getElementById("videoGridContainer");
    const empty = document.getElementById("emptyVideosState");

    if (!container) return;

    const videos = getVideoManifest();

    if (empty) {
        empty.classList.toggle("active", videos.length === 0);
    }

    container.innerHTML = videos.map(video => {

        const youtubeId = extractYoutubeId(video.youtubeId || video.file || "");

        return `
            <div class="video-card" data-video-name="${escapeHTML(video.name.toLowerCase())}">
                <button class="video-card-thumb" onclick="openVideoPlayer('${youtubeId}', '${escapeHTML(video.name)}')" aria-label="Play ${escapeHTML(video.name)}">
                    <img src="${getYoutubeThumbnailURL(youtubeId)}" alt="${escapeHTML(video.name)}" loading="lazy">
                    <span class="video-card-play-badge">${VIDEO_THUMB_ICON_SVG}</span>
                </button>
                <div class="video-card-info">
                    <span class="video-card-name">${escapeHTML(video.name)}</span>
                </div>
            </div>
        `;
    }).join("");

    searchVideosOnPage(document.getElementById("videoSearchInput")?.value || "");
}

function searchVideosOnPage(value) {

    const query = String(value || "").trim().toLowerCase();

    document
        .querySelectorAll(".video-card[data-video-name]")
        .forEach(card => {

            const name = card.dataset.videoName || "";

            card.style.display =
                !query || name.includes(query) ? "" : "none";
        });
}


/* --- YouTube IFrame Player API --- */

let youtubePlayer = null;
let youtubeApiReady = false;
let youtubeApiLoading = false;
let pendingYoutubeId = null;

/*
 * The YouTube API calls this exact global function name once
 * it has finished loading — it has to live on window.
 */
window.onYouTubeIframeAPIReady = function () {

    youtubeApiReady = true;

    if (pendingYoutubeId) {
        createYoutubePlayer(pendingYoutubeId);
        pendingYoutubeId = null;
    }
};

function loadYoutubeIframeAPI() {

    if (youtubeApiReady || youtubeApiLoading) return;

    youtubeApiLoading = true;

    const script = document.createElement("script");

    script.src = "https://www.youtube.com/iframe_api";

    document.head.appendChild(script);
}

function createYoutubePlayer(youtubeId) {

    const host = document.getElementById("videoPlayerEl");

    if (!host || typeof YT === "undefined" || !YT.Player) return;

    if (youtubePlayer && youtubePlayer.loadVideoById) {

        youtubePlayer.loadVideoById(youtubeId);
        youtubePlayer.playVideo();
        return;
    }

    youtubePlayer = new YT.Player("videoPlayerEl", {

        videoId: youtubeId,

        playerVars: {
            autoplay: 1,
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            fs: 0
        },

        events: {
            onReady: event => {

                /* Respect the Sound switch in Settings. */
                applySoundState();

                event.target.playVideo();
            }
        }
    });
}

function openVideoPlayer(youtubeId, name) {

    const modal = document.getElementById("videoPlayerModal");
    const title = document.getElementById("videoPlayerTitle");

    if (!modal) return;

    if (title) {
        title.textContent = name || "";
    }

    modal.classList.add("active");

    setupVideoUiAutoHide();

    showVideoUi();

    if (youtubeApiReady) {
        createYoutubePlayer(youtubeId);
    } else {
        pendingYoutubeId = youtubeId;
        loadYoutubeIframeAPI();
    }

    clearVideoActiveTask();
}

function closeVideoPlayer() {

    const modal = document.getElementById("videoPlayerModal");

    /* Only leave full-screen if it is the video that is
       full-screen — not the whole-site full-screen switched
       on from Settings. */
    const box = document.querySelector(".video-player-overlay .video-player-box");

    if (box && getFullscreenElement() === box) {

        const exit = document.exitFullscreen
            ? document.exitFullscreen()
            : (document.webkitExitFullscreen ? document.webkitExitFullscreen() : null);

        if (exit && typeof exit.catch === "function") {
            exit.catch(() => {});
        }
    }

    if (modal) {
        modal.classList.remove("active");
        modal.classList.remove("video-ui-hidden");
    }

    clearTimeout(videoUiHideTimer);

    if (youtubePlayer && youtubePlayer.stopVideo) {
        youtubePlayer.stopVideo();
    }

    pendingYoutubeId = null;

    hideVideoTaskSuggestions();
}


/*
 * Our own full-screen control — used instead of YouTube's
 * built-in one (disabled above via playerVars.fs) so that
 * going full-screen takes the whole .video-player-box with
 * it, task card included. The search bar is hidden while
 * full-screen (see the :fullscreen rule in main.css); the
 * pinned task card is deliberately left alone so it keeps
 * showing on top of the video the whole time.
 */
function toggleVideoFullscreen() {

    const box = document.querySelector(".video-player-overlay .video-player-box");

    if (!box) return;

    if (getFullscreenElement() === box) {

        const exit = document.exitFullscreen
            ? document.exitFullscreen()
            : (document.webkitExitFullscreen ? document.webkitExitFullscreen() : null);

        if (exit && typeof exit.catch === "function") {
            exit.catch(() => {});
        }

    } else if (box.requestFullscreen) {
        box.requestFullscreen().catch(() => {});
    }
}

document.addEventListener("fullscreenchange", () => {

    const button = document.getElementById("videoFullscreenToggleBtn");

    if (!button) return;

    const box = document.querySelector(".video-player-overlay .video-player-box");

    const isFullscreen = Boolean(box) && getFullscreenElement() === box;

    button.innerHTML = isFullscreen ? FULLSCREEN_EXIT_ICON_SVG : FULLSCREEN_ENTER_ICON_SVG;
    button.setAttribute("aria-label", isFullscreen ? "Exit full screen" : "Full screen");
});


/* --- Video controls that hide when the mouse is still ---
   Like YouTube: moving the mouse (or touching the screen)
   brings the search bar and the close button back; if nothing
   moves for a moment they fade away. They stay while the
   person is typing in the search box or choosing a task.
   The pinned task card is never hidden. */

const VIDEO_UI_IDLE_MS = 2500;

let videoUiHideTimer = null;
let videoLastMouseX = -1;
let videoLastMouseY = -1;

function showVideoUi() {

    const modal = document.getElementById("videoPlayerModal");

    if (!modal) return;

    modal.classList.remove("video-ui-hidden");

    clearTimeout(videoUiHideTimer);

    videoUiHideTimer = setTimeout(hideVideoUiIfIdle, VIDEO_UI_IDLE_MS);
}

function hideVideoUiIfIdle() {

    const modal = document.getElementById("videoPlayerModal");

    if (!modal || !modal.classList.contains("active")) return;

    const input = document.getElementById("videoTaskSearchInput");
    const suggestions = document.getElementById("videoTaskSearchSuggestions");

    const busy =
        (input && document.activeElement === input) ||
        (suggestions && suggestions.classList.contains("active"));

    if (busy) {
        videoUiHideTimer = setTimeout(hideVideoUiIfIdle, VIDEO_UI_IDLE_MS);
        return;
    }

    modal.classList.add("video-ui-hidden");
}

function setupVideoUiAutoHide() {

    const modal = document.getElementById("videoPlayerModal");

    if (!modal || modal.dataset.autoHide) return;

    modal.dataset.autoHide = "1";

    /* Mouse: only a real movement counts (a few pixels), so the
       browser's own "fake" moves do not bring the bar back. */
    modal.addEventListener("mousemove", event => {

        const moved =
            Math.abs(event.clientX - videoLastMouseX) > 2 ||
            Math.abs(event.clientY - videoLastMouseY) > 2;

        videoLastMouseX = event.clientX;
        videoLastMouseY = event.clientY;

        if (moved) showVideoUi();

    }, { passive: true });

    /* Touch screens: a tap shows the controls. */
    ["pointerdown", "touchstart"].forEach(name =>
        modal.addEventListener(name, showVideoUi, { passive: true })
    );
}


/* --- "Bring your task into the video" search overlay ---
   Lets the person search their task list from inside the
   full-screen player and pin the one they're working on as
   a small overlay card while they watch. */

let currentVideoTaskId = null;

function handleVideoTaskSearchInput(value) {

    const suggestions = document.getElementById("videoTaskSearchSuggestions");

    if (!suggestions) return;

    const query = String(value || "").trim().toLowerCase();

    suggestions.innerHTML = "";

    if (query.length < 1) {
        suggestions.classList.remove("active");
        return;
    }

    const matches = tasks
        .filter(task => String(task.text).toLowerCase().includes(query))
        .slice(0, 6);

    if (!matches.length) {

        suggestions.innerHTML = `
            <div class="home-search-result">
                <div class="home-search-result-text">
                    <strong>No matching tasks</strong>
                </div>
            </div>
        `;

        suggestions.classList.add("active");

        return;
    }

    suggestions.innerHTML = matches.map(task => `
        <button type="button" class="home-search-result" onclick="selectVideoTask('${task.id}')">
            <div class="home-search-result-text">
                <strong>${escapeHTML(task.text)}</strong>
                <small>${escapeHTML(task.priority || "Normal")}</small>
            </div>
        </button>
    `).join("");

    suggestions.classList.add("active");
}

function selectVideoTask(taskId) {

    const task = tasks.find(item => item.id === taskId);

    if (!task) return;

    currentVideoTaskId = taskId;

    renderVideoActiveTaskCard();

    const input = document.getElementById("videoTaskSearchInput");

    if (input) input.value = "";

    hideVideoTaskSuggestions();
}

/*
 * Renders the pinned task using the exact same row markup as
 * the Tasks page (buildTaskItemElement) — same time display,
 * priority badge, complete button, timer play/pause, and
 * delete button. Because it carries the real data-task-id,
 * the normal update loop (updateAllTaskTimerButtons) keeps its
 * countdown ticking automatically, same as on the Tasks page.
 */
function renderVideoActiveTaskCard() {

    const card = document.getElementById("videoActiveTaskCard");
    const host = document.getElementById("videoActiveTaskItemHost");

    if (!card || !host) return;

    const task = tasks.find(item => item.id === currentVideoTaskId);

    if (!task) {
        clearVideoActiveTask();
        return;
    }

    host.innerHTML = "";
    host.appendChild(buildTaskItemElement(task));

    card.classList.add("active");

    if (task.timerRunning && task.timerEndAt) {
        startGlobalTimerUpdater();
    }
}

/*
 * Called after any task edit (complete / delete / delete all)
 * so the pinned card in the video player never goes stale —
 * it re-renders if the task changed, or clears if it's gone.
 */
function refreshVideoPinnedTaskIfNeeded(taskId) {

    if (currentVideoTaskId !== taskId) return;

    renderVideoActiveTaskCard();
}

function clearVideoActiveTask() {

    currentVideoTaskId = null;

    const card = document.getElementById("videoActiveTaskCard");
    const host = document.getElementById("videoActiveTaskItemHost");

    if (card) card.classList.remove("active");

    if (host) host.innerHTML = "";
}

function hideVideoTaskSuggestions() {

    const suggestions = document.getElementById("videoTaskSearchSuggestions");

    if (suggestions) {
        suggestions.classList.remove("active");
    }
}


/* =========================================================
   KEYBOARD
========================================================= */

document.addEventListener(
    "keydown",
    event => {

        if (event.key === "Escape") {

            closeAddTaskModal();
            closeBackgroundModal();
            closeFocusTimer();
            closeAvatarEditModal();
            closeSettingsModal();
            closeVideoPlayer();
        }

        if (
            event.key === "Enter" &&
            document.activeElement?.id ===
                "taskTextInput"
        ) {
            createTask();
        }
    }
);


/* =========================================================
   INIT
========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    () => {

        applySiteTheme();


        applyAuthView();

        loadUserInfo();

        tasks = getTasks();

        if (document.getElementById("app-screen")) {
            loadSavedBackground();
        }

        if (isTasksPage()) {

            normalizeTasks();

            loadTargetTaskFromURL();

            if (
                tasks.some(
                    task =>
                        task.timerRunning &&
                        task.timerEndAt
                )
            ) {
                startGlobalTimerUpdater();
            }

            renderMusicList();
        }

        if (isVideosPage()) {
            renderVideoGrid();
        }

        initTimeInputs();

        configureMusicFileInput();

        updateSettingsUI();

        setupNotebookPage();

        setupTaskSearchInput("homeTaskSearch", "homeTaskSearchSuggestions");
        setupTaskSearchInput("navTaskSearch", "navTaskSearchSuggestions");

        initMusicPlayback();

        /*
         * Close modal by clicking outside.
         */
        document
            .querySelectorAll(".modal-overlay")
            .forEach(modal => {

                modal.addEventListener(
                    "click",
                    event => {

                        if (
                            event.target === modal
                        ) {
                            modal.classList.remove(
                                "active"
                            );
                        }
                    }
                );
            });
    }
);


/* =========================================================
   COLOUR MODES
   Three modes, remembered between pages:
     - "light"  : white / light grey
     - "dark"   : black
     - "focus"  : the normal FocusLab colours (dark navy blue)
   The mode is a data-theme attribute on <html>; main.css
   restyles the pages for "light" and "dark". Every page also
   sets the attribute from a tiny script in its <head> so there
   is no flash of the wrong colours while the page loads.
========================================================= */

const SITE_THEMES = ["light", "dark", "focus"];

function getSiteTheme() {

    const saved = localStorage.getItem("focusLab_theme");

    return SITE_THEMES.includes(saved) ? saved : "focus";
}

function applySiteTheme() {

    const theme = getSiteTheme();

    document.documentElement.setAttribute("data-theme", theme);

    notifyNotebookTheme(theme);
    updateThemeUI();
}

function setSiteTheme(theme) {

    if (!SITE_THEMES.includes(theme)) return;

    localStorage.setItem("focusLab_theme", theme);

    applySiteTheme();
}

function updateThemeUI() {

    const theme = getSiteTheme();

    document.querySelectorAll("[data-theme-option]").forEach(button => {

        const isOn = button.dataset.themeOption === theme;

        button.classList.toggle("on", isOn);
        button.setAttribute("aria-pressed", String(isOn));
    });
}

/* The notebook lives inside an <iframe>, so it is told about the mode with a message. */
function notifyNotebookTheme(theme) {

    const frame = document.getElementById("nbFrame");

    if (!frame || !frame.contentWindow) return;

    try {
        frame.contentWindow.postMessage({ focusLab: "theme", mode: theme }, "*");
    } catch {
        /* The frame is not ready yet — it asks again when it has loaded. */
    }
}


/* =========================================================
   NOTEBOOK PAGE — auto-hiding top bar + burger menu
   (only runs on pages/notebook.html)

   - the top bar is hidden when the page opens
   - it slides in when the mouse touches the very top edge of
     the screen, when the little tab at the top is tapped, or
     when the notebook (inside its frame) reports that the
     mouse reached its top edge
   - it stays while the mouse is over it, and hides again
     NB_HEADER_HIDE_MS after the mouse (or finger) left it
   - the burger menu starts closed. If the top bar hides while
     the menu is open, the menu simply grows up into the space
     (see .notebook-screen .sidebar in main.css)
========================================================= */

const NB_EDGE_PX = 6;
const NB_HEADER_HIDE_MS = 3500;

function setupNotebookPage() {

    if (!document.body.classList.contains("notebook-page")) return;

    const screen  = document.getElementById("app-screen");
    const header  = document.querySelector(".tasks-header");
    const peek    = document.getElementById("nbPeek");
    const scrim   = document.getElementById("nbScrim");
    const sidebar = document.getElementById("sidebar");
    const music   = document.getElementById("musicSidebarPanel");
    const frame   = document.getElementById("nbFrame");

    if (!screen || !header) return;

    let hideTimer = null;
    let pointerInside = false;

    function showHeader() {
        screen.classList.add("header-visible");
        scheduleHide();
    }

    function scheduleHide() {

        clearTimeout(hideTimer);

        if (pointerInside) return;

        hideTimer = setTimeout(() => {
            screen.classList.remove("header-visible");
        }, NB_HEADER_HIDE_MS);
    }

    /* Mouse at the very top of the page. */
    document.addEventListener("pointermove", event => {
        if (event.pointerType === "mouse" && event.clientY <= NB_EDGE_PX) {
            showHeader();
        }
    });

    /* The mouse is over the notebook (inside the frame) and reached its top edge. */
    window.addEventListener("message", event => {
        if (event.data && event.data.focusLab === "top-edge") {
            showHeader();
        }
    });

    /* The small tab (the only way on a touch screen). */
    if (peek) {
        peek.addEventListener("click", showHeader);
    }

    /* Stay while it is being used; start the countdown when it is left. */
    header.addEventListener("pointerenter", () => {
        pointerInside = true;
        clearTimeout(hideTimer);
    });

    header.addEventListener("pointerleave", () => {
        pointerInside = false;
        scheduleHide();
    });

    header.addEventListener("pointerdown", () => {
        clearTimeout(hideTimer);
    });

    header.addEventListener("pointerup", () => {
        if (!pointerInside) scheduleHide();
        else clearTimeout(hideTimer);
    });

    /* Tapping the notebook while the menu is open closes the menu. */
    function menuIsOpen() {

        if (!sidebar) return false;

        const panelOpen = music && music.classList.contains("active");

        if (window.innerWidth <= 800) {
            return sidebar.classList.contains("open") || panelOpen;
        }

        return !sidebar.classList.contains("closed") || panelOpen;
    }

    function syncScrim() {
        if (scrim) scrim.classList.toggle("on", menuIsOpen());
    }

    if (scrim) {
        scrim.addEventListener("click", () => {

            if (music && music.classList.contains("active")) {
                closeMusicSidebarPanel();
            }

            if (window.innerWidth <= 800) {
                sidebar.classList.remove("open");
            } else if (!sidebar.classList.contains("closed")) {
                toggleSidebar();
            }

            syncScrim();
        });
    }

    const observer = new MutationObserver(syncScrim);

    [sidebar, music].forEach(element => {
        if (element) observer.observe(element, { attributes: true, attributeFilter: ["class"] });
    });

    window.addEventListener("resize", syncScrim);

    /* Give the frame the current colour mode as soon as it has loaded. */
    if (frame) {
        frame.addEventListener("load", () => notifyNotebookTheme(getSiteTheme()));
    }

    syncScrim();
}


/* =========================================================
   FRIENDS — Firebase Realtime Database
   unique IDs + presence, chat (text / images / voice / files as
   Base64 inside normal messages), groups, replies, delete,
   P2P voice calls (1:1 and group, WebRTC mesh) with an
   incoming-call banner on every page.
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

    /* STUN only. If some networks cannot connect, add a TURN server here. */
    var ICE = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };
    var MAX_FILE = 700 * 1024;

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
        var hue = hash(u.id || u.name || "x") % 360;
        d.style.background = "linear-gradient(135deg,hsl(" + hue + ",70%,45%),hsl(" + (hue + 40) + ",75%,62%))";
        d.textContent = initials(u.name);
        var src = avSrc(u.avatar || u.photo);
        if (src) { var i = new Image(); i.alt = ""; i.onload = function () { d.textContent = ""; d.appendChild(i); }; i.src = src; }
        return d;
    }
    function fmt(s) { return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
    function size(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
    function pairKey(a, b) { return [a, b].sort().join("__"); }
    function mk(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    var userCache = {};
    var blocked = {};
    try { blocked = JSON.parse(LS.getItem("focusLab_blocked") || "{}") || {}; } catch (e) { blocked = {}; }
    function saveBlocked() { LS.setItem("focusLab_blocked", JSON.stringify(blocked)); }
    var MAX_UPLOAD = 50 * 1048576;
    var I_BAN = '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.8"/><path d="M6.5 17.5L17.5 6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    var I_DL = '<svg viewBox="0 0 24 24" fill="none"><path d="M12 4V15M7.5 10.5L12 15L16.5 10.5M5 19.5H19" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var I_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5V18.5L19 12Z"/></svg>';
    var I_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>';
    var I_FILE = '<svg viewBox="0 0 24 24" fill="none"><path d="M7 3.5H14L19 8.5V20.5H7V3.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M14 3.5V8.5H19" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
    function download(src, name) {
        var go = function (href, rev) { var a = document.createElement("a"); a.href = href; a.download = name || "file"; document.body.appendChild(a); a.click(); a.remove(); if (rev) setTimeout(function () { URL.revokeObjectURL(href); }, 4000); };
        if (/^data:/.test(src)) return go(src);
        fetch(src).then(function (r) { return r.blob(); }).then(function (b) { go(URL.createObjectURL(b), 1); }).catch(function () { window.open(src, "_blank"); });
    }
    function dlBtn(src, name) { var b = mk("button", "fr-dlb"); b.type = "button"; b.title = "Download"; b.innerHTML = I_DL; b.onclick = function (e) { e.stopPropagation(); download(src, name); }; return b; }
    function fetchUser(id) {
        return database.ref("users/" + id).once("value").then(function (s) {
            var v = s.val(); if (!v) return null;
            var u = { id: id, name: v.name || id, avatar: v.avatar || "", online: v.online === true };
            userCache[id] = u; return u;
        });
    }
    function toast(t) {
        var e = $("frToast"); if (!e) return;
        e.textContent = t; e.classList.add("show");
        clearTimeout(toast.t); toast.t = setTimeout(function () { e.classList.remove("show"); }, 2600);
    }
    function shrink(file, max, cb) {
        var r = new FileReader();
        r.onload = function () {
            var img = new Image();
            img.onload = function () {
                var k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas");
                c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
                c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
                cb(c.toDataURL("image/jpeg", 0.74));
            };
            img.onerror = function () { toast("Couldn’t read that image"); };
            img.src = r.result;
        };
        r.readAsDataURL(file);
    }

    /* ---------- identity ---------- */
    function claim(id) {
        return database.ref("users/" + id + "/owner").transaction(function (cur) {
            return (cur === null || cur === token) ? token : undefined;
        }).then(function (r) { return r.committed && r.snapshot.val() === token; });
    }
    async function ensureId() {
        var id = cleanId(LS.getItem("focusLab_friendId")) || genId();
        for (var n = 0; n < 10; n++) { if (await claim(id)) return id; id = genId(); }
        throw new Error("Could not get an ID");
    }
    function readProfile() {
        var first = LS.getItem("focusLab_firstName") || "Focus", last = LS.getItem("focusLab_lastName") || "User";
        me.name = (LS.getItem("focusLab_friendName") || (first + " " + last)).trim();
        me.avatar = LS.getItem("focusLab_avatarSrc") || "images/avatars/avatar1.jpeg";
    }
    function findUser(raw) {
        var id = cleanId(raw);
        if (!id) return Promise.resolve(null);
        return fetchUser(id);
    }

    /* ---------- incoming-call banner (every page) ---------- */
    var bannerEl = null, incoming = null;
    function buildBanner() {
        bannerEl = document.createElement("div");
        bannerEl.id = "frBanner";
        bannerEl.innerHTML =
            '<div id="frBnAv"></div><div class="fr-w"><strong id="frBnName"></strong><small id="frBnSub">is calling you…</small></div>' +
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
            $("frBnSub").textContent = v.label ? "is calling you · " + v.label : "is calling you…";
            bannerEl.classList.add("show");
        });
    }
    function hideBanner() { incoming = null; if (bannerEl) bannerEl.classList.remove("show"); }
    function declineCall(v) {
        hideBanner(); if (!v) return;
        database.ref("calls/" + v.callId + "/declined/" + me.id).set(true);
        database.ref("incoming/" + me.id).remove();
    }
    function listenIncoming() {
        database.ref("incoming/" + me.id).on("value", function (s) {
            var v = s.val();
            if (!v) { hideBanner(); return; }
            if (blocked[v.from]) { database.ref("incoming/" + me.id).remove(); return; }
            if (callActive) { declineCall(v); return; }
            if (autoAccept && v.callId === autoAccept && HAS_UI) { autoAccept = null; acceptCall(v); return; }
            showBanner(v);
        });
    }

    /* ---------- call engine: 1:1 and group (mesh) ---------- */
    var callActive = false, callId = null, localStream = null, peers = {}, parts = {}, invited = {}, declinedN = 0;
    var callRefs = [], ringT = null, callTimer = null, callSec = 0, callLabel = "", muted = false, spkOn = false;
    var actx = null, mineTs = 0, connectedOnce = false;
    var speak = {}, vad = {}, vadT = null;
    function levelWatch(uid, stream) {
        try {
            if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
            if (actx.state === "suspended") actx.resume();
            var an = actx.createAnalyser(); an.fftSize = 512;
            var src = actx.createMediaStreamSource(stream); src.connect(an);
            vad[uid] = { an: an, src: src, buf: new Uint8Array(an.fftSize), last: 0 };
            if (!vadT) vadT = setInterval(vadTick, 110);
        } catch (e) {}
    }
    function vadTick() {
        var now = Date.now();
        Object.keys(vad).forEach(function (uid) {
            var v = vad[uid]; v.an.getByteTimeDomainData(v.buf);
            var s = 0; for (var i = 0; i < v.buf.length; i++) { var x = (v.buf[i] - 128) / 128; s += x * x; }
            if (Math.sqrt(s / v.buf.length) > 0.04 && !(uid === me.id && muted)) v.last = now;
            var on = now - v.last < 450;
            if (on && !speak[uid]) speak[uid] = { c: "hsl(" + Math.floor(Math.random() * 360) + ",90%,62%)" };
            if (!on && speak[uid]) delete speak[uid];
            var el = document.querySelector('.fr-part[data-uid="' + uid + '"]');
            if (el) { el.classList.toggle("speaking", !!speak[uid]); if (speak[uid]) el.style.setProperty("--sp", speak[uid].c); }
        });
    }
    function levelStop() { clearInterval(vadT); vadT = null; Object.keys(vad).forEach(function (u) { try { vad[u].src.disconnect(); } catch (e) {} }); vad = {}; speak = {}; }
    function selfPart() { userCache[me.id] = me; parts[me.id] = { user: me, status: "You" }; renderParts(); }

    function getMic() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error("no-mic"));
        return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    }
    function watch(ref, ev, fn) { var f = ref.on(ev, fn); callRefs.push({ ref: ref, ev: ev, fn: f }); }
    function renderParts() {
        var box = $("frParts"); if (!box) return; box.innerHTML = "";
        var ids = Object.keys(parts);
        box.className = "fr-parts n" + Math.min(ids.length, 6);
        ids.forEach(function (id) {
            var p = parts[id], t = mk("div", "fr-part" + (speak[id] ? " speaking" : "")); t.dataset.uid = id;
            if (speak[id]) t.style.setProperty("--sp", speak[id].c);
            t.appendChild(avatarEl(p.user));
            t.appendChild(mk("strong", "", id === me.id ? p.user.name + " (you)" : p.user.name));
            t.appendChild(mk("small", "", p.status));
            box.appendChild(t);
        });
    }
    function setPart(uid, status, user) {
        if (!parts[uid]) parts[uid] = { user: user || userCache[uid] || { id: uid, name: uid, avatar: "" }, status: status || "" };
        if (status) parts[uid].status = status;
        if (user) parts[uid].user = user;
        renderParts();
        if (!userCache[uid]) fetchUser(uid).then(function (u) { if (u && parts[uid]) { parts[uid].user = u; renderParts(); } });
    }
    function openCallUI(title) {
        callLabel = title; $("frClName").textContent = title; $("frClSt").textContent = "Calling…";
        muted = false; spkOn = false; $("frClMute").classList.remove("on"); $("frClSpk").classList.remove("on");
        $("frAddBox").classList.remove("open"); $("frCall").classList.add("open");
    }
    function markConnected() {
        if (connectedOnce) return;
        connectedOnce = true; clearTimeout(ringT); callSec = 0; $("frClSt").textContent = "0:00";
        callTimer = setInterval(function () { callSec++; $("frClSt").textContent = fmt(callSec); }, 1000);
    }
    function addCand(p, c) {
        if (p.pc.remoteDescription) p.pc.addIceCandidate(new RTCIceCandidate(c)).catch(function () {});
        else p.pending.push(c);
    }
    function flushCands(p) { var l = p.pending; p.pending = []; l.forEach(function (c) { addCand(p, c); }); }
    function makePeer(uid, key, offerer) {
        if (peers[uid]) return peers[uid];
        var p = { pc: new RTCPeerConnection(ICE), pending: [], stream: null, audio: null, src: null, gain: null };
        peers[uid] = p; setPart(uid, "Connecting…");
        localStream.getTracks().forEach(function (t) { p.pc.addTrack(t, localStream); });
        var sref = database.ref("sig/" + callId + "/" + key);
        p.pc.onicecandidate = function (e) { if (e.candidate) sref.child(offerer ? "ca" : "cb").push(e.candidate.toJSON()); };
        p.pc.ontrack = function (e) {
            p.stream = e.streams[0];
            var a = document.createElement("audio"); a.autoplay = true; a.setAttribute("playsinline", ""); a.srcObject = p.stream; a.volume = 0.45; levelWatch(uid, p.stream);
            $("frAudios").appendChild(a); p.audio = a;
            var pr = a.play(); if (pr && pr.catch) pr.catch(function () {});
            if (spkOn) applySpeaker();
        };
        p.pc.onconnectionstatechange = function () {
            var s = p.pc.connectionState;
            if (s === "connected") { setPart(uid, "Connected"); markConnected(); }
            else if (s === "failed") { closePeer(uid); toast("Connection to " + (parts[uid] ? parts[uid].user.name : "a friend") + " failed"); checkAlone(); }
        };
        watch(sref.child(offerer ? "cb" : "ca"), "child_added", function (s) { addCand(p, s.val()); });
        return p;
    }
    async function offerTo(uid) {
        var key = me.id + "__" + uid, p = makePeer(uid, key, true);
        var offer = await p.pc.createOffer(); await p.pc.setLocalDescription(offer);
        var sref = database.ref("sig/" + callId + "/" + key);
        await sref.child("offer").set({ type: offer.type, sdp: offer.sdp });
        watch(sref.child("answer"), "value", function (s) {
            var v = s.val(); if (v && !p.pc.remoteDescription) p.pc.setRemoteDescription(v).then(function () { flushCands(p); });
        });
    }
    async function answerFrom(uid, offer) {
        var key = uid + "__" + me.id, p = makePeer(uid, key, false);
        await p.pc.setRemoteDescription(offer);
        var ans = await p.pc.createAnswer(); await p.pc.setLocalDescription(ans);
        await database.ref("sig/" + callId + "/" + key + "/answer").set({ type: ans.type, sdp: ans.sdp });
        flushCands(p);
    }
    function closePeer(uid) {
        var p = peers[uid]; if (!p) return;
        try { if (p.src) p.src.disconnect(); } catch (e) {}
        try { if (vad[uid]) { vad[uid].src.disconnect(); delete vad[uid]; } delete speak[uid]; } catch (e) {}
        try { p.pc.close(); } catch (e) {}
        if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
        delete peers[uid]; delete parts[uid]; renderParts();
    }
    function checkAlone() {
        if (!callActive) return;
        var others = Object.keys(peers).length, inv = Object.keys(invited).length;
        if (!others && (connectedOnce || (inv && declinedN >= inv))) hangup(connectedOnce ? "Call ended" : "Call declined");
    }
    async function joinRoom() {
        var base = database.ref("calls/" + callId), mine = base.child("peers/" + me.id);
        mine.onDisconnect().remove(); await mine.set(TS);
        mineTs = (await mine.once("value")).val() || 0;
        watch(base.child("peers"), "child_added", function (s) {
            var uid = s.key; if (uid === me.id) return;
            setPart(uid, "Connecting…");
            var t = s.val() || 0;
            if (t < mineTs || (t === mineTs && uid < me.id)) offerTo(uid);
        });
        watch(base.child("peers"), "child_removed", function (s) { closePeer(s.key); checkAlone(); });
        watch(database.ref("sig/" + callId), "child_added", function (s) {
            var k = s.key.split("__"); if (k[1] !== me.id) return;
            var off = k[0], oref = s.ref.child("offer");
            var fn = oref.on("value", function (v) { if (v.val() && !peers[off]) answerFrom(off, v.val()); });
            callRefs.push({ ref: oref, ev: "value", fn: fn });
        });
        watch(base.child("declined"), "child_added", function (s) {
            declinedN++;
            var p = parts[s.key]; toast((p ? p.user.name : "Someone") + " declined");
            if (p && !peers[s.key]) { delete parts[s.key]; renderParts(); }
            checkAlone();
        });
    }
    function invite(u) {
        if (!callActive || invited[u.id] || peers[u.id]) return;
        invited[u.id] = true; userCache[u.id] = u; setPart(u.id, "Ringing…", u);
        var inc = database.ref("incoming/" + u.id);
        inc.onDisconnect().remove();
        inc.set({ callId: callId, from: me.id, label: callLabel, ts: TS });
    }
    async function startCall(list, title) {
        if (callActive) return;
        list = (list || []).filter(function (u) { return u && u.online && u.id !== me.id; });
        if (!list.length) { toast("No one is online to call"); return; }
        callActive = true; connectedOnce = false; declinedN = 0; invited = {}; peers = {}; parts = {};
        openCallUI(title || list[0].name); selfPart();
        try { localStream = await getMic(); levelWatch(me.id, localStream); } catch (e) { hangup("Microphone permission is needed", true); return; }
        callId = database.ref("calls").push().key;
        await database.ref("calls/" + callId).set({ host: me.id, ts: TS });
        await joinRoom();
        list.forEach(invite);
        ringT = setTimeout(function () { if (!connectedOnce) hangup("No answer"); }, 45000);
    }
    async function acceptCall(v) {
        if (callActive || !v) return;
        database.ref("incoming/" + me.id).remove();
        var snap = await database.ref("calls/" + v.callId).once("value");
        if (!snap.exists()) { toast("The call has already ended"); return; }
        callActive = true; connectedOnce = false; declinedN = 0; invited = {}; peers = {}; parts = {};
        callId = v.callId;
        var host = await fetchUser(v.from);
        openCallUI((host ? host.name : "Call") + (v.label && host && v.label !== host.name ? " · " + v.label : "")); $("frClSt").textContent = "Connecting…"; selfPart();
        try { localStream = await getMic(); levelWatch(me.id, localStream); } catch (e) { hangup("Microphone permission is needed", true); return; }
        await joinRoom();
        ringT = setTimeout(function () { if (!connectedOnce) hangup("Could not connect"); }, 25000);
    }
    function hangup(reason, noDb) {
        if (!callActive && !callId) return;
        var cid = callId, inv = Object.keys(invited);
        callActive = false; callId = null;
        clearTimeout(ringT); clearInterval(callTimer); levelStop();
        callRefs.forEach(function (w) { try { w.ref.off(w.ev, w.fn); } catch (e) {} });
        callRefs = [];
        Object.keys(peers).forEach(closePeer);
        if (localStream) { localStream.getTracks().forEach(function (t) { t.stop(); }); localStream = null; }
        if (cid && !noDb) {
            var base = database.ref("calls/" + cid);
            base.child("peers/" + me.id).onDisconnect().cancel();
            base.child("peers/" + me.id).remove().then(function () {
                return base.child("peers").once("value");
            }).then(function (s) { if (!s.exists()) { base.remove(); database.ref("sig/" + cid).remove(); } });
            inv.forEach(function (uid) {
                var inc = database.ref("incoming/" + uid); inc.onDisconnect().cancel();
                inc.once("value").then(function (s) { var x = s.val(); if (x && x.callId === cid) inc.remove(); });
            });
        }
        peers = {}; parts = {}; invited = {}; callSec = 0; connectedOnce = false;
        if ($("frCall")) $("frCall").classList.remove("open");
        if (reason) toast(reason);
    }
    function applySpeaker() {
        Object.keys(peers).forEach(function (uid) {
            var p = peers[uid];
            if (p.src) { try { p.src.disconnect(); } catch (e) {} p.src = null; p.gain = null; }
            if (spkOn && p.stream) {
                try {
                    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
                    if (actx.state === "suspended") actx.resume();
                    p.src = actx.createMediaStreamSource(p.stream);
                    p.gain = actx.createGain(); p.gain.gain.value = 3;
                    p.src.connect(p.gain); p.gain.connect(actx.destination);
                    if (p.audio) p.audio.muted = true;
                } catch (e) { spkOn = false; $("frClSpk").classList.remove("on"); if (p.audio) p.audio.muted = false; toast("Speaker boost isn’t supported on this browser"); }
            } else if (p.audio) p.audio.muted = false;
        });
    }

    /* ---------- friends page: lists ---------- */
    var list = [], inbox = {}, gids = [], groupsData = {}, watchOff = [];
    function loadList() { try { list = JSON.parse(LS.getItem("focusLab_friendList") || "[]"); } catch (e) { list = []; } if (!Array.isArray(list)) list = []; }
    function saveList() { LS.setItem("focusLab_friendList", JSON.stringify(list)); }
    function lastRead() { try { return JSON.parse(LS.getItem("focusLab_friendRead") || "{}"); } catch (e) { return {}; } }
    function addFriend(id) { if (id && id !== me.id && list.indexOf(id) < 0) { list.unshift(id); saveList(); renderList(); } }
    function isUnread(key) { return inbox[key] && inbox[key] !== lastRead()[key]; }

    var PHONE = '<svg viewBox="0 0 24 24" fill="none"><path d="M6.5 4H9.5L11 8L9 9.5C9.9 11.5 12.5 14.1 14.5 15L16 13L20 14.5V17.5C20 18.6 19.1 19.5 18 19.5C10.8 19.5 4.5 13.2 4.5 6C4.5 4.9 5.4 4 6.5 4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
    var CHAT = '<svg viewBox="0 0 24 24" fill="none"><path d="M4 6.5C4 5.4 4.9 4.5 6 4.5H18C19.1 4.5 20 5.4 20 6.5V15C20 16.1 19.1 17 18 17H10L6 20.5V17C4.9 17 4 16.1 4 15V6.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 9H16M8 12.5H13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
    var USERS = '<svg viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8.5" r="3.2" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 19C4 15.8 6.2 14.2 9 14.2C11.8 14.2 14 15.8 14.5 19" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="17" cy="9.5" r="2.5" stroke="currentColor" stroke-width="1.7"/><path d="M16.5 14.4C18.9 14.3 20.4 15.7 20.8 18.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

    function iconBtn(svg, title, fn, disabled) {
        var b = mk("button", "fr-ico"); b.type = "button"; b.title = title; b.innerHTML = svg; b.disabled = !!disabled; b.onclick = fn; return b;
    }
    function userBar(u, unread) {
        var bar = mk("div", "fr-bar " + (u.online ? "on" : "off"));
        bar.appendChild(avatarEl(u));
        var w = mk("div", "fr-who"); w.appendChild(mk("strong", "", u.name));
        var s = mk("div", "fr-st"); s.appendChild(mk("i")); s.appendChild(document.createTextNode(u.online ? "Online" : "Not online")); w.appendChild(s);
        if (unread) w.appendChild(mk("span", "fr-new", "New"));
        bar.appendChild(w);
        bar.appendChild(iconBtn(CHAT, "Chat", function () { openChat({ kind: "user", id: u.id, name: u.name, avatar: u.avatar, online: u.online }); }));
        bar.appendChild(iconBtn(PHONE, u.online ? "Call" : "Not online", function () { startCall([u]); }, !u.online));
        var bb = iconBtn(I_BAN, "Block " + u.name, function () { blockUser(u); }); bb.classList.add("fr-ico-danger"); bar.appendChild(bb);
        return bar;
    }
    function groupBar(gid, g, unread) {
        var bar = mk("div", "fr-bar on");
        bar.appendChild(avatarEl({ id: gid, name: g.name, photo: g.photo }));
        var w = mk("div", "fr-who"); w.appendChild(mk("strong", "", g.name));
        var n = Object.keys(g.members || {}).length;
        var s = mk("div", "fr-st"); s.appendChild(mk("i")); s.appendChild(document.createTextNode("Group · " + n + " members")); w.appendChild(s);
        if (unread) w.appendChild(mk("span", "fr-new", "New"));
        bar.appendChild(w);
        bar.appendChild(iconBtn(CHAT, "Open group", function () { openChat(groupTarget(gid, g)); }));
        bar.appendChild(iconBtn(PHONE, "Group call", function () { groupCall(g); }));
        return bar;
    }
    function groupTarget(gid, g) { return { kind: "group", id: gid, name: g.name, photo: g.photo, members: g.members || {}, owner: g.owner }; }
    async function groupCall(g) {
        var ids = Object.keys(g.members || {}).filter(function (x) { return x !== me.id; });
        var users = (await Promise.all(ids.map(fetchUser))).filter(Boolean);
        startCall(users, g.name);
    }
    function renderList() {
        var box = $("frList"); if (!box) return;
        watchOff.forEach(function (f) { f(); }); watchOff = [];
        box.innerHTML = "";
        if (!list.length && !gids.length) { box.innerHTML = '<div class="fr-empty">No chats yet — search a friend’s ID above, or create a group.</div>'; renderBlocked(box); return; }
        gids.forEach(function (gid) {
            var holder = mk("div"); box.appendChild(holder);
            var ref = database.ref("groups/" + gid);
            var fn = ref.on("value", function (s) {
                var g = s.val(); groupsData[gid] = g; holder.innerHTML = "";
                if (g) holder.appendChild(groupBar(gid, g, isUnread("g_" + gid)));
            });
            watchOff.push(function () { ref.off("value", fn); });
        });
        list.forEach(function (id) {
            var holder = mk("div"); box.appendChild(holder);
            if (blocked[id]) { holder.remove(); return; }
            var ref = database.ref("users/" + id);
            var fn = ref.on("value", function (s) {
                var v = s.val(); if (!v) return;
                var u = { id: id, name: v.name || id, avatar: v.avatar || "", online: v.online === true };
                userCache[id] = u; holder.innerHTML = ""; holder.appendChild(userBar(u, isUnread(id)));
            });
            watchOff.push(function () { ref.off("value", fn); });
        });
        renderBlocked(box);
    }
    function renderBlocked(box) {
        var ids = Object.keys(blocked).filter(function (i) { return blocked[i]; }); if (!ids.length) return;
        box.appendChild(mk("h3", "fr-h", "Blocked (" + ids.length + ")"));
        ids.forEach(function (id) {
            var row = mk("div", "fr-bar off"); row.appendChild(avatarEl({ id: id, name: id }));
            var w = mk("div", "fr-who"), nm = mk("strong", "", id); w.appendChild(nm); row.appendChild(w);
            fetchUser(id).then(function (u) { if (u) { nm.textContent = u.name; row.replaceChild(avatarEl(u), row.firstChild); } });
            var ub = mk("button", "fr-small", "Unblock"); ub.type = "button"; ub.onclick = function () { unblockUser(id); }; row.appendChild(ub);
            box.appendChild(row);
        });
    }
    function blockUser(u) {
        var box = mk("div", "fr-mbox"); box.appendChild(mk("h3", "", "Block " + u.name + "?"));
        box.appendChild(mk("p", "fr-bnote", "They will be removed from your chats and won’t be able to call you. You can unblock them any time from the Blocked list."));
        var act = mk("div", "fr-mact"), c = mk("button", "fr-small", "Cancel"); c.type = "button"; c.onclick = closeModal;
        var ok = mk("button", "fr-go danger", "Block"); ok.type = "button";
        ok.onclick = function () {
            blocked[u.id] = true; saveBlocked(); list = list.filter(function (x) { return x !== u.id; }); saveList();
            var up = {}; up["blocks/" + me.id + "/" + u.id] = true; up["inbox/" + me.id + "/" + u.id] = null; database.ref().update(up).catch(function () {});
            if (chat && chat.kind === "user" && chat.id === u.id) closeChat();
            closeModal(); $("frResult").innerHTML = ""; renderList(); toast(u.name + " blocked");
        };
        act.appendChild(c); act.appendChild(ok); box.appendChild(act); openModal(box);
        $("frModal").onclick = function (e) { if (e.target === $("frModal")) closeModal(); };
    }
    function unblockUser(id) { delete blocked[id]; saveBlocked(); database.ref("blocks/" + me.id + "/" + id).remove().catch(function () {}); renderList(); toast("Unblocked"); }
    var searchOff = null;
    function search(raw) {
        var box = $("frResult"), id = cleanId(raw);
        if (searchOff) { searchOff(); searchOff = null; }
        if (!id) { box.innerHTML = ""; return; }
        if (id === me.id) { box.innerHTML = '<div class="fr-empty">That’s your own ID.</div>'; return; }
        if (blocked[id]) { box.innerHTML = '<div class="fr-empty">You blocked this person. Unblock them from the Blocked list below.</div>'; return; }
        var ref = database.ref("users/" + id);
        ref.once("value").then(function (s) {
            if (!s.val()) { box.innerHTML = '<div class="fr-empty">No user found with this ID. Check the number and try again.</div>'; return; }
            var fn = ref.on("value", function (s2) {
                var d = s2.val(); if (!d) return;
                var u = { id: id, name: d.name || id, avatar: d.avatar || "", online: d.online === true };
                userCache[id] = u; box.innerHTML = ""; box.appendChild(userBar(u));
            });
            searchOff = function () { ref.off("value", fn); };
        });
    }

    /* ---------- modal helper ---------- */
    function openModal(node) { var m = $("frModal"); m.innerHTML = ""; m.appendChild(node); m.classList.add("open"); }
    function closeModal() { var m = $("frModal"); m.classList.remove("open"); m.innerHTML = ""; }
    function memberSearchForm(placeholder, onUser) {
        var f = mk("form", "fr-msearch"); f.autocomplete = "off";
        var i = mk("input"); i.placeholder = placeholder; i.maxLength = 16;
        var b = mk("button", "fr-go", "Add"); b.type = "submit";
        var err = mk("div", "fr-merr");
        f.appendChild(i); f.appendChild(b);
        f.onsubmit = function (e) {
            e.preventDefault(); err.textContent = "";
            findUser(i.value).then(function (u) {
                if (!u) { err.textContent = "No user with that ID"; return; }
                if (u.id === me.id) { err.textContent = "That’s you"; return; }
                i.value = ""; onUser(u);
            });
        };
        var wrap = mk("div"); wrap.appendChild(f); wrap.appendChild(err); return wrap;
    }

    /* ---------- groups ---------- */
    function newGroupModal(prefill) {
        var members = {}, photo = "";
        (prefill || []).forEach(function (u) { members[u.id] = u; });
        var box = mk("div", "fr-mbox");
        box.appendChild(mk("h3", "", "New group"));
        var top = mk("div", "fr-gtop");
        var ph = mk("label", "fr-gphoto"); ph.appendChild(mk("span", "", "+"));
        var fi = mk("input"); fi.type = "file"; fi.accept = "image/*"; ph.appendChild(fi);
        fi.onchange = function () {
            var f = fi.files[0]; fi.value = ""; if (!f) return;
            shrink(f, 160, function (d) { photo = d; ph.style.backgroundImage = "url(" + d + ")"; ph.firstChild.style.display = "none"; });
        };
        var nm = mk("input", "fr-gname"); nm.placeholder = "Group name"; nm.maxLength = 40;
        top.appendChild(ph); top.appendChild(nm); box.appendChild(top);
        var chips = mk("div", "fr-chips"); box.appendChild(chips);
        function drawChips() {
            chips.innerHTML = "";
            Object.keys(members).forEach(function (id) {
                var c = mk("span", "fr-chip", members[id].name + " ");
                var x = mk("button", "", "✕"); x.type = "button"; x.onclick = function () { delete members[id]; drawChips(); };
                c.appendChild(x); chips.appendChild(c);
            });
            if (!Object.keys(members).length) chips.appendChild(mk("small", "", "Add friends by their ID"));
        }
        drawChips();
        box.appendChild(memberSearchForm("Add member by ID", function (u) { members[u.id] = u; drawChips(); }));
        var act = mk("div", "fr-mact");
        var cancel = mk("button", "fr-small", "Cancel"); cancel.type = "button"; cancel.onclick = closeModal;
        var go = mk("button", "fr-go", "Create"); go.type = "button";
        go.onclick = function () {
            var ids = Object.keys(members);
            if (!ids.length) { toast("Add at least one member"); return; }
            var name = nm.value.trim() || ([me.name].concat(ids.map(function (i) { return members[i].name.split(" ")[0]; })).join(", ")).slice(0, 40);
            var gid = database.ref("groups").push().key, mem = {}; mem[me.id] = true;
            ids.forEach(function (i) { mem[i] = true; });
            database.ref("groups/" + gid).set({ name: name, photo: photo, owner: me.id, members: mem, ts: TS }).then(function () {
                var up = {}; Object.keys(mem).forEach(function (i) { up["userGroups/" + i + "/" + gid] = true; if (i !== me.id) up["inbox/" + i + "/g_" + gid] = TS; });
                return database.ref().update(up);
            }).then(function () { closeModal(); openChat(groupTarget(gid, { name: name, photo: photo, members: mem, owner: me.id })); });
        };
        act.appendChild(cancel); act.appendChild(go); box.appendChild(act);
        openModal(box);
    }
    function groupInfoModal(t) {
        var ref = database.ref("groups/" + t.id), box = mk("div", "fr-mbox");
        function draw(g) {
            box.innerHTML = "";
            if (!g) { closeModal(); return; }
            var isOwner = g.owner === me.id, mem = Object.keys(g.members || {});
            var head = mk("div", "fr-ginfo"); head.appendChild(avatarEl({ id: t.id, name: g.name, photo: g.photo }));
            var nm = mk("input", "fr-gname"); nm.value = g.name; nm.disabled = !isOwner; nm.maxLength = 40; head.appendChild(nm); box.appendChild(head);
            if (isOwner) {
                var row = mk("div", "fr-mact");
                var pl = mk("label", "fr-small", "Change photo"); var pf = mk("input"); pf.type = "file"; pf.accept = "image/*"; pf.style.display = "none"; pl.appendChild(pf);
                pf.onchange = function () { var f = pf.files[0]; pf.value = ""; if (f) shrink(f, 160, function (d) { ref.update({ photo: d }); }); };
                var sv = mk("button", "fr-small", "Save name"); sv.type = "button"; sv.onclick = function () { var v = nm.value.trim(); if (v) ref.update({ name: v }); };
                row.appendChild(pl); row.appendChild(sv); box.appendChild(row);
            }
            box.appendChild(mk("h4", "fr-sub", mem.length + " members"));
            mem.forEach(function (id) {
                var r = mk("div", "fr-mrow"), u = userCache[id];
                var holder = mk("div", "fr-who"); r.appendChild(mk("span")); holder.appendChild(mk("strong", "", id === me.id ? me.name + " (you)" : id)); r.appendChild(holder);
                fetchUser(id).then(function (uu) {
                    if (!uu) return; r.innerHTML = ""; r.className = "fr-mrow " + (uu.online ? "on" : "off");
                    r.appendChild(avatarEl(uu));
                    var w = mk("div", "fr-who"); w.appendChild(mk("strong", "", id === me.id ? uu.name + " (you)" : uu.name));
                    var s = mk("div", "fr-st"); s.appendChild(mk("i")); s.appendChild(document.createTextNode(g.owner === id ? "Admin" : (uu.online ? "Online" : "Not online"))); w.appendChild(s); r.appendChild(w);
                    if (id !== me.id) {
                        r.appendChild(iconBtn(CHAT, "Message " + uu.name, function () { closeModal(); openChat({ kind: "user", id: id, name: uu.name, avatar: uu.avatar, online: uu.online }); }));
                        r.appendChild(iconBtn(PHONE, uu.online ? "Call " + uu.name : "Not online", function () { closeModal(); startCall([uu]); }, !uu.online));
                        if (isOwner) { var x = mk("button", "fr-small", "Remove"); x.type = "button"; x.onclick = function () { var up = {}; up["groups/" + t.id + "/members/" + id] = null; up["userGroups/" + id + "/" + t.id] = null; database.ref().update(up); }; r.appendChild(x); }
                    }
                });
                box.appendChild(r);
            });
            box.appendChild(memberSearchForm("Add member by ID", function (u) {
                var up = {}; up["groups/" + t.id + "/members/" + u.id] = true; up["userGroups/" + u.id + "/" + t.id] = true; up["inbox/" + u.id + "/g_" + t.id] = TS;
                database.ref().update(up).then(function () { toast(u.name + " added"); });
            }));
            var act = mk("div", "fr-mact");
            var leave = mk("button", "fr-small danger", "Leave group"); leave.type = "button";
            leave.onclick = function () {
                var up = {}; up["groups/" + t.id + "/members/" + me.id] = null; up["userGroups/" + me.id + "/" + t.id] = null;
                database.ref().update(up).then(function () { closeModal(); closeChat(); });
            };
            var cl = mk("button", "fr-go", "Done"); cl.type = "button"; cl.onclick = closeModal;
            act.appendChild(leave); act.appendChild(cl); box.appendChild(act);
        }
        var fn = ref.on("value", function (s) { var g = s.val(); chat && chat.id === t.id && g && (chat.members = g.members || {}); draw(g); });
        $("frModal").onclick = function (e) { if (e.target === $("frModal")) { ref.off("value", fn); closeModal(); } };
        openModal(box);
    }

    /* ---------- chat ---------- */
    var chat = null, msgDom = {}, replyTo = null;
    function timeLabel(ts) { var d = new Date(ts || Date.now()); return d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0"); }
    function previewOf(m) { return m.type === "img" ? "Photo" : m.type === "video" ? "Video" : m.type === "pdf" ? "PDF · " + (m.name || "") : m.type === "voice" ? "Voice message" : m.type === "file" ? (m.name || "File") : String(m.text || "").slice(0, 70); }
    function nameOf(id) { return id === me.id ? "You" : (userCache[id] ? userCache[id].name : id); }
    var msgData = {};
    function pauseVoices() { [].forEach.call(document.querySelectorAll(".fr-vp audio"), function (a) { a.pause(); }); }
    function voiceEl(m, key) {
        var src = m.data || m.url, w = mk("div", "fr-vp"), au = document.createElement("audio"); au.preload = "metadata"; au.src = src; au.style.display = "none";
        var pb = mk("button", "fr-vplay"); pb.type = "button"; pb.innerHTML = I_PLAY;
        var bars = mk("div", "fr-vbars"), N = 28, spans = [], tm = mk("small", "fr-vt", fmt(m.dur || 0));
        for (var i = 0; i < N; i++) { var s = mk("i"); s.style.height = (22 + hash(key + i) % 70) + "%"; bars.appendChild(s); spans.push(s); }
        pb.onclick = function () { if (au.paused) { pauseVoices(); au.play(); } else au.pause(); };
        au.onplay = function () { pb.innerHTML = I_PAUSE; }; au.onpause = function () { pb.innerHTML = I_PLAY; };
        au.ontimeupdate = function () { var p = au.duration && isFinite(au.duration) ? au.currentTime / au.duration : 0; spans.forEach(function (x, k) { x.classList.toggle("on", k / N < p); }); tm.textContent = fmt(Math.floor(au.currentTime)); };
        au.onended = function () { spans.forEach(function (x) { x.classList.remove("on"); }); tm.textContent = fmt(m.dur || 0); pb.innerHTML = I_PLAY; };
        bars.onclick = function (e) { var r = bars.getBoundingClientRect(); if (au.duration && isFinite(au.duration)) au.currentTime = au.duration * (e.clientX - r.left) / r.width; };
        w.appendChild(pb); w.appendChild(bars); w.appendChild(tm); w.appendChild(au);
        return w;
    }
    function react(key, emo) {
        if (!chat) return;
        var ref = database.ref("chats/" + chat.key + "/" + key + "/reacts/" + me.id), cur = msgData[key] && msgData[key].reacts && msgData[key].reacts[me.id];
        if (cur === emo) ref.remove(); else ref.set(emo);
    }
    function reactBar(d, key, m) {
        var old = $("frReactBar"); if (old) old.remove();
        var bar = mk("div", "fr-reactbar"); bar.id = "frReactBar";
        ["👍", "❤️", "😂", "😮", "😢", "🙏"].forEach(function (e) { var b = mk("button", "", e); b.type = "button"; b.onclick = function () { bar.remove(); react(key, e); }; bar.appendChild(b); });
        var more = mk("button", "fr-rmore", "⋯"); more.type = "button"; more.onclick = function () { bar.remove(); msgMenu(d, key, m); }; bar.appendChild(more);
        document.body.appendChild(bar);
        var r = d.getBoundingClientRect(), w = bar.offsetWidth;
        bar.style.top = Math.max(8, r.top - 56) + "px";
        bar.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, m.from === me.id ? r.right - w : r.left)) + "px";
        setTimeout(function () { document.addEventListener("pointerdown", function once(ev) { if (!ev.target.closest("#frReactBar")) bar.remove(); document.removeEventListener("pointerdown", once); }); }, 60);
    }
    function renderMsg(key, m, old) {
        var box = $("frMsgs"), mine = m.from === me.id;
        if (!old && blocked[m.from]) return null;
        msgData[key] = m;
        var first;
        if (old) first = old.dataset.first === "1";
        else { first = !chat.prev || chat.prev.from !== m.from || (m.ts && chat.prev.ts && m.ts - chat.prev.ts > 300000); chat.prev = { from: m.from, ts: m.ts }; }
        var d = mk("div", "fr-m" + (mine ? " me" : "") + (first ? " first" : "") + (m.type === "img" || m.type === "video" ? " media" : "")); d.dataset.key = key; d.dataset.first = first ? "1" : "0";
        if (first) {
            var hd = mk("div", "fr-mh"), u = mine ? me : (userCache[m.from] || { id: m.from, name: m.from, avatar: "" });
            var hn = mk("b", "", mine ? me.name : u.name);
            hd.appendChild(avatarEl(u)); hd.appendChild(hn); d.appendChild(hd);
            if (!mine && !userCache[m.from]) fetchUser(m.from).then(function (x) { if (x) { hn.textContent = x.name; hd.replaceChild(avatarEl(x), hd.firstChild); } });
        }
        if (m.reply) { var q = mk("div", "fr-quote"); q.appendChild(mk("b", "", nameOf(m.reply.from))); q.appendChild(mk("span", "", m.reply.text)); d.appendChild(q); }
        var src = m.data || m.url;
        if (m.type === "img") { var im = new Image(); im.src = src; im.alt = "Photo"; im.loading = "lazy"; var iw = mk("div", "fr-media"); iw.appendChild(im); iw.appendChild(dlBtn(src, m.name || "photo.jpg")); d.appendChild(iw); }
        else if (m.type === "video") { var vd = document.createElement("video"); vd.controls = true; vd.preload = "metadata"; vd.setAttribute("playsinline", ""); vd.src = src; var vw = mk("div", "fr-media"); vw.appendChild(vd); vw.appendChild(dlBtn(src, m.name || "video.mp4")); d.appendChild(vw); }
        else if (m.type === "voice") d.appendChild(voiceEl(m, key));
        else if (m.type === "file" || m.type === "pdf") {
            var fc = mk("div", "fr-file"), ic = mk("span", "fr-fico"); ic.innerHTML = I_FILE; if (m.type === "pdf") ic.classList.add("pdf");
            var fw = mk("div", "fr-fw"); fw.appendChild(mk("b", "", m.name || "File")); fw.appendChild(mk("small", "", (m.type === "pdf" ? "PDF · " : "") + size(m.size || 0)));
            fc.appendChild(ic); fc.appendChild(fw);
            if (m.type === "pdf") { var op = mk("a", "fr-dlb", "Open"); op.href = src; op.target = "_blank"; op.rel = "noopener"; op.className = "fr-dlb txt"; fc.appendChild(op); }
            fc.appendChild(dlBtn(src, m.name || "file")); d.appendChild(fc);
        } else d.appendChild(mk("span", "fr-txt", m.text || ""));
        d.appendChild(mk("small", "fr-time", timeLabel(m.ts)));
        var mb = mk("button", "fr-mm", "⋯"); mb.type = "button"; mb.title = "Message options";
        mb.onclick = function (e) { e.stopPropagation(); reactBar(d, key, m); }; d.appendChild(mb);
        var rs = m.reacts ? Object.keys(m.reacts) : [];
        if (rs.length) {
            var cnt = {}, mineR = m.reacts[me.id]; rs.forEach(function (x) { var e = m.reacts[x]; cnt[e] = (cnt[e] || 0) + 1; });
            var rb = mk("div", "fr-reacts");
            Object.keys(cnt).forEach(function (e) { var c = mk("button", "fr-rc" + (e === mineR ? " mine" : ""), e + (cnt[e] > 1 ? " " + cnt[e] : "")); c.type = "button"; c.onclick = function () { react(key, e); }; rb.appendChild(c); });
            d.appendChild(rb);
        }
        var lp = 0, sx = 0, sy = 0;
        d.addEventListener("pointerdown", function (e) { if (e.target.closest("button,a,audio,video,input,.fr-vbars")) return; sx = e.clientX; sy = e.clientY; clearTimeout(lp); lp = setTimeout(function () { reactBar(d, key, m); }, 450); });
        d.addEventListener("pointermove", function (e) { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 8) clearTimeout(lp); });
        ["pointerup", "pointercancel", "pointerleave"].forEach(function (n) { d.addEventListener(n, function () { clearTimeout(lp); }); });
        d.addEventListener("contextmenu", function (e) { e.preventDefault(); reactBar(d, key, m); });
        var atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 160 || mine;
        if (old && old.parentNode) old.replaceWith(d); else box.appendChild(d);
        msgDom[key] = d;
        if (atBottom && !old) box.scrollTop = box.scrollHeight;
        return d;
    }
    function msgMenu(anchor, key, m) {
        var old = $("frMsgMenu"); if (old) old.remove();
        var menu = mk("div", "fr-menu"); menu.id = "frMsgMenu";
        function item(t, fn) { var b = mk("button", "", t); b.type = "button"; b.onclick = function () { menu.remove(); fn(); }; menu.appendChild(b); }
        item("Reply", function () { setReply(key, m); });
        if (m.type === "text") item("Copy", function () { if (navigator.clipboard) navigator.clipboard.writeText(m.text || ""); toast("Copied"); });
        if (m.from === me.id) item("Delete for everyone", function () { database.ref("chats/" + chat.key + "/" + key).remove(); });
        document.body.appendChild(menu);
        var r = anchor.getBoundingClientRect();
        menu.style.top = Math.min(window.innerHeight - 140, r.bottom + 4) + "px";
        menu.style.left = Math.max(8, Math.min(window.innerWidth - 190, r.left - 120)) + "px";
        setTimeout(function () { document.addEventListener("click", function once() { menu.remove(); document.removeEventListener("click", once); }); }, 0);
    }
    function setReply(key, m) {
        replyTo = { from: m.from, text: previewOf(m) };
        $("frReplyName").textContent = nameOf(m.from); $("frReplyText").textContent = replyTo.text;
        $("frReplyBar").classList.add("open"); $("frTxt").focus();
    }
    function clearReply() { replyTo = null; $("frReplyBar").classList.remove("open"); }
    function markRead(key) { if (!inbox[key]) return; var r = lastRead(); r[key] = inbox[key]; LS.setItem("focusLab_friendRead", JSON.stringify(r)); }
    function openChat(t) {
        closeChat(true);
        chat = t; chat.key = t.kind === "group" ? "g_" + t.id : pairKey(me.id, t.id);
        chat.ibox = t.kind === "group" ? "g_" + t.id : t.id;
        msgDom = {}; msgData = {}; clearReply();
        $("frChBlock").style.display = t.kind === "user" ? "" : "none";
        var head = $("frChHead"); head.innerHTML = ""; head.className = "fr-chhead";
        head.appendChild(avatarEl(t.kind === "group" ? { id: t.id, name: t.name, photo: t.photo } : t));
        var w = mk("div", "fr-who"); w.appendChild(mk("strong", "", t.name));
        var st = mk("div", "fr-st"); st.appendChild(mk("i")); var stt = mk("span"); st.appendChild(stt); w.appendChild(st); head.appendChild(w);
        head.style.cursor = "pointer";
        head.onclick = function () { if (chat.kind === "group") groupInfoModal(chat); };
        chat.offs = [];
        if (t.kind === "user") {
            addFriend(t.id);
            var sr = database.ref("users/" + t.id + "/online");
            var sf = sr.on("value", function (s) { t.online = s.val() === true; head.className = "fr-chhead " + (t.online ? "on" : "off"); stt.textContent = t.online ? "Online" : "Not online"; $("frChCall").disabled = !t.online; });
            chat.offs.push(function () { sr.off("value", sf); });
            fetchUser(t.id);
        } else {
            head.className = "fr-chhead on"; $("frChCall").disabled = false;
            var gr = database.ref("groups/" + t.id);
            var gf = gr.on("value", function (s) {
                var g = s.val(); if (!g) return; t.members = g.members || {}; t.owner = g.owner;
                stt.textContent = Object.keys(t.members).length + " members · tap for info";
                Object.keys(t.members).forEach(function (id) { if (!userCache[id]) fetchUser(id); });
            });
            chat.offs.push(function () { gr.off("value", gf); });
        }
        $("frMsgs").innerHTML = ""; $("frChat").classList.add("open");
        var ref = database.ref("chats/" + chat.key).limitToLast(150);
        var af = ref.on("child_added", function (s) { renderMsg(s.key, s.val()); markRead(chat.ibox); });
        var rf = ref.on("child_removed", function (s) { var n = msgDom[s.key]; if (n) { n.remove(); delete msgDom[s.key]; } });
        var cf = ref.on("child_changed", function (s) { var n = msgDom[s.key]; if (n) renderMsg(s.key, s.val(), n); });
        chat.offs.push(function () { ref.off("child_added", af); ref.off("child_removed", rf); ref.off("child_changed", cf); });
        markRead(chat.ibox); renderList();
    }
    function closeChat(keepUi) {
        if (chat && chat.offs) chat.offs.forEach(function (f) { f(); });
        chat = null;
        if (!keepUi) { $("frChat").classList.remove("open"); $("frPlusMenu").classList.remove("open"); $("frEmojis").classList.remove("open"); renderList(); }
    }
    function send(msg) {
        if (!chat) return;
        msg.from = me.id; msg.ts = TS;
        if (replyTo) { msg.reply = replyTo; clearReply(); }
        database.ref("chats/" + chat.key).push(msg).catch(function () { toast("Message failed — it may be too large"); });
        if (chat.kind === "group") Object.keys(chat.members || {}).forEach(function (id) { if (id !== me.id) database.ref("inbox/" + id + "/g_" + chat.id).set(TS); });
        else database.ref("inbox/" + chat.id + "/" + me.id).set(TS);
    }
    function sendAttachment(f) {
        if (!f || !chat) return;
        var mime = f.type || "", kind = /^image\//.test(mime) ? "img" : /^video\//.test(mime) ? "video" : (mime === "application/pdf" || /\.pdf$/i.test(f.name)) ? "pdf" : "file";
        if (kind === "img") { shrink(f, 1280, function (d) { send({ type: "img", data: d, name: f.name.slice(0, 80) }); }); return; }
        var base = { type: kind, name: f.name.slice(0, 80), size: f.size, mime: mime };
        if (f.size <= MAX_FILE) { var r = new FileReader(); r.onload = function () { base.data = r.result; send(base); }; r.readAsDataURL(f); return; }
        if (f.size > MAX_UPLOAD) { toast("File is too large (max 50 MB)"); return; }
        if (!firebase.storage) { toast("Large files need Firebase Storage — enable it first"); return; }
        var target = chat, up;
        try { up = firebase.storage().ref("chat/" + chat.key + "/" + Date.now() + "_" + f.name.replace(/[^\w.\-]/g, "_")).put(f); } catch (e) { toast("Upload isn’t available"); return; }
        toast("Uploading " + f.name + "…");
        up.on("state_changed", function (s) { toast("Uploading… " + Math.round(100 * s.bytesTransferred / s.totalBytes) + "%"); },
            function () { toast("Upload failed — check Firebase Storage rules"); },
            function () { up.snapshot.ref.getDownloadURL().then(function (url) { base.url = url; if (chat === target) send(base); else toast("Chat was closed — file not sent"); }); });
    }
    function syncTxt() { $("frCin").classList.toggle("hastxt", !!$("frTxt").value.trim()); }
    function sendText() { var v = $("frTxt").value.trim(); if (!v) return; $("frTxt").value = ""; syncTxt(); send({ type: "text", text: v.slice(0, 2000) }); }

    /* voice messages */
    var rec = null, recChunks = [], recStream = null, recStart = 0, recTick = null, recCancel = false, recAc = null, recLv = [];
    function recWave(an) {
        var cv = $("frWave"); if (!cv) return; var c = cv.getContext("2d"), buf = new Uint8Array(an.fftSize), n = 0; recLv = [];
        (function loop() {
            if (!$("frCin").classList.contains("recording")) return;
            an.getByteTimeDomainData(buf);
            if (n++ % 4 === 0) { var s = 0; for (var i = 0; i < buf.length; i++) { var x = (buf[i] - 128) / 128; s += x * x; } recLv.push(Math.min(1, Math.sqrt(s / buf.length) * 4)); if (recLv.length > 40) recLv.shift(); }
            c.clearRect(0, 0, cv.width, cv.height); c.fillStyle = "#f87171";
            recLv.forEach(function (v, i) { var h = Math.max(3, v * cv.height); c.fillRect(i * 4, (cv.height - h) / 2, 2.4, h); });
            requestAnimationFrame(loop);
        })();
    }
    function stopRecUi() { clearInterval(recTick); try { recAc && recAc.close(); } catch (e) {} recAc = null; $("frCin").classList.remove("recording"); $("frMic").classList.remove("rec"); }
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
            try { recAc = new (window.AudioContext || window.webkitAudioContext)(); var an = recAc.createAnalyser(); an.fftSize = 256; recAc.createMediaStreamSource(st).connect(an); recWave(an); } catch (e) {}
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
        
        $("frCopy").onclick = function () {
            if (navigator.clipboard) navigator.clipboard.writeText(me.id).then(function () { toast("ID copied"); }, function () { toast(me.id); }); else toast(me.id);
        };
        $("frForm").onsubmit = function (e) { e.preventDefault(); search($("frQ").value); };
        $("frNewGroup").onclick = function () { newGroupModal([]); };
        database.ref("inbox/" + me.id).on("value", function (s) {
            inbox = s.val() || {};
            Object.keys(inbox).forEach(function (id) { if (id.indexOf("g_") !== 0 && list.indexOf(id) < 0 && !blocked[id]) { list.unshift(id); saveList(); } });
            if (chat) markRead(chat.ibox);
            renderList();
        });
        database.ref("blocks/" + me.id).on("value", function (s) { var v = s.val(); if (v) { Object.keys(v).forEach(function (k) { if (v[k]) blocked[k] = true; }); saveBlocked(); renderList(); } }, function () {});
        database.ref("userGroups/" + me.id).on("value", function (s) { gids = Object.keys(s.val() || {}); renderList(); });
        renderList();

        $("frBack").onclick = function () { closeChat(); };
        $("frChCall").onclick = function () {
            if (!chat) return;
            if (chat.kind === "group") groupCall({ name: chat.name, members: chat.members });
            else startCall([userCache[chat.id] || { id: chat.id, name: chat.name, avatar: chat.avatar, online: chat.online }]);
        };
        $("frChMore").onclick = function () {
            if (!chat) return;
            if (chat.kind === "group") groupInfoModal(chat);
            else newGroupModal([userCache[chat.id] || { id: chat.id, name: chat.name, avatar: chat.avatar }]);
        };
        $("frSend").onclick = sendText;
        $("frTxt").oninput = syncTxt;
        $("frChBlock").onclick = function () { if (chat && chat.kind === "user") blockUser(userCache[chat.id] || { id: chat.id, name: chat.name }); };
        $("frTxt").onkeydown = function (e) { if (e.key === "Enter") sendText(); };
        $("frReplyX").onclick = clearReply;
        $("frPlus").onclick = function (e) { e.stopPropagation(); $("frEmojis").classList.remove("open"); $("frPlusMenu").classList.toggle("open"); };
        document.addEventListener("click", function (e) { if (!e.target.closest("#frPlusMenu") && !e.target.closest("#frPlus")) $("frPlusMenu").classList.remove("open"); });
        ["frImg", "frVid", "frCam", "frPdf", "frFile"].forEach(function (id) {
            $(id).onchange = function () {
                var fs = [].slice.call(this.files || []); this.value = ""; $("frPlusMenu").classList.remove("open");
                fs.forEach(sendAttachment);
            };
        });
        ["😀", "😂", "😍", "👍", "🔥", "🎉", "📚", "💪", "😴", "🙏", "❤️", "✅"].forEach(function (e) {
            var b = mk("button", "", e); b.type = "button";
            b.onclick = function () { $("frTxt").value += e; syncTxt(); $("frEmojis").classList.remove("open"); $("frTxt").focus(); };
            $("frEmojis").appendChild(b);
        });
        $("frEmBtn").onclick = function () { $("frPlusMenu").classList.remove("open"); $("frEmojis").classList.toggle("open"); };
        $("frMic").onclick = function () { if ($("frCin").classList.contains("recording")) finishRec(false); else startRec(); };
        $("frRecCancel").onclick = function () { finishRec(true); };

        $("frClAdd").onclick = function () { $("frAddBox").classList.toggle("open"); if ($("frAddBox").classList.contains("open")) $("frAddIn").focus(); };
        $("frClEnd").onclick = function () { hangup(""); };
        $("frClMute").onclick = function () {
            muted = !muted; this.classList.toggle("on", muted); if (parts[me.id]) { parts[me.id].status = muted ? "Muted" : "You"; renderParts(); }
            if (localStream) localStream.getAudioTracks().forEach(function (t) { t.enabled = !muted; });
        };
        $("frClSpk").onclick = function () { spkOn = !spkOn; this.classList.toggle("on", spkOn); applySpeaker(); toast(spkOn ? "Speaker on — louder" : "Speaker off"); };
        $("frAddForm").onsubmit = function (e) {
            e.preventDefault(); var i = $("frAddIn");
            findUser(i.value).then(function (u) {
                if (!u) { toast("No user with that ID"); return; }
                if (!u.online) { toast(u.name + " is not online"); return; }
                if (!callActive) { toast("Start a call first"); return; }
                if (parts[u.id]) { toast(u.name + " is already in the call"); return; }
                i.value = ""; invite(u); toast("Calling " + u.name + "…");
            });
        };
    }

    /* ---------- start ---------- */
    window.addEventListener("beforeunload", function () { if (callActive && callId) database.ref("calls/" + callId + "/peers/" + me.id).remove(); });

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
    }).catch(function () { /* offline, or database rules blocked access */ });

})();

/* ===== PWA: the manifest is built here (no manifest.json / icons folder needed) ===== */
(function () {
    try {
        var base = location.href.replace(/[?#].*$/, "").replace(/[^\/]*$/, "").replace(/pages\/$/, "");
        var cv = document.createElement("canvas");
        function icon(n, mask) {
            cv.width = cv.height = n;
            var c = cv.getContext("2d"), g = c.createLinearGradient(0, 0, n, n);
            g.addColorStop(0, "#2563eb"); g.addColorStop(1, "#60a5fa");
            c.fillStyle = g;
            if (mask) c.fillRect(0, 0, n, n);
            else { var r = n * 0.22; c.beginPath(); c.moveTo(r, 0); c.arcTo(n, 0, n, n, r); c.arcTo(n, n, 0, n, r); c.arcTo(0, n, 0, 0, r); c.arcTo(0, 0, n, 0, r); c.closePath(); c.fill(); }
            c.fillStyle = "#fff"; c.textAlign = "center"; c.textBaseline = "middle";
            c.font = "900 " + Math.round(n * (mask ? 0.32 : 0.42)) + "px Arial, Helvetica, sans-serif";
            c.fillText("FL", n / 2, n / 2 + n * 0.02);
            return cv.toDataURL("image/png");
        }
        var i192 = icon(192), i512 = icon(512), im = icon(512, true);
        var man = {
            name: "FocusLab Workspace", short_name: "FocusLab",
            description: "Tasks, videos, notebook and friends in one focus workspace.",
            start_url: base + "index.html", scope: base, display: "standalone",
            background_color: "#0f172a", theme_color: "#2563eb",
            icons: [
                { src: i192, sizes: "192x192", type: "image/png", purpose: "any" },
                { src: i512, sizes: "512x512", type: "image/png", purpose: "any" },
                { src: im, sizes: "512x512", type: "image/png", purpose: "maskable" }
            ]
        };
        var l = document.createElement("link"); l.rel = "manifest";
        l.href = URL.createObjectURL(new Blob([JSON.stringify(man)], { type: "application/manifest+json" }));
        document.head.appendChild(l);
        var a = document.createElement("link"); a.rel = "apple-touch-icon"; a.href = i192; document.head.appendChild(a);
    } catch (e) {}
    if ("serviceWorker" in navigator) {
        window.addEventListener("load", function () {
            var inPages = location.pathname.indexOf("/pages/") > -1;
            navigator.serviceWorker.register(inPages ? "../sw.js" : "sw.js").catch(function () {});
        });
    }
})();

/* ===== LANGUAGE: English (default) → Arabic, switched from Settings ===== */
(function () {
    var AR = {"Home": "الرئيسية", "Tasks": "المهام", "Videos": "الفيديوهات", "Notebook": "الدفتر", "Friends": "الأصدقاء", "Music": "الموسيقى", "Settings": "الإعدادات", "Workspace": "مساحة العمل", "Sign out": "تسجيل الخروج", "Sign In": "تسجيل الدخول", "Create your account": "أنشئ حسابك", "Focus User": "مستخدم فوكس", "User": "مستخدم", "Open menu": "فتح القائمة", "Show the top bar": "إظهار الشريط العلوي", "Close": "إغلاق", "Cancel": "إلغاء", "Back": "رجوع", "Save": "حفظ", "Delete": "حذف", "Copy": "نسخ", "Add": "إضافة", "Search": "بحث", "Send": "إرسال", "More": "المزيد", "Message": "رسالة", "Photo": "صورة", "Video": "فيديو", "Camera": "الكاميرا", "PDF": "PDF", "Any file": "أي ملف", "Attach": "إرفاق", "Emoji": "إيموجي", "Call": "اتصال", "End": "إنهاء", "End call": "إنهاء المكالمة", "Mute": "كتم", "Mute microphone": "كتم الميكروفون", "Speaker": "السماعة", "Block": "حظر", "Unblock": "إلغاء الحظر", "Blocked": "المحظورون", "Settings.": "الإعدادات", "Sound": "الصوت", "Sound is on": "الصوت يعمل", "Sound is off": "الصوت متوقف", "Sound, screen and colours.": "الصوت والشاشة والألوان واللغة.", "Full screen": "ملء الشاشة", "Fill the whole screen with the site": "املأ الشاشة كلها بالموقع", "Appearance": "المظهر", "Light": "فاتح", "Dark": "داكن", "FocusLab": "فوكس لاب", "Language": "اللغة", "Change Avatar": "تغيير الصورة الرمزية", "Change avatar": "تغيير الصورة الرمزية", "Pick an avatar or upload your own photo.": "اختر صورة رمزية أو ارفع صورتك.", "Choose an avatar": "اختر صورة رمزية", "Avatar": "الصورة الرمزية", "Choose Background": "اختر الخلفية", "Backgrounds": "الخلفيات", "Reset Background": "إعادة الخلفية", "Pick a wallpaper, or add your own photos.": "اختر خلفية أو أضف صورك الخاصة.", "YOUR MEDIA": "وسائطك", "Focus Music": "موسيقى التركيز", "+ Add Music": "+ إضافة موسيقى", "Stop Music": "إيقاف الموسيقى", "Get things done.": "أنجز مهامك.", "Stay focused.": "ابقَ مركّزاً.", "Build your productivity": "ابنِ إنتاجيتك", "YOUR PRODUCTIVITY": "إنتاجيتك", "FOCUS • PLAN • ACHIEVE": "ركّز • خطّط • أنجز", "STUDY TOGETHER": "ذاكروا معاً", "Learn and stay inspired": "تعلّم وابقَ ملهَماً", "Manage your daily tasks": "أدِر مهامك اليومية", "Organize your tasks, focus on what matters, and make every study session count.": "نظّم مهامك وركّز على المهم واجعل كل جلسة مذاكرة مثمرة.", "Sign in to start focusing on what matters.": "سجّل الدخول لتبدأ التركيز على ما يهم.", "Chat or call friends while you focus — one-to-one or in a group.": "تحدّث أو اتصل بأصدقائك أثناء التركيز — فردياً أو في مجموعة.", "First name": "الاسم الأول", "Last name": "اسم العائلة", "Email": "البريد الإلكتروني", "Password": "كلمة المرور", "you@example.com": "you@example.com", "Please fill in every field and choose an avatar.": "من فضلك املأ كل الحقول واختر صورة رمزية.", "Created by Ahmed Mohamed & Gamal Mohamed": "من تصميم أحمد محمد وجمال محمد", "FOCUSLAB": "فوكس لاب", "FOCUS SESSION": "جلسة تركيز", "Focus Session": "جلسة تركيز", "Open Tasks": "فتح المهام", "Set your focus session before you start.": "اضبط جلسة التركيز قبل أن تبدأ.", "My Tasks": "مهامي", "All Tasks": "كل المهام", "Add Task": "إضافة مهمة", "Create Task": "إنشاء مهمة", "Create New Task": "إنشاء مهمة جديدة", "Start Task": "ابدأ المهمة", "Delete All": "حذف الكل", "Completed": "المكتملة", "Normal": "عادية", "Important": "مهمة", "Study": "مذاكرة", "Priority": "الأولوية", "Task name": "اسم المهمة", "What do you need to do?": "ماذا تريد أن تنجز؟", "Focus time": "وقت التركيز", "Break": "الراحة", "BREAK TIME": "وقت الراحة", "min": "د", "FILTER TASKS": "تصفية المهام", "QUICK SEARCH": "بحث سريع", "Find a task": "ابحث عن مهمة", "Search tasks...": "ابحث في المهام...", "Search your tasks...": "ابحث في مهامك...", "Bring up a task you're working on...": "استدعِ مهمة تعمل عليها...", "Type at least 2 characters to search your tasks.": "اكتب حرفين على الأقل للبحث في مهامك.", "No tasks yet": "لا توجد مهام بعد", "Create your first task and start focusing.": "أنشئ أول مهمة وابدأ التركيز.", "0 tasks": "0 مهام", "Task in progress": "مهمة قيد التنفيذ", "Your timer is running automatically.": "المؤقت يعمل تلقائياً.", "Task Complete!": "اكتملت المهمة!", "Great job. Keep going.": "عمل رائع. واصل.", "Skip Break": "تخطَّ الراحة", "Take a short rest before your next task.": "خذ استراحة قصيرة قبل مهمتك التالية.", "Dismiss task": "إخفاء المهمة", "Time's Up": "انتهى الوقت", "Time is up.": "انتهى الوقت.", "Timer is paused.": "المؤقت متوقف مؤقتاً.", "Task completed.": "اكتملت المهمة.", "The focus time ended before you finished.": "انتهى وقت التركيز قبل أن تنهي المهمة.", "There are no tasks to delete.": "لا توجد مهام لحذفها.", "One session at a time": "جلسة واحدة في كل مرة", "Always available on this site": "متاح دائماً في الموقع", "Search videos...": "ابحث في الفيديوهات...", "No videos yet": "لا توجد فيديوهات بعد", "Close video": "إغلاق الفيديو", "Search and watch — this library is curated by the site owner.": "ابحث وشاهد — هذه المكتبة من اختيار صاحب الموقع.", "The site owner hasn't added any videos here yet — check back soon.": "لم يضف صاحب الموقع أي فيديو هنا بعد — عاود الزيارة قريباً.", "YouTube": "يوتيوب", "Facebook": "فيسبوك", "TikTok": "تيك توك", "Your ID": "رقمك (ID)", "Friend’s ID": "رقم الصديق (ID)", "Enter your friend’s ID, e.g. FL-20418": "أدخل رقم صديقك، مثل FL-20418", "Your chats": "محادثاتك", "New group": "مجموعة جديدة", "Add person": "إضافة شخص", "Calling…": "جارٍ الاتصال…", "Connecting…": "جارٍ الاتصال…", "Group info / add friends": "معلومات المجموعة / إضافة أصدقاء", "Voice message": "رسالة صوتية", "Cancel recording": "إلغاء التسجيل", "Message options": "خيارات الرسالة", "Add at least one member": "أضف عضواً واحداً على الأقل", "Add friends by their ID": "أضف أصدقاء برقمهم (ID)", "Group name": "اسم المجموعة", "Leave group": "مغادرة المجموعة", "ID copied": "تم نسخ الرقم", "That’s you": "هذا أنت", "No user with that ID": "لا يوجد مستخدم بهذا الرقم", "No one is online to call": "لا أحد متصل للاتصال به", "Start a call first": "ابدأ مكالمة أولاً", "The call has already ended": "انتهت المكالمة بالفعل", "Microphone permission is needed": "مطلوب إذن الميكروفون", "Voice messages aren’t supported on this browser": "الرسائل الصوتية غير مدعومة في هذا المتصفح", "Speaker boost isn’t supported on this browser": "تعزيز السماعة غير مدعوم في هذا المتصفح", "Chat was closed — file not sent": "أُغلقت المحادثة — لم يُرسل الملف", "File is too large (max 50 MB)": "الملف كبير جداً (الحد الأقصى 50 ميجا)", "Large files need Firebase Storage — enable it first": "الملفات الكبيرة تحتاج Firebase Storage — فعّله أولاً", "Upload failed — check Firebase Storage rules": "فشل الرفع — راجع قواعد Firebase Storage", "Upload isn’t available": "الرفع غير متاح", "Message failed — it may be too large": "فشل إرسال الرسالة — قد تكون كبيرة جداً", "Couldn’t read that image": "تعذّرت قراءة الصورة", "Couldn't use that photo. Please try another image.": "تعذّر استخدام الصورة. جرّب صورة أخرى.", "Please choose an image file.": "من فضلك اختر ملف صورة.", "Please choose audio files (MP3, M4A, WAV, OGG, FLAC, MP4 ...).": "من فضلك اختر ملفات صوتية (MP3 وM4A وWAV وOGG وFLAC وMP4 ...).", "This song's format can't be played by your browser. Try an MP3 or M4A version of it.": "صيغة هذه الأغنية غير مدعومة في متصفحك. جرّب نسخة MP3 أو M4A.", "Delete this background?": "حذف هذه الخلفية؟", "Not supported by this browser (iPhone Safari has no full screen).": "غير مدعوم في هذا المتصفح (سفاري على الآيفون لا يدعم ملء الشاشة).", "Storage is full — delete old notebooks": "المساحة ممتلئة — احذف دفاتر قديمة", "Change photo": "تغيير الصورة", "Save name": "حفظ الاسم", "Tap to rename": "اضغط لإعادة التسمية", "Template": "القالب", "Page template": "قالب الصفحة", "Page thumbnails": "مصغّرات الصفحات", "Pages": "الصفحات", "New page": "صفحة جديدة", "Duplicate": "تكرار", "Duplicate page": "تكرار الصفحة", "Delete page": "حذف الصفحة", "Clear page": "مسح الصفحة", "Undo": "تراجع", "Redo": "إعادة", "Zoom in": "تكبير", "Zoom out": "تصغير", "Library": "المكتبة", "Back to library": "الرجوع للمكتبة", "Close book": "إغلاق الدفتر", "Import PDF": "استيراد PDF", "Add PDF": "إضافة PDF", "PDF page": "صفحة PDF", "Drag to move the toolbar": "اسحب لتحريك الشريط", "Pen": "قلم", "Fountain": "حبر", "Calligraphy": "خط", "Pencil": "رصاص", "Brush": "فرشاة", "Marker": "ماركر", "Highlight": "هايلايت", "Eraser": "ممحاة", "Type": "كتابة", "Scroll": "تمرير", "Arrows": "أسهم", "Highlight mode": "وضع الهايلايت", "Free": "حر", "Snap to text": "التقاط النص", "Custom colour": "لون مخصص", "More colours": "ألوان أكثر", "Choose a cover": "اختر غلافاً", "Cover": "الغلاف", "First page": "الصفحة الأولى", "New notebook name": "اسم الدفتر الجديد", "Notes": "ملاحظات", "Cues": "إشارات", "Summary": "ملخص", "Scroll pages / Switch pages": "تمرير الصفحات / التنقل بالأسهم", "Scroll mode · keep scrolling to move between pages": "وضع التمرير · واصل التمرير للانتقال بين الصفحات", "Arrow mode · use the arrows to switch pages": "وضع الأسهم · استخدم الأسهم للتنقل بين الصفحات", "Page cleared · tap Undo to restore": "تم مسح الصفحة · اضغط تراجع للاستعادة", "Tap Delete page again to confirm": "اضغط حذف الصفحة مرة أخرى للتأكيد", "Re-add the PDF to see its pages again": "أعد إضافة الـPDF لرؤية صفحاته", "Opening PDF…": "جارٍ فتح الـPDF…", "PDF added as a new notebook": "أُضيف الـPDF كدفتر جديد", "PDF engine could not load": "تعذّر تحميل محرّك الـPDF", "Book closed — start a new one": "أُغلق الدفتر — ابدأ دفتراً جديداً", "Daily planner (Arabic)": "مخطط يومي (عربي)", "Daily planner (English)": "مخطط يومي (إنجليزي)", "Task list": "قائمة مهام", "White · lines": "أبيض · سطور", "Black · lines": "أسود · سطور", "Grid": "مربعات", "Dotted": "نقاط", "Infinite": "لا نهائية", "Cornell notes": "ملاحظات كورنيل", "Weekly planner": "مخطط أسبوعي", "Weekly planner (Arabic)": "مخطط أسبوعي (عربي)", "Habit tracker": "متتبع العادات", "Study planner": "مخطط المذاكرة", "Legal pad": "دفتر قانوني", "Blueprint": "مخطط أزرق", "Kraft dots": "نقاط كرافت", "Mint grid": "مربعات نعناعية", "Sepia lines": "سطور سيبيا", "Dark dots": "نقاط داكنة", "Dark grid": "مربعات داكنة", "Music staff": "سلّم موسيقي", "Handwriting guide": "دليل الخط اليدوي", "Calligraphy guide": "دليل الخط العربي", "Plain white": "أبيض سادة", "Plain black": "أسود سادة", "Handwriting": "خط اليد", "Modern": "عصري", "Mono": "أحادي", "Serif": "سيريف", "White": "أبيض", "Notebook • FocusLab": "الدفتر • فوكس لاب", "Tasks • FocusLab": "المهام • فوكس لاب", "Videos • FocusLab": "الفيديوهات • فوكس لاب", "Friends • FocusLab": "الأصدقاء • فوكس لاب"};
    var PAT = [[/^Page (\d+) \/ (\d+)$/,function(m){return 'صفحة '+m[1]+' / '+m[2]}],
[/^Page (\d+)$/,function(m){return 'صفحة '+m[1]}],
[/^(\d+) tasks?$/,function(m){return m[1]+' مهام'}],
[/^(\d+) members?$/,function(m){return m[1]+' أعضاء'}],
[/^Calling (.+)…?$/,function(m){return 'جارٍ الاتصال بـ '+m[1]}],
[/^Uploading… (\d+)%$/,function(m){return 'جارٍ الرفع… '+m[1]+'%'}],
[/^Uploading (.+)…$/,function(m){return 'جارٍ رفع '+m[1]+'…'}],
[/^Block (.+)\?$/,function(m){return 'حظر '+m[1]+'؟'}],
[/^Blocked \((\d+)\)$/,function(m){return 'المحظورون ('+m[1]+')'}],
[/^(.+) blocked$/,function(m){return 'تم حظر '+m[1]}],
[/^(.+) is not online$/,function(m){return m[1]+' غير متصل'}],
[/^(.+) is already in the call$/,function(m){return m[1]+' موجود في المكالمة بالفعل'}],
[/^Could not open PDF: (.+)$/,function(m){return 'تعذّر فتح الـPDF: '+m[1]}],
[/^(\d+) min$/,function(m){return m[1]+' د'}]];
    var KEY = "focusLab_lang", lang = "en";
    try { lang = localStorage.getItem(KEY) === "ar" ? "ar" : "en"; } catch (e) {}
    var docs = [], orig = new WeakMap(), applied = new WeakMap();
    var ATTRS = ["placeholder", "title", "aria-label", "alt"];

    function tr(s) {
        var t = s.replace(/\s+/g, " ").trim();
        if (!t) return null;
        if (Object.prototype.hasOwnProperty.call(AR, t)) return AR[t];
        for (var i = 0; i < PAT.length; i++) { var m = t.match(PAT[i][0]); if (m) return PAT[i][1](m); }
        return null;
    }
    function skip(n) {
        var p = n.parentNode;
        if (!p || p.nodeType !== 1) return false;
        var tag = p.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" || tag === "CODE") return true;
        return !!(p.closest && p.closest("[contenteditable=true],[data-nt]"));
    }
    function doText(n) {
        if (skip(n)) return;
        var v = n.nodeValue;
        if (applied.has(n) && applied.get(n) === v) { if (lang === "en") { n.nodeValue = orig.get(n); applied.delete(n); } return; }
        applied.delete(n);
        if (lang !== "ar") return;
        var t = tr(v); if (t === null) return;
        var out = v.match(/^\s*/)[0] + t + v.match(/\s*$/)[0];
        orig.set(n, v); n.nodeValue = out; applied.set(n, out);
    }
    function doAttr(el, a) {
        var v = el.getAttribute(a); if (v === null) return;
        var k = el, rec = applied.get(k) || {}, or = orig.get(k) || {};
        if (rec[a] !== undefined && rec[a] === v) { if (lang === "en") { el.setAttribute(a, or[a]); delete rec[a]; } return; }
        delete rec[a];
        if (lang === "ar") { var t = tr(v); if (t !== null) { or[a] = v; rec[a] = t; el.setAttribute(a, t); } }
        applied.set(k, rec); orig.set(k, or);
    }
    function scan(root, d) {
        if (!root) return;
        if (root.nodeType === 3) { doText(root); return; }
        if (root.nodeType !== 1 && root.nodeType !== 9) return;
        var w = d.createTreeWalker(root, 4), n;
        while ((n = w.nextNode())) doText(n);
        var els = root.nodeType === 1 ? [root].concat([].slice.call(root.querySelectorAll("[placeholder],[title],[aria-label],[alt]"))) : [].slice.call(root.querySelectorAll("[placeholder],[title],[aria-label],[alt]"));
        els.forEach(function (el) { ATTRS.forEach(function (a) { if (el.hasAttribute && el.hasAttribute(a)) doAttr(el, a); }); });
    }
    function titleFix(d) { var t = d.title; if (!t) return; if (lang === "ar") { var x = tr(t); if (x) { d.__t0 = t; d.title = x; } } else if (d.__t0) { d.title = d.__t0; d.__t0 = null; } }
    function attach(d) {
        if (!d || !d.body || docs.indexOf(d) > -1) return;
        docs.push(d);
        var mo = new MutationObserver(function (list) {
            list.forEach(function (m) {
                if (m.type === "characterData") doText(m.target);
                else if (m.type === "attributes") doAttr(m.target, m.attributeName);
                else m.addedNodes.forEach(function (n) { scan(n, d); });
            });
        });
        mo.observe(d.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
        paint(d);
    }
    function paint(d) {
        var r = d.documentElement;
        r.lang = lang === "ar" ? "ar" : "en"; r.classList.toggle("lang-ar", lang === "ar");
        scan(d.body, d); titleFix(d);
    }
    function ui() {
        docs.forEach(function (d) { [].forEach.call(d.querySelectorAll("[data-lang-option]"), function (b) { var on = b.dataset.langOption === lang; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); }); });
    }
    window.setSiteLang = function (l) {
        lang = l === "ar" ? "ar" : "en";
        try { localStorage.setItem(KEY, lang); } catch (e) {}
        docs.forEach(paint); ui();
    };
    function hookFrame() {
        var f = document.getElementById("nbFrame"); if (!f) return;
        var go = function () { try { var d = f.contentDocument; if (d && d.body) attach(d); } catch (e) {} };
        f.addEventListener("load", go); go();
    }
    function start() { attach(document); hookFrame(); ui(); }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
