function _styleFromTypeR(textStyle, paragraphStyle) {
    const t = textStyle || {};
    const p = paragraphStyle || {};
    return _normStyle({
        fontPostScriptName: t.fontPostScriptName,
        fontName: t.fontName,
        fontStyleName: t.fontStyleName,
        size: _num(t.size),
        fontCaps: t.fontCaps,
        syntheticBold: t.syntheticBold,
        syntheticItalic: t.syntheticItalic,
        autoKern: (typeof t.autoKern === "string") ? t.autoKern : undefined,
        antiAlias: undefined,
        alignment: p.alignment,
        autoLeading: t.autoLeading,
        autoLeadingPercentage: p.autoLeadingPercentage,
        tracking: t.tracking,
        horizontalScale: t.horizontalScale,
        verticalScale: t.verticalScale,
        baselineShift: _num(t.baselineShift),
        color: t.color
    });
}

function _enumStr(v) {
    if (typeof v === "string") return v;
    if (v && typeof v._value === "string") return v._value;
    return undefined;
}

function _styleFromLayerGet(tk) {
    const t = (tk.textStyleRange && tk.textStyleRange[0] && tk.textStyleRange[0].textStyle) || {};
    const p = (tk.paragraphStyleRange && tk.paragraphStyleRange[0] && tk.paragraphStyleRange[0].paragraphStyle) || {};
    return _normStyle({
        fontPostScriptName: t.fontPostScriptName,
        fontName: t.fontName,
        fontStyleName: t.fontStyleName,
        size: _num(t.size),
        fontCaps: _enumStr(t.fontCaps),
        syntheticBold: t.syntheticBold,
        syntheticItalic: t.syntheticItalic,
        autoKern: _enumStr(t.autoKern),
        antiAlias: _enumStr(tk.antiAlias),
        alignment: _enumStr(p.align) || p.alignment,
        autoLeading: t.autoLeading,
        autoLeadingPercentage: p.autoLeadingPercentage,
        tracking: t.tracking,
        horizontalScale: t.horizontalScale,
        verticalScale: t.verticalScale,
        baselineShift: _num(t.baselineShift),
        color: t.color
    });
}

function _parseStyleLibrary(json, fileName) {
    const out = { format: "unknown", folders: [], styles: [], ignoreLinePrefixes: [], activeFolderId: null, skipped: 0 };
    if (!json || typeof json !== "object" || Array.isArray(json)) return out;
    const kitsu = (json.kitsu && typeof json.kitsu === "object") ? json.kitsu : null;
    const baseName = String(fileName || "").replace(/\.json$/i, "") || "Imported";
    let rawFolders, rawStyles;
    if (Array.isArray(json.styles)) {
        out.format = kitsu ? "kitsu" : "typer";
        rawFolders = Array.isArray(json.folders) ? json.folders : [];
        rawStyles = json.styles;
    } else if (Array.isArray(json.exportedStyles)) {
        out.format = "typer-folder";
        const fid = _genId();
        rawFolders = [{ id: fid, name: (typeof json.name === "string" && json.name.trim()) ? json.name : baseName, order: 0 }];
        rawStyles = json.exportedStyles.map(s => (s && typeof s === "object") ? Object.assign({}, s, { folder: fid }) : s);
    } else {
        return out;
    }

    const folders = rawFolders.filter(f => f && typeof f === "object").map((f, i) => ({
        id: (typeof f.id === "string" && f.id) ? f.id : _genId(),
        name: (typeof f.name === "string" && f.name.trim()) ? f.name : "Folder",
        order: typeof f.order === "number" ? f.order : i,
        defaultStyleId: null
    }));

    const styles = [];
    for (const s of rawStyles) {
        const lt = s && s.textProps && s.textProps.layerText;
        if (!lt || typeof lt !== "object") { out.skipped++; continue; }
        const tsr = (Array.isArray(lt.textStyleRange) && lt.textStyleRange[0]) || {};
        const psr = (Array.isArray(lt.paragraphStyleRange) && lt.paragraphStyleRange[0]) || {};
        const st = _styleFromTypeR(tsr.textStyle, psr.paragraphStyle);
        if (typeof lt.antiAlias === "string" && lt.antiAlias) st.antiAlias = lt.antiAlias;
        styles.push({
            id: (typeof s.id === "string" && s.id) ? s.id : _genId(),
            name: (typeof s.name === "string" && s.name) ? s.name : "Style",
            folderId: s.folder,
            tags: Array.isArray(s.prefixes) ? s.prefixes.filter(t => typeof t === "string" && t.length) : [],
            color: (typeof s.prefixColor === "string" && s.prefixColor) ? s.prefixColor : "#FFF3B0",
            style: st
        });
    }
    if (!styles.length) return out;

    if (!folders.length) folders.push({ id: _genId(), name: baseName, order: 0, defaultStyleId: null });
    for (const s of styles) if (!folders.some(f => f.id === s.folderId)) s.folderId = folders[0].id;

    const setDefault = (folderId, styleId) => {
        const f = folders.find(x => x.id === folderId);
        if (f && styles.some(s => s.id === styleId && s.folderId === folderId)) f.defaultStyleId = styleId;
    };
    if (typeof json.defaultStyleId === "string" && json.defaultStyleId) {
        const ds = styles.find(s => s.id === json.defaultStyleId);
        if (ds) setDefault(ds.folderId, ds.id);
    }
    if (kitsu && kitsu.defaultStyleIds && typeof kitsu.defaultStyleIds === "object") {
        for (const fid of Object.keys(kitsu.defaultStyleIds)) setDefault(fid, kitsu.defaultStyleIds[fid]);
    }

    const ilp = Array.isArray(json.ignoreLinePrefixes) ? json.ignoreLinePrefixes
        : ((kitsu && Array.isArray(kitsu.ignoreLinePrefixes)) ? kitsu.ignoreLinePrefixes : []);
    out.ignoreLinePrefixes = _mergePrefixList([], ilp);
    if (kitsu && folders.some(f => f.id === kitsu.activeFolderId)) out.activeFolderId = kitsu.activeFolderId;
    out.folders = folders;
    out.styles = styles;
    return out;
}

