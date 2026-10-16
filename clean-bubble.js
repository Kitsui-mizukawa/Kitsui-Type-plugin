const WHITE_RGB = { red: 255, grain: 255, blue: 255 };
const BLACK_RGB = { red: 0, grain: 0, blue: 0 };

var _cbAllocBytes = 0, _cbLiveBytes = 0, _cbPeakBytes = 0;
function _cbTrack(bytes) {
    _cbAllocBytes += bytes;
    _cbLiveBytes += bytes;
    if (_cbLiveBytes > _cbPeakBytes) _cbPeakBytes = _cbLiveBytes;
}
function _cbAlloc(Ctor, n) {
    _cbTrack(n * Ctor.BYTES_PER_ELEMENT);
    return new Ctor(n);
}
function _cbCountBuf(buf) {
    _cbTrack((buf && (buf.byteLength || buf.length)) || 0);
    return buf;
}
function _cbFree(buf) {
    if (buf) _cbLiveBytes -= (buf.byteLength || buf.length || 0);
    return null;
}

async function _detectBubbleColor(sel) {
    try {
        const imaging = require("photoshop").imaging;
        const doc = app.activeDocument;
        const W = doc.width, H = doc.height;
        const left = Math.max(0, Math.floor(sel.left));
        const top = Math.max(0, Math.floor(sel.top));
        const right = Math.min(W, Math.ceil(sel.right));
        const bottom = Math.min(H, Math.ceil(sel.bottom));
        if (right - left < 1 || bottom - top < 1) return WHITE_RGB;

        const pix = await imaging.getPixels({
            documentID: doc.id,
            sourceBounds: { left, top, right, bottom },
            targetSize: { width: 32, height: 32 },
            applyAlpha: false,
            colorSpace: "RGB",
            componentSize: 8
        });
        const data = _cbCountBuf(await pix.imageData.getData({}));
        const comp = pix.imageData.components || 3;
        let sum = 0, n = 0;
        for (let i = 0; i + 2 < data.length; i += comp) {
            sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            n++;
        }
        _cbFree(data);
        try { pix.imageData.dispose(); } catch (e) { vlog("dispose: " + (e && e.message), "warn"); }
        const mean = n > 0 ? sum / n : 255;
        vlog("Clean bubble: mean luminance=" + mean.toFixed(1), "info");
        return mean >= 128 ? WHITE_RGB : BLACK_RGB;
    } catch (e) {
        log("Deteksi warna gagal (" + (e && e.message ? e.message : String(e)) +
            ") — fallback putih.", "warn");
        return WHITE_RGB;
    }
}

function _erodeBinary(a, w, h, r, tmp) {
    if (r <= 0) return a;
    const own = !tmp;
    if (own) tmp = _cbAlloc(Uint8Array, w * h);
    for (let y = 0; y < h; y++) {
        const row = y * w;
        let zeros = 0;
        for (let k = 0, e = Math.min(w - 1, r); k <= e; k++) if (a[row + k] === 0) zeros++;
        for (let x = 0; x < w; x++) {
            tmp[row + x] = zeros > 0 ? 0 : 255;
            const o = x - r, n = x + r + 1;
            if (o >= 0 && a[row + o] === 0) zeros--;
            if (n < w && a[row + n] === 0) zeros++;
        }
    }
    for (let x = 0; x < w; x++) {
        let zeros = 0;
        for (let k = 0, e = Math.min(h - 1, r); k <= e; k++) if (tmp[k * w + x] === 0) zeros++;
        for (let y = 0; y < h; y++) {
            a[y * w + x] = zeros > 0 ? 0 : 255;
            const o = y - r, n = y + r + 1;
            if (o >= 0 && tmp[o * w + x] === 0) zeros--;
            if (n < h && tmp[n * w + x] === 0) zeros++;
        }
    }
    if (own) _cbFree(tmp);
    return a;
}

