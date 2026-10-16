const _pvState = { live: true, selW: 320, selH: 280, lastShaped: null, selKey: null };
const PV_MAX = 140;
const PV_SIZE_MIN = 80, PV_SIZE_MAX = 320;
const PV_MIN_FONT_PX = 7;
const PV_FONT_MAX = 32;

function _previewShapedFor(rawText, opts, sel) {
    const ls = _pvState.lastShaped;
    if (!ls || (!_pvState.live && sel)) return null;
    if (!opts.wrapShape || opts.wrapShape === "none") return null;
    if (ls.shape !== opts.wrapShape || ls.algorithm !== opts.algorithm) return null;
    if (ls.raw !== (rawText || "").trim()) return null;
    if (sel) {
        const w = sel.right - sel.left, h = sel.bottom - sel.top;
        if (!(w > 0 && h > 0) || Math.abs((w / h) / ls.aspect - 1) > 0.01) return null;
    }
    return ls.shaped;
}

function _pvEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function _pvFontSize() {
    const n = _notes[_currentIdx];
    let tag = n ? n.tag : "";
    if (n && _isFollowTag(tag)) tag = _resolveFollowSourceTag(_currentIdx);
    const st = n ? _styleForTag(tag) : null;
    const sz = (st && st.style && isFinite(st.style.size)) ? st.style.size : 18;
    return sz > 0 ? sz : 18;
}

function _pvMax() {
    const v = parseInt(_readText("input-preview-size", String(PV_MAX)), 10);
    return isFinite(v) ? Math.max(PV_SIZE_MIN, Math.min(PV_SIZE_MAX, v)) : PV_MAX;
}

function _pvFontPx(styleSize, s) {
    const v = parseFloat(_readText("input-preview-font", "0"));
    if (isFinite(v) && v > 0) return Math.max(PV_MIN_FONT_PX, Math.min(PV_FONT_MAX, v));
    return Math.max(PV_MIN_FONT_PX, styleSize * s);
}

function _pvApplyCompact() {
    const panel = document.getElementById("preview-panel");
    if (panel) panel.classList.toggle("pv-compact", _readCheckbox("checkbox-preview-compact", false));
}

function _pvSetSlider(id, valId, v) {
    const el = document.getElementById(id);
    if (el) {
        if (v > +el.max) el.max = String(v);
        el.value = String(v);
    }
    const lbl = document.getElementById(valId);
    if (lbl) lbl.textContent = String(v);
}