function _mergePrefixList(cur, add) {
    const out = [];
    for (const p of [].concat(cur || [], add || [])) {
        if (typeof p !== "string") continue;
        const t = p.trim();
        if (t && out.indexOf(t) === -1) out.push(t);
    }
    return out;
}

function _mergeFontData(current, incoming, mode) {
    const base = (mode === "replace") ? { folders: [], styles: [], activeFolderId: null } : _normFontData(current);
    const folderIds = new Set(base.folders.map(f => f.id));
    const styleIds = new Set(base.styles.map(s => s.id));
    const names = new Set(base.folders.map(f => f.name));
    const uniqId = (id, taken) => {
        let v = id;
        while (!v || taken.has(v)) v = _genId();
        taken.add(v);
        return v;
    };
    let order = base.folders.reduce((m, f) => Math.max(m, f.order + 1), 0);
    let renamed = 0, reIded = 0;
    const fMap = {}, sMap = {};
    const newFolders = (incoming.folders || []).slice().sort((a, b) => a.order - b.order).map(f => {
        const id = uniqId(f.id, folderIds);
        if (id !== f.id) reIded++;
        fMap[f.id] = id;
        let name = f.name;
        if (names.has(name)) {
            let n = 2;
            while (names.has(f.name + " (" + n + ")")) n++;
            name = f.name + " (" + n + ")";
            renamed++;
        }
        names.add(name);
        return { id, name, order: order++, defaultStyleId: f.defaultStyleId || null };
    });
    const firstNewId = newFolders.length ? newFolders[0].id : null;
    const newStyles = (incoming.styles || []).map(s => {
        const id = uniqId(s.id, styleIds);
        if (id !== s.id) reIded++;
        sMap[s.id] = id;
        return Object.assign({}, s, { id, folderId: fMap[s.folderId] || firstNewId });
    });
    for (const f of newFolders) if (f.defaultStyleId) f.defaultStyleId = sMap[f.defaultStyleId] || null;
    let active = base.activeFolderId;
    if (!active) active = fMap[incoming.activeFolderId] || firstNewId;
    return {
        data: _normFontData({ folders: base.folders.concat(newFolders), styles: base.styles.concat(newStyles), activeFolderId: active }),
        addedFolders: newFolders.length,
        addedStyles: newStyles.length,
        renamed: renamed,
        reIded: reIded
    };
}

async function importTypeRJSON() {
    try {
        const fs = require("uxp").storage.localFileSystem;
        const file = await fs.getFileForOpening({ types: ["json"] });
        if (!file) return;
        let raw = await file.read();
        raw = (typeof raw === "string" ? raw : String(raw)).replace(/^﻿/, "");
        const json = JSON.parse(raw);

        const parsed = _parseStyleLibrary(json, file.name);
        if (!parsed.styles.length) {
            log("Format file tidak dikenali / tidak ada style valid (" + file.name + ") — library tidak diubah.", "error");
            return;
        }
        if (parsed.skipped) log("Impor: " + parsed.skipped + " entri style tanpa textProps dilewati.", "warn");

        const mode = _readText("select-import-mode", "merge") === "replace" ? "replace" : "merge";
        const hadData = _fontData.folders.length > 0 || _fontData.styles.length > 0;
        if (mode === "replace" && hadData) {
            try {
                localStorage.setItem(LS_FONTDATA_BACKUP, JSON.stringify(_fontData));
            } catch (e) {
                log("Backup style gagal — impor Replace dibatalkan: " + (e && e.message ? e.message : String(e)), "error");
                return;
            }
        }

        const prevActive = _fontData.activeFolderId;
        const res = _mergeFontData(_fontData, parsed, mode);
        _fontData = res.data;

        if (parsed.ignoreLinePrefixes.length) {
            const el = document.getElementById("input-ignore-prefixes");
            const cur = _ignorePrefixes();
            const added = parsed.ignoreLinePrefixes.filter(p => cur.indexOf(p) === -1);
            if (el && added.length) {
                el.value = _mergePrefixList(cur, added).join("\n");
                el._userEdited = true;
                saveSettings();
                vlog("Tags to skip lines: +" + added.length + " entri dari file.", "info");
            }
        }

        saveFontData();
        renderFontSettings();
        if (_fontData.activeFolderId !== prevActive && _notes.length) rescanPrefixes();

        log("Impor style (" + (mode === "replace" ? "Replace" : "Merge") + ", " + parsed.format + "): +" +
            res.addedFolders + " folder, +" + res.addedStyles + " style (" + file.name + ")" +
            (res.renamed ? ", " + res.renamed + " folder diberi akhiran" : "") +
            (res.reIded ? ", " + res.reIded + " id bentrok diganti" : "") + ".", "success");
        if (mode === "replace" && hadData) {
            log("Library lama di-backup — pulihkan via Settings → Data → Restore previous styles.", "info");
        }
    } catch (e) {
        log("Impor style gagal: " + (e && e.message ? e.message : String(e)), "error");
    }
}