function _blur3x3ToU8(src, w, h, out, tmp) {
    const own = !tmp;
    if (own) tmp = _cbAlloc(Uint16Array, w * h);
    for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
            let s = src[row + x];
            if (x > 0) s += src[row + x - 1];
            if (x < w - 1) s += src[row + x + 1];
            tmp[row + x] = s;
        }
    }
    for (let y = 0; y < h; y++) {
        const row = y * w;
        const up = y > 0 ? row - w : -1, dn = y < h - 1 ? row + w : -1;
        const ch = 1 + (up >= 0 ? 1 : 0) + (dn >= 0 ? 1 : 0);
        for (let x = 0; x < w; x++) {
            let s = tmp[row + x];
            if (up >= 0) s += tmp[up + x];
            if (dn >= 0) s += tmp[dn + x];
            const v = s / ((1 + (x > 0 ? 1 : 0) + (x < w - 1 ? 1 : 0)) * ch);
            out[row + x] = v >= 255 ? 255 : (v <= 0 ? 0 : (v | 0));
        }
    }
    if (own) _cbFree(tmp);
    return out;
}

async function _getCleanMask(bbox, doFill, insetPx) {
    const imaging = require("photoshop").imaging;
    const doc = app.activeDocument;
    const w = bbox.right - bbox.left, h = bbox.bottom - bbox.top;
    const sPix = await imaging.getSelection({
        documentID: doc.id,
        sourceBounds: { left: bbox.left, top: bbox.top, right: bbox.right, bottom: bbox.bottom }
    });
    let sdata = _cbCountBuf(await sPix.imageData.getData({}));
    const sc = sPix.imageData.components || 1;
    const N = w * h;
    const filled = _cbAlloc(Uint8Array, N);
    for (let i = 0; i < N; i++) filled[i] = sdata[i * sc] >= 128 ? 255 : 0;
    sdata = _cbFree(sdata);
    try { sPix.imageData.dispose(); } catch (e) { vlog("dispose: " + (e && e.message), "warn"); }

    let outside = null, queue = null;
    if (doFill) {
        outside = _cbAlloc(Uint8Array, N);
        queue = _cbAlloc(Int32Array, N);
        let qh = 0, qt = 0;
        const pushIf = (idx) => { if (!outside[idx] && !filled[idx]) { outside[idx] = 1; queue[qt++] = idx; } };
        for (let x = 0; x < w; x++) { pushIf(x); pushIf((h - 1) * w + x); }
        for (let y = 0; y < h; y++) { pushIf(y * w); pushIf(y * w + (w - 1)); }
        while (qh < qt) {
            const idx = queue[qh++];
            const x = idx % w, y = (idx / w) | 0;
            if (x > 0) pushIf(idx - 1);
            if (x < w - 1) pushIf(idx + 1);
            if (y > 0) pushIf(idx - w);
            if (y < h - 1) pushIf(idx + w);
        }
        let holes = 0;
        for (let i = 0; i < N; i++) { if (!filled[i] && !outside[i]) { filled[i] = 255; holes++; } }
        vlog("Isi lubang: " + holes + " px (flood-fill bbox).", "info");
    }

    const r = Math.round(insetPx) || 0;
    _erodeBinary(filled, w, h, r, outside);
    outside = _cbFree(outside);
    const alpha = _cbAlloc(Uint8Array, N);
    _blur3x3ToU8(filled, w, h, alpha, queue);
    _cbFree(filled);
    return { alpha, w, h, scratch: queue };
}

async function _putLayerRGBA(name, rgba, bbox, opacity) {
    const imaging = require("photoshop").imaging;
    const doc = app.activeDocument;
    const layerID = await _makeLayerGetID(name);
    await _moveLayerToRootFront(layerID);
    const imgData = await imaging.createImageDataFromBuffer(rgba, {
        width: bbox.right - bbox.left, height: bbox.bottom - bbox.top,
        components: 4, componentSize: 8, colorSpace: "RGB"
    });
    await imaging.putPixels({
        documentID: doc.id, layerID: layerID, imageData: imgData,
        targetBounds: { left: bbox.left, top: bbox.top, right: bbox.right, bottom: bbox.bottom }
    });
    try { imgData.dispose(); } catch (e) { vlog("dispose: " + (e && e.message), "warn"); }
    if (opacity != null) await setLayerOpacity(opacity);
}

