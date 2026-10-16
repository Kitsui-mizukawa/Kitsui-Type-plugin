function _bp(descs) {
    _bpCount++;
    return action.batchPlay(descs, { synchronousExecution: false });
}

function _dGetSelection() {
    return { _obj: "get", _target: [{ _property: "selection" }, { _ref: "document", _enum: "ordinal", _value: "targetEnum" }] };
}
function _dGetLayerBounds() {
    return { _obj: "get", _target: [{ _property: "bounds" }, { _ref: "layer", _enum: "ordinal", _value: "targetEnum" }] };
}
function _dMoveBy(dx, dy) {
    return {
        _obj: "move",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        to: {
            _obj: "offset",
            horizontal: { _unit: "distanceUnit", _value: dx },
            vertical: { _unit: "distanceUnit", _value: dy }
        }
    };
}
function _dDeselect() {
    return { _obj: "set", _target: [{ _ref: "channel", _property: "selection" }], to: { _enum: "ordinal", _value: "none" } };
}
function _dSetActiveLayerVisible(visible) {
    return { _obj: visible ? "show" : "hide", null: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }] };
}

function _rectFromDesc(d) {
    return { top: d.top._value, left: d.left._value, bottom: d.bottom._value, right: d.right._value };
}

async function _bpThenLayerBounds(descs, what) {
    const r = await _bp(descs.concat([_dGetLayerBounds()]));
    const g = r && r[descs.length];
    if (g && g.bounds && !g.message) return _rectFromDesc(g.bounds);
    const bad = (r || []).find(x => x && x.message);
    vlog(what + ": batch terhenti (" + (bad ? bad.message : "bounds tak terbaca") + ") — baca bounds terpisah.", "warn");
    return await _getCurrentLayerBounds();
}

async function getSelectionBounds() {
    try {
        const r = await _bp([_dGetSelection()]);
        _vlogOk("getSel");
        return (r && r[0] && r[0].selection) ? _rectFromDesc(r[0].selection) : null;
    } catch (e) {
        _vlogChanged("getSel", "getSelectionBounds gagal: " + _errMsg(e));
        return null;
    }
}

async function deselect() {
    await _bp([_dDeselect()]);
}

const WAND_TOLERANCE = 32;

function _dMagicWand(x, y) {
    return {
        _obj: "set",
        _target: [{ _ref: "channel", _property: "selection" }],
        to: {
            _obj: "paint",
            horizontal: { _unit: "pixelsUnit", _value: x },
            vertical: { _unit: "pixelsUnit", _value: y }
        },
        tolerance: WAND_TOLERANCE,
        antiAlias: true,
        merged: true
    };
}

async function _magicWandBounds(x, y) {
    const r = await _bp([_dMagicWand(x, y), _dGetSelection()]);
    if (r && r[0] && r[0].message) {
        vlog("Magic wand gagal: " + r[0].message, "warn");
        return null;
    }
    return (r && r[1] && r[1].selection) ? _rectFromDesc(r[1].selection) : null;
}

function hasActiveDocument() {
    try {
        const has = !!app.activeDocument;
        _vlogOk("hasDoc");
        return has;
    } catch (e) {
        _vlogChanged("hasDoc", "app.activeDocument gagal dibaca: " + _errMsg(e));
        return false;
    }
}

async function _openSelectionBounds(px) {
    const r = await _bp([
        { _obj: "contract", by: { _unit: "pixelsUnit", _value: px } },
        { _obj: "expand", by: { _unit: "pixelsUnit", _value: px } },
        _dGetSelection()
    ]);
    const bad = (r || []).find(x => x && x.message);
    if (bad) vlog("Contract/expand selection: " + bad.message, "warn");
    const g = r && r[2];
    return (g && g.selection) ? _rectFromDesc(g.selection) : null;
}