function restoreFontDataBackup() {
    try {
        const raw = localStorage.getItem(LS_FONTDATA_BACKUP);
        if (!raw) {
            log("Belum ada backup style (dibuat otomatis saat impor mode Replace).", "warn");
            setStatusPill("No style backup yet", "status-warn");
            return;
        }
        const restored = _normFontData(JSON.parse(raw));
        const prevActive = _fontData.activeFolderId;
        const hadData = _fontData.folders.length > 0 || _fontData.styles.length > 0;
        if (hadData) localStorage.setItem(LS_FONTDATA_BACKUP, JSON.stringify(_fontData));
        _fontData = restored;
        saveFontData();
        renderFontSettings();
        if (_fontData.activeFolderId !== prevActive && _notes.length) rescanPrefixes();
        log("Library style dipulihkan dari backup: " + _fontData.folders.length + " folder, " +
            _fontData.styles.length + " style" + (hadData ? " (library sebelumnya kini jadi backup)" : "") + ".", "success");
        setStatusPill("Styles restored from backup", "status-ok");
    } catch (e) {
        log("Restore style gagal: " + (e && e.message ? e.message : String(e)), "error");
    }
}

function _styleToTypeR(st) {
    const s = _normStyle(st);
    const textStyle = {
        fontPostScriptName: s.fontPostScriptName,
        fontName: s.fontName,
        fontStyleName: s.fontStyleName,
        size: s.size,
        fontCaps: s.fontCaps,
        syntheticBold: s.syntheticBold,
        syntheticItalic: s.syntheticItalic,
        autoKern: s.autoKern,
        autoLeading: s.autoLeading,
        tracking: s.tracking,
        horizontalScale: s.horizontalScale,
        verticalScale: s.verticalScale,
        baselineShift: s.baselineShift,
        color: { red: s.color.r, green: s.color.g, blue: s.color.b }
    };
    const paragraphStyle = { alignment: s.alignment };
    if (typeof s.autoLeadingPercentage === "number") paragraphStyle.autoLeadingPercentage = s.autoLeadingPercentage;
    return {
        layerText: {
            textGridding: "none",
            orientation: "horizontal",
            antiAlias: s.antiAlias,
            textStyleRange: [{ from: 0, to: 100, textStyle: textStyle }],
            paragraphStyleRange: [{ from: 0, to: 100, paragraphStyle: paragraphStyle }]
        },
        typeUnit: "pointsUnit"
    };
}

function _buildStyleExport(fontData, ignorePrefixes, version) {
    const d = _normFontData(fontData);
    const folders = d.folders.slice().sort((a, b) => a.order - b.order);
    const defaultStyleIds = {};
    for (const f of folders) if (f.defaultStyleId) defaultStyleIds[f.id] = f.defaultStyleId;
    return {
        folders: folders.map(f => ({ id: f.id, name: f.name, order: f.order, parentId: null })),
        styles: d.styles.map(s => ({
            id: s.id,
            name: s.name,
            folder: s.folderId,
            prefixes: s.tags.slice(),
            prefixColor: s.color,
            textProps: _styleToTypeR(s.style)
        })),
        version: String(version || ""),
        exported: new Date().toISOString(),
        kitsu: {
            formatVersion: 1,
            activeFolderId: d.activeFolderId,
            defaultStyleIds: defaultStyleIds,
            ignoreLinePrefixes: _mergePrefixList([], ignorePrefixes)
        }
    };
}

async function exportFontData() {
    try {
        if (!_fontData.styles.length) {
            log("Belum ada style untuk diekspor.", "warn");
            setStatusPill("No styles to export", "status-warn");
            return;
        }
        const uxp = require("uxp");
        const file = await uxp.storage.localFileSystem.getFileForSaving("kitsu-styles.json", { types: ["json"] });
        if (!file) return;
        const version = (uxp.versions && uxp.versions.plugin) || "";
        const payload = _buildStyleExport(_fontData, _ignorePrefixes(), version);
        await file.write(JSON.stringify(payload, null, 2), { format: uxp.storage.formats.utf8 });
        log("Ekspor style: " + payload.folders.length + " folder, " + payload.styles.length + " style → " +
            file.name + ".", "success");
    } catch (e) {
        log("Ekspor style gagal: " + (e && e.message ? e.message : String(e)), "error");
    }
}

function _stylesInFolder(folderId) {
    return _fontData.styles.filter(s => s.folderId === folderId);
}

function activateFolder(id) {
    _fontData.activeFolderId = id;
    saveFontData();
    renderFontSettings();
}

function moveStyle(styleId, targetFolderId, beforeStyleId) {
    if (styleId === beforeStyleId) return;
    const idx = _fontData.styles.findIndex(s => s.id === styleId);
    if (idx < 0) return;
    const [st] = _fontData.styles.splice(idx, 1);
    st.folderId = targetFolderId;
    if (beforeStyleId) {
        const bi = _fontData.styles.findIndex(s => s.id === beforeStyleId);
        _fontData.styles.splice(bi < 0 ? _fontData.styles.length : bi, 0, st);
    } else {
        let last = -1;
        _fontData.styles.forEach((s, i) => { if (s.folderId === targetFolderId) last = i; });
        _fontData.styles.splice(last + 1, 0, st);
    }
    saveFontData();
    renderFontSettings();
}