async function _buildAreaRGBA(bbox, alpha, scratch) {
    const imaging = require("photoshop").imaging;
    const doc = app.activeDocument;
    const w = bbox.right - bbox.left, h = bbox.bottom - bbox.top;
    const N = w * h;
    const cPix = await imaging.getPixels({
        documentID: doc.id,
        sourceBounds: { left: bbox.left, top: bbox.top, right: bbox.right, bottom: bbox.bottom },
        applyAlpha: false, colorSpace: "RGB", componentSize: 8
    });
    let cdata = _cbCountBuf(await cPix.imageData.getData({}));
    const cc = cPix.imageData.components || 3;
    let L = _cbAlloc(Uint8Array, N);
    for (let i = 0; i < N; i++) {
        const o = i * cc;
        L[i] = (0.299 * cdata[o] + 0.587 * cdata[o + 1] + 0.114 * cdata[o + 2] + 0.5) | 0;
    }
    cdata = _cbFree(cdata);
    try { cPix.imageData.dispose(); } catch (e) { vlog("dispose: " + (e && e.message), "warn"); }

    const label = _cbAlloc(Int32Array, N);
    let queue = (scratch instanceof Int32Array && scratch.length >= N) ? scratch : _cbAlloc(Int32Array, N);
    const sumL = [0], cnt = [0];
    let nextLabel = 0;
    for (let start = 0; start < N; start++) {
        if (!alpha[start] || label[start]) continue;
        nextLabel++;
        let qs = 0, qe = 0;
        queue[qe++] = start; label[start] = nextLabel;
        let s = 0, c = 0;
        while (qs < qe) {
            const idx = queue[qs++];
            s += L[idx]; c++;
            const x = idx % w, y = (idx / w) | 0;
            if (x > 0 && alpha[idx - 1] && !label[idx - 1]) { label[idx - 1] = nextLabel; queue[qe++] = idx - 1; }
            if (x < w - 1 && alpha[idx + 1] && !label[idx + 1]) { label[idx + 1] = nextLabel; queue[qe++] = idx + 1; }
            if (y > 0 && alpha[idx - w] && !label[idx - w]) { label[idx - w] = nextLabel; queue[qe++] = idx - w; }
            if (y < h - 1 && alpha[idx + w] && !label[idx + w]) { label[idx + w] = nextLabel; queue[qe++] = idx + w; }
        }
        sumL[nextLabel] = s; cnt[nextLabel] = c;
    }
    L = _cbFree(L); queue = _cbFree(queue);
    const labelVal = _cbAlloc(Uint8Array, nextLabel + 1);
    for (let l = 1; l <= nextLabel; l++) labelVal[l] = (cnt[l] > 0 && sumL[l] / cnt[l] >= 128) ? 255 : 0;
    vlog("Clean area: " + nextLabel + " komponen.", "info");

    const out = _cbAlloc(Uint8Array, N * 4);
    for (let i = 0; i < N; i++) {
        const a = alpha[i];
        if (!a) continue;
        const v = labelVal[label[i]];
        out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = a;
    }
    _cbFree(label);
    return out;
}

function _buildSingleRGBA(alpha, N, color) {
    const out = _cbAlloc(Uint8Array, N * 4);
    for (let i = 0; i < N; i++) {
        const a = alpha[i];
        if (!a) continue;
        out[i * 4] = color.red; out[i * 4 + 1] = color.grain; out[i * 4 + 2] = color.blue;
        out[i * 4 + 3] = a;
    }
    return out;
}