async function _removeTailBounds(sel) {
    const px = parseInt(_readText("input-remove-tail", "8"), 10) || 0;
    if (px <= 0) return sel;
    const cleaned = await _openSelectionBounds(px);
    if (!cleaned) {
        vlog("Hapus ekor (Apply): selection hilang setelah morfologi — pakai bounds asli.", "warn");
        return sel;
    }
    const cw = cleaned.right - cleaned.left, ch = cleaned.bottom - cleaned.top;
    const ow = sel.right - sel.left, oh = sel.bottom - sel.top;
    if (cw < 2 || ch < 2 || (cw * ch) < 0.3 * (ow * oh)) {
        vlog("Hapus ekor (Apply): hasil terlalu kecil (" + Math.round(cw) + "×" +
            Math.round(ch) + ") — pakai bounds asli.", "warn");
        return sel;
    }
    vlog("Hapus ekor (Apply): contract/expand " + px + "px → " + JSON.stringify(cleaned), "info");
    return cleaned;
}

async function _makeLayerGetID(name) {
    const r = await _bp([
        { _obj: "make", _target: [{ _ref: "layer" }], using: { _obj: "layer", name: name } },
        { _obj: "get", _target: [{ _property: "layerID" }, { _ref: "layer", _enum: "ordinal", _value: "targetEnum" }] }
    ]);
    if (!r || !r[0] || r[0].message) {
        throw new Error("make layer '" + name + "': " + (r && r[0] ? r[0].message : "tanpa hasil"));
    }
    const id = r[1] && r[1].layerID;
    return (typeof id === "number") ? id : null;
}

async function setLayerOpacity(opacity) {
    await _bp([{
        _obj: "set",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        to: { _obj: "layer", opacity: { _unit: "percentUnit", _value: opacity } }
    }]);
}

async function _moveLayerToRootFront(id) {
    if (id === null || id === undefined) return;
    try {
        const happy = await _bp([
            { _obj: "select", _target: [{ _ref: "layer", _id: id }], makeVisible: false },
            {
                _obj: "move", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
                to: { _ref: "layer", _enum: "ordinal", _value: "front" }
            },
            { _obj: "get", _target: [{ _property: "parentLayerID" }, { _ref: "layer", _id: id }] }
        ]);
        const parentID = happy && happy[2] && happy[2].parentLayerID;
        if (typeof parentID === "number" && parentID !== -1) {
            log("Layer masih di group (id=" + parentID + "), fallback back→front...", "warn");
            await _bp([
                {
                    _obj: "move", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
                    to: { _ref: "layer", _enum: "ordinal", _value: "back" }
                },
                {
                    _obj: "move", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
                    to: { _ref: "layer", _enum: "ordinal", _value: "front" }
                }
            ]);
        }
    } catch (e) {
        log("Reposisi layer error: " + (e && e.message ? e.message : String(e)), "error");
    }
}

async function _getCurrentLayerBounds() {
    const r = await _bp([_dGetLayerBounds()]);
    const ab = r && r[0] && r[0].bounds;
    return ab ? _rectFromDesc(ab) : null;
}

async function _recenterFrom(lb, targetCx, targetCy, needBounds) {
    if (!lb) lb = await _getCurrentLayerBounds();
    if (!lb) return null;
    const dx = targetCx - (lb.left + lb.right) / 2;
    const dy = targetCy - (lb.top + lb.bottom) / 2;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return { dx: 0, dy: 0, bounds: lb };
    if (!needBounds) {
        await _bp([_dMoveBy(dx, dy)]);
        return { dx: dx, dy: dy, bounds: null };
    }
    const nb = await _bpThenLayerBounds([_dMoveBy(dx, dy)], "Recenter");
    return { dx: dx, dy: dy, bounds: nb };
}

function _dSelectLayerID(id) {
    return { _obj: "select", _target: [{ _ref: "layer", _id: id }], makeVisible: false };
}

async function _deleteTextLayer(info) {
    const target = (info && info.layerID != null)
        ? { _ref: "layer", _id: info.layerID }
        : { _ref: "layer", _enum: "ordinal", _value: "targetEnum" };
    const r = await _bp([{ _obj: "delete", _target: [target] }]);
    if (!r || !r[0] || r[0].message) {
        throw new Error("hapus layer teks lama: " + (r && r[0] && r[0].message ? r[0].message : "tanpa hasil"));
    }
}