function addFolder() {
    const f = { id: _genId(), name: "New folder", order: _fontData.folders.length, defaultStyleId: null };
    _fontData.folders.push(f);
    if (!_fontData.activeFolderId) _fontData.activeFolderId = f.id;
    saveFontData();
    renderFontSettings();
}

async function addStyle() {
    let folderId = _fontData.activeFolderId;
    if (!folderId) {
        if (_fontData.folders.length === 0) addFolder();
        folderId = _fontData.activeFolderId || (_fontData.folders[0] && _fontData.folders[0].id);
    }
    if (!folderId) return;
    let base = null;
    try {
        const info = await _getActiveTextInfo();
        if (info && info.isText) {
            base = _styleFromLayerGet(info.tk);
            const xf = info.tk.transform;
            const sc = (xf && typeof xf.xx === "number" && xf.xx > 0) ? xf.xx : 1;
            if (sc !== 1) base.size = Math.round(base.size * sc * 10) / 10;
            vlog("Style baru dari layer aktif: " + base.fontName + " " + base.size + "pt", "info");
        } else {
            vlog("Tidak ada layer teks aktif — style baru pakai default.", "info");
        }
    } catch (e) {
        vlog("addStyle: gagal baca layer aktif: " + (e && e.message), "warn");
    }
    const s = { id: _genId(), name: "New style", folderId, tags: [], color: "#FFF3B0", style: base || _normStyle({}) };
    _fontData.styles.push(s);
    saveFontData();
    openStyleEditor(s.id);
}

function duplicateStyle(id) {
    const s = _fontData.styles.find(x => x.id === id);
    if (!s) return;
    const copy = JSON.parse(JSON.stringify(s));
    copy.id = _genId();
    copy.name = s.name + " copy";
    copy.tags = [];
    _fontData.styles.push(copy);
    saveFontData();
    renderFontSettings();
}

function deleteStyle(id) {
    _fontData.styles = _fontData.styles.filter(s => s.id !== id);
    for (const f of _fontData.folders) if (f.defaultStyleId === id) f.defaultStyleId = null;
    saveFontData();
    renderFontSettings();
}

function deleteFolder(id) {
    _fontData.folders = _fontData.folders.filter(f => f.id !== id);
    _fontData.styles = _fontData.styles.filter(s => s.folderId !== id);
    if (_fontData.activeFolderId === id) {
        _fontData.activeFolderId = _fontData.folders.length ? _fontData.folders[0].id : null;
    }
    saveFontData();
    renderFontSettings();
}

function openStyleEditor(id) {
    _editingStyleId = id;
    switchView("styleeditor");
    renderStyleEditor();
}

function _esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function _rgbToHex(c) {
    const h = (n) => ("0" + Math.max(0, Math.min(255, Math.round(n || 0))).toString(16)).slice(-2);
    return "#" + h(c.r) + h(c.g) + h(c.b);
}
function _hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return { r: 0, g: 0, b: 0 };
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function _normHex(s) {
    let h = String(s || "").trim().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(h)) h = h.split("").map(c => c + c).join("");
    if (/^[0-9a-f]{6}$/i.test(h)) return "#" + h.toUpperCase();
    return null;
}

const SE_PALETTE = [
    "#FFFFFF", "#000000", "#FF5C5C", "#F0AD4E", "#FFF3B0", "#FFE14D",
    "#4ECB71", "#3FD0C9", "#5B9AFF", "#9B6BFF", "#FF7BD5", "#E84393",
    "#7BE0FF", "#B5651D", "#AAAAAA", "#555555"
];

function _wireColorBox(body, key, getCur, onChange) {
    const sw = body.querySelector('[data-cb="' + key + '"]');
    const hex = body.querySelector('[data-cbhex="' + key + '"]');
    const pal = body.querySelector('[data-cbpal="' + key + '"]');
    if (!sw || !hex || !pal) return;
    const apply = (h) => {
        const n = _normHex(h);
        if (!n) return;
        sw.style.background = n;
        hex.value = n;
        onChange(n);
    };
    const cur = _normHex(getCur()) || "#000000";
    sw.style.background = cur;
    hex.value = cur;
    pal.innerHTML = "";
    SE_PALETTE.forEach(c => {
        const chip = document.createElement("div");
        chip.className = "se-pchip";
        chip.style.background = c;
        chip.title = c;
        chip.addEventListener("click", () => { apply(c); pal.style.display = "none"; });
        pal.appendChild(chip);
    });
    sw.addEventListener("click", () => {
        pal.style.display = (pal.style.display === "none") ? "flex" : "none";
    });
    hex.addEventListener("input", () => {
        const n = _normHex(hex.value);
        if (n) { sw.style.background = n; onChange(n); }
    });
}

