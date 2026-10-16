const _SETTINGS_FIELDS = [
    { id: "select-align", key: "align", type: "text" },
    { id: "select-wrap-shape", key: "wrapShape", type: "text" },
    { id: "select-algorithm", key: "algorithm", type: "text" },
    { id: "input-edge-min-letters", key: "edgeMinLetters", type: "number" },
    { id: "input-v4-soften", key: "v4Soften", type: "number" },
    { id: "input-v4-floor", key: "v4Floor", type: "number" },
    { id: "input-v4-punct", key: "v4Punct", type: "number" },
    { id: "input-v4-slack", key: "v4Slack", type: "number" },
    { id: "input-v4-mweight", key: "v4Mweight", type: "number" },
    { id: "input-v4-abias", key: "v4Abias", type: "number" },
    { id: "input-v4-aweight", key: "v4Aweight", type: "number" },
    { id: "input-v4-leading", key: "v4Leading", type: "number" },
    { id: "input-v4-minwords", key: "v4MinWords", type: "number" },
    { id: "checkbox-auto-resize", key: "autoResize", type: "checkbox" },
    { id: "input-resize-pct", key: "resizePct", type: "number" },
    { id: "select-resize-fit", key: "resizeFit", type: "text" },
    { id: "checkbox-restyle-reshape", key: "restyleReshape", type: "checkbox" },
    { id: "checkbox-restyle-resize", key: "restyleResize", type: "checkbox" },
    { id: "checkbox-pop-on-apply", key: "popOnApply", type: "checkbox" },
    { id: "checkbox-remove-tail-apply", key: "doRemoveTailApply", type: "checkbox" },
    { id: "checkbox-deselect-after", key: "deselectAfter", type: "checkbox" },
    { id: "checkbox-live-selection", key: "liveSelection", type: "checkbox" },
    { id: "checkbox-multi-bubble", key: "multiBubble", type: "checkbox" },
    { id: "select-resize-target", key: "resizeTarget", type: "text" },
    { id: "select-resize-mode", key: "resizeMode", type: "text" },
    { id: "input-resize-step", key: "resizeStep", type: "number" },
    { id: "select-log-level", key: "logLevel", type: "text" },
    { id: "select-queue-view", key: "queueView", type: "text" },
    { id: "input-preview-size", key: "previewSize", type: "number" },
    { id: "input-preview-font", key: "previewFont", type: "number" },
    { id: "checkbox-preview-compact", key: "previewCompact", type: "checkbox" },
    { id: "select-ui-font-mode", key: "uiFontMode", type: "text" },
    { id: "input-ui-font-size", key: "uiFontSize", type: "number" },
    { id: "preview-panel", key: "previewOpen", type: "details" },
    { id: "input-ignore-prefixes", key: "ignorePrefixes", type: "text" },
    { id: "select-noprefix-mode", key: "noPrefixMode", type: "text" },
    { id: "input-page-marks", key: "pageMarks", type: "text" },
    { id: "input-follow-prefixes", key: "followPrefixes", type: "text" },
    { id: "checkbox-remove-tail", key: "doRemoveTail", type: "checkbox" },
    { id: "input-remove-tail", key: "removeTailPx", type: "number" },
    { id: "checkbox-fill-holes", key: "doFillHoles", type: "checkbox" },
    { id: "input-edge-inset", key: "edgeInsetPx", type: "number" },
    { id: "select-clean-color", key: "cleanColorMode", type: "text" },
    { id: "select-bar-button", key: "barButton", type: "text" }
];

function _applySettingsData(data) {
    const res = { applied: 0, rejected: [] };
    for (const f of _SETTINGS_FIELDS) {
        if (data[f.key] === undefined) continue;
        const el = document.getElementById(f.id);
        if (!el) continue;
        const v = data[f.key];
        if (f.type === "checkbox") el.checked = !!v;
        else if (f.type === "details") {
            if (typeof el.open === "boolean") el.open = !!v;
            if (v) el.setAttribute("open", ""); else el.removeAttribute("open");
        } else if (String(el.tagName).toUpperCase() === "SELECT") {
            const s = String(v);
            const opts = el.querySelectorAll("option");
            let found = opts.length === 0;
            for (let i = 0; i < opts.length; i++) if (opts[i].value === s) { found = true; break; }
            if (!found) { res.rejected.push(f.key); continue; }
            el.value = s;
            for (let i = 0; i < opts.length; i++) {
                const on = opts[i].value === s;
                opts[i].selected = on;
                if (on) opts[i].setAttribute("selected", ""); else opts[i].removeAttribute("selected");
            }
        } else el.value = v;
        el._userEdited = true;
        res.applied++;
    }
    return res;
}

