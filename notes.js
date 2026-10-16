function currentNoteText() {
    const n = _notes[_currentIdx];
    return (n && typeof n.text === "string") ? n.text : "";
}

function _normNote(n) {
    if (typeof n === "string") return { tag: "", text: n, skip: false, raw: n };
    if (n && typeof n === "object") {
        const tag = typeof n.tag === "string" ? n.tag : "";
        const text = typeof n.text === "string" ? n.text : "";
        return {
            tag: tag,
            text: text,
            skip: !!n.skip,
            raw: typeof n.raw === "string" && n.raw.length ? n.raw : _noteRaw(tag, text)
        };
    }
    return { tag: "", text: "", skip: false, raw: "" };
}

const DEFAULT_BALLOON_PREFIXES = [];
const DEFAULT_IGNORE_PREFIXES = [
    '##', 'Page', 'PG.', 'PAGE', 'Pg.', 'Pg',
    'P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9',
    'sfx', 'SFX', 'Sfx',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
];

var _settingsCache = null;
function _cached(key, fn) {
    if (!_settingsCache) return fn();
    if (!(key in _settingsCache)) _settingsCache[key] = fn();
    return _settingsCache[key];
}
function _withSettingsCache(fn) {
    if (_settingsCache) return fn();
    _settingsCache = {};
    try { return fn(); } finally { _settingsCache = null; }
}

function _readListSetting(id, defaults) {
    const el = document.getElementById(id);
    if (!el || typeof el.value !== "string") return defaults.slice();
    if (!el._userEdited) {
        const list = el.value.split(/[\r\n;,]+/).map(s => s.trim()).filter(s => s.length > 0);
        return list.length ? list : defaults.slice();
    }
    return el.value.split(/[\r\n;,]+/).map(s => s.trim()).filter(s => s.length > 0);
}

function _balloonPrefixes() {
    return _cached("balloon", () => {
        const tags = [];
        for (const s of _activeStyles()) {
            if (Array.isArray(s.tags)) for (const t of s.tags) if (t) tags.push(t);
        }
        return tags.length ? tags : DEFAULT_BALLOON_PREFIXES.slice();
    });
}
function _ignorePrefixes() { return _cached("ignore", () => _readListSetting("input-ignore-prefixes", DEFAULT_IGNORE_PREFIXES)); }

const DEFAULT_PAGE_MARKS = ['Page', 'PAGE', 'PG.', 'Pg.', 'Pg', 'PG'];
function _pageMarks() { return _cached("page", () => _readListSetting("input-page-marks", DEFAULT_PAGE_MARKS)); }

const DEFAULT_FOLLOW_PREFIXES = ['//'];
function _followPrefixes() { return _cached("follow", () => _readListSetting("input-follow-prefixes", DEFAULT_FOLLOW_PREFIXES)); }
function _isFollowTag(tag) { return !!tag && _followPrefixes().indexOf(tag) !== -1; }

function _isPageRow(note) {
    if (!note || !note.skip) return false;
    const raw = (note.raw != null ? note.raw : _noteRaw(note.tag, note.text)) + "";
    const line = raw.replace(/^\s+/, "").toLowerCase();
    if (!line) return false;
    return _pageMarks().some(p => { const q = (p || "").trim().toLowerCase(); return q && line.startsWith(q); });
}

function _matchLongestPrefix(line, list) {
    let best = null;
    for (const p of list) {
        if (p && line.startsWith(p) && (!best || p.length > best.length)) best = p;
    }
    return best;
}

function classifyLine(rawLine) {
    const L = rawLine.replace(/\s+$/, "");
    const balloon = _matchLongestPrefix(L, _balloonPrefixes());
    if (balloon) return { tag: balloon, text: L.slice(balloon.length).trim(), skip: false, raw: L };
    const follow = _matchLongestPrefix(L, _followPrefixes());
    if (follow) return { tag: follow, text: L.slice(follow.length).trim(), skip: false, raw: L };
    const ignore = _matchLongestPrefix(L, _ignorePrefixes());
    if (ignore) return { tag: ignore, text: L.slice(ignore.length).trim(), skip: true, raw: L };
    const page = _matchLongestPrefix(L, _pageMarks());
    if (page) return { tag: page, text: L.slice(page.length).trim(), skip: true, raw: L };
    const paste = _cached("noprefix", () => _readText("select-noprefix-mode", "skip")) === "paste";
    const T = L.replace(/^\s+/, "");
    const marker = paste && T !== L && !!(_matchLongestPrefix(T, _ignorePrefixes()) || _matchLongestPrefix(T, _pageMarks()));
    return { tag: "", text: L.trim(), skip: !paste || marker, raw: L };
}

function _noteRaw(tag, text) {
    return ((tag ? tag + " " : "") + (text || "")).replace(/\s+$/, "");
}

function parseScript(raw) {
    if (!raw) return [];
    return _withSettingsCache(() => raw
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .filter(line => line.trim().length > 0)
        .map(line => classifyLine(line)));
}

function setNotes(arr) {
    _notes = Array.isArray(arr) ? arr.map(_normNote) : [];
    if (_currentIdx >= _notes.length) _currentIdx = Math.max(0, _notes.length - 1);
    if (_currentIdx < 0) _currentIdx = 0;
    renderNotes();
}

function clearAllNotes() {
    _clearBubbleQueue();
    _applyHist = [];
    _notes = [];
    _currentIdx = 0;
    renderNotes();
    saveStateDebounced();
    log("Semua note dihapus.", "info");
}

async function importTxtFile() {
    try {
        const fs = require("uxp").storage.localFileSystem;
        const file = await fs.getFileForOpening({ types: ["txt"] });
        if (!file) return;
        let text = await file.read();
        text = (typeof text === "string") ? text : String(text);
        text = text.replace(/^﻿/, "");
        if (text.indexOf("\u0000") !== -1) text = text.replace(/\u0000/g, "");

        _clearBubbleQueue();
        _applyHist = [];
        _notes = parseScript(text);
        const firstBalloon = _firstBalloonIdx();
        _currentIdx = firstBalloon >= 0 ? firstBalloon : 0;
        renderNotes();
        saveStateDebounced();

        const nBalloon = _notes.filter(n => !n.skip).length;
        const nSkip = _notes.length - nBalloon;
        log("Impor .txt: " + nBalloon + " balon, " + nSkip + " baris skip (ditampilkan) (" +
            file.name + ").", nBalloon ? "success" : "warn");
    } catch (e) {
        log("Impor .txt gagal: " + (e && e.message ? e.message : String(e)), "error");
    }
}

function setCurrentIdx(i) {
    if (i < 0 || i >= _notes.length) return;
    if (_notes[i] && _notes[i].skip) {
        let j = -1;
        for (let k = i; k < _notes.length; k++) if (!_notes[k].skip) { j = k; break; }
        if (j < 0) for (let k = i - 1; k >= 0; k--) if (!_notes[k].skip) { j = k; break; }
        if (j < 0) return;
        i = j;
    }
    if (i === _currentIdx) return;
    const prev = _currentIdx;
    _currentIdx = i;
    _renderCurrentChange(prev);
    _updatePreviewFromSelection();
    saveStateDebounced();
}