function renderStyleEditor() {
    const body = document.getElementById("styleeditor-body");
    if (!body) return;
    const s = _fontData.styles.find(x => x.id === _editingStyleId);
    if (!s) { body.className = "hint"; body.textContent = "Style not found."; return; }
    body.className = "style-editor";
    const st = s.style;

    let effFolderId = _fontData.folders.some(f => f.id === s.folderId)
        ? s.folderId : ((_fontData.folders[0] && _fontData.folders[0].id) || null);
    if (effFolderId && effFolderId !== s.folderId) { s.folderId = effFolderId; saveStateDebounced(); }
    const folderOpts = _fontData.folders.map(f =>
        `<option value="${_esc(f.id)}"${f.id === effFolderId ? " selected" : ""}>${_esc(f.name)}</option>`).join("");

    const aaOpt = (v, label) => `<option value="${v}"${st.antiAlias === v ? " selected" : ""}>${label}</option>`;
    const kernOpt = (v, label) => `<option value="${v}"${st.autoKern === v ? " selected" : ""}>${label}</option>`;
    const alignOpt = (v, label) => `<option value="${v}"${(st.alignment || "center") === v ? " selected" : ""}>${label}</option>`;

    const aaSel = '<select id="se-aa" class="config-input se-select">' +
        aaOpt("antiAliasNone", "None") + aaOpt("antiAliasSharp", "Sharp") + aaOpt("antiAliasCrisp", "Crisp") +
        aaOpt("antiAliasStrong", "Strong") + aaOpt("antiAliasSmooth", "Smooth") + '</select>';
    const kernSel = '<select id="se-kern" class="config-input se-select">' +
        kernOpt("metricsKern", "Metrics") + kernOpt("opticalKern", "Optical") + kernOpt("manualKern", "None") + '</select>';

    body.innerHTML =
        '<label class="se-label">Style name</label>' +
        '<input id="se-name" class="se-input" type="text" spellcheck="false" placeholder="Style name">' +
        '<label class="se-label">Folder</label>' +
        '<div class="se-row"><select id="se-folder" class="config-input se-select">' + folderOpts + '</select></div>' +

        '<div class="se-section">Style settings</div>' +

        '<label class="se-label">Font &amp; type</label>' +
        '<div class="se-row">' +
        '<input id="se-font" class="se-input se-grow" type="text" spellcheck="false" placeholder="PostScript name (e.g. CCOriginStory-Regular)">' +
        '<input id="se-type" class="se-input se-type" type="text" spellcheck="false" placeholder="Regular">' +
        '</div>' +

        '<div class="se-grid">' +
        '<div class="se-row2">' +
        '<div class="se-cell"><span class="se-cap">Size (pt)</span><input id="se-size" class="se-ctl" type="number" step="0.5"></div>' +
        '<div class="se-cell" title="Auto leading as % of the font size. Empty = auto (Photoshop default).">' +
        '<span class="se-cap">Lead (%)</span><input id="se-al" class="se-ctl" type="number" step="1" placeholder="auto"></div>' +
        '</div>' +
        '<div class="se-row2">' +
        '<div class="se-cell"><span class="se-cap">Kern</span>' + kernSel + '</div>' +
        '<div class="se-cell"><span class="se-cap">Track</span><input id="se-track" class="se-ctl" type="number" step="1"></div>' +
        '</div>' +
        '<div class="se-row2">' +
        '<div class="se-cell"><span class="se-cap">V (%)</span><input id="se-vs" class="se-ctl" type="number"></div>' +
        '<div class="se-cell"><span class="se-cap">H (%)</span><input id="se-hs" class="se-ctl" type="number"></div>' +
        '</div>' +
        '<div class="se-row2">' +
        '<div class="se-cell"><span class="se-cap">Base (pt)</span><input id="se-base" class="se-ctl" type="number" step="0.5"></div>' +
        '<div class="se-cell"><span class="se-cap">AA</span>' + aaSel + '</div>' +
        '</div>' +
        '</div>' +
        '<label class="se-label">Font style</label>' +
        '<div class="se-grid se-checklist">' +
        '<div class="se-row2">' +
        '<div class="se-cell"><sp-checkbox class="se-style-cb" data-t="syntheticBold"' + (st.syntheticBold ? " checked" : "") + '>Faux Bold</sp-checkbox></div>' +
        '<div class="se-cell"><sp-checkbox class="se-style-cb" data-t="syntheticItalic"' + (st.syntheticItalic ? " checked" : "") + '>Faux Italic</sp-checkbox></div>' +
        '</div>' +
        '<div class="se-row2">' +
        '<div class="se-cell"><sp-checkbox class="se-style-cb" data-caps="allCaps"' + (st.fontCaps === "allCaps" ? " checked" : "") + '>All Caps</sp-checkbox></div>' +
        '<div class="se-cell"><sp-checkbox class="se-style-cb" data-caps="smallCaps"' + (st.fontCaps === "smallCaps" ? " checked" : "") + '>Small Caps</sp-checkbox></div>' +
        '</div>' +
        '</div>' +
        '<label class="se-label">Alignment<span class="se-label-note">&nbsp;(overrides global setting)</span></label>' +
        '<div class="se-row"><select id="se-align" class="config-input se-select">' +
        alignOpt("left", "Left") + alignOpt("center", "Center") +
        alignOpt("right", "Right") + alignOpt("justifyAll", "Justify") +
        '</select></div>' +
        '<label class="se-label">Text color</label>' +
        '<div class="se-colorbox">' +
        '<div class="se-swatch" data-cb="color" title="Click for color palette"></div>' +
        '<input class="se-ctl se-hex" type="text" data-cbhex="color" maxlength="7" spellcheck="false">' +
        '</div>' +
        '<div class="se-palette" data-cbpal="color" style="display:none"></div>' +

        '<label class="se-label">Prefix tag<span class="se-label-note">&nbsp;(auto style selector)</span></label>' +
        '<textarea id="se-tags" class="config-textarea se-tags-area" rows="2" spellcheck="false" placeholder="e.g. tag:   //   or   &quot;&quot;"></textarea>' +
        '<div class="se-help">Separate with a new line or ; . If a bubble line starts with one of these tags, this style is used automatically. The tag itself is not pasted.</div>' +

        '<label class="se-label">Prefix color</label>' +
        '<div class="se-colorbox">' +
        '<div class="se-swatch" data-cb="tag" title="Click for color palette"></div>' +
        '<input class="se-ctl se-hex" type="text" data-cbhex="tag" maxlength="7" spellcheck="false">' +
        '</div>' +
        '<div class="se-palette" data-cbpal="tag" style="display:none"></div>' +
        '<div class="se-help">Color of this prefix tag in the queue list.</div>' +

        '<div class="se-section">Danger</div>' +
        '<button id="se-delete" class="se-delete-btn">Delete style</button>';

    const $ = (id) => body.querySelector(id);
    $("#se-name").value = s.name;
    $("#se-font").value = st.fontPostScriptName || "";
    $("#se-type").value = st.fontStyleName || "";
    $("#se-size").value = st.size;
    $("#se-al").value = (st.autoLeadingPercentage != null) ? Math.round(st.autoLeadingPercentage * 100) : "";
    $("#se-track").value = st.tracking;
    $("#se-hs").value = st.horizontalScale;
    $("#se-vs").value = st.verticalScale;
    $("#se-base").value = st.baselineShift;
    $("#se-tags").value = s.tags.join("\n");
    _refreshToggleStates(body, st);

    $("#se-name").addEventListener("input", () => { s.name = $("#se-name").value; saveStateDebounced(); });
    $("#se-folder").addEventListener("change", () => { s.folderId = $("#se-folder").value; saveStateDebounced(); });

    $("#se-font").addEventListener("input", () => { st.fontPostScriptName = $("#se-font").value; saveStateDebounced(); });
    $("#se-type").addEventListener("input", () => { st.fontStyleName = $("#se-type").value; saveStateDebounced(); });

    const numWire = (id, key, fn) => $("#" + id).addEventListener("input", () => {
        const raw = $("#" + id).value;
        st[key] = (raw === "") ? (key === "autoLeadingPercentage" ? null : 0) : fn(parseFloat(raw));
        saveStateDebounced();
    });
    numWire("se-size", "size", v => v || 0);
    $("#se-al").addEventListener("input", () => {
        const raw = $("#se-al").value;
        if (raw === "") { st.autoLeadingPercentage = null; st.autoLeading = true; }
        else { st.autoLeadingPercentage = (parseFloat(raw) || 0) / 100; }
        saveStateDebounced();
    });
    numWire("se-track", "tracking", v => v || 0);
    numWire("se-hs", "horizontalScale", v => v || 100);
    numWire("se-vs", "verticalScale", v => v || 100);
    numWire("se-base", "baselineShift", v => v || 0);
    $("#se-kern").addEventListener("change", () => { st.autoKern = $("#se-kern").value; saveStateDebounced(); });
    $("#se-aa").addEventListener("change", () => { st.antiAlias = $("#se-aa").value; saveStateDebounced(); });
    $("#se-align").addEventListener("change", () => { st.alignment = $("#se-align").value; saveStateDebounced(); });
    $("#se-tags").addEventListener("input", () => {
        s.tags = $("#se-tags").value.split(/[\r\n;,]+/).map(x => x.trim()).filter(x => x.length);
        saveStateDebounced();
        renderNotes();
    });

    _wireColorBox(body, "color", () => _rgbToHex(st.color), (hex) => {
        st.color = _hexToRgb(hex); saveStateDebounced();
    });
    _wireColorBox(body, "tag", () => s.color || "#FFF3B0", (hex) => {
        s.color = hex; saveStateDebounced(); renderNotes();
    });

    $("#se-delete").addEventListener("click", () => {
        deleteStyle(s.id);
        switchView("fontsettings");
    });

    body.querySelectorAll(".se-style-cb").forEach(cb => {
        cb.addEventListener("change", () => {
            if (cb.dataset.t) {
                st[cb.dataset.t] = !!cb.checked;
            } else if (cb.dataset.caps) {
                st.fontCaps = cb.checked ? cb.dataset.caps : "normal";
            }
            _refreshToggleStates(body, st);
            saveStateDebounced();
        });
    });
}

