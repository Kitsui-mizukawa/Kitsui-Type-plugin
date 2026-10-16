/*
 *        |
 *       /|\      Kitsu Auto Typeset
 *      / | \     Guhua Style: Rain Swords
 *        |       ~ for Xingqiu, Juvenile Galant ~
 *        |
 */

var { app, action } = require("photoshop");
function executeAsModal(fn, opts) {
    return require("photoshop").core.executeAsModal(fn, opts);
}
const { entrypoints } = require("uxp");

try {
    entrypoints.setup({
        commands: {
            reloadPlugin: () => window.location.reload()
        },
        panels: {
            mainPanel: {
                show() { _panelVisible = true; },
                hide() { _panelVisible = false; },
                menuItems: [
                    { id: "showNotes", label: "Notes", checked: true, enabled: true },
                    { id: "showFontSettings", label: "Font Settings", checked: false, enabled: true },
                    { id: "showSettings", label: "Settings", checked: false, enabled: true },
                    { id: "showLog", label: "Log", checked: false, enabled: true },
                    { id: "clearNotes", label: "Clear all notes", checked: false, enabled: true }
                ],
                invokeMenu(id) {
                    switch (id) {
                        case "showNotes": switchView("notes"); break;
                        case "showFontSettings": switchView("fontsettings"); break;
                        case "showSettings": switchView("settings"); break;
                        case "showLog": switchView("log"); break;
                        case "clearNotes": clearAllNotes(); break;
                    }
                }
            }
        }
    });
} catch (e) {
    console.error("[Kitsu] entrypoints.setup() GAGAL:", e && e.message, e);
}

var _notes = [];
var _currentIdx = 0;
var _modalBusy = false;
var _lastHasSelection = false;
var _lastHasDocument = false;
var _activeView = "notes";

var _multiBubbleMode = false;
var _bubbleQueue = [];
var _lastCaptureHash = null;
var _lastCaptureRawKey = null;
var _capturing = false;
var _panelVisible = true;

var _fontData = { folders: [], styles: [], activeFolderId: null };
var _editingStyleId = null;

var LS_NOTES = "kitsu_typeset_notes";
var LS_CURIDX = "kitsu_typeset_curidx";
var LS_SETTINGS = "kitsu_typeset_settings";
var LS_SETTINGS_BACKUP = "kitsu_typeset_settings_backup";
var LS_FONTDATA = "kitsu_typeset_fontdata";
var LS_FONTDATA_BACKUP = "kitsu_typeset_fontdata_backup";

var _logBuffer = [];
var _logFlushTimer = null;

const MAX_LOG_ENTRIES = 200;

function flushLog() {
    _logFlushTimer = null;
    if (_logBuffer.length === 0) return;
    const area = document.getElementById("log-area");
    if (!area) { _logBuffer = []; return; }
    const frag = document.createDocumentFragment();
    for (const e of _logBuffer) {
        const div = document.createElement("div");
        div.className = "log-entry " + (e.type || "");
        div.textContent = "[" + e.ts + "] " + e.msg;
        frag.appendChild(div);
    }
    area.appendChild(frag);
    while (area.children.length > MAX_LOG_ENTRIES) {
        area.removeChild(area.firstChild);
    }
    area.scrollTop = area.scrollHeight;
    _logBuffer = [];
}

const LOG_HISTORY_MAX = 5000;
var _logHistory = [];

function log(msg, type) {
    if (_logLevel < LOG_LEVEL_NORMAL &&
        (_logLevel === LOG_LEVEL_OFF || (type !== "error" && type !== "warn"))) return;
    const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
    _logBuffer.push({ ts: ts, msg: msg, type: type });
    _logHistory.push("[" + ts + "] " + (type && type !== "info" ? type.toUpperCase() + ": " : "") + msg);
    if (_logHistory.length > LOG_HISTORY_MAX + 500) _logHistory.splice(0, _logHistory.length - LOG_HISTORY_MAX);
    if (!_logFlushTimer) _logFlushTimer = setTimeout(flushLog, 0);
}

async function saveLogFile() {
    try {
        const uxp = require("uxp");
        const folder = await uxp.storage.localFileSystem.getDataFolder();
        const file = await folder.createFile("kitsu-log.txt", { overwrite: true });
        const n = _logHistory.length;
        const header = "Kitsu Auto Typeset log — disimpan " + new Date().toString() + " — " + n + " baris" +
            (n >= LOG_HISTORY_MAX ? " (dipangkas, maks " + LOG_HISTORY_MAX + ")" : "") + "\n";
        await file.write(header + _logHistory.join("\n") + "\n", { format: uxp.storage.formats.utf8 });
        log("Log disimpan (" + n + " baris): PluginData/" + file.name, "success");
        setStatusPill("Log saved (" + n + " lines)", "status-ok");
    } catch (e) {
        log("Simpan log gagal: " + (e && e.message ? e.message : String(e)), "error");
    }
}