async function _renderPreview() {
    const stage = document.getElementById("pv-stage");
    if (!stage) return;
    const metrics = document.getElementById("pv-metrics");
    const text = (currentNoteText() || "").trim();
    if (!text) {
        stage.innerHTML = "";
        if (metrics) metrics.textContent = "";
        return;
    }
    const tok = _perfBegin("Preview render");
    const fontSize = _pvFontSize();
    const opts = Object.assign({}, _readFontOpts(), { fontSize: fontSize });
    const selW = Math.max(1, _pvState.selW), selH = Math.max(1, _pvState.selH);
    const sel = { left: 0, top: 0, right: selW, bottom: selH };

    let shaped;
    try {
        shaped = await wrapTextToShape(text, sel, opts);
    } catch (e) {
        vlog("Preview wrap error: " + (e && e.message ? e.message : String(e)), "warn");
        return;
    }
    _pvState.lastShaped = {
        raw: text,
        shaped: String(shaped),
        shape: opts.wrapShape || "none",
        algorithm: opts.algorithm,
        aspect: selW / selH
    };
    const lines = String(shaped).split("\r").filter(s => s.length).map(l => l.split(" ").filter(Boolean));
    if (!lines.length) { stage.innerHTML = ""; return; }

    const shape = opts.wrapShape || "none";
    const pvMax = _pvMax();
    const s = Math.min(pvMax / selW, pvMax / selH);
    const pvW = Math.round(selW * s), pvH = Math.round(selH * s);
    let selStyle = "width:" + pvW + "px;height:" + pvH + "px;left:50%;top:50%;" +
        "margin-left:" + (-pvW / 2) + "px;margin-top:" + (-pvH / 2) + "px;";
    if (shape === "ellipse" || shape === "sine") selStyle += "border-radius:50%;";
    else if (shape === "diamond") selStyle += "transform:rotate(45deg) scale(0.7);";

    const rows = lines.map(r => '<div class="pv-row">' + _pvEsc(r.join(" ")) + "</div>").join("");
    stage.innerHTML =
        '<div class="pv-stage" style="min-width:' + pvW + "px;min-height:" + pvH + 'px;">' +
        '<div class="pv-selbox" style="' + selStyle + '"></div>' +
        '<div class="pv-textbox" style="font-size:' + _pvFontPx(fontSize, s).toFixed(1) + 'px;">' + rows + "</div>" +
        "</div>";

    if (metrics) {
        const allWords = lines.reduce((a, r) => a.concat(r), []);
        const est = _measureWordWidthsEstimate(allWords, fontSize);
        const lw = lines.map(r => {
            let w = 0;
            for (let j = 0; j < r.length; j++) { if (j) w += est.spaceWidth; w += est.widths.get(r[j]) || 0; }
            return Math.round(w);
        });
        const asp = (selH / selW).toFixed(2);
        metrics.textContent =
            "lines: " + lines.length + "  ·  words: " + allWords.length +
            "  ·  box " + Math.round(selW) + "×" + Math.round(selH) + " (aspect " + asp + ")" +
            "\nactual: [" + lw.join(", ") + "]";
    }
    _perfEnd(tok, lines.length + " baris");
}

async function _updatePreviewFromSelection() {
    if (!_pvState.live) return;
    if (!document.getElementById("pv-stage")) return;
    try {
        const b = await getSelectionBounds();
        if (b) _pvTakeSelBounds(b);
        else _pvState.selKey = null;
    } catch (e) {
        vlog("Preview: baca selection gagal: " + (e && e.message ? e.message : String(e)), "warn");
    }
    _renderPreview();
}

const PV_SEL_DEBOUNCE_MS = 150;
const _PV_SEL_EVENTS = ["set", "addTo", "subtractFrom", "intersectWith", "inverse",
    "expand", "contract", "transform", "move"];
var _pvSelTimer = null;

function _pvSelKey(b) {
    return Math.round(b.left) + "_" + Math.round(b.top) + "_" +
        Math.round(b.right - b.left) + "_" + Math.round(b.bottom - b.top);
}

function _pvTakeSelBounds(b) {
    const w = Math.round(b.right - b.left), h = Math.round(b.bottom - b.top);
    if (!(w > 0 && h > 0)) return false;
    _pvState.selKey = _pvSelKey(b);
    _pvState.selW = w; _pvState.selH = h;
    _pvSetSlider("pv-selw", "pv-selw-val", w);
    _pvSetSlider("pv-selh", "pv-selh-val", h);
    return true;
}

function _pvApplySelectionBounds(b) {
    if (!_pvState.live || _activeView !== "notes") return false;
    if (!b) { _pvState.selKey = null; return false; }
    if (_pvSelKey(b) === _pvState.selKey) return false;
    if (!_pvTakeSelBounds(b)) return false;
    vlog("Preview: bubble " + _pvState.selW + "×" + _pvState.selH + " dari selection.", "info");
    _renderPreview();
    return true;
}

function _pvIsSelectionEvent(event, desc) {
    if (_PV_SEL_EVENTS.indexOf(event) === -1) return false;
    if (event !== "set" && event !== "move" && event !== "transform") return true;
    const t = desc && desc._target;
    if (!t) return true;
    try {
        return JSON.stringify(t).indexOf("selection") !== -1;
    } catch (e) {
        vlog("Preview: descriptor event tak terbaca: " + (e && e.message ? e.message : String(e)), "warn");
        return true;
    }
}