function _refreshToggleStates(body, st) {
    body.querySelectorAll(".se-style-cb").forEach(cb => {
        if (cb.dataset.t) cb.checked = !!st[cb.dataset.t];
        else if (cb.dataset.caps) cb.checked = (st.fontCaps === cb.dataset.caps);
    });
}

function _iconBtn(html, title, onClick) {
    const b = document.createElement("button");
    b.className = "icon-btn";
    b.innerHTML = html;
    b.title = title;
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
    return b;
}

function _confirmIconBtn(html, armedHtml, title, onConfirm) {
    const b = document.createElement("button");
    b.className = "icon-btn";
    b.innerHTML = html;
    b.title = title;
    let armed = false, t = null;
    const reset = () => {
        armed = false; b.innerHTML = html; b.classList.remove("confirm");
        if (t) { clearTimeout(t); t = null; }
    };
    b.addEventListener("click", (e) => {
        e.stopPropagation();
        if (armed) { reset(); onConfirm(); return; }
        armed = true; b.innerHTML = armedHtml; b.classList.add("confirm");
        t = setTimeout(reset, 3000);
    });
    return b;
}

function renderFontSettings() {
    const list = document.getElementById("folder-list");
    if (!list) return;
    list.innerHTML = "";
    const frag = document.createDocumentFragment();

    if (_fontData.folders.length === 0) {
        const empty = document.createElement("div");
        empty.className = "hint";
        empty.textContent = "No folder yet. Import TypeR JSON or press + Add folder.";
        frag.appendChild(empty);
    }

    const folders = _fontData.folders.slice().sort((a, b) => a.order - b.order);
    for (const folder of folders) {
        const styles = _stylesInFolder(folder.id);
        const isActive = folder.id === _fontData.activeFolderId;

        const block = document.createElement("div");
        block.className = "folder-block" + (isActive ? " active" : "");
        block.setAttribute("data-folder-id", folder.id);

        const header = document.createElement("div");
        header.className = "folder-row";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "folder-activate";
        cb.checked = isActive;
        cb.title = "Activate this folder (only 1 active)";
        cb.addEventListener("change", () => activateFolder(folder.id));
        header.appendChild(cb);

        const nm = document.createElement("span");
        nm.className = "folder-name";
        nm.textContent = folder.name + " (" + styles.length + ")";
        header.appendChild(nm);

        header.appendChild(_confirmIconBtn("x", "Sure?", "Delete folder (click again to confirm)", () => deleteFolder(folder.id)));
        block.appendChild(header);

        const grid = document.createElement("div");
        grid.className = "style-grid";
        styles.forEach((s, i) => {
            const row = document.createElement("div");
            row.className = "style-row";
            row.setAttribute("draggable", "true");
            row.setAttribute("data-style-id", s.id);
            row.setAttribute("data-folder-id", folder.id);
            row.title = s.tags.length ? "Tag: " + s.tags.join(" ") : "No tag";

            const grip = document.createElement("span");
            grip.className = "style-grip";
            grip.textContent = "::";
            grip.title = "Drag to reorder / move folder";
            row.appendChild(grip);

            const name = document.createElement("span");
            name.className = "style-name";
            name.textContent = (i === 0 ? "* " : "") + s.name;
            if (i === 0) name.title = "Folder default style (bubbles with no matching tag)";
            row.appendChild(name);

            row.appendChild(_iconBtn("Dup", "Duplicate", () => duplicateStyle(s.id)));

            if (s.tags.length) {
                const tagsBox = document.createElement("div");
                tagsBox.className = "style-tags";
                s.tags.forEach(tag => {
                    const chip = document.createElement("span");
                    chip.className = "style-chip";
                    chip.textContent = tag;
                    chip.style.color = s.color || "#FFF3B0";
                    tagsBox.appendChild(chip);
                });
                row.appendChild(tagsBox);
            }

            row.addEventListener("click", () => openStyleEditor(s.id));
            grid.appendChild(row);
        });
        block.appendChild(grid);

        frag.appendChild(block);
    }

    list.appendChild(frag);

    renderRestyleStrip();
}