function _firstBalloonIdx() {
    for (let i = 0; i < _notes.length; i++) if (!_notes[i].skip) return i;
    return -1;
}

function _nextBalloonIdx(from) {
    for (let i = from + 1; i < _notes.length; i++) if (!_notes[i].skip) return i;
    return -1;
}

function advanceCurrent() {
    const next = _nextBalloonIdx(_currentIdx);
    if (next >= 0) {
        const prev = _currentIdx;
        _currentIdx = next;
        _renderCurrentChange(prev);
        _updatePreviewFromSelection();
        saveStateDebounced();
    }
}

const QV_BEFORE = 2;
const QV_AFTER = 6;

function _scrollQueueToCurrent() {
    if (_activeView !== "notes") return;
    if (_readText("select-queue-view", "full") === "compact") return;
    try {
        const list = document.getElementById("note-list");
        const cur = list && list.querySelector(".sticky-note.current");
        if (cur) cur.scrollIntoView({ block: "center" });
    } catch (e) {
        _vlogChanged("scrollQueue", "scrollIntoView antrian gagal: " + _errMsg(e));
    }
}

var _noteEls = [];

function _buildEmptyGuide() {
    const box = document.createElement("div");
    box.className = "hint empty-guide";
    const add = (text, cls) => {
        const p = document.createElement("div");
        if (cls) p.className = cls;
        p.textContent = text;
        box.appendChild(p);
    };
    add("Kitsu Auto Typeset - by Kitsui Mizukawa", "eg-credit");
    add("How to start", "eg-title");
    add("1. Font Settings: import a TypeR JSON or press + Add style, give each style a tag (e.g. []:) and tick its folder.");
    add("2. Press Import .txt - one line per bubble. Lines that start with a style tag become bubbles.");
    add("3. Select a bubble with the Magic Wand, then press APPLY + next.");
    add("Why can't I paste the script like in TypeR / TypeRtools?", "eg-title");
    add("Kitsu runs on UXP, Adobe's newer plugin system, which limits clipboard paste into panels. " +
        "TypeR and TypeRtools use the older CEP system. Import a .txt file instead, or type a line in the card above.");
    return box;
}

function renderNotes() {
    const list = document.getElementById("note-list");
    const count = document.getElementById("note-count");
    if (!list) return;
    const tok = _perfBegin("renderNotes");
    const t0 = _perfNow();
    list.innerHTML = "";
    _noteEls = [];
    const t1 = _perfNow();

    const balloonNos = new Array(_notes.length);
    let bn = 0;
    for (let i = 0; i < _notes.length; i++) balloonNos[i] = _notes[i].skip ? 0 : ++bn;

    if (count) count.textContent = String(bn);

    const mode = _readText("select-queue-view", "full");
    const frag = document.createDocumentFragment();
    const addCard = (i) => {
        const el = _buildNoteCard(i, _notes[i], i === _currentIdx, balloonNos[i]);
        _noteEls[i] = el;
        frag.appendChild(el);
    };

    _withSettingsCache(() => {
        if (_notes.length === 0) {
            frag.appendChild(_buildNoteCard(0, { tag: "", text: "", skip: false }, true, 1));
            frag.appendChild(_buildEmptyGuide());
        } else if (mode === "compact" && _notes.length > QV_BEFORE + QV_AFTER + 1) {
            const start = Math.max(0, _currentIdx - QV_BEFORE);
            const end = Math.min(_notes.length, _currentIdx + QV_AFTER + 1);
            if (start > 0) frag.appendChild(_buildMoreRow("▲ " + start + " baris di atas", start - 1));
            for (let i = start; i < end; i++) addCard(i);
            if (end < _notes.length) frag.appendChild(_buildMoreRow("▼ " + (_notes.length - end) + " baris di bawah", end));
        } else {
            for (let i = 0; i < _notes.length; i++) addCard(i);
        }
    });

    const nCards = frag.childNodes ? frag.childNodes.length : 0;
    const t2 = _perfNow();
    list.appendChild(frag);
    const t3 = _perfNow();

    _scrollQueueToCurrent();
    const t4 = _perfNow();

    refreshStatusLight();
    const t5 = _perfNow();
    const f = (a, b) => Math.round(b - a);
    _perfEnd(tok, nCards + " kartu (" + mode + ") · clear " + f(t0, t1) + " · build " + f(t1, t2) +
        " · append " + f(t2, t3) + " · scroll " + f(t3, t4) + " · status " + f(t4, t5) + " ms");
}

function _balloonNoAt(idx) {
    if (!_notes[idx] || _notes[idx].skip) return 0;
    let bn = 0;
    for (let i = 0; i <= idx; i++) if (!_notes[i].skip) bn++;
    return bn;
}

function _renderCurrentChange(prevIdx) {
    const list = document.getElementById("note-list");
    if (!list || !_notes.length || _readText("select-queue-view", "full") === "compact") return renderNotes();
    const idxs = (prevIdx === _currentIdx) ? [_currentIdx] : [prevIdx, _currentIdx];
    if (idxs.some(i => !_noteEls[i] || _noteEls[i].parentNode !== list)) return renderNotes();
    const tok = _perfBegin("renderNotes (ganti " + idxs.length + " kartu)");
    const t0 = _perfNow();
    let t1 = t0;
    try {
        _withSettingsCache(() => {
            const els = idxs.map(i => _buildNoteCard(i, _notes[i], i === _currentIdx, _balloonNoAt(i)));
            t1 = _perfNow();
            idxs.forEach((i, k) => {
                list.replaceChild(els[k], _noteEls[i]);
                _noteEls[i] = els[k];
            });
        });
    } catch (e) {
        vlog("Ganti kartu gagal (" + (e && e.message ? e.message : String(e)) + ") — render penuh.", "warn");
        return renderNotes();
    }
    const t2 = _perfNow();
    _scrollQueueToCurrent();
    const t3 = _perfNow();
    _scheduleLightRefresh();
    const t4 = _perfNow();
    const f = (a, b) => Math.round(b - a);
    _perfEnd(tok, "build " + f(t0, t1) + " · replace " + f(t1, t2) + " · scroll " + f(t2, t3) +
        (_activeView === "notes" ? "" : " (view lain, dilewati)") + " · status " + f(t3, t4) + " ms");
}

function _buildMoreRow(label, jumpIdx) {
    const row = document.createElement("div");
    row.className = "note-list-more";
    row.textContent = label;
    row.addEventListener("click", () => setCurrentIdx(jumpIdx));
    return row;
}

function _ensureNote(idx) {
    if (!_notes[idx]) _notes[idx] = { tag: "", text: "", skip: false };
    return _notes[idx];
}