function _collectSettingsData() {
    const data = {};
    for (const f of _SETTINGS_FIELDS) {
        const el = document.getElementById(f.id);
        if (!el) continue;
        if (f.type === "checkbox") data[f.key] = !!el.checked;
        else if (f.type === "details") data[f.key] = (typeof el.open === "boolean") ? el.open : el.hasAttribute("open");
        else data[f.key] = el.value;
    }
    return data;
}

function loadSavedSettings() {
    try {
        const raw = localStorage.getItem(LS_SETTINGS);
        if (!raw) return;
        const data = JSON.parse(raw);
        const res = _applySettingsData(data);
        if (res.rejected.length) log("Settings tersimpan tanpa opsi padanan (default dipakai): " + res.rejected.join(", "), "warn");
        if (data.logLevel === undefined && data.verboseLog !== undefined) {
            const lv = document.getElementById("select-log-level");
            if (lv) lv.value = data.verboseLog ? "verbose" : "normal";
        }
    } catch (e) {
        log("loadSavedSettings error: " + e.message, "error");
    }
}

function saveSettings() {
    try {
        localStorage.setItem(LS_SETTINGS, JSON.stringify(_collectSettingsData()));
    } catch (e) {
        log("saveSettings error: " + e.message, "error");
    }
}

const SETTINGS_FORMAT_VERSION = 1;

function _validateSettingsData(obj) {
    const out = { settings: {}, count: 0, invalid: [], unknown: [] };
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
    const known = {};
    for (const f of _SETTINGS_FIELDS) {
        known[f.key] = true;
        if (!Object.prototype.hasOwnProperty.call(obj, f.key)) continue;
        const v = obj[f.key];
        let ok;
        if (f.type === "checkbox" || f.type === "details") ok = typeof v === "boolean";
        else if (f.type === "number") ok = (typeof v === "number" && isFinite(v)) ||
            (typeof v === "string" && v.trim() !== "" && isFinite(Number(v)));
        else ok = typeof v === "string";
        if (!ok) { out.invalid.push(f.key); continue; }
        out.settings[f.key] = (f.type === "number") ? String(v).trim() : v;
        out.count++;
    }
    for (const k of Object.keys(obj)) if (!known[k]) out.unknown.push(k);
    return out;
}

function _parseSettingsFile(json) {
    if (!json || typeof json !== "object" || Array.isArray(json)) return { error: "unknown" };
    const s = json.settings;
    if (json.kitsuSettings !== undefined && s && typeof s === "object" && !Array.isArray(s)) {
        const r = _validateSettingsData(s);
        r.formatVersion = json.kitsuSettings;
        return r;
    }
    if (Array.isArray(json.styles) || Array.isArray(json.exportedStyles)) return { error: "style" };
    return { error: "unknown" };
}

function _buildSettingsExport(data, version) {
    return {
        kitsuSettings: SETTINGS_FORMAT_VERSION,
        version: String(version || ""),
        exported: new Date().toISOString(),
        settings: Object.assign({}, data)
    };
}

function _afterSettingsChanged() {
    _syncLogLevel();
    const mb = _readCheckbox("checkbox-multi-bubble", false);
    if (mb !== _multiBubbleMode) _setMultiBubbleMode(mb, false);
    _stopSelectionPoll();
    if (_readCheckbox("checkbox-live-selection", false)) _startSelectionPoll();
    _pvApplyCompact();
    _applyUiFont();
    _pvSyncSoftenFromInput();
    _syncBarButton();
    if (_notes.length) rescanPrefixes(); else renderNotes();
    _renderPreview();
}

const UI_FONT_BASE = 11, UI_FONT_MIN = 8, UI_FONT_MAX = 16;
var _uiFontCssText = null;

async function _readPluginCss() {
    if (_uiFontCssText != null) return _uiFontCssText;
    const fs = require("uxp").storage.localFileSystem;
    const folder = await fs.getPluginFolder();
    const file = await folder.getEntry("style.css");
    _uiFontCssText = String(await file.read());
    return _uiFontCssText;
}