var LOG_LEVEL_OFF = 0;
var LOG_LEVEL_ERRORS = 1;
var LOG_LEVEL_NORMAL = 2;
var LOG_LEVEL_VERBOSE = 3;
var _LOG_LEVELS = { off: LOG_LEVEL_OFF, errors: LOG_LEVEL_ERRORS, normal: LOG_LEVEL_NORMAL, verbose: LOG_LEVEL_VERBOSE };
var _logLevel = LOG_LEVEL_NORMAL;
var _verboseOn = false;

function _syncLogLevel() {
    const el = document.getElementById("select-log-level");
    const v = el ? el.value : "normal";
    const lv = (_LOG_LEVELS[v] !== undefined) ? _LOG_LEVELS[v] : LOG_LEVEL_NORMAL;
    const prev = _logLevel;
    _logLevel = lv;
    _verboseOn = lv >= LOG_LEVEL_VERBOSE;
    const area = document.getElementById("log-area");
    if (lv === LOG_LEVEL_OFF) {
        _logBuffer = [];
        _logHistory = [];
        _vlogLast = {};
        if (_logFlushTimer) { clearTimeout(_logFlushTimer); _logFlushTimer = null; }
        if (area) {
            area.innerHTML = "";
            const div = document.createElement("div");
            div.className = "log-entry info";
            div.textContent = "Log is off (Settings → Behavior → Log).";
            area.appendChild(div);
        }
    } else if (prev === LOG_LEVEL_OFF) {
        if (area) area.innerHTML = "";
        log("Log level: " + v + ".", "info");
    }
}

function vlog(msg, type) {
    if (!_verboseOn) return;
    log(msg, type);
}

var _vlogLast = {};
function _vlogChanged(key, msg, type) {
    if (!_verboseOn || _vlogLast[key] === msg) return;
    _vlogLast[key] = msg;
    log(msg, type || "warn");
}
function _vlogOk(key) {
    if (_vlogLast[key] !== undefined) _vlogLast[key] = undefined;
}
function _errMsg(e) {
    return (e && e.message) ? e.message : String(e);
}

var _bpCount = 0;
function _perfNow() {
    return (typeof performance !== "undefined" && typeof performance.now === "function")
        ? performance.now() : Date.now();
}
function _perfBegin(name) {
    return { name: name, t0: _perfNow(), bp0: _bpCount };
}
function _perfEnd(tok, extra) {
    if (!_verboseOn || !tok) return;
    const ms = Math.round(_perfNow() - tok.t0);
    let heap = "";
    try {
        if (typeof performance !== "undefined" && performance.memory) {
            heap = " · heap " + (performance.memory.usedJSHeapSize / 1048576).toFixed(1) + " MB";
        }
    } catch (e) {
        console.warn("[Kitsu] baca performance.memory gagal:", e && e.message ? e.message : String(e));
    }
    log("⏱ " + tok.name + ": " + ms + " ms, " + (_bpCount - tok.bp0) + " batchPlay" +
        (extra ? " · " + extra : "") + heap, "info");
}

function clearLog() {
    _logBuffer = [];
    _logHistory = [];
    if (_logFlushTimer) { clearTimeout(_logFlushTimer); _logFlushTimer = null; }
    const area = document.getElementById("log-area");
    if (area) area.innerHTML = "";
    log("Log cleared.", "info");
}

const PILL_HOLD_MS = 4000;
var _pillHoldTimer = null;

function setStatusPill(text, cls) {
    const el = document.getElementById("status-pill");
    if (!el) return;
    el.textContent = text;
    el.title = text;
    el.className = "status-pill " + (cls || "status-none");
    el.style.display = "";
    if (_pillHoldTimer) clearTimeout(_pillHoldTimer);
    _pillHoldTimer = setTimeout(() => {
        _pillHoldTimer = null;
        el.style.display = "none";
    }, PILL_HOLD_MS);
}

function truncate(str, max) {
    if (!str) return "";
    return str.length > max ? str.substring(0, max - 1) + "…" : str;
}

async function refreshSelectionBounds(src) {
    if (_modalBusy) return;
    if (!hasActiveDocument()) {
        _lastHasDocument = false;
        _lastHasSelection = false;
        refreshStatusLight();
        return;
    }
    _lastHasDocument = true;
    const tok = _perfBegin("Refresh selection (" + (src || "after") + ")");
    try {
        const sel = await getSelectionBounds();
        _lastHasSelection = !!sel;
        _pvApplySelectionBounds(sel);
        _vlogOk("refreshSel");
    } catch (e) {
        _lastHasSelection = false;
        _vlogChanged("refreshSel", "refreshSelectionBounds gagal: " + _errMsg(e));
    }
    _perfEnd(tok);
    refreshStatusLight();
}

function refreshStatusLight() {
    if (_modalBusy) return;
    _lastHasDocument = hasActiveDocument();
    if (!_lastHasDocument) {
        _setApplyEnabled(false);
        return;
    }
    const hasNote = (currentNoteText() || "").trim().length > 0;
    const liveOn = _readCheckbox("checkbox-live-selection", false);

    if (!liveOn) {
        _setApplyEnabled(hasNote);
        return;
    }
    if (!_lastHasSelection || !hasNote) {
        _setApplyEnabled(false);
        return;
    }
    _setApplyEnabled(true);
}