function _buildNoteCard(idx, note, isCurrent, balloonNo) {
    const tag = (note && note.tag) || "";
    const text = (note && note.text) || "";
    const skip = !!(note && note.skip);

    if (skip && _isPageRow(note)) {
        const row = document.createElement("div");
        row.className = "sticky-note page";
        row.textContent = (tag + " " + (text || "")).trim();
        return row;
    }

    if (skip) {
        const row = document.createElement("div");
        row.className = "sticky-note skip" + (tag ? "" : " noprefix");
        row.appendChild(_noCell(""));
        if (tag) {
            const tagBadge = document.createElement("span");
            tagBadge.className = "sticky-note-tag sticky-note-tag-skip";
            tagBadge.textContent = tag;
            row.appendChild(tagBadge);
        }
        const preview = document.createElement("div");
        preview.className = "sticky-note-preview";
        preview.textContent = text && text.trim() ? text : "(skip)";
        row.appendChild(preview);
        return row;
    }

    const card = document.createElement("div");
    const noPrefix = !tag && !!(text && text.trim());
    card.className = "sticky-note" + (isCurrent ? " current" : " preview") + (noPrefix ? " noprefix" : "");
    card.appendChild(_noCell("#" + (balloonNo || (idx + 1))));

    let tagColor = _tagColorForTag(tag);
    if (!tagColor && _isFollowTag(tag)) tagColor = _tagColorForTag(_resolveFollowSourceTag(idx));

    if (isCurrent) {
        const tagEdit = document.createElement("input");
        tagEdit.className = "sticky-note-tag-edit";
        tagEdit.setAttribute("spellcheck", "false");
        tagEdit.setAttribute("placeholder", "type");
        if (tag && tagColor) tagEdit.style.color = tagColor;
        tagEdit.value = tag;
        tagEdit.addEventListener("input", () => {
            const n = _ensureNote(idx);
            n.tag = tagEdit.value;
            n.raw = _noteRaw(n.tag, n.text);
            if (!n.tag && n.text && n.text.trim()) card.classList.add("noprefix");
            else card.classList.remove("noprefix");
            saveStateDebounced();
        });
        card.appendChild(tagEdit);

        const edit = document.createElement("textarea");
        edit.className = "sticky-note-edit";
        edit.setAttribute("rows", "1");
        edit.setAttribute("spellcheck", "false");
        edit.value = text;
        edit.addEventListener("input", () => {
            const n = _ensureNote(idx);
            n.text = edit.value;
            n.raw = _noteRaw(n.tag, n.text);
            saveStateDebounced();
        });
        edit.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const n = _ensureNote(idx);
                n.text = edit.value;
                n.raw = _noteRaw(n.tag, n.text);
                _notes.splice(idx + 1, 0, { tag: "", text: "", skip: false, raw: "" });
                _currentIdx = idx + 1;
                renderNotes();
                saveStateDebounced();
                _focusCurrentEdit();
            }
        });
        card.appendChild(edit);
    } else {
        if (tag) {
            const tagBadge = document.createElement("span");
            tagBadge.className = "sticky-note-tag";
            tagBadge.textContent = tag;
            if (tagColor) tagBadge.style.color = tagColor;
            card.appendChild(tagBadge);
        } else {
            const noTag = document.createElement("span");
            noTag.className = "sticky-note-tag sticky-note-tag-none";
            noTag.textContent = "(no tag)";
            noTag.title = "No tag — uses the active folder's default (first) style";
            card.appendChild(noTag);
        }

        const preview = document.createElement("div");
        preview.className = "sticky-note-preview";
        preview.textContent = text && text.trim() ? text : "(empty)";
        if (!text || !text.trim()) preview.classList.add("empty");
        card.appendChild(preview);

        card.addEventListener("click", () => setCurrentIdx(idx));
    }

    return card;
}

function _noCell(label) {
    const el = document.createElement("span");
    el.className = "sticky-note-no";
    el.textContent = label;
    return el;
}

function _focusCurrentEdit() {
    const list = document.getElementById("note-list");
    if (!list) return;
    const el = list.querySelector(".sticky-note.current textarea.sticky-note-edit");
    if (!el) return;
    el.focus();
    const len = el.value.length;
    try { el.setSelectionRange(len, len); }
    catch (e) { vlog("setSelectionRange (caret di akhir) gagal: " + _errMsg(e), "warn"); }
}

function _resolveStyleIntoOpts(note, idx, opts) {
    let resolveTag = note ? note.tag : "";
    if (note && _isFollowTag(note.tag)) {
        resolveTag = _resolveFollowSourceTag(idx);
        vlog("Follow prefix '" + note.tag + "' → ikut tag '" + resolveTag + "'", "info");
    }
    const resolved = _styleForTag(resolveTag);
    if (resolved && resolveTag && resolved.tags.indexOf(resolveTag) === -1) {
        vlog("Tag '" + resolveTag + "' tidak ada di style folder aktif → fallback '" + resolved.name + "'", "warn");
    }
    if (resolved) {
        const st = resolved.style;
        opts.styleObj = st;
        opts.fontPostScript = st.fontPostScriptName;
        opts.fontFamily = st.fontName;
        opts.fontSize = st.size;
        if (st.alignment) opts.align = st.alignment;
        vlog("Style '" + resolved.name + "' untuk tag '" + (note ? (note.tag || "") : "") + "'", "info");
    }
}

function _updateMBUI() {
    const n = _bubbleQueue.length;
    const btn = document.getElementById("btn-mb-toggle");
    if (btn) {
        btn.textContent = _multiBubbleMode ? ("MB: ON (" + n + ")") : "MB: OFF";
        btn.classList.toggle("is-on", _multiBubbleMode);
    }
    const apply = document.getElementById("btn-apply");
    if (apply) apply.textContent = (_multiBubbleMode && n > 0) ? ("APPLY ALL (" + n + ")") : "APPLY + next";
    const clr = document.getElementById("btn-mb-clear");
    if (clr) clr.style.display = (_multiBubbleMode && n > 0) ? "" : "none";
}

function _setMultiBubbleMode(on, persist) {
    _multiBubbleMode = !!on;
    if (!_multiBubbleMode) { _bubbleQueue = []; _lastCaptureHash = null; _lastCaptureRawKey = null; }
    const cb = document.getElementById("checkbox-multi-bubble");
    if (cb) cb.checked = _multiBubbleMode;
    _updateMBUI();
    if (persist !== false) saveSettings();
    refreshStatusLight();
    log("Multi-Bubble mode " + (_multiBubbleMode ? "ON" : "OFF") + ".", "info");
}

function _clearBubbleQueue() {
    if (!_bubbleQueue.length) return;
    _bubbleQueue = [];
    _lastCaptureHash = null;
    _lastCaptureRawKey = null;
    _updateMBUI();
    log("Multi-Bubble: antrian dikosongkan.", "info");
}