function _scaledFontRules(css, scale) {
    const out = [];
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(clean))) {
        const decls = [];
        const dre = /(font-size|--resize-btn-font)\s*:\s*([\d.]+)px/g;
        let d;
        while ((d = dre.exec(m[2]))) decls.push(d[1] + ": " + (parseFloat(d[2]) * scale).toFixed(2) + "px");
        if (decls.length) out.push(m[1].trim() + " { " + decls.join("; ") + "; }");
    }
    return out.join("\n");
}

async function _applyUiFont() {
    const custom = _readText("select-ui-font-mode", "auto") === "custom";
    const row = document.getElementById("row-ui-font-size");
    if (row) row.style.display = custom ? "" : "none";
    let tag = document.getElementById("ui-font-style");
    if (!custom) {
        if (tag) tag.textContent = "";
        return;
    }
    const v = parseFloat(_readText("input-ui-font-size", String(UI_FONT_BASE)));
    const px = isFinite(v) ? Math.max(UI_FONT_MIN, Math.min(UI_FONT_MAX, v)) : UI_FONT_BASE;
    try {
        const css = _scaledFontRules(await _readPluginCss(), px / UI_FONT_BASE);
        if (!tag) {
            tag = document.createElement("style");
            tag.id = "ui-font-style";
            document.head.appendChild(tag);
        }
        tag.textContent = css;
        _updateLayoutMode();
    } catch (e) {
        log("UI font size gagal diterapkan: " + (e && e.message ? e.message : String(e)), "error");
    }
}

function _barButtonIsReplace() {
    return _readText("select-bar-button", "clean") === "replace";
}

function _syncBarButton() {
    const btn = document.getElementById("btn-clean");
    if (!btn) return;
    const replace = _barButtonIsReplace();
    btn.textContent = replace ? "Replace text" : "Clean Bubble";
    if (replace) btn.title = "Replace the text layer inside the selection with the CURRENT note (style from its tag), then advance";
    else btn.removeAttribute("title");
}

function _applyImportedSettings(parsed) {
    const res = _applySettingsData(parsed.settings);
    saveStateNow();
    _afterSettingsChanged();
    return res;
}

async function exportSettingsFile() {
    try {
        const uxp = require("uxp");
        const file = await uxp.storage.localFileSystem.getFileForSaving("kitsu-settings.json", { types: ["json"] });
        if (!file) return;
        const version = (uxp.versions && uxp.versions.plugin) || "";
        const payload = _buildSettingsExport(_collectSettingsData(), version);
        await file.write(JSON.stringify(payload, null, 2), { format: uxp.storage.formats.utf8 });
        log("Ekspor settings: " + Object.keys(payload.settings).length + " field → " + file.name + ".", "success");
        setStatusPill("Settings exported", "status-ok");
    } catch (e) {
        log("Ekspor settings gagal: " + (e && e.message ? e.message : String(e)), "error");
    }
}

async function importSettingsFile() {
    try {
        const fs = require("uxp").storage.localFileSystem;
        const file = await fs.getFileForOpening({ types: ["json"] });
        if (!file) return;
        let raw = await file.read();
        raw = (typeof raw === "string" ? raw : String(raw)).replace(/^﻿/, "");
        const parsed = _parseSettingsFile(JSON.parse(raw));
        if (parsed.error === "style") {
            log("File " + file.name + " berisi library style, bukan settings — impor lewat Font Settings → Import. Settings tidak diubah.", "error");
            setStatusPill("Not a settings file", "status-warn");
            return;
        }
        if (parsed.error || !parsed.count) {
            log("Format file settings tidak dikenali / tidak ada field valid (" + file.name + ") — settings tidak diubah.", "error");
            setStatusPill("Not a settings file", "status-warn");
            return;
        }
        if (parsed.formatVersion !== SETTINGS_FORMAT_VERSION) {
            log("Versi format settings " + parsed.formatVersion + " (plugin ini " + SETTINGS_FORMAT_VERSION + ") — field yang dikenali tetap diimpor.", "warn");
        }
        try {
            localStorage.setItem(LS_SETTINGS_BACKUP, JSON.stringify(_collectSettingsData()));
        } catch (e) {
            log("Backup settings gagal — impor dibatalkan: " + (e && e.message ? e.message : String(e)), "error");
            return;
        }
        const res = _applyImportedSettings(parsed);
        if (parsed.invalid.length) log("Impor settings: tipe nilai salah, dilewati: " + parsed.invalid.join(", "), "warn");
        if (res.rejected.length) log("Impor settings: opsi tidak dikenal, dilewati: " + res.rejected.join(", "), "warn");
        if (parsed.unknown.length) vlog("Impor settings: key tak dikenal diabaikan: " + parsed.unknown.join(", "), "info");
        log("Impor settings: " + res.applied + " field diterapkan (" + file.name + "). Settings lama di-backup — " +
            "pulihkan via Settings → Data → Restore previous settings.", "success");
        setStatusPill("Settings imported (" + res.applied + ")", "status-ok");
    } catch (e) {
        log("Impor settings gagal: " + (e && e.message ? e.message : String(e)), "error");
    }
}