function renderRestyleStrip() {
    const strip = document.getElementById("restyle-strip");
    if (!strip) return;
    strip.innerHTML = "";
    const styles = _activeStyles();
    if (!styles.length) {
        const hint = document.createElement("span");
        hint.className = "restyle-hint";
        hint.textContent = "Activate a folder in Font Settings for style buttons.";
        strip.appendChild(hint);
        return;
    }
    const frag = document.createDocumentFragment();
    styles.forEach(s => {
        const btn = document.createElement("button");
        btn.className = "restyle-btn";
        btn.textContent = s.name;
        btn.title = s.tags.length ? "Tag: " + s.tags.join(" ") : "No tag";
        if (s.color) btn.style.borderLeftColor = s.color;
        btn.addEventListener("click", () => _applyWithStyle(s.style));
        frag.appendChild(btn);
    });
    strip.appendChild(frag);
}

var _styleDragId = null;

function setupStyleDragDrop() {
    const root = document.getElementById("folder-list");
    if (!root) return;

    root.addEventListener("dragstart", (e) => {
        const row = e.target.closest(".style-row");
        if (!row || !root.contains(row)) return;
        _styleDragId = row.getAttribute("data-style-id");
        try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", _styleDragId); }
        catch (err) { _vlogChanged("dnd", "dataTransfer (dragstart): " + _errMsg(err)); }
        row.classList.add("dragging");
    });

    root.addEventListener("dragover", (e) => {
        if (!_styleDragId) return;
        const block = e.target.closest(".folder-block");
        if (!block || !root.contains(block)) return;
        e.preventDefault();
        try { e.dataTransfer.dropEffect = "move"; }
        catch (err) { _vlogChanged("dndOver", "dataTransfer (dragover): " + _errMsg(err)); }
        root.querySelectorAll(".drop-before, .drop-after, .drop-into").forEach(n =>
            n.classList.remove("drop-before", "drop-after", "drop-into"));
        const row = e.target.closest(".style-row");
        if (row) {
            const r = row.getBoundingClientRect();
            row.classList.add((e.clientX - r.left) < r.width / 2 ? "drop-before" : "drop-after");
        } else {
            block.classList.add("drop-into");
        }
    });

    root.addEventListener("drop", (e) => {
        if (!_styleDragId) return;
        const block = e.target.closest(".folder-block");
        if (!block || !root.contains(block)) { _styleDragId = null; _clearDropMarks(root); return; }
        e.preventDefault();
        const targetFolderId = block.getAttribute("data-folder-id");
        const row = e.target.closest(".style-row");
        let beforeId = null;
        if (row && row.getAttribute("data-style-id") !== _styleDragId) {
            const r = row.getBoundingClientRect();
            const after = (e.clientX - r.left) >= r.width / 2;
            if (after) {
                const next = row.nextElementSibling;
                beforeId = (next && next.classList.contains("style-row")) ? next.getAttribute("data-style-id") : null;
            } else {
                beforeId = row.getAttribute("data-style-id");
            }
        }
        const dragId = _styleDragId;
        _styleDragId = null;
        _clearDropMarks(root);
        moveStyle(dragId, targetFolderId, beforeId);
    });

    root.addEventListener("dragend", () => {
        _styleDragId = null;
        _clearDropMarks(root);
    });
}