var _captureDebounceTimer = null;
function _scheduleBubbleCapture() {
    if (_captureDebounceTimer) clearTimeout(_captureDebounceTimer);
    _captureDebounceTimer = setTimeout(_captureCurrentSelection, 250);
}

async function _waitCapture(flush) {
    if (flush && _captureDebounceTimer) {
        clearTimeout(_captureDebounceTimer);
        _captureDebounceTimer = null;
        if (_multiBubbleMode && !_capturing) await _captureCurrentSelection(true);
    }
    while (_capturing) await new Promise(r => setTimeout(r, 30));
}

const MIN_BUBBLE_PX = 10;

async function _captureCurrentSelection(force) {
    if (force !== true) _captureDebounceTimer = null;
    if (!_multiBubbleMode || _capturing || (_modalBusy && force !== true)) return;
    _capturing = true;
    const tok = _perfBegin("MB capture");
    let captured = null, skipped = "";
    try {
        const raw = await getSelectionBounds();
        if (!raw) { skipped = "tanpa selection"; return; }
        const rw = raw.right - raw.left, rh = raw.bottom - raw.top;
        if (rw < MIN_BUBBLE_PX || rh < MIN_BUBBLE_PX) {
            log("Multi-Bubble: selection terlalu kecil (" + Math.round(rw) + "×" + Math.round(rh) +
                " px, min " + MIN_BUBBLE_PX + ") — diabaikan.", "warn");
            skipped = "terlalu kecil";
            return;
        }
        const rawKey = _pvSelKey(raw);
        if (rawKey === _lastCaptureRawKey) { skipped = "selection sama"; return; }

        let noteIdx = _currentIdx;
        if (!_notes[noteIdx] || _notes[noteIdx].skip) {
            noteIdx = _notes[noteIdx] ? _nextBalloonIdx(noteIdx) : _firstBalloonIdx();
        }
        if (noteIdx < 0 || !_notes[noteIdx]) {
            log("Multi-Bubble: tidak ada note balon untuk dipasangkan.", "warn");
            skipped = "tanpa note";
            return;
        }
        if (_bubbleQueue.some(e => e.noteIdx === noteIdx)) {
            log("Multi-Bubble: semua note balon sudah terpasang ke selection.", "warn");
            skipped = "note habis";
            return;
        }

        const opts = _readFontOpts();
        await executeAsModal(async (ctx) => {
            const hc = ctx && ctx.hostControl;
            let sid = null;
            try {
                if (hc) sid = await hc.suspendHistory({ documentID: app.activeDocument.id, name: "Auto Typeset: Capture Bubble" });
            } catch (e) {
                vlog("suspendHistory (capture) gagal: " + (e && e.message ? e.message : String(e)) +
                    " — marquee terkikis & history bertambah seperti dulu.", "warn");
                sid = null;
            }
            try {
                let sel = raw;
                let w = rw, h = rh;
                if (_readCheckbox("checkbox-remove-tail-apply", true)) {
                    sel = await _removeTailBounds(sel);
                    w = sel.right - sel.left; h = sel.bottom - sel.top;
                }
                const cx = (sel.left + sel.right) / 2, cy = (sel.top + sel.bottom) / 2;
                const hash = Math.round(cx) + "_" + Math.round(cy) + "_" + Math.round(w) + "_" + Math.round(h);
                if (hash === _lastCaptureHash) { skipped = "balon sama"; return; }
                let selFillRatio;
                if (opts.autoResize && opts.resizeFit === "area") {
                    selFillRatio = await _getSelectionFillRatio(sel);
                }
                captured = { bounds: sel, noteIdx: noteIdx, selFillRatio: selFillRatio, hash: hash };
            } finally {
                if (sid != null) {
                    try { await hc.resumeHistory(sid, false); }
                    catch (e) { vlog("Rollback capture gagal: " + (e && e.message ? e.message : String(e)), "warn"); }
                }
            }
        }, { commandName: "Auto Typeset: Capture Bubble" });
        _lastCaptureRawKey = rawKey;

        if (captured) {
            const docID = app.activeDocument ? app.activeDocument.id : null;
            if (_bubbleQueue.length && _bubbleQueue[0].docID !== docID) {
                _bubbleQueue = [];
                log("Multi-Bubble: dokumen berganti — antrian lama dikosongkan.", "warn");
            }
            _bubbleQueue.push({ bounds: captured.bounds, noteIdx: captured.noteIdx, selFillRatio: captured.selFillRatio, docID: docID });
            _lastCaptureHash = captured.hash;
            vlog("MB capture #" + _bubbleQueue.length + " note[" + captured.noteIdx + "] hash=" + captured.hash, "info");
            advanceCurrent();
            _updateMBUI();
        }
    } catch (e) {
        log("Multi-Bubble capture error: " + (e && e.message ? e.message : String(e)), "error");
    } finally {
        _capturing = false;
        _perfEnd(tok, captured ? "tertangkap" : ("tanpa capture" + (skipped ? " (" + skipped + ")" : "")));
    }
}

async function _applyMultiBubble() {
    if (_modalBusy) return;
    if (_bubbleQueue.length === 0) return _applyNote({});

    const tTotal = _perfBegin("MB Apply (total)");
    const baseOpts = _readFontOpts();
    const deselectAfter = _readCheckbox("checkbox-deselect-after", true);
    const entries = _bubbleQueue.slice();

    _modalBusy = true;
    _setApplyEnabled(false);
    let made = 0;
    let remaining = entries.slice();
    const done = (entry) => { remaining = remaining.filter(e => e !== entry); };
    try {
        const tModal = _perfBegin("MB Apply (modal)");
        await executeAsModal(async (ctx) => {
            const hc = ctx && ctx.hostControl;
            const doc = app.activeDocument;
            for (const entry of entries) {
                done(entry);
                if (entry.docID != null && doc && entry.docID !== doc.id) {
                    log("Multi-Bubble: selection note[" + entry.noteIdx + "] dari dokumen lain — dibuang.", "warn");
                    continue;
                }
                const note = _notes[entry.noteIdx];
                const text = (note && typeof note.text === "string") ? note.text : "";
                if (!text || !text.trim()) {
                    vlog("MB skip note[" + entry.noteIdx + "] (kosong).", "warn");
                    continue;
                }
                const w = entry.bounds.right - entry.bounds.left;
                const h = entry.bounds.bottom - entry.bounds.top;
                if (w < 2 || h < 2) { vlog("MB skip entry (bounds kecil).", "warn"); continue; }

                const opts = Object.assign({}, baseOpts);
                _resolveStyleIntoOpts(note, entry.noteIdx, opts);
                if (!opts.styleObj) {
                    log("No style found — buat style dulu di Font Styles (MB skip note[" + entry.noteIdx + "]).", "warn");
                    continue;
                }
                if (entry.selFillRatio !== undefined) opts.selFillRatio = entry.selFillRatio;

                let sid = null;
                if (hc && doc) {
                    try {
                        sid = await hc.suspendHistory({ documentID: doc.id, name: "Auto Typeset: Apply (MB)" });
                    } catch (e) {
                        vlog("suspendHistory (MB) gagal: " + (e && e.message), "warn");
                        sid = null;
                    }
                }
                let ok = false;
                const tB = _perfBegin("MB balon note[" + entry.noteIdx + "]");
                try {
                    let finalText = text;
                    if (opts.wrapShape && opts.wrapShape !== "none") {
                        finalText = await _shapeText(text, entry.bounds, opts);
                    }
                    await createParagraphText(finalText, entry.bounds, opts);
                    made++;
                    ok = true;
                    _perfEnd(tB);
                } catch (e) {
                    log("Multi-Bubble note[" + entry.noteIdx + "] gagal: " + (e && e.message ? e.message : String(e)) +
                        " — tetap di antrian.", "error");
                    remaining.push(entry);
                } finally {
                    if (sid != null) {
                        const tc = _perfBegin("Commit history (MB)");
                        try { await hc.resumeHistory(sid, ok); }
                        catch (e) { vlog("resumeHistory (MB) gagal: " + (e && e.message), "warn"); }
                        _perfEnd(tc);
                    }
                }
            }
            if (deselectAfter) {
                const td = _perfBegin("Deselect");
                await deselect();
                _perfEnd(td);
            }
        }, { commandName: "Auto Typeset: Multi-Bubble Apply" });
        _perfEnd(tModal);

        log("Multi-Bubble: " + made + " teks dibuat dari " + entries.length + " selection.", "success");
    } catch (e) {
        log("Multi-Bubble apply error: " + (e && e.message ? e.message : String(e)), "error");
    } finally {
        _bubbleQueue = remaining;
        if (remaining.length) setStatusPill(remaining.length + " bubble(s) not applied (see Log)", "status-warn");
        _lastCaptureHash = null;
        _lastCaptureRawKey = null;
        _modalBusy = false;
        _updateMBUI();
        await refreshSelectionBounds();
        _perfEnd(tTotal, made + " balon");
    }
}