function restoreSettingsBackup() {
    try {
        const raw = localStorage.getItem(LS_SETTINGS_BACKUP);
        if (!raw) {
            log("Belum ada backup settings (dibuat otomatis saat impor settings).", "warn");
            setStatusPill("No settings backup yet", "status-warn");
            return;
        }
        const parsed = _validateSettingsData(JSON.parse(raw));
        if (!parsed.count) {
            log("Backup settings kosong / rusak — tidak dipulihkan.", "error");
            return;
        }
        localStorage.setItem(LS_SETTINGS_BACKUP, JSON.stringify(_collectSettingsData()));
        const res = _applyImportedSettings(parsed);
        if (res.rejected.length) log("Restore settings: opsi tidak dikenal, dilewati: " + res.rejected.join(", "), "warn");
        log("Settings dipulihkan dari backup: " + res.applied + " field (settings sebelumnya kini jadi backup).", "success");
        setStatusPill("Settings restored from backup", "status-ok");
    } catch (e) {
        log("Restore settings gagal: " + (e && e.message ? e.message : String(e)), "error");
    }
}

function loadSavedNotes() {
    try {
        const savedIdx = parseInt(localStorage.getItem(LS_CURIDX), 10);
        if (!isNaN(savedIdx)) _currentIdx = savedIdx;
        const raw = localStorage.getItem(LS_NOTES);
        if (!raw) { renderNotes(); return; }
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            setNotes(parsed);
        } else if (typeof parsed === "string") {
            setNotes(parseScript(parsed));
        } else {
            renderNotes();
        }
    } catch (e) {
        log("loadSavedNotes error: " + e.message, "error");
    }
}

function saveNotes() {
    try {
        localStorage.setItem(LS_CURIDX, String(_currentIdx));
        localStorage.setItem(LS_NOTES, JSON.stringify(_notes));
    } catch (e) {
        log("saveNotes error: " + e.message, "error");
    }
}

function loadFontData() {
    try {
        const raw = localStorage.getItem(LS_FONTDATA);
        if (raw) _fontData = _normFontData(JSON.parse(raw));
    } catch (e) {
        log("loadFontData error: " + e.message, "error");
        _fontData = { folders: [], styles: [], activeFolderId: null };
    }
}

function saveFontData() {
    try {
        localStorage.setItem(LS_FONTDATA, JSON.stringify(_fontData));
    } catch (e) {
        log("saveFontData error: " + e.message, "error");
    }
}

var _saveTimer = null;
function saveStateDebounced() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
        saveNotes();
        saveSettings();
        saveFontData();
    }, 300);
}

function saveStateNow() {
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    saveNotes();
    saveSettings();
    saveFontData();
}

function rescanPrefixes() {
    if (!_notes.length) { log("Re-scan prefix: tidak ada baris.", "warn"); return; }
    _notes = _withSettingsCache(() => _notes.map(n => {
        const line = (n.raw && n.raw.length) ? n.raw : _noteRaw(n.tag, n.text);
        return classifyLine(line);
    }));
    if (_currentIdx >= _notes.length) _currentIdx = Math.max(0, _notes.length - 1);
    if (_notes[_currentIdx] && _notes[_currentIdx].skip) {
        let j = _nextBalloonIdx(_currentIdx);
        if (j < 0) for (let k = _currentIdx - 1; k >= 0; k--) if (!_notes[k].skip) { j = k; break; }
        if (j >= 0) _currentIdx = j;
    }
    saveNotes();
    renderNotes();
    const nBalloon = _notes.filter(n => !n.skip).length;
    log("Re-scan prefix: " + nBalloon + " balon, " + (_notes.length - nBalloon) + " baris skip.", "success");
}