function _pvScheduleSelectionSync(event, desc) {
    if (!_pvState.live || _activeView !== "notes") return;
    if (!_pvIsSelectionEvent(event, desc)) return;
    if (_pvSelTimer) clearTimeout(_pvSelTimer);
    _pvSelTimer = setTimeout(_pvSyncFromSelection, PV_SEL_DEBOUNCE_MS);
}

async function _pvSyncFromSelection() {
    _pvSelTimer = null;
    if (_modalBusy || _capturing) return;
    _pvApplySelectionBounds(await getSelectionBounds());
}

function _pvSetSoften(val) {
    const num = document.getElementById("input-v4-soften");
    if (num) { num.value = String(val); num._userEdited = true; }
    const sld = document.querySelector('.pv-cslider[data-target="input-v4-soften"]');
    if (sld) sld.value = String(Math.round(val * 100));
    const lbl = document.getElementById("pv-soften-val");
    if (lbl) lbl.textContent = val.toFixed(2);
}

function _pvSyncSoftenFromInput() {
    const num = document.getElementById("input-v4-soften");
    if (!num) return;
    const v = parseFloat(num.value);
    if (!isFinite(v)) return;
    const sld = document.querySelector('.pv-cslider[data-target="input-v4-soften"]');
    if (sld) sld.value = String(Math.round(v * 100));
    const lbl = document.getElementById("pv-soften-val");
    if (lbl) lbl.textContent = v.toFixed(2);
}

function _pvSyncLiveLabel() {
    const live = document.getElementById("pv-live");
    const lbl = live && live.parentElement;
    if (lbl) lbl.classList.toggle("is-on", !!live.checked);
}

function _wirePreview() {
    const selw = document.getElementById("pv-selw");
    if (selw) selw.addEventListener("input", () => {
        _pvState.selW = Math.round(+selw.value) || 1;
        const lbl = document.getElementById("pv-selw-val"); if (lbl) lbl.textContent = String(_pvState.selW);
        _renderPreview();
    });
    const selh = document.getElementById("pv-selh");
    if (selh) selh.addEventListener("input", () => {
        _pvState.selH = Math.round(+selh.value) || 1;
        const lbl = document.getElementById("pv-selh-val"); if (lbl) lbl.textContent = String(_pvState.selH);
        _renderPreview();
    });
    const soft = document.querySelector('.pv-cslider[data-target="input-v4-soften"]');
    if (soft) soft.addEventListener("input", () => {
        const mult = +soft.getAttribute("data-mult") || 100;
        _pvSetSoften((+soft.value) / mult);
        _renderPreview();
        saveStateDebounced();
    });
    const live = document.getElementById("pv-live");
    if (live) live.addEventListener("change", () => {
        _pvState.live = live.checked;
        _pvSyncLiveLabel();
        if (live.checked) _updatePreviewFromSelection();
    });
    _pvSyncLiveLabel();
    const selShape = document.getElementById("select-wrap-shape");
    if (selShape) selShape.addEventListener("change", () => _renderPreview());
    const selAlgo = document.getElementById("select-algorithm");
    if (selAlgo) selAlgo.addEventListener("change", () => _renderPreview());
    const pvSize = document.getElementById("input-preview-size");
    if (pvSize) {
        pvSize.addEventListener("input", () => _renderPreview());
        pvSize.addEventListener("change", () => _renderPreview());
    }
    const pvFont = document.getElementById("input-preview-font");
    if (pvFont) {
        pvFont.addEventListener("input", () => _renderPreview());
        pvFont.addEventListener("change", () => _renderPreview());
    }
    const pvCompact = document.getElementById("checkbox-preview-compact");
    if (pvCompact) pvCompact.addEventListener("change", _pvApplyCompact);
    _pvApplyCompact();
    const pvPanel = document.getElementById("preview-panel");
    if (pvPanel) {
        pvPanel.addEventListener("toggle", saveStateDebounced);
        const pvSummary = pvPanel.querySelector("summary");
        if (pvSummary) pvSummary.addEventListener("click", saveStateDebounced);
    }

    _pvSyncSoftenFromInput();
}