function _onPsNotify(event, desc) {
    _scheduleLightRefresh();
    _scheduleHistoryCheck();
    _pvScheduleSelectionSync(event, desc);
    if (event === "open" || event === "close") {
        _lastCaptureRawKey = null;
        if (_bubbleQueue.length) { _bubbleQueue = []; _lastCaptureHash = null; _updateMBUI(); }
        return;
    }
    if (_multiBubbleMode && _panelVisible && event === "set" && _pvIsSelectionEvent(event, desc)) {
        _scheduleBubbleCapture();
    }
}

const APPLY_HIST_MAX = 50;
var _applyHist = [];
var _histChecking = false;
var _histCheckTimer = null;

async function _getHistoryStateID(id) {
    const ref = (id != null)
        ? { _ref: "historyState", _id: id }
        : { _ref: "historyState", _enum: "ordinal", _value: "targetEnum" };
    const r = await _bp([{ _obj: "get", _target: [ref] }]);
    if (!r || !r[0] || r[0].message || typeof r[0].ID !== "number") return null;
    return { id: r[0].ID, name: r[0].name };
}

async function _recordApplyHistory(noteIdx, nextIdx) {
    try {
        const doc = app.activeDocument;
        const st = await _getHistoryStateID();
        if (!doc || !st) { vlog("Riwayat Apply: history state tak terbaca — undo tidak memundurkan baris.", "warn"); return; }
        _applyHist = _applyHist.filter(r => !(r.docID === doc.id && r.undone));
        _applyHist.push({ docID: doc.id, stateID: st.id, noteIdx: noteIdx, nextIdx: nextIdx, undone: false });
        if (_applyHist.length > APPLY_HIST_MAX) _applyHist.shift();
        vlog("Riwayat Apply: state " + st.id + " '" + st.name + "' → note[" + noteIdx + "]", "info");
    } catch (e) {
        vlog("Riwayat Apply gagal: " + (e && e.message ? e.message : String(e)), "warn");
    }
}

function _scheduleHistoryCheck() {
    if (!_applyHist.length) return;
    if (_histCheckTimer) clearTimeout(_histCheckTimer);
    _histCheckTimer = setTimeout(() => { _histCheckTimer = null; _checkApplyHistory(); }, 150);
}

async function _checkApplyHistory() {
    if (_histChecking || _modalBusy || !_applyHist.length) return;
    let doc = null;
    try { doc = app.activeDocument; } catch (e) { return; }
    if (!doc) return;
    const recs = _applyHist.filter(r => r.docID === doc.id);
    if (!recs.length) return;
    _histChecking = true;
    try {
        const cur = await _getHistoryStateID();
        if (!cur) return;
        for (let i = recs.length - 1; i >= 0; i--) {
            const r = recs[i];
            if (r.undone || cur.id >= r.stateID) continue;
            r.undone = true;
            if (_currentIdx === r.nextIdx && r.noteIdx !== r.nextIdx) {
                setCurrentIdx(r.noteIdx);
                log("Undo Apply → kembali ke note #" + (r.noteIdx + 1) + ".", "info");
            }
        }
        for (const r of recs) {
            if (!r.undone || cur.id < r.stateID) continue;
            const still = await _getHistoryStateID(r.stateID);
            if (!still) { _applyHist = _applyHist.filter(x => x !== r); continue; }
            r.undone = false;
            if (_currentIdx === r.noteIdx && r.noteIdx !== r.nextIdx) {
                setCurrentIdx(r.nextIdx);
                log("Redo Apply → maju ke note #" + (r.nextIdx + 1) + ".", "info");
            }
        }
    } catch (e) {
        vlog("Cek riwayat Apply gagal: " + (e && e.message ? e.message : String(e)), "warn");
    } finally {
        _histChecking = false;
    }
}

async function applyCurrentNote() {
    if (_modalBusy) return;
    await _checkApplyHistory();
    if (_modalBusy) return;
    if (_multiBubbleMode) {
        _modalBusy = true;
        try { await _waitCapture(true); }
        finally { _modalBusy = false; }
        if (_bubbleQueue.length > 0) return _applyMultiBubble();
    }
    return _applyNote({});
}

async function replaceCurrentNote() {
    if (_modalBusy) return;
    if (_multiBubbleMode) {
        log("Replace text tidak tersedia di Multi-Bubble mode — matikan MB dulu.", "warn");
        setStatusPill("Replace: turn off Multi-Bubble first", "status-warn");
        return;
    }
    let hit = null;
    _modalBusy = true;
    try {
        const sel = await getSelectionBounds();
        if (!sel) {
            log("Tidak ada selection — buat selection di balon yang berisi teks, lalu Replace.", "warn");
            setStatusPill("Make a selection first", "status-warn");
            return;
        }
        hit = await _findTextLayerInSelection(sel, "Replace");
        if (!hit) {
            log("Replace: tidak ada layer teks di selection — tidak ada yang diganti (balon kosong → APPLY).", "warn");
            setStatusPill("No text in selection to replace", "status-warn");
            return;
        }
    } catch (e) {
        log("Replace error: " + (e && e.message ? e.message : String(e)), "error");
        return;
    } finally {
        _modalBusy = false;
    }
    log("Replace: teks id " + hit.id + " → note CURRENT", "info");
    return _applyNote({ replaceLayerID: hit.id });
}