function _dTransformScale(scale) {
    const pct = scale * 100;
    return {
        _obj: "transform",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
        offset: {
            _obj: "offset",
            horizontal: { _unit: "pixelsUnit", _value: 0 },
            vertical: { _unit: "pixelsUnit", _value: 0 }
        },
        width: { _unit: "percentUnit", _value: pct },
        height: { _unit: "percentUnit", _value: pct },
        interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubicAutomatic" }
    };
}

async function _getActiveTextInfo(pre) {
    const k = (pre || []).length;
    const r = await _bp((pre || []).concat([
        { _obj: "get", _target: [{ _property: "textKey" }, { _ref: "layer", _enum: "ordinal", _value: "targetEnum" }] },
        _dGetLayerBounds(),
        { _obj: "get", _target: [{ _property: "layerID" }, { _ref: "layer", _enum: "ordinal", _value: "targetEnum" }] }
    ]));
    if (k && (!r || r.length <= k || r.slice(0, k).some(x => x && x.message))) {
        const bad = (r || []).find(x => x && x.message);
        vlog("Pra-langkah info layer: " + (bad ? bad.message : "batch terhenti") + " — baca layer aktif.", "warn");
        return await _getActiveTextInfo();
    }
    const tk = r && r[k] && r[k].textKey;
    if (!tk) return { isText: false };
    const sz = tk.textStyleRange && tk.textStyleRange[0] && tk.textStyleRange[0].textStyle
        && tk.textStyleRange[0].textStyle.size;
    const size = (sz && typeof sz._value === "number") ? sz._value : (typeof sz === "number" ? sz : null);
    const ab = r[k + 1] && r[k + 1].bounds;
    if (size == null || !ab) return { isText: false };
    return {
        isText: true,
        size: size,
        cx: (ab.left._value + ab.right._value) / 2,
        cy: (ab.top._value + ab.bottom._value) / 2,
        layerID: (r[k + 2] && typeof r[k + 2].layerID === "number") ? r[k + 2].layerID : null,
        tk: tk,
        bounds: {
            left: ab.left._value, right: ab.right._value,
            top: ab.top._value, bottom: ab.bottom._value
        }
    };
}

async function _fitBoxToText(lb, padX, padY) {
    if (!lb) lb = await _getCurrentLayerBounds();
    if (!lb) return null;
    return await _bpThenLayerBounds([{
        _obj: "set",
        _target: [{ _ref: "textLayer", _enum: "ordinal", _value: "targetEnum" }],
        to: {
            _obj: "textLayer",
            textShape: [{
                _obj: "textShape",
                char: { _enum: "char", _value: "box" },
                orientation: { _enum: "orientation", _value: "horizontal" },
                rowCount: 1, columnCount: 1, rowMajorOrder: true,
                bounds: {
                    _obj: "rectangle",
                    top: { _unit: "pixelsUnit", _value: lb.top - padY },
                    left: { _unit: "pixelsUnit", _value: lb.left - padX },
                    bottom: { _unit: "pixelsUnit", _value: lb.bottom + padY },
                    right: { _unit: "pixelsUnit", _value: lb.right + padX }
                }
            }]
        }
    }], "fitBox");
}

function _modalWithHistory(name, fn) {
    return executeAsModal(async (ctx) => {
        let hc = null, sid = null;
        try {
            const doc = app.activeDocument;
            if (doc && ctx && ctx.hostControl) {
                hc = ctx.hostControl;
                sid = await hc.suspendHistory({ documentID: doc.id, name: name });
            }
        } catch (e) {
            vlog("suspendHistory gagal: " + (e && e.message), "warn");
            hc = null; sid = null;
        }
        let ok = false;
        try {
            const r = await fn(ctx);
            ok = true;
            return r;
        } finally {
            if (hc && sid != null && ok) {
                const tc = _perfBegin("Commit history");
                try { await hc.resumeHistory(sid); }
                catch (e) { vlog("resumeHistory gagal: " + (e && e.message), "warn"); }
                _perfEnd(tc);
            }
        }
    }, { commandName: name });
}