function _clearDropMarks(root) {
    root.querySelectorAll(".dragging").forEach(n => n.classList.remove("dragging"));
    root.querySelectorAll(".drop-before, .drop-after, .drop-into").forEach(n =>
        n.classList.remove("drop-before", "drop-after", "drop-into"));
}

function _genId() { return Math.random().toString(36).slice(2, 10); }

function _normStyle(s) {
    s = s || {};
    return {
        fontPostScriptName: s.fontPostScriptName || "CCOriginStory",
        fontName: s.fontName || "CC Origin Story",
        fontStyleName: s.fontStyleName || "Regular",
        size: typeof s.size === "number" ? s.size : 31,
        fontCaps: s.fontCaps || "normal",
        syntheticBold: !!s.syntheticBold,
        syntheticItalic: !!s.syntheticItalic,
        autoKern: s.autoKern || "metricsKern",
        antiAlias: s.antiAlias || "antiAliasSmooth",
        alignment: s.alignment || "center",
        autoLeading: s.autoLeading !== false,
        autoLeadingPercentage: typeof s.autoLeadingPercentage === "number" ? s.autoLeadingPercentage : null,
        tracking: typeof s.tracking === "number" ? s.tracking : 0,
        horizontalScale: typeof s.horizontalScale === "number" ? s.horizontalScale : 100,
        verticalScale: typeof s.verticalScale === "number" ? s.verticalScale : 100,
        baselineShift: typeof s.baselineShift === "number" ? s.baselineShift : 0,
        color: _normRGB(s.color)
    };
}

function _normRGB(c) {
    if (!c) return { r: 0, g: 0, b: 0 };
    const r = (c.r !== undefined) ? c.r : c.red;
    const g = (c.g !== undefined) ? c.g : (c.green !== undefined ? c.green : c.grain);
    const b = (c.b !== undefined) ? c.b : c.blue;
    return { r: r || 0, g: g || 0, b: b || 0 };
}

function _num(v) {
    if (typeof v === "number") return v;
    if (v && typeof v._value === "number") return v._value;
    return undefined;
}

function _normFontData(d) {
    d = d || {};
    const folders = Array.isArray(d.folders) ? d.folders.map((f, i) => ({
        id: f.id || _genId(),
        name: f.name || "Folder",
        order: typeof f.order === "number" ? f.order : i,
        defaultStyleId: f.defaultStyleId || null
    })) : [];
    const styles = Array.isArray(d.styles) ? d.styles.map(s => ({
        id: s.id || _genId(),
        name: s.name || "Style",
        folderId: s.folderId || null,
        tags: Array.isArray(s.tags) ? s.tags.filter(t => typeof t === "string" && t.length) : [],
        color: s.color || "#FFF3B0",
        style: _normStyle(s.style)
    })) : [];
    let activeFolderId = d.activeFolderId || null;
    if (activeFolderId && !folders.some(f => f.id === activeFolderId)) activeFolderId = null;
    if (!activeFolderId && folders.length) activeFolderId = folders[0].id;
    return { folders, styles, activeFolderId };
}

function _activeStyles() {
    return _cached("activeStyles", () => {
        if (!_fontData.activeFolderId) return [];
        return _fontData.styles.filter(s => s.folderId === _fontData.activeFolderId);
    });
}

function _resolveFollowSourceTag(idx) {
    for (let i = idx - 1; i >= 0; i--) {
        const n = _notes[i];
        if (!n) continue;
        const line = (n.raw && n.raw.length) ? n.raw : _noteRaw(n.tag, n.text);
        if (!line || !line.trim()) continue;
        const c = classifyLine(line);
        if (c.skip) continue;
        if (_isFollowTag(c.tag)) continue;
        if (!c.tag) return "";
        return c.tag;
    }
    return "";
}

function _styleForTag(tag) {
    const styles = _activeStyles();
    if (tag) {
        const hit = styles.find(s => s.tags.indexOf(tag) !== -1);
        if (hit) return hit;
    }
    return styles.length ? styles[0] : null;
}

function _tagColorForTag(tag) {
    if (!tag) return null;
    const hit = _activeStyles().find(s => s.tags.indexOf(tag) !== -1);
    return (hit && hit.color) ? hit.color : null;
}