const BUBBLE_MIN_ENCLOSE = 0.8;

async function _findBubbleBoundsForLayer(info) {
    let inBubble = false, bounds = null;
    try {
        const r = await _bp([_dSetActiveLayerVisible(false), _dMagicWand(info.cx, info.cy), _dGetSelection()]);
        let wb = null;
        if (r && r[0] && r[0].message) {
            vlog("hide layer: " + r[0].message, "warn");
            wb = await _magicWandBounds(info.cx, info.cy);
        } else if (r && r[1] && r[1].message) {
            vlog("Magic wand gagal: " + r[1].message, "warn");
        } else if (r && r[2] && r[2].selection) {
            wb = _rectFromDesc(r[2].selection);
        }
        if (wb) {
            const W = Math.round(app.activeDocument.width), H = Math.round(app.activeDocument.height);
            const areaRatio = ((wb.right - wb.left) * (wb.bottom - wb.top)) / (W * H);
            const textW = info.bounds.right - info.bounds.left;
            const textH = info.bounds.bottom - info.bounds.top;
            const wandW = wb.right - wb.left, wandH = wb.bottom - wb.top;
            const enclosesText = wandW >= textW * BUBBLE_MIN_ENCLOSE && wandH >= textH * BUBBLE_MIN_ENCLOSE;
            if (areaRatio > 0.4) {
                vlog("Wand bounds terlalu besar (" + (areaRatio * 100).toFixed(0) +
                    "% kanvas) — fallback bounds layer.", "warn");
            } else if (!enclosesText) {
                vlog("Wand bounds terlalu kecil (" + Math.round(wandW) + "×" + Math.round(wandH) +
                    " < teks " + Math.round(textW) + "×" + Math.round(textH) +
                    ") — teks di luar balon, fallback bounds layer.", "warn");
            } else {
                bounds = wb; inBubble = true;
            }
        }
    } finally {
        const r2 = await _bp([_dSetActiveLayerVisible(true), _dDeselect()]);
        if (r2 && r2[0] && r2[0].message) vlog("show layer: " + r2[0].message, "warn");
        else if (r2 && r2[1] && r2[1].message) vlog("deselect: " + r2[1].message, "warn");
    }
    return { bounds: bounds, inBubble: inBubble };
}

function _bestTextLayerInSel(layers, sel) {
    let best = null, bestScore = -1;
    for (const r of layers) {
        if (!r || r.layerKind !== 3 || !r.bounds) continue;
        const bd = r.bounds;
        if (!bd.left || !bd.right || !bd.top || !bd.bottom) continue;
        const b = {
            left: bd.left._value, right: bd.right._value,
            top: bd.top._value, bottom: bd.bottom._value
        };
        const ix = Math.max(0, Math.min(sel.right, b.right) - Math.max(sel.left, b.left));
        const iy = Math.max(0, Math.min(sel.bottom, b.bottom) - Math.max(sel.top, b.top));
        const inter = ix * iy;
        if (inter <= 0) continue;
        const area = (b.right - b.left) * (b.bottom - b.top);
        const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
        const centerIn = cx >= sel.left && cx <= sel.right && cy >= sel.top && cy <= sel.bottom;
        const ratio = area > 0 ? inter / area : 0;
        if (ratio < 0.5 && !centerIn) continue;
        if (ratio >= bestScore) { bestScore = ratio; best = { id: r.layerID, bounds: b }; }
    }
    return best;
}

async function _findTextLayerInSelection(sel, who) {
    if (!sel) return null;
    const tok = _perfBegin("Enumerasi layer (" + (who || "tombol style") + ")");
    const nr = await _bp([{
        _obj: "get",
        _target: [{ _property: "numberOfLayers" }, { _ref: "document", _enum: "ordinal", _value: "targetEnum" }]
    }]);
    const n = nr && nr[0] && nr[0].numberOfLayers;
    if (!n) return null;
    const PROPS = ["layerKind", "bounds", "layerID"];
    const gets = [];
    for (let i = 1; i <= n; i++) {
        for (const p of PROPS) gets.push({ _obj: "get", _target: [{ _property: p }, { _ref: "layer", _index: i }] });
    }
    const res = await _bp(gets) || [];
    let layers = [];
    let g = 0;
    for (; g < n; g++) {
        const a = res[3 * g], b = res[3 * g + 1], c = res[3 * g + 2];
        if (!a || !b || !c || a.message || b.message || c.message) break;
        layers.push({ layerKind: a.layerKind, bounds: b.bounds, layerID: c.layerID });
    }
    let mode = "per-properti";
    if (g < n - 1) {
        const bad = res.find(x => x && x.message);
        vlog("Enumerasi per-properti terhenti di layer " + (g + 1) + "/" + n + " (" +
            (bad ? bad.message : "tanpa hasil") + ") — fallback get penuh.", "warn");
        const full = [];
        for (let i = 1; i <= n; i++) full.push({ _obj: "get", _target: [{ _ref: "layer", _index: i }] });
        layers = (await _bp(full) || []).filter(r => r && !r.message);
        mode = "get penuh (fallback)";
    }
    const best = _bestTextLayerInSel(layers, sel);
    _perfEnd(tok, n + " layer, " + mode);
    return best;
}

async function _resizeFontReshape(info, newSize) {
    const tk = info.tk;
    const st = _styleFromLayerGet(tk);
    st.size = newSize;

    const opts = _readFontOpts();
    opts.styleObj = st;
    opts.fontPostScript = st.fontPostScriptName;
    opts.fontFamily = st.fontName;
    opts.fontSize = newSize;
    opts.align = st.alignment;
    opts.autoResize = false;

    const raw = (typeof tk.textKey === "string") ? tk.textKey : "";
    if (!raw.trim()) { log("textKey kosong — batal.", "warn"); return false; }
    let finalText;
    if (opts.wrapShape && opts.wrapShape !== "none") {
        let wrapBounds = await getSelectionBounds();
        if (!wrapBounds) {
            const rb = await _findBubbleBoundsForLayer(info);
            if (rb.inBubble) {
                wrapBounds = rb.bounds;
                vlog("Pembatas bubble via magic wand @(" + Math.round(info.cx) + "," +
                    Math.round(info.cy) + ")", "info");
            }
        }
        if (!wrapBounds) wrapBounds = info.bounds;
        finalText = await _shapeText(raw.replace(/\r/g, " "), wrapBounds, opts);
    } else {
        finalText = raw;
        opts.forceExplicitBreaks = true;
    }

    await _deleteTextLayer(info);
    await createParagraphText(finalText, info.bounds, opts);
    return true;
}