async function doCleanBubble() {
    if (_modalBusy) return;
    const tok = _perfBegin("Clean Bubble");
    let perfInfo = "";
    _cbAllocBytes = 0; _cbLiveBytes = 0; _cbPeakBytes = 0;
    _modalBusy = true;
    _setApplyEnabled(false);
    try {
        await _waitCapture(false);
        await _modalWithHistory("Auto Typeset: Clean Bubble", async () => {
            const sel = await getSelectionBounds();
            if (!sel) {
                log("Tidak ada selection — buat selection di balon dulu, lalu Clean Bubble.", "warn");
                setStatusPill("Make a selection first, then Clean Bubble", "status-warn");
                return;
            }
            const w = sel.right - sel.left, h = sel.bottom - sel.top;
            if (w < 2 || h < 2) {
                log("Selection terlalu kecil (" + w.toFixed(0) + "×" + h.toFixed(0) + " px).", "warn");
                return;
            }

            const doFillHoles = _readCheckbox("checkbox-fill-holes", true);
            const doRemoveTail = _readCheckbox("checkbox-remove-tail", true);
            const removeTailPx = parseInt(_readText("input-remove-tail", "8"), 10) || 0;
            const colorMode = _readText("select-clean-color", "area");
            const edgeInsetPx = parseInt(_readText("input-edge-inset", "1"), 10) || 0;

            const singleColor = (colorMode === "single") ? await _detectBubbleColor(sel) : null;

            let cur;
            if (doRemoveTail && removeTailPx > 0) {
                cur = await _openSelectionBounds(removeTailPx) || await getSelectionBounds();
                vlog("Hapus ekor: contract/expand " + removeTailPx + "px", "info");
            } else {
                cur = await getSelectionBounds();
            }

            if (!cur) { log("Selection hilang setelah morfologi.", "warn"); return; }
            const W = Math.round(app.activeDocument.width), H = Math.round(app.activeDocument.height);
            const bbox = {
                left: Math.max(0, Math.floor(cur.left)),
                top: Math.max(0, Math.floor(cur.top)),
                right: Math.min(W, Math.ceil(cur.right)),
                bottom: Math.min(H, Math.ceil(cur.bottom))
            };
            const bw = bbox.right - bbox.left, bh = bbox.bottom - bbox.top;
            if (bw < 1 || bh < 1) { log("bbox kosong.", "warn"); return; }
            perfInfo = bw + "×" + bh + " px (" + colorMode + ")";

            const m = await _getCleanMask(bbox, doFillHoles, edgeInsetPx);
            if (!m) { log("Gagal membaca mask selection.", "error"); return; }
            const N = m.w * m.h;

            const scratch = m.scratch;
            m.scratch = null;
            if (colorMode === "single") _cbFree(scratch);
            let cleanRGBA = (colorMode === "single")
                ? _buildSingleRGBA(m.alpha, N, singleColor)
                : await _buildAreaRGBA(bbox, m.alpha, scratch);
            await _putLayerRGBA("clean bubble", cleanRGBA, bbox);
            cleanRGBA = _cbFree(cleanRGBA);
            log("Clean bubble (" + (colorMode === "single" ? "1 warna" : "per-area") + ") dibuat.", "success");

            const guideRGBA = _cbAlloc(Uint8Array, N * 4);
            for (let i = 0; i < N; i++) {
                const a = m.alpha[i];
                if (!a) continue;
                guideRGBA[i * 4] = 0; guideRGBA[i * 4 + 1] = 255; guideRGBA[i * 4 + 2] = 255;
                guideRGBA[i * 4 + 3] = a;
            }
            m.alpha = _cbFree(m.alpha);
            await _putLayerRGBA("bubble", guideRGBA, bbox, 50);
            _cbFree(guideRGBA);

            await deselect();
            log("Layer 'bubble' (guide) dibuat. Magic-wand untuk menempel teks.", "success");
        });
    } catch (e) {
        log("Clean Bubble error: " + (e && e.message ? e.message : String(e)), "error");
    } finally {
        _modalBusy = false;
        await refreshSelectionBounds();
        const mb = (b) => (b / 1048576).toFixed(1);
        _perfEnd(tok, perfInfo + " · buffer JS puncak ≈" + mb(_cbPeakBytes) + " MB, alokasi " + mb(_cbAllocBytes) + " MB (kumulatif)");
    }
}