function _setApplyEnabled(on) {
    const btn = document.getElementById("btn-apply");
    if (btn) btn.disabled = !on;
}

var _statusDebounceTimer = null;
function _scheduleLightRefresh() {
    if (_statusDebounceTimer) clearTimeout(_statusDebounceTimer);
    _statusDebounceTimer = setTimeout(refreshStatusLight, 200);
}

var _selPollHandle = null;
const SEL_POLL_INTERVAL_MS = 5000;
function _startSelectionPoll() {
    if (_selPollHandle) return;
    if (_activeView !== "notes") return;
    if (!_readCheckbox("checkbox-live-selection", false)) return;
    refreshSelectionBounds("poll");
    _selPollHandle = setInterval(() => {
        if (!_modalBusy) refreshSelectionBounds("poll");
    }, SEL_POLL_INTERVAL_MS);
}
function _stopSelectionPoll() {
    if (_selPollHandle) { clearInterval(_selPollHandle); _selPollHandle = null; }
}

const LAYOUT_NARROW_MAX_W = 420;
const LAYOUT_SHORT_MAX_H = 1000;
var _layoutMode = "";

function _updateLayoutMode() {
    try {
        const body = document.body;
        if (!body) return;
        const r = body.getBoundingClientRect();
        const w = Math.round(r.width || body.clientWidth || 0);
        const h = Math.round(r.height || body.clientHeight || 0);
        if (!w || !h) return;
        const isNarrow = w < LAYOUT_NARROW_MAX_W;
        const isShort = h < LAYOUT_SHORT_MAX_H;
        body.classList.toggle("layout-narrow", isNarrow);
        body.classList.toggle("layout-short", isShort);
        const mode = (isNarrow ? "narrow" : "wide") + "/" + (isShort ? "short" : "tall");
        if (mode !== _layoutMode) {
            _layoutMode = mode;
            vlog("Layout panel " + w + "×" + h + " → " + mode, "info");
        }
        _syncScrollGutters();
    } catch (e) {
        console.warn("[Kitsu] _updateLayoutMode gagal:", e && e.message ? e.message : String(e));
    }
}

const _GUTTER_IDS = ["note-list", "pv-scroll", "restyle-strip"];
function _syncScrollGutters() {
    if (_activeView !== "notes") return;
    try {
        const els = _GUTTER_IDS.map(id => document.getElementById(id)).filter(Boolean);
        for (const el of els) el.style.paddingRight = "";
        const own = els.map(el => Math.max(0, el.offsetWidth - el.clientWidth));
        const sbw = Math.max.apply(null, own.concat([0]));
        els.forEach((el, i) => {
            if (own[i] < sbw) el.style.paddingRight = (sbw - own[i]) + "px";
        });
    } catch (e) {
        console.warn("[Kitsu] _syncScrollGutters gagal:", e && e.message ? e.message : String(e));
    }
}

function _initLayoutWatch() {
    _updateLayoutMode();
    window.addEventListener("resize", _updateLayoutMode);
    document.body.addEventListener("mouseenter", _updateLayoutMode);
    if (typeof ResizeObserver === "function") {
        try {
            new ResizeObserver(_updateLayoutMode).observe(document.body);
        } catch (e) {
            vlog("ResizeObserver gagal dipasang: " + (e && e.message ? e.message : String(e)), "warn");
        }
    }
}
const _FLYOUT_VIEW_MENU = {
    notes: "showNotes",
    fontsettings: "showFontSettings",
    styleeditor: "showFontSettings",
    settings: "showSettings",
    log: "showLog"
};
function _syncFlyoutChecks(view) {
    try {
        const panel = entrypoints.getPanel("mainPanel");
        if (!panel || !panel.menuItems) return;
        const activeId = _FLYOUT_VIEW_MENU[view] || null;
        for (const id of ["showNotes", "showFontSettings", "showSettings", "showLog"]) {
            const item = panel.menuItems.getItem(id);
            if (item) item.checked = (id === activeId);
        }
    } catch (e) {
        console.error("[Kitsu] sync flyout check gagal:", e && e.message ? e.message : String(e));
    }
}

function switchView(name) {
    _activeView = name;
    const views = ["notes", "fontsettings", "styleeditor", "settings", "log"];
    for (const v of views) {
        const el = document.getElementById("view-" + v);
        if (el) el.style.display = (v === name) ? "" : "none";
    }
    if (name !== "notes") _stopSelectionPoll();
    else {
        _startSelectionPoll();
        setTimeout(_scrollQueueToCurrent, 0);
        setTimeout(_syncScrollGutters, 0);
        _updatePreviewFromSelection();
    }
    if (name === "fontsettings") renderFontSettings();
    _syncFlyoutChecks(name);
}

function switchSettingsTab(name) {
    const tabs = ["general", "appearance", "behavior", "shortcuts", "data"];
    for (const t of tabs) {
        const panel = document.getElementById("stab-" + t);
        if (panel) panel.style.display = (t === name) ? "" : "none";
    }
    document.querySelectorAll(".settings-tab-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.stab === name);
    });
}