async function _restyleActiveLayer(styleObj, reshape, targetLayerID) {
    if (_modalBusy) return;
    const tok = _perfBegin("Restyle" + (reshape ? " (reshape)" : " (swap)"));
    _modalBusy = true;
    _setApplyEnabled(false);
    try {
        await _waitCapture(false);
        await _modalWithHistory("Auto Typeset: Restyle Layer", async () => {
            const pre = (targetLayerID != null) ? [_dSelectLayerID(targetLayerID)] : null;
            const info = await _getActiveTextInfo(pre);
            if (!info.isText) {
                log("Pilih layer TEKS dulu untuk di-restyle.", "warn");
                setStatusPill("Select a text layer to restyle", "status-warn");
                return;
            }
            const ok = await _restyleFontReshape(info, styleObj, reshape);
            if (ok) log("Style diganti (" + (styleObj.fontName || "") + ").", "success");
        });
    } catch (e) {
        log("Restyle error: " + (e && e.message ? e.message : String(e)), "error");
    } finally {
        _modalBusy = false;
        await refreshSelectionBounds();
        _perfEnd(tok);
    }
}

async function _restyleFontReshape(info, styleObj, reshape) {
    const raw = (info.tk && typeof info.tk.textKey === "string") ? info.tk.textKey : "";
    if (!raw.trim()) { log("textKey kosong — batal.", "warn"); return false; }

    const xf = info.tk && info.tk.transform;
    const sc = (xf && typeof xf.xx === "number" && xf.xx > 0) ? xf.xx : 1;
    const effSize = info.size * sc;

    const resizeOn = _readCheckbox("checkbox-restyle-resize", true);

    const st = Object.assign({}, styleObj);
    st.size = resizeOn ? styleObj.size : effSize;

    const opts = _readFontOpts();
    opts.styleObj = st;
    opts.fontPostScript = st.fontPostScriptName;
    opts.fontFamily = st.fontName;
    if (st.alignment) opts.align = st.alignment;
    opts.resizeFit = "bbox";
    opts.fontSize = st.size;
    opts.autoResize = false;

    let finalText, targetBounds = info.bounds;

    if (!reshape) {
        opts.wrapShape = "none";
        opts.forceExplicitBreaks = true;
        finalText = raw;
    } else {
        let bb = await getSelectionBounds();
        let inBubble = !!bb;
        if (!bb) {
            const rb = await _findBubbleBoundsForLayer(info);
            bb = rb.inBubble ? rb.bounds : info.bounds;
            inBubble = rb.inBubble;
        }
        const wrapBounds = bb;

        if (opts.wrapShape && opts.wrapShape !== "none") {
            finalText = await _shapeText(raw.replace(/\r/g, " "), wrapBounds, opts);
        } else {
            finalText = raw; opts.forceExplicitBreaks = true;
        }

        opts.autoResize = resizeOn && inBubble;
        targetBounds = inBubble ? bb : info.bounds;
    }

    await _deleteTextLayer(info);
    await createParagraphText(finalText, targetBounds, opts);
    return true;
}

async function resizeActiveText(dir) {
    if (_modalBusy) return;
    const step = parseFloat(_readText("input-resize-step", "2")) || 0;
    if (step <= 0) { log("Resize step harus > 0.", "warn"); return; }
    const mode = _readText("select-resize-mode", "transform");
    const target = _readText("select-resize-target", "selection");
    const tok = _perfBegin("Resize " + (dir < 0 ? "−" : "+") + " (" + mode + ", target " + target + ")");
    _modalBusy = true;
    _setApplyEnabled(false);
    try {
        await _waitCapture(false);
        const sel = await getSelectionBounds();
        let targetID = null;
        if (sel && target === "selection") {
            const hit = await _findTextLayerInSelection(sel, "Resize");
            if (hit) targetID = hit.id;
            else log("Resize: tidak ada teks di selection → layer aktif.", "info");
        }
        await _modalWithHistory("Auto Typeset: Resize Text", async () => {
            const pre = (targetID != null) ? [_dSelectLayerID(targetID)] : null;
            const info = await _getActiveTextInfo(pre);
            if (!info.isText) {
                log("Pilih layer TEKS dulu untuk di-resize.", "warn");
                setStatusPill("Select a text layer to resize", "status-warn");
                return;
            }
            const xf = info.tk && info.tk.transform;
            const sc = (xf && typeof xf.xx === "number" && xf.xx > 0) ? xf.xx : 1;
            const effSize = info.size * sc;
            const newSize = effSize + dir * step;
            if (newSize < 1) { log("Ukuran font minimum 1.", "warn"); return; }
            if (mode === "fontreshape") {
                const ok = await _resizeFontReshape(info, newSize);
                if (sel) await deselect();
                if (ok) vlog("Resize (font+reshape): " + effSize.toFixed(1) + " → " +
                    newSize.toFixed(1), "info");
                return;
            }
            const ratio = newSize / effSize;
            if (sel) await deselect();
            const tdescs = (info.layerID != null) ? [_dSelectLayerID(info.layerID), _dTransformScale(ratio)] : [_dTransformScale(ratio)];
            const rt = await _bp(tdescs);
            const bad = (rt || []).find(x => x && x.message);
            if (!rt || rt.length < tdescs.length || bad) {
                log("Resize gagal: " + (bad ? bad.message : "batch terhenti"), "warn");
                setStatusPill("Resize failed (see Log)", "status-warn");
                return;
            }
            await _recenterFrom(null, info.cx, info.cy, false);
            vlog("Resize: " + effSize.toFixed(1) + " → " + newSize.toFixed(1) +
                " (×" + ratio.toFixed(3) + ")", "info");
        });
    } catch (e) {
        log("Resize error: " + (e && e.message ? e.message : String(e)), "error");
    } finally {
        _modalBusy = false;
        await refreshSelectionBounds();
        _perfEnd(tok);
    }
}

const SOFTEN_STEP = 0.05;
async function reshapeSoften(dir) {
    if (_modalBusy) return;
    const shape = _readText("select-wrap-shape", "none");
    if (!shape || shape === "none") {
        log("SOFTEN −/+ butuh Shape ≠ None (Settings → Shape).", "warn");
        setStatusPill("Soften: set a Shape first", "status-warn");
        return;
    }
    const el = document.getElementById("input-v4-soften");
    if (!el) return;
    const cur = parseFloat(el.value);
    const base = isFinite(cur) ? cur : V3_SOFTEN_EXP;
    const next = Math.max(0.05, Math.round((base + dir * SOFTEN_STEP) * 100) / 100);
    el.value = String(next);
    _pvSyncSoftenFromInput();
    _renderPreview();
    saveSettings();

    const tok = _perfBegin("Soften " + (dir < 0 ? "−" : "+"));
    _modalBusy = true;
    _setApplyEnabled(false);
    try {
        await _waitCapture(false);
        await _modalWithHistory("Auto Typeset: Soften " + (dir < 0 ? "−" : "+"), async () => {
            const info = await _getActiveTextInfo();
            if (!info.isText) {
                log("Pilih layer TEKS dulu untuk di-reshape (SOFTEN).", "warn");
                setStatusPill("Select a text layer to reshape", "status-warn");
                return;
            }
            const xf = info.tk && info.tk.transform;
            const sc = (xf && typeof xf.xx === "number" && xf.xx > 0) ? xf.xx : 1;
            const effSize = info.size * sc;
            const ok = await _resizeFontReshape(info, effSize);
            if (ok) vlog("Soften: SOFTEN_EXP " + base.toFixed(2) + " → " + next.toFixed(2), "info");
        });
    } catch (e) {
        log("Soften error: " + (e && e.message ? e.message : String(e)), "error");
    } finally {
        _modalBusy = false;
        await refreshSelectionBounds();
        _perfEnd(tok);
    }
}