function _readFontOpts() {
    return {
        fontPostScript: "CCOriginStory",
        fontFamily: "CC Origin Story",
        fontSize: 12,
        align: _readText("select-align", "center"),
        wrapShape: _readText("select-wrap-shape", "none"),
        algorithm: _readText("select-algorithm", "sinefastv4"),
        edgeMinLetters: parseInt(_readText("input-edge-min-letters", "3"), 10) || 0,
        autoResize: _readCheckbox("checkbox-auto-resize", false),
        resizePct: parseFloat(_readText("input-resize-pct", "80")) || 80,
        resizeFit: _readText("select-resize-fit", "bbox"),
        tune: _readV4Tune()
    };
}

function _readV4Tune() {
    const num = (id, def) => { const v = parseFloat(_readText(id, String(def))); return isFinite(v) ? v : def; };
    return {
        soften: num("input-v4-soften", V3_SOFTEN_EXP),
        floor: num("input-v4-floor", V3_FLOOR),
        punct: num("input-v4-punct", V3_PUNCT_BONUS),
        slack: num("input-v4-slack", V3_MONO_SLACK),
        mweight: num("input-v4-mweight", V3_MONO_WEIGHT),
        abias: num("input-v4-abias", V3_ASPECT_BIAS),
        aweight: num("input-v4-aweight", V3_ASPECT_WEIGHT),
        leading: num("input-v4-leading", V3_LEADING),
        minWords: Math.max(1, Math.round(num("input-v4-minwords", 1)))
    };
}

function _readText(id, def) {
    const el = document.getElementById(id);
    if (!el) return def;
    const v = (el.value !== undefined ? el.value : el.textContent) || "";
    return v.trim() || def;
}

function _readCheckbox(id, def) {
    const el = document.getElementById(id);
    if (!el) return def;
    return !!el.checked;
}

