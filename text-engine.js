const CHAR_WIDTH_FACTOR = 0.55;

function _measureWordWidthsEstimate(words, fontSize) {
    const factor = CHAR_WIDTH_FACTOR * fontSize;
    const widths = new Map();
    for (const w of words) {
        if (!widths.has(w)) widths.set(w, w.length * factor);
    }
    return { widths: widths, spaceWidth: factor };
}

var V3_SOFTEN_EXP = 0.6;
var V3_FLOOR = 0.15;
var V3_PUNCT_BONUS = 0.02;
const V3_PUNCT_RE = /[,.!?;:…"”’)\]]$/;
var V3_MONO_SLACK = 0.08;
var V3_MONO_WEIGHT = 4;
var V3_ASPECT_BIAS = 0.8;
var V3_ASPECT_WEIGHT = 0.2;
var V3_LEADING = 1.4;

const V3_DEFAULT_TUNE = {
    soften: V3_SOFTEN_EXP, floor: V3_FLOOR, punct: V3_PUNCT_BONUS,
    slack: V3_MONO_SLACK, mweight: V3_MONO_WEIGHT,
    abias: V3_ASPECT_BIAS, aweight: V3_ASPECT_WEIGHT,
    leading: V3_LEADING, minWords: 1
};

function _dpFitWordsV3(W, L, P, spaceWidth, targetW, maxWidth, edgeMin, peakW, tune) {
    tune = tune || V3_DEFAULT_TUNE;
    const M = W.length, N = targetW.length;
    if (M === 0 || M < N) return null;
    const pW = new Array(M + 1).fill(0), pL = new Array(M + 1).fill(0);
    for (let i = 0; i < M; i++) { pW[i + 1] = pW[i] + W[i]; pL[i + 1] = pL[i] + L[i]; }
    const lineW = (a, b) => pW[b] - pW[a] + (b - a - 1) * spaceWidth;
    const lineL = (a, b) => pL[b] - pL[a];

    const dir = new Array(N).fill(0);
    for (let j = 2; j <= N; j++) {
        const dt = targetW[j - 1] - targetW[j - 2];
        dir[j - 1] = dt > 1e-9 ? 1 : (dt < -1e-9 ? -1 : 0);
    }

    const fitCost = (j, a, b) => {
        const t = targetW[j - 1];
        const d = (lineW(a, b) - t) / t;
        let c = d * d;
        if (b < M && P[b - 1]) c = Math.max(0, c - tune.punct);
        return c;
    };
    const monoCost = (wPrev, wCur, d) => {
        if (d === 0) return 0;
        const v = (d > 0 ? (wPrev - wCur) : (wCur - wPrev)) / peakW - tune.slack;
        return v > 0 ? tune.mweight * v * v : 0;
    };

    const STRIDE = M + 1;
    const SZ = STRIDE * STRIDE;
    const INF = Number.POSITIVE_INFINITY;
    let cur = new Float64Array(SZ).fill(INF);
    const pars = [];

    for (let i = 1; i <= M - (N - 1); i++) {
        const w = lineW(0, i);
        if (w > maxWidth && i > 1) break;
        if (N > 1 && lineL(0, i) <= edgeMin) continue;
        cur[i * STRIDE] = fitCost(1, 0, i);
    }

    for (let j = 2; j <= N; j++) {
        const next = new Float64Array(SZ).fill(INF);
        const par = new Int16Array(SZ).fill(-1);
        const isLast = (j === N);
        const iMax = M - (N - j + 1);
        for (let i = j - 1; i <= iMax; i++) {
            const rowI = i * STRIDE;
            for (let k = 0; k < i; k++) {
                const base = cur[rowI + k];
                if (base === INF) continue;
                const wPrev = lineW(k, i);
                const lEnd = isLast ? M : (M - (N - j));
                for (let l = isLast ? M : (i + 1); l <= lEnd; l++) {
                    const w = lineW(i, l);
                    if (w > maxWidth && (l - i) > 1) break;
                    if (isLast && lineL(i, l) <= edgeMin) continue;
                    const c = base + fitCost(j, i, l) + monoCost(wPrev, w, dir[j - 1]);
                    const id = l * STRIDE + i;
                    if (c < next[id]) { next[id] = c; par[id] = k; }
                }
            }
        }
        pars.push(par);
        cur = next;
    }

    let best = INF, bestK = -1;
    const rowM = M * STRIDE;
    for (let k = 0; k < M; k++) {
        if (cur[rowM + k] < best) { best = cur[rowM + k]; bestK = k; }
    }
    if (best === INF) return null;

    const ranges = [];
    let ei = M, sk = bestK;
    for (let j = N; j >= 1; j--) {
        ranges.unshift([sk, ei]);
        if (j > 1) {
            const pk = pars[j - 2][ei * STRIDE + sk];
            ei = sk; sk = pk;
        }
    }
    return { ranges: ranges, cost: best };
}

function _wrapSineFastV3(words, widths, spaceWidth, naturalTotalW, aspect, lineH, shape, edgeMin, tune) {
    tune = tune || V3_DEFAULT_TUNE;
    const M = words.length;
    const W = words.map(w => widths.get(w) || 0);
    const L = words.map(w => w.length);
    const P = words.map(w => V3_PUNCT_RE.test(w));
    const maxWordW = W.reduce((a, b) => Math.max(a, b), 0);

    const Nmin = 2;
    const minWords = Math.max(1, tune.minWords || 1);
    const Nmax = Math.max(Nmin, Math.min(M, 12, Math.floor(M / minWords)));
    const targetAspect = Math.max(0.05, aspect * tune.abias);

    function search(edge) {
        let bestRanges = null, bestScore = Infinity, bestN = 0;
        for (let N = Nmin; N <= Nmax; N++) {
            const f = new Array(N);
            let mean = 0;
            for (let i = 0; i < N; i++) {
                const u = (2 * i + 1) / N - 1;
                let base;
                if (shape === "diamond") base = 1 - Math.abs(u);
                else if (shape === "sine") base = Math.cos(Math.PI * u / 2);
                else base = Math.sqrt(Math.max(0, 1 - u * u));
                f[i] = Math.max(Math.pow(base, tune.soften), tune.floor);
                mean += f[i];
            }
            mean /= N;
            const peakW = naturalTotalW / (N * mean);
            const targetW = f.map(x => x * peakW);
            const maxLineW = Math.max(peakW * 1.05, maxWordW);
            const res = _dpFitWordsV3(W, L, P, spaceWidth, targetW, maxLineW, edge, peakW, tune);
            if (!res) continue;
            const blockAspect = (N * lineH) / peakW;
            const aDev = Math.log(blockAspect / targetAspect);
            const score = res.cost / N + tune.aweight * aDev * aDev;
            vlog("  Psacs-kp v3 Try N=" + N + " peakW=" + peakW.toFixed(1) +
                " fit=" + (res.cost / N).toFixed(3) + " blockAR=" + blockAspect.toFixed(2) +
                " score=" + score.toFixed(3), "info");
            if (score < bestScore) { bestScore = score; bestN = N; bestRanges = res.ranges; }
        }
        return { ranges: bestRanges, score: bestScore, N: bestN };
    }

    let r = search(edgeMin);
    if (!r.ranges && edgeMin > 0) {
        vlog("Psacs-kp v3: edge constraint infeasible → retry tanpa syarat tepi", "warn");
        r = search(0);
    }
    if (!r.ranges) {
        vlog("Psacs-kp v3: no feasible layout → 1 line", "warn");
        return words.join(" ");
    }
    vlog("Psacs-kp v3 bestN=" + r.N + " score=" + r.score.toFixed(3) +
        " (shape=" + shape + ", edgeMin=" + edgeMin + ")", "info");
    return r.ranges.map(rg => words.slice(rg[0], rg[1]).join(" ")).join("\r");
}

async function _shapeText(text, sel, opts) {
    if (!opts.wrapShape || opts.wrapShape === "none") return text;
    const pv = _previewShapedFor(text, opts, opts.previewAnyAspect ? null : sel);
    if (pv != null) { vlog("Shape: pakai hasil PREVIEW (match).", "info"); return pv; }
    return await wrapTextToShape(text, sel, opts);
}

const SHAPE_REF_FONT_SIZE = 18;

async function wrapTextToShape(text, sel, opts) {
    const shape = opts.wrapShape;
    if (!shape || shape === "none") return text;

    const collapsed = text.replace(/\s+/g, " ").trim();
    if (!collapsed) return text;
    const words = collapsed.split(" ").filter(s => s.length > 0);
    if (words.length < 2) return text;

    const fontSize = SHAPE_REF_FONT_SIZE;

    const est = _measureWordWidthsEstimate(words, fontSize);
    const widths = est.widths;
    const spaceWidth = est.spaceWidth;

    let naturalTotalW = 0;
    for (let i = 0; i < words.length; i++) {
        naturalTotalW += widths.get(words[i]) || 0;
    }
    naturalTotalW += (words.length - 1) * spaceWidth;

    const selW = sel.right - sel.left;
    const selH = sel.bottom - sel.top;
    const aspect = (selH > 0 && selW > 0) ? (selH / selW) : 1;
    const tune = opts.tune || V3_DEFAULT_TUNE;
    const lineH = fontSize * tune.leading;
    return _wrapSineFastV3(words, widths, spaceWidth, naturalTotalW,
        aspect, lineH, shape,
        (opts.edgeMinLetters != null ? opts.edgeMinLetters : 3), tune);
}

function _buildTextStyle(st, len) {
    const ts = {
        _obj: "textStyle",
        fontPostScriptName: st.fontPostScriptName,
        fontName: st.fontName,
        fontStyleName: st.fontStyleName,
        size: { _unit: "pointsUnit", _value: st.size },
        autoLeading: st.autoLeading !== false,
        tracking: st.tracking || 0,
        horizontalScale: st.horizontalScale || 100,
        verticalScale: st.verticalScale || 100,
        baselineShift: { _unit: "pointsUnit", _value: st.baselineShift || 0 },
        syntheticBold: !!st.syntheticBold,
        syntheticItalic: !!st.syntheticItalic,
        autoKern: { _enum: "autoKern", _value: st.autoKern || "metricsKern" },
        fontCaps: { _enum: "fontCaps", _value: st.fontCaps || "normal" },
        color: {
            _obj: "RGBColor",
            red: (st.color && st.color.r) || 0,
            grain: (st.color && st.color.g) || 0,
            blue: (st.color && st.color.b) || 0
        }
    };
    return { _obj: "textStyleRange", from: 0, to: len, textStyle: ts };
}

function _buildParagraphStyle(st, len) {
    const ps = {
        _obj: "paragraphStyle",
        align: { _enum: "alignmentType", _value: st.alignment || "center" }
    };
    if (typeof st.autoLeadingPercentage === "number") {
        ps.autoLeadingPercentage = st.autoLeadingPercentage;
    }
    return { _obj: "paragraphStyleRange", from: 0, to: len, paragraphStyle: ps };
}

async function _getSelectionFillRatio(bbox) {
    try {
        const imaging = require("photoshop").imaging;
        const doc = app.activeDocument;
        const left = Math.max(0, Math.floor(bbox.left));
        const top = Math.max(0, Math.floor(bbox.top));
        const right = Math.min(doc.width, Math.ceil(bbox.right));
        const bottom = Math.min(doc.height, Math.ceil(bbox.bottom));
        const w = right - left, h = bottom - top;
        if (w < 1 || h < 1) return 1;
        const sPix = await imaging.getSelection({
            documentID: doc.id,
            sourceBounds: { left, top, right, bottom }
        });
        const sdata = await sPix.imageData.getData({});
        const sc = sPix.imageData.components || 1;
        const N = w * h;
        let sum = 0;
        for (let i = 0; i < N; i++) sum += sdata[i * sc];
        try { sPix.imageData.dispose(); } catch (e) { vlog("dispose: " + (e && e.message), "warn"); }
        const ratio = sum / (N * 255);
        return (ratio > 0.01 && ratio <= 1) ? ratio : 1;
    } catch (e) {
        log("Fill ratio gagal (" + (e && e.message ? e.message : String(e)) + ") — pakai kotak.", "warn");
        return 1;
    }
}

async function _resizeFitFactor(opts, b) {
    const mode = (opts && opts.resizeFit) || "bbox";
    if (mode === "shape") {
        const sh = opts && opts.wrapShape;
        if (sh === "ellipse") return Math.sqrt(Math.PI / 4);
        if (sh === "diamond") return Math.sqrt(0.5);
        if (sh === "sine") return Math.sqrt(2 / Math.PI);
        return 1;
    }
    if (mode === "area") {
        const fill = (opts && typeof opts.selFillRatio === "number")
            ? opts.selFillRatio
            : await _getSelectionFillRatio(b);
        return Math.sqrt(fill);
    }
    return 1;
}

async function createParagraphText(text, b, opts) {
    text = text.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
    const len = text.length;
    const fontPostScript = (opts && opts.fontPostScript) || "CCOriginStory";
    const fontFamily = (opts && opts.fontFamily) || "CC Origin Story";
    const fontSize = (opts && opts.fontSize) || 12;
    const align = (opts && opts.align) || "center";
    const autoResize = !!(opts && opts.autoResize);
    const resizePct = (opts && opts.resizePct) || 80;
    const useExplicitBreaks = !!(opts && ((opts.wrapShape && opts.wrapShape !== "none") || opts.forceExplicitBreaks));

    const targetCx = (b.left + b.right) / 2;
    const targetCy = (b.top + b.bottom) / 2;
    const selW = b.right - b.left;
    const selH = b.bottom - b.top;

    const styleObj = (opts && opts.styleObj) ? opts.styleObj : _normStyle({
        fontPostScriptName: fontPostScript,
        fontName: fontFamily,
        size: fontSize,
        alignment: align
    });
    const textStyleRange = [_buildTextStyle(styleObj, len)];
    const paragraphStyleRange = [_buildParagraphStyle(styleObj, len)];

    let boxLeft, boxRight, boxTop, boxBottom;
    if (useExplicitBreaks) {
        const _lines = text.split("\r");
        const _maxLineLen = _lines.reduce((a, l) => Math.max(a, l.length), 1);
        let _dpi = 72;
        try { _dpi = (app.activeDocument && app.activeDocument.resolution) || 72; }
        catch (e) { vlog("Resolusi dokumen tak terbaca (" + _errMsg(e) + ") — pakai 72 DPI utk box anti-wrap.", "warn"); }
        const pxPerPt = _dpi / 72;
        const lineWpx = _maxLineLen * fontSize * CHAR_WIDTH_FACTOR * pxPerPt;
        const totalHpx = _lines.length * fontSize * 1.4 * pxPerPt;
        const halfW = Math.max(selW, lineWpx * 1.5) / 2 + fontSize * pxPerPt;
        const halfH = Math.max(selH, totalHpx) / 2 + fontSize * pxPerPt;
        boxLeft = targetCx - halfW;
        boxRight = targetCx + halfW;
        boxTop = targetCy - halfH;
        boxBottom = targetCy + halfH;
    } else {
        boxLeft = b.left;
        boxRight = b.right;
        boxTop = b.top;
        boxBottom = b.bottom;
    }
    vlog("Box make: [" + Math.round(boxLeft) + "," + Math.round(boxTop) + " → " +
        Math.round(boxRight) + "," + Math.round(boxBottom) + "] target=(" +
        Math.round(targetCx) + "," + Math.round(targetCy) + ") explicit=" + useExplicitBreaks, "info");

    const using = {
        _obj: "textLayer",
        textKey: text,
        textShape: [{
            _obj: "textShape",
            char: { _enum: "char", _value: "box" },
            orientation: { _enum: "orientation", _value: "horizontal" },
            rowCount: 1, columnCount: 1, rowMajorOrder: true,
            bounds: {
                _obj: "rectangle",
                top: { _unit: "pixelsUnit", _value: boxTop },
                left: { _unit: "pixelsUnit", _value: boxLeft },
                bottom: { _unit: "pixelsUnit", _value: boxBottom },
                right: { _unit: "pixelsUnit", _value: boxRight }
            }
        }],
        antiAlias: { _enum: "antiAliasType", _value: styleObj.antiAlias || "antiAliasSmooth" },
        textStyleRange: textStyleRange,
        paragraphStyleRange: paragraphStyleRange
    };

    const r1 = await _bp([{
        _obj: "make",
        _target: [{ _ref: "textLayer" }],
        using: using
    }, _dGetLayerBounds()]);

    if (r1 && r1[0] && r1[0].message) {
        throw new Error("make textLayer: " + r1[0].message);
    }
    let lb = (r1 && r1[1] && r1[1].bounds) ? _rectFromDesc(r1[1].bounds) : null;

    lb = await _fitBoxToText(lb, Math.max(2, fontSize * 0.2), Math.max(3, fontSize * 0.45));

    const off1 = await _recenterFrom(lb, targetCx, targetCy, true);
    if (off1) vlog("Recenter#1: dx=" + off1.dx.toFixed(1) + " dy=" + off1.dy.toFixed(1), "info");
    lb = off1 ? off1.bounds : null;

    if (autoResize && resizePct > 0 && selW > 0 && selH > 0) {
        if (!lb) lb = await _getCurrentLayerBounds();
        if (lb) {
            const tW = lb.right - lb.left;
            const tH = lb.bottom - lb.top;
            if (tW > 0 && tH > 0) {
                const fitK = await _resizeFitFactor(opts, b);
                const targetW = selW * (resizePct / 100) * fitK;
                const targetH = selH * (resizePct / 100) * fitK;
                const scale = Math.min(targetW / tW, targetH / tH);
                vlog("Auto-resize: text=" + Math.round(tW) + "×" + Math.round(tH) +
                    " sel=" + Math.round(selW) + "×" + Math.round(selH) +
                    " fit=" + ((opts && opts.resizeFit) || "bbox") + " k=" + fitK.toFixed(3) +
                    " target=" + Math.round(targetW) + "×" + Math.round(targetH) +
                    " → scale " + (scale * 100).toFixed(1) + "%", "info");
                if (Math.abs(scale - 1) >= 0.005) {
                    lb = await _bpThenLayerBounds([_dTransformScale(scale)], "Auto-resize");
                    const off2 = await _recenterFrom(lb, targetCx, targetCy, true);
                    if (off2) vlog("Recenter#2: dx=" + off2.dx.toFixed(1) + " dy=" + off2.dy.toFixed(1), "info");
                }
            }
        }
    }

    const offF = await _recenterFrom(null, targetCx, targetCy, false);
    if (offF && (Math.abs(offF.dx) > 1 || Math.abs(offF.dy) > 1)) {
        log("Safety recenter: teks dipindah dx=" + Math.round(offF.dx) + " dy=" +
            Math.round(offF.dy) + " ke pusat selection (anti off-canvas).", "warn");
    }

    return r1.slice(0, 1);
}