async function _applyNote(over) {
    over = over || {};
    if (_modalBusy) return;
    const replaceID = (over.replaceLayerID != null) ? over.replaceLayerID : null;
    const perfName = replaceID != null ? "Replace" : (over.styleObj ? "Apply tombol style" : "Apply");
    const tTotal = _perfBegin(perfName + " (total)");
    const curNote = _notes[_currentIdx];
    if (curNote && curNote.skip) {
        log("Baris ini penanda bantuan (skip) — tidak ditempel.", "warn");
        setStatusPill("Marker line (skip)", "status-warn");
        return;
    }
    const text = currentNoteText();
    if (!text || !text.trim()) {
        log("Note current kosong — tidak dijalankan.", "warn");
        setStatusPill("Current note is empty", "status-warn");
        return;
    }

    const opts = _readFontOpts();
    if (over.styleObj) {
        const st = over.styleObj;
        opts.styleObj = st;
        opts.fontPostScript = st.fontPostScriptName;
        opts.fontFamily = st.fontName;
        opts.fontSize = st.size;
        if (st.alignment) opts.align = st.alignment;
        vlog("Style dipaksa (tombol style) '" + (st.fontName || "") + "'", "info");
    } else {
        _resolveStyleIntoOpts(curNote, _currentIdx, opts);
        if (!opts.styleObj) {
            log("No style found — buat style dulu di Font Styles.", "warn");
            setStatusPill("No style found", "status-warn");
            return;
        }
    }

    const autoAdvance = _readCheckbox("checkbox-pop-on-apply", true);
    const deselectAfter = _readCheckbox("checkbox-deselect-after", true);

    _modalBusy = true;
    _setApplyEnabled(false);
    let applied = false;
    try {
        await _waitCapture(false);
        const tModal = _perfBegin(perfName + " (modal)");
        await _modalWithHistory(replaceID != null ? "Auto Typeset: Replace Text" : "Auto Typeset: Apply Note", async () => {
            let sel = await getSelectionBounds();
            if (!sel) {
                log("Tidak ada selection aktif — buat selection (magic wand) lalu Apply lagi.", "warn");
                setStatusPill("Make a selection first (magic wand), then Apply", "status-warn");
                return;
            }
            const w = sel.right - sel.left;
            const h = sel.bottom - sel.top;
            if (w < MIN_BUBBLE_PX || h < MIN_BUBBLE_PX) {
                log("Selection terlalu kecil (" + w.toFixed(0) + "×" + h.toFixed(0) + " px, min " + MIN_BUBBLE_PX + ").", "warn");
                setStatusPill("Selection too small (min " + MIN_BUBBLE_PX + " px)", "status-warn");
                return;
            }
            opts.previewAnyAspect = true;
            if (_readCheckbox("checkbox-remove-tail-apply", true)) sel = await _removeTailBounds(sel);
            vlog("Selection bounds: " + JSON.stringify(sel), "info");

            if (opts.resizeFit === "area" && opts.autoResize) {
                opts.selFillRatio = await _getSelectionFillRatio(sel);
                vlog("Fill ratio (area) = " + opts.selFillRatio.toFixed(3), "info");
            }

            let finalText = text;
            if (opts.wrapShape && opts.wrapShape !== "none") {
                finalText = await _shapeText(text, sel, opts);
                vlog("Shape wrap: " + opts.wrapShape + " → " +
                    finalText.split("\r").length + " baris", "info");
            }

            if (replaceID != null) {
                const rd = await _bp([
                    { _obj: "select", _target: [{ _ref: "layer", _id: replaceID }], makeVisible: false },
                    { _obj: "delete", _target: [{ _ref: "layer", _id: replaceID }] }
                ]);
                const bad = (rd || []).find(x => x && x.message);
                if (!rd || rd.length < 2 || bad) {
                    throw new Error("hapus teks lama (id " + replaceID + "): " + (bad ? bad.message : "batch terhenti"));
                }
            }

            await createParagraphText(finalText, sel, opts);
            log((replaceID != null ? "Teks diganti" : "Text dibuat") + " (" + truncate(text, 32) + ") di " +
                Math.round(w) + "×" + Math.round(h) + " px.", "success");

            if (deselectAfter) {
                const td = _perfBegin("Deselect");
                await deselect();
                _perfEnd(td);
            }
            applied = true;
        });
        _perfEnd(tModal);

        if (applied && autoAdvance) {
            const appliedIdx = _currentIdx;
            advanceCurrent();
            if (replaceID == null) await _recordApplyHistory(appliedIdx, _currentIdx);
        }
    } catch (e) {
        log((replaceID != null ? "Replace" : "Apply") + " error: " + (e && e.message ? e.message : String(e)), "error");
    } finally {
        _modalBusy = false;
        await refreshSelectionBounds();
        _perfEnd(tTotal, applied ? "" : "tidak jadi");
    }
}

async function _applyWithStyle(styleObj) {
    if (_modalBusy) return;
    const reshape = _readCheckbox("checkbox-restyle-reshape", true);
    let hit = null;
    _modalBusy = true;
    try {
        const sel = await getSelectionBounds();
        if (!sel) {
            log("Tidak ada selection — buat selection dulu, lalu klik style.", "warn");
            setStatusPill("Make a selection first", "status-warn");
            return;
        }
        hit = await _findTextLayerInSelection(sel);
    } catch (e) {
        log("Style btn error: " + (e && e.message ? e.message : String(e)), "error");
        return;
    } finally {
        _modalBusy = false;
    }
    log("Style btn: teks di selection=" + (hit ? "id " + hit.id : "tidak ada") + " → " +
        (hit ? "RESTYLE teks di selection" : "paste teks queue"), "info");
    if (hit) {
        return _restyleActiveLayer(styleObj, reshape, hit.id);
    }
    return _applyNote({ styleObj: styleObj });
}

function skipCurrent() {
    if (_notes.length === 0) return;
    if (_currentIdx >= _notes.length - 1) {
        log("Sudah di balon terakhir.", "info");
        return;
    }
    advanceCurrent();
    log("Maju ke balon berikutnya.", "info");
}