document.addEventListener("DOMContentLoaded", () => {
    loadSavedNotes();
    loadSavedSettings();
    _syncLogLevel();
    loadFontData();
    renderNotes();
    renderFontSettings();
    refreshStatusLight();
    _setMultiBubbleMode(_readCheckbox("checkbox-multi-bubble", false), false);
    log("Plugin loaded. Ready.", "info");

    for (const f of _SETTINGS_FIELDS) {
        const el = document.getElementById(f.id);
        if (!el) continue;
        const markEdited = () => { el._userEdited = true; };
        el.addEventListener("change", markEdited);
        el.addEventListener("input", markEdited);
        el.addEventListener("change", saveStateDebounced);
        if (f.type === "number" || f.type === "text") {
            el.addEventListener("input", saveStateDebounced);
        }
    }

    const logLevelEl = document.getElementById("select-log-level");
    if (logLevelEl) logLevelEl.addEventListener("change", _syncLogLevel);

    _applyUiFont();
    const uiFontMode = document.getElementById("select-ui-font-mode");
    if (uiFontMode) uiFontMode.addEventListener("change", _applyUiFont);
    const uiFontSize = document.getElementById("input-ui-font-size");
    if (uiFontSize) {
        uiFontSize.addEventListener("input", _applyUiFont);
        uiFontSize.addEventListener("change", _applyUiFont);
    }

    const liveSelEl = document.getElementById("checkbox-live-selection");
    if (liveSelEl) {
        liveSelEl.addEventListener("change", () => {
            _stopSelectionPoll();
            if (liveSelEl.checked) _startSelectionPoll();
        });
    }

    const btnApply = document.getElementById("btn-apply");
    if (btnApply) btnApply.addEventListener("click", applyCurrentNote);

    const btnRMinus = document.getElementById("btn-resize-minus");
    if (btnRMinus) btnRMinus.addEventListener("click", () => resizeActiveText(-1));
    const btnRPlus = document.getElementById("btn-resize-plus");
    if (btnRPlus) btnRPlus.addEventListener("click", () => resizeActiveText(+1));

    const btnSMinus = document.getElementById("btn-soften-minus");
    if (btnSMinus) btnSMinus.addEventListener("click", () => reshapeSoften(-1));
    const btnSPlus = document.getElementById("btn-soften-plus");
    if (btnSPlus) btnSPlus.addEventListener("click", () => reshapeSoften(+1));

    const btnClean = document.getElementById("btn-clean");
    if (btnClean) btnClean.addEventListener("click", () => (_barButtonIsReplace() ? replaceCurrentNote() : doCleanBubble()));
    const barBtnEl = document.getElementById("select-bar-button");
    if (barBtnEl) barBtnEl.addEventListener("change", _syncBarButton);
    _syncBarButton();

    const btnImport = document.getElementById("btn-import-txt");
    if (btnImport) btnImport.addEventListener("click", importTxtFile);

    const btnImportTypeR = document.getElementById("btn-import-typer");
    if (btnImportTypeR) btnImportTypeR.addEventListener("click", importTypeRJSON);
    const btnExportStyles = document.getElementById("btn-export-styles");
    if (btnExportStyles) btnExportStyles.addEventListener("click", exportFontData);
    const btnRestoreFont = document.getElementById("btn-restore-fontdata");
    if (btnRestoreFont) btnRestoreFont.addEventListener("click", restoreFontDataBackup);
    const btnExportSettings = document.getElementById("btn-export-settings");
    if (btnExportSettings) btnExportSettings.addEventListener("click", exportSettingsFile);
    const btnImportSettings = document.getElementById("btn-import-settings");
    if (btnImportSettings) btnImportSettings.addEventListener("click", importSettingsFile);
    const btnRestoreSettings = document.getElementById("btn-restore-settings");
    if (btnRestoreSettings) btnRestoreSettings.addEventListener("click", restoreSettingsBackup);
    const btnAddFolder = document.getElementById("btn-add-folder");
    if (btnAddFolder) btnAddFolder.addEventListener("click", addFolder);
    const btnAddStyle = document.getElementById("btn-add-style");
    if (btnAddStyle) btnAddStyle.addEventListener("click", addStyle);
    const btnStyleBack = document.getElementById("btn-style-back");
    if (btnStyleBack) btnStyleBack.addEventListener("click", () => switchView("fontsettings"));
    const btnStyleSave = document.getElementById("btn-style-save");
    if (btnStyleSave) btnStyleSave.addEventListener("click", () => {
        saveStateNow();
        rescanPrefixes();
        log("Style tersimpan.", "success");
    });
    const btnSettingsSave = document.getElementById("btn-settings-save");
    if (btnSettingsSave) btnSettingsSave.addEventListener("click", () => {
        saveStateNow();
        rescanPrefixes();
    });
    const btnSaveLog = document.getElementById("btn-save-log");
    if (btnSaveLog) btnSaveLog.addEventListener("click", saveLogFile);
    const btnReload = document.getElementById("btn-reload");
    if (btnReload) btnReload.addEventListener("click", () => window.location.reload());
    document.querySelectorAll(".settings-tab-btn").forEach(btn => {
        btn.addEventListener("click", () => switchSettingsTab(btn.dataset.stab));
    });
    switchSettingsTab("general");

    setupStyleDragDrop();

    const queueViewEl = document.getElementById("select-queue-view");
    if (queueViewEl) queueViewEl.addEventListener("change", renderNotes);

    const cbMB = document.getElementById("checkbox-multi-bubble");
    if (cbMB) cbMB.addEventListener("change", () => _setMultiBubbleMode(cbMB.checked));
    const btnMB = document.getElementById("btn-mb-toggle");
    if (btnMB) btnMB.addEventListener("click", () => _setMultiBubbleMode(!_multiBubbleMode));
    const btnMBClear = document.getElementById("btn-mb-clear");
    if (btnMBClear) btnMBClear.addEventListener("click", _clearBubbleQueue);

    try {
        action.addNotificationListener(
            ["open", "close", "select", "make", "delete", "set",
                "addTo", "subtractFrom", "intersectWith", "inverse", "expand", "contract", "transform", "move"],
            _onPsNotify
        );
    } catch (e) {
        console.warn("[Kitsu Typeset] addNotificationListener gagal:", e && e.message);
    }
    try {
        action.addNotificationListener(["historyStateChanged"], _scheduleHistoryCheck);
    } catch (e) {
        vlog("Listener history gagal dipasang: " + (e && e.message ? e.message : String(e)), "warn");
    }

    document.body.addEventListener("mouseenter", _startSelectionPoll);
    document.body.addEventListener("mouseenter", _scheduleHistoryCheck);
    document.body.addEventListener("mouseleave", _stopSelectionPoll);

    _initLayoutWatch();

    _wirePreview();
    _updatePreviewFromSelection();
});

window.clearLog = clearLog;
window.applyCurrentNote = applyCurrentNote;
window.skipCurrent = skipCurrent;
window.doCleanBubble = doCleanBubble;
