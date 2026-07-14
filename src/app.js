/* ===================== Vectorial — core app logic (draft for syntax check) ===================== */
'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';

function uid(prefix) {
  return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 9);
}

/* ---------- State ---------- */
const state = {
  shapes: [],
  selectedIds: [],
  tool: 'select',
  nodeEditShapeId: null,
  nodeSel: null, // {cmdIndex, part}
  viewBox: { x: 0, y: 0, w: 900, h: 600 },
  draft: null,
};

let history = [];
let historyIndex = -1;

function snapshot() {
  return JSON.stringify({ shapes: state.shapes, selectedIds: state.selectedIds });
}

function pushHistory() {
  const snap = snapshot();
  history = history.slice(0, historyIndex + 1);
  history.push(snap);
  if (history.length > 100) history.shift();
  historyIndex = history.length - 1;
}

function undo() {
  if (historyIndex <= 0) return;
  historyIndex--;
  restore(history[historyIndex]);
}

function redo() {
  if (historyIndex >= history.length - 1) return;
  historyIndex++;
  restore(history[historyIndex]);
}

function restore(snap) {
  const data = JSON.parse(snap);
  state.shapes = data.shapes;
  state.selectedIds = data.selectedIds;
}

/* ---------- Shape factories ---------- */
function baseShape(type, extra) {
  return Object.assign({
    id: uid(type),
    type: type,
    name: type[0].toUpperCase() + type.slice(1),
    fill: '#5eead4',
    stroke: '#0d0f12',
    strokeWidth: 2,
    opacity: 1,
    visible: true,
    locked: false,
  }, extra);
}

function makeRect(x, y, w, h) {
  return baseShape('rect', { x: x, y: y, w: w, h: h, rx: 0 });
}
function makeEllipse(cx, cy, rx, ry) {
  return baseShape('ellipse', { cx: cx, cy: cy, rx: rx, ry: ry });
}
function makeLine(x1, y1, x2, y2) {
  return baseShape('line', { x1: x1, y1: y1, x2: x2, y2: y2, fill: 'none' });
}
function makeText(x, y, content) {
  return baseShape('text', { x: x, y: y, content: content || 'Text', fontSize: 24, fontFamily: 'Space Grotesk, sans-serif', fill: '#e8eaed', stroke: 'none', strokeWidth: 0 });
}
function makePath(commands) {
  return baseShape('path', { commands: commands, fill: 'none', fillRule: 'nonzero' });
}

const BEZIER_KAPPA = 0.5522847498307936; // standard 4-curve circle/ellipse approximation constant
function convertShapeToPath(shape) {
  let cmds;
  const k = BEZIER_KAPPA;
  if (shape.type === 'rect') {
    const x = shape.x, y = shape.y, w = shape.w, h = shape.h;
    const r = Math.max(0, Math.min(shape.rx || 0, w / 2, h / 2));
    if (r > 0.01) {
      cmds = [
        { type: 'M', x: x + r, y: y },
        { type: 'L', x: x + w - r, y: y },
        { type: 'C', x1: x + w - r + k * r, y1: y, x2: x + w, y2: y + r - k * r, x: x + w, y: y + r },
        { type: 'L', x: x + w, y: y + h - r },
        { type: 'C', x1: x + w, y1: y + h - r + k * r, x2: x + w - r + k * r, y2: y + h, x: x + w - r, y: y + h },
        { type: 'L', x: x + r, y: y + h },
        { type: 'C', x1: x + r - k * r, y1: y + h, x2: x, y2: y + h - r + k * r, x: x, y: y + h - r },
        { type: 'L', x: x, y: y + r },
        { type: 'C', x1: x, y1: y + r - k * r, x2: x + r - k * r, y2: y, x: x + r, y: y },
        { type: 'Z' },
      ];
    } else {
      cmds = [
        { type: 'M', x: x, y: y }, { type: 'L', x: x + w, y: y },
        { type: 'L', x: x + w, y: y + h }, { type: 'L', x: x, y: y + h }, { type: 'Z' },
      ];
    }
  } else if (shape.type === 'ellipse') {
    const cx = shape.cx, cy = shape.cy, rx = shape.rx, ry = shape.ry;
    cmds = [
      { type: 'M', x: cx + rx, y: cy },
      { type: 'C', x1: cx + rx, y1: cy + ry * k, x2: cx + rx * k, y2: cy + ry, x: cx, y: cy + ry },
      { type: 'C', x1: cx - rx * k, y1: cy + ry, x2: cx - rx, y2: cy + ry * k, x: cx - rx, y: cy },
      { type: 'C', x1: cx - rx, y1: cy - ry * k, x2: cx - rx * k, y2: cy - ry, x: cx, y: cy - ry },
      { type: 'C', x1: cx + rx * k, y1: cy - ry, x2: cx + rx, y2: cy - ry * k, x: cx + rx, y: cy },
      { type: 'Z' },
    ];
  } else if (shape.type === 'line') {
    cmds = [{ type: 'M', x: shape.x1, y: shape.y1 }, { type: 'L', x: shape.x2, y: shape.y2 }];
  } else {
    return null; // text (no font-to-path conversion available) or already a path
  }
  const newShape = makePath(cmds);
  newShape.id = shape.id; // preserve identity: selection/layer position/history stay coherent
  newShape.name = shape.name;
  newShape.fill = shape.fill;
  newShape.stroke = shape.stroke;
  newShape.strokeWidth = shape.strokeWidth;
  newShape.opacity = shape.opacity;
  newShape.visible = shape.visible;
  newShape.locked = shape.locked;
  newShape.gradient = shape.gradient || null;
  return newShape;
}

/* ---------- Path <-> d string ---------- */
function commandsToD(cmds) {
  let d = '';
  for (const c of cmds) {
    if (c.type === 'M') d += 'M ' + c.x + ' ' + c.y + ' ';
    else if (c.type === 'L') d += 'L ' + c.x + ' ' + c.y + ' ';
    else if (c.type === 'C') d += 'C ' + c.x1 + ' ' + c.y1 + ' ' + c.x2 + ' ' + c.y2 + ' ' + c.x + ' ' + c.y + ' ';
    else if (c.type === 'Z') d += 'Z ';
  }
  return d.trim();
}

// Parse an SVG path 'd' attribute into an absolute M/L/C/Z command list.
function parsePathD(d) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  let i = 0;
  const cmds = [];
  let cur = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  let lastCtrl = null; // for S/T reflection
  let lastType = null;

  function num() { return parseFloat(tokens[i++]); }

  while (i < tokens.length) {
    let t = tokens[i++];
    if (!/[a-zA-Z]/.test(t)) { i--; t = lastType; if (!t) break; } // implicit repeat
    const rel = t === t.toLowerCase();
    const T = t.toUpperCase();
    lastType = t;

    if (T === 'M') {
      const x = num() + (rel ? cur.x : 0), y = num() + (rel ? cur.y : 0);
      cmds.push({ type: 'M', x, y });
      cur = { x, y }; start = { x, y }; lastCtrl = null;
      lastType = rel ? 'l' : 'L'; // subsequent bare coords act as lineto
    } else if (T === 'L') {
      const x = num() + (rel ? cur.x : 0), y = num() + (rel ? cur.y : 0);
      cmds.push({ type: 'L', x, y }); cur = { x, y }; lastCtrl = null;
    } else if (T === 'H') {
      const x = num() + (rel ? cur.x : 0);
      cmds.push({ type: 'L', x, y: cur.y }); cur = { x, y: cur.y }; lastCtrl = null;
    } else if (T === 'V') {
      const y = num() + (rel ? cur.y : 0);
      cmds.push({ type: 'L', x: cur.x, y }); cur = { x: cur.x, y }; lastCtrl = null;
    } else if (T === 'C') {
      const x1 = num() + (rel ? cur.x : 0), y1 = num() + (rel ? cur.y : 0);
      const x2 = num() + (rel ? cur.x : 0), y2 = num() + (rel ? cur.y : 0);
      const x = num() + (rel ? cur.x : 0), y = num() + (rel ? cur.y : 0);
      cmds.push({ type: 'C', x1, y1, x2, y2, x, y });
      lastCtrl = { x: x2, y: y2 }; cur = { x, y };
    } else if (T === 'S') {
      const x2 = num() + (rel ? cur.x : 0), y2 = num() + (rel ? cur.y : 0);
      const x = num() + (rel ? cur.x : 0), y = num() + (rel ? cur.y : 0);
      const x1 = lastCtrl ? (2 * cur.x - lastCtrl.x) : cur.x;
      const y1 = lastCtrl ? (2 * cur.y - lastCtrl.y) : cur.y;
      cmds.push({ type: 'C', x1, y1, x2, y2, x, y });
      lastCtrl = { x: x2, y: y2 }; cur = { x, y };
    } else if (T === 'Q') {
      const qx = num() + (rel ? cur.x : 0), qy = num() + (rel ? cur.y : 0);
      const x = num() + (rel ? cur.x : 0), y = num() + (rel ? cur.y : 0);
      const x1 = cur.x + 2 / 3 * (qx - cur.x), y1 = cur.y + 2 / 3 * (qy - cur.y);
      const x2 = x + 2 / 3 * (qx - x), y2 = y + 2 / 3 * (qy - y);
      cmds.push({ type: 'C', x1, y1, x2, y2, x, y });
      lastCtrl = { x: qx, y: qy }; cur = { x, y };
    } else if (T === 'T') {
      const x = num() + (rel ? cur.x : 0), y = num() + (rel ? cur.y : 0);
      const qx = lastCtrl ? (2 * cur.x - lastCtrl.x) : cur.x;
      const qy = lastCtrl ? (2 * cur.y - lastCtrl.y) : cur.y;
      const x1 = cur.x + 2 / 3 * (qx - cur.x), y1 = cur.y + 2 / 3 * (qy - cur.y);
      const x2 = x + 2 / 3 * (qx - x), y2 = y + 2 / 3 * (qy - y);
      cmds.push({ type: 'C', x1, y1, x2, y2, x, y });
      lastCtrl = { x: qx, y: qy }; cur = { x, y };
    } else if (T === 'Z') {
      cmds.push({ type: 'Z' }); cur = { x: start.x, y: start.y }; lastCtrl = null;
    } else {
      // unsupported command (A = arc, etc.) — skip its args conservatively
      break;
    }
  }
  return cmds;
}

/* Split a cubic bezier at t using De Casteljau's algorithm. Returns two C commands. */
function splitCubic(p0, c, t) {
  const p1 = { x: c.x1, y: c.y1 }, p2 = { x: c.x2, y: c.y2 }, p3 = { x: c.x, y: c.y };
  function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
  const p01 = lerp(p0, p1, t), p12 = lerp(p1, p2, t), p23 = lerp(p2, p3, t);
  const p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t);
  const p0123 = lerp(p012, p123, t);
  return [
    { type: 'C', x1: p01.x, y1: p01.y, x2: p012.x, y2: p012.y, x: p0123.x, y: p0123.y },
    { type: 'C', x1: p123.x, y1: p123.y, x2: p23.x, y2: p23.y, x: p3.x, y: p3.y },
  ];
}

/* ---------- Best-effort EPS -> shapes parser ----------
   EPS is PostScript, and real-world EPS (especially from Cairo, Inkscape,
   or PDF-to-EPS converters) almost never calls operators like "moveto" or
   "fill" directly. Instead the file defines short procedure aliases at
   the top ("/m { moveto } bind def", "/f { fill } bind def", etc.) and
   the drawing content calls those aliases. So this is a two-pass, minimal
   PostScript interpreter: pass 1 extracts "/name { ... } [bind] def"
   procedure definitions into a dictionary; pass 2 executes the remaining
   tokens, recursively expanding any call to a user-defined procedure name
   (depth-limited against runaway/self-referential definitions).
   Supported: path/paint ops (moveto/lineto/curveto/closepath, rmoveto/
   rlineto/rcurveto, fill/eofill/stroke), color ops (setrgbcolor/setgray/
   sethsbcolor/setcmykcolor), transform ops (translate/scale/concat/cm),
   basic stack & arithmetic ops needed by common prologs (dup/pop/exch/
   roll/index/copy/neg/add/sub/mul/div), minimal array support (array/
   astore/concat) since "cm" is commonly implemented as
   "6 array astore concat", a direct "re" (rectangle) as both a built-in
   and via user-defined procedures, and gsave/grestore for color+CTM state.
   Fonts, images, patterns, clipping, and shadings are not supported and
   are skipped. */
/* Tokenize a PostScript body respecting string literals: PS strings are
   delimited by unescaped parens and may contain nested balanced parens
   (and any other character, including brace characters) without needing
   escapes. A naive scanner that counts "{"/"}" anywhere in the raw text
   -- regardless of whether it's inside a string -- can massively
   miscount procedure-body nesting depth on real-world files (e.g. text
   content containing a literal brace), which can capture huge swaths of
   the file as a single bogus "procedure" and cause catastrophic
   slowdown when it's later executed. This scanner skips string and
   array-literal content properly instead. */
function tokenizeEPSBody(text) {
  const tokens = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '(') {
      let depth = 1; i++;
      while (i < n && depth > 0) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === '(') depth++;
        else if (text[i] === ')') depth--;
        i++;
      }
      continue; // string content isn't needed for path geometry
    }
    if (ch === ')') { i++; continue; } // stray/unmatched paren: skip defensively
    if (ch === '{' || ch === '}') { tokens.push(ch); i++; continue; }
    if (ch === '[' || ch === ']') { i++; continue; } // array-literal brackets: not used by our operators
    if (ch === '/') {
      let j = i + 1;
      while (j < n && !/[\s\/{}()\[\]]/.test(text[j])) j++;
      tokens.push(text.slice(i, j));
      i = j;
      continue;
    }
    let j = i;
    while (j < n && !/[\s\/{}()\[\]]/.test(text[j])) j++;
    if (j === i) { i++; continue; }
    tokens.push(text.slice(i, j));
    i = j;
  }
  return tokens;
}

/* Real-world gradient fills in EPS are almost always done via the
   PostScript "shfill" operator (fill the current clip region with a
   shading), rather than a simple color operator. Fully interpreting a
   shading dictionary + PostScript Function is out of scope, so instead
   we pre-scan the raw text (in document order, once per "shfill" call)
   for the /C0 and /C1 color-stop arrays belonging to that shading's
   Function definition (handling both a plain FunctionType 2 and a
   FunctionType 3 stitching function with several nested sub-functions)
   and average them into one representative flat color. */
function extractShadingGradients(text) {
  const gradients = [];
  const shfillPositions = [];
  let from = 0;
  while (true) {
    const idx = text.indexOf('shfill', from);
    if (idx === -1) break;
    shfillPositions.push(idx);
    from = idx + 6;
  }
  let prevEnd = 0;
  for (const idx of shfillPositions) {
    const chunk = text.slice(prevEnd, idx);
    const cfIdx = chunk.indexOf('CairoFunction');
    const searchChunk = cfIdx >= 0 ? chunk.slice(cfIdx) : chunk;

    const shadingTypeMatch = searchChunk.match(/\/ShadingType\s+(\d)/);
    const shadingType = shadingTypeMatch ? parseInt(shadingTypeMatch[1], 10) : 2;
    const coordsMatch = searchChunk.match(/\/Coords\s*\[\s*([^\]]+)\]/);
    const coordsRaw = coordsMatch ? coordsMatch[1].trim().split(/\s+/).map(Number) : null;

    const funcTypeMatch = searchChunk.match(/\/FunctionType\s+(\d)/);
    const domainMatch = searchChunk.match(/\/Domain\s*\[\s*([^\]]+)\]/);
    const domain = domainMatch ? domainMatch[1].trim().split(/\s+/).map(Number) : [0, 1];

    let stops = [];
    if (funcTypeMatch && funcTypeMatch[1] === '3') {
      const boundsMatch = searchChunk.match(/\/Bounds\s*\[\s*([^\]]*)\]/);
      const bounds = boundsMatch && boundsMatch[1].trim() ? boundsMatch[1].trim().split(/\s+/).map(Number) : [];
      const subC0C1 = [];
      const subFuncRe = /\/C0\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\][\s\S]*?\/C1\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g;
      let sm;
      while ((sm = subFuncRe.exec(searchChunk))) {
        subC0C1.push({
          c0: [parseFloat(sm[1]), parseFloat(sm[2]), parseFloat(sm[3])],
          c1: [parseFloat(sm[4]), parseFloat(sm[5]), parseFloat(sm[6])],
        });
      }
      const offsets = [domain[0]].concat(bounds).concat([domain[1]]);
      for (let i = 0; i < subC0C1.length && i < offsets.length - 1; i++) {
        stops.push({ offset: offsets[i], color: subC0C1[i].c0 });
        stops.push({ offset: offsets[i + 1], color: subC0C1[i].c1 });
      }
    } else {
      const c0Match = searchChunk.match(/\/C0\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
      const c1Match = searchChunk.match(/\/C1\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
      if (c0Match && c1Match) {
        stops.push({ offset: domain[0], color: [parseFloat(c0Match[1]), parseFloat(c0Match[2]), parseFloat(c0Match[3])] });
        stops.push({ offset: domain[1], color: [parseFloat(c1Match[1]), parseFloat(c1Match[2]), parseFloat(c1Match[3])] });
      }
    }

    gradients.push(stops.length ? { type: shadingType === 3 ? 'radial' : 'linear', stops: stops, coordsRaw: coordsRaw, domain: domain } : null);
    prevEnd = idx + 6;
  }
  return gradients;
}

function parseEPS(text) {
  let bbox = null;
  const bboxMatch = text.match(/%%BoundingBox:\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/);
  if (bboxMatch) {
    bbox = {
      x0: parseFloat(bboxMatch[1]), y0: parseFloat(bboxMatch[2]),
      x1: parseFloat(bboxMatch[3]), y1: parseFloat(bboxMatch[4]),
    };
  }

  const bodyText = text.split('\n').filter(function (line) { return !/^\s*%/.test(line); }).join('\n');
  const tokens = tokenizeEPSBody(bodyText);
  const shadingGradients = extractShadingGradients(bodyText);

  function isNum(t) { return /^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t); }

  /* Pass 1: extract "/name { ... } [bind] def" procedure definitions,
     leaving a flat top-level token stream with the definitions removed. */
  const procs = {};
  const topTokens = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t[0] === '/' && tokens[i + 1] === '{') {
      const name = t.slice(1);
      let depth = 0, j = i + 1;
      const bodyTokens = [];
      for (; j < tokens.length; j++) {
        if (tokens[j] === '{') { depth++; if (depth === 1) continue; }
        if (tokens[j] === '}') { depth--; if (depth === 0) break; }
        bodyTokens.push(tokens[j]);
      }
      let k = j + 1;
      if (tokens[k] === 'bind') k++;
      if (tokens[k] === 'def') k++;
      procs[name] = bodyTokens;
      i = k - 1;
      continue;
    }
    topTokens.push(t);
  }

  /* Pass 2: execute, expanding proc calls recursively. */
  const shapes = [];
  const stack = [];
  let cur = { x: 0, y: 0 };
  let subStart = { x: 0, y: 0 };
  let cmds = [];
  let fillColor = '#000000';
  let lastClipPath = null;
  let lastClipRule = 'nonzero';
  let shfillCounter = 0;
  let strokeColor = '#000000';
  let ctm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const gstack = [];

  function tx(x, y) { return { x: ctm.a * x + ctm.c * y + ctm.e, y: ctm.b * x + ctm.d * y + ctm.f }; }
  function popN(n) {
    const out = stack.splice(Math.max(0, stack.length - n), n);
    while (out.length < n) out.unshift(0);
    return out.map(function (v) { const num = Number(v); return isFinite(num) ? num : 0; });
  }
  function rgbToHex(r, g, b) {
    function h(v) { v = Math.max(0, Math.min(1, v)); return Math.round(v * 255).toString(16).padStart(2, '0'); }
    return '#' + h(r) + h(g) + h(b);
  }
  function hsbToHex(h, s, v) {
    let r, g, b;
    const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), tt = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: r = v; g = tt; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = tt; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = tt; g = p; b = v; break;
      default: r = v; g = p; b = q; break;
    }
    return rgbToHex(r, g, b);
  }
  function finalizePath(mode, rule) {
    if (cmds.length === 0) return;
    const shape = makePath(cmds.slice());
    shape.fill = mode === 'stroke' ? 'none' : fillColor;
    shape.stroke = mode === 'fill' ? 'none' : strokeColor;
    shape.strokeWidth = mode === 'fill' ? 0 : 1.5;
    shape.fillRule = rule || 'nonzero';
    shape.name = 'EPS Path';
    shapes.push(shape);
  }
  function concatMatrix(a2, b2, c2, d2, e2, f2) {
    const na = ctm.a * a2 + ctm.c * b2, nb = ctm.b * a2 + ctm.d * b2;
    const nc = ctm.a * c2 + ctm.c * d2, nd = ctm.b * c2 + ctm.d * d2;
    const ne = ctm.a * e2 + ctm.c * f2 + ctm.e, nf = ctm.b * e2 + ctm.d * f2 + ctm.f;
    ctm = { a: na, b: nb, c: nc, d: nd, e: ne, f: nf };
  }

  let opBudget = 2000000; // hard cap so no input can hang the tab
  let truncated = false;
  function execOne(t, depth) {
    if (depth > 40) return; // guard against runaway/self-referential proc definitions
    if (opBudget-- <= 0) { truncated = true; return; }
    if (isNum(t)) { if (stack.length < 5000) stack.push(parseFloat(t)); return; }
    if (t[0] === '/') { stack.push(t); return; }
    if (t === '{' || t === '}') return;
    if (Object.prototype.hasOwnProperty.call(procs, t)) {
      const body = procs[t];
      for (const bt of body) execOne(bt, depth + 1);
      return;
    }

    switch (t) {
      case 'newpath': cmds = []; break;
      case 'moveto': { const [x, y] = popN(2); const p = tx(x, y); cmds.push({ type: 'M', x: p.x, y: p.y }); cur = p; subStart = p; break; }
      case 'rmoveto': { const [dx, dy] = popN(2); const abs = { x: cur.x + dx * ctm.a + dy * ctm.c, y: cur.y + dx * ctm.b + dy * ctm.d }; cmds.push({ type: 'M', x: abs.x, y: abs.y }); cur = abs; subStart = abs; break; }
      case 'lineto': { const [x, y] = popN(2); const p = tx(x, y); cmds.push({ type: 'L', x: p.x, y: p.y }); cur = p; break; }
      case 'rlineto': { const [dx, dy] = popN(2); const abs = { x: cur.x + dx * ctm.a + dy * ctm.c, y: cur.y + dx * ctm.b + dy * ctm.d }; cmds.push({ type: 'L', x: abs.x, y: abs.y }); cur = abs; break; }
      case 'curveto': { const [x1, y1, x2, y2, x3, y3] = popN(6); const p1 = tx(x1, y1), p2 = tx(x2, y2), p3 = tx(x3, y3); cmds.push({ type: 'C', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p3.x, y: p3.y }); cur = p3; break; }
      case 'rcurveto': {
        const [x1, y1, x2, y2, x3, y3] = popN(6);
        function rel(dx, dy) { return { x: cur.x + dx * ctm.a + dy * ctm.c, y: cur.y + dx * ctm.b + dy * ctm.d }; }
        const p1 = rel(x1, y1), p2 = rel(x1 + x2, y1 + y2), p3 = rel(x1 + x2 + x3, y1 + y2 + y3);
        cmds.push({ type: 'C', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p3.x, y: p3.y }); cur = p3; break;
      }
      case 'closepath': cmds.push({ type: 'Z' }); cur = subStart; break;
      case 'clip': case 'W': if (cmds.length) { lastClipPath = cmds.slice(); lastClipRule = 'nonzero'; } break;
      case 'eoclip': case 'W*': if (cmds.length) { lastClipPath = cmds.slice(); lastClipRule = 'evenodd'; } break;
      case 'shfill': {
        if (lastClipPath && lastClipPath.length) {
          const shape = makePath(lastClipPath.slice());
          const grad = shadingGradients[shfillCounter];
          shape.stroke = 'none';
          shape.strokeWidth = 0;
          shape.fillRule = lastClipRule || 'nonzero';
          shape.name = 'EPS Gradient';
          if (grad && grad.stops.length >= 2 && grad.coordsRaw) {
            const c = grad.coordsRaw;
            const domainSpan = (grad.domain[1] - grad.domain[0]) || 1;
            const stops = grad.stops.map(function (st) {
              return { offset: (st.offset - grad.domain[0]) / domainSpan, color: rgbToHex(st.color[0], st.color[1], st.color[2]) };
            });
            if (grad.type === 'radial' && c.length === 6) {
              const focal = tx(c[0], c[1]), outer = tx(c[3], c[4]);
              const scaleApprox = (Math.hypot(ctm.a, ctm.b) + Math.hypot(ctm.c, ctm.d)) / 2;
              shape.gradient = { type: 'radial', stops: stops, coords: { fx: focal.x, fy: focal.y, cx: outer.x, cy: outer.y, r: Math.abs(c[5]) * scaleApprox } };
            } else if (c.length >= 4) {
              const p0 = tx(c[0], c[1]), p1 = tx(c[2], c[3]);
              shape.gradient = { type: 'linear', stops: stops, coords: { x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y } };
            }
            shape.fill = stops[0].color; // fallback representative color if gradient ever can't render
          }
          if (!shape.gradient) shape.fill = fillColor; // couldn't extract gradient data: fall back to last flat color
          shapes.push(shape);
        }
        shfillCounter++;
        break;
      }
      case 'fill': finalizePath('fill', 'nonzero'); cmds = []; break;
      case 'eofill': finalizePath('fill', 'evenodd'); cmds = []; break;
      case 'stroke': finalizePath('stroke'); cmds = []; break;
      case 'setrgbcolor': { const [r, g, b] = popN(3); const hex = rgbToHex(r, g, b); fillColor = hex; strokeColor = hex; break; }
      case 'setgray': { const [v] = popN(1); const hex = rgbToHex(v, v, v); fillColor = hex; strokeColor = hex; break; }
      case 'setcmykcolor': { const [c, m, y, k] = popN(4); const r = (1 - c) * (1 - k), g = (1 - m) * (1 - k), b = (1 - y) * (1 - k); fillColor = rgbToHex(r, g, b); strokeColor = fillColor; break; }
      case 'sethsbcolor': { const [h, s, v] = popN(3); const hex = hsbToHex(h, s, v); fillColor = hex; strokeColor = hex; break; }
      case 'translate': { const [dx, dy] = popN(2); ctm = { a: ctm.a, b: ctm.b, c: ctm.c, d: ctm.d, e: ctm.e + dx * ctm.a + dy * ctm.c, f: ctm.f + dx * ctm.b + dy * ctm.d }; break; }
      case 'scale': { const [sx, sy] = popN(2); ctm = { a: ctm.a * sx, b: ctm.b * sx, c: ctm.c * sy, d: ctm.d * sy, e: ctm.e, f: ctm.f }; break; }
      case 'concat': {
        const top = stack[stack.length - 1];
        if (top && top.__psArray && top.vals.length === 6) {
          const v = stack.pop().vals;
          concatMatrix(v[0], v[1], v[2], v[3], v[4], v[5]);
        } else {
          const v = popN(6);
          concatMatrix(v[0], v[1], v[2], v[3], v[4], v[5]);
        }
        break;
      }
      case 'cm': { const [a2, b2, c2, d2, e2, f2] = popN(6); concatMatrix(a2, b2, c2, d2, e2, f2); break; }
      case 'array': { const n = popN(1)[0]; stack.push({ __psArray: true, vals: new Array(Math.max(0, n)).fill(0) }); break; }
      case 'astore': {
        const arrObj = stack.pop();
        if (arrObj && arrObj.__psArray) { arrObj.vals = popN(arrObj.vals.length); }
        stack.push(arrObj);
        break;
      }
      case 'dup': { const v = stack[stack.length - 1]; stack.push(v); break; }
      case 'pop': stack.pop(); break;
      case 'exch': { const b = stack.pop(), a = stack.pop(); stack.push(b); stack.push(a); break; }
      case 'neg': { const v = Number(stack.pop()); stack.push(-v); break; }
      case 'add': { const b = Number(stack.pop()), a = Number(stack.pop()); stack.push(a + b); break; }
      case 'sub': { const b = Number(stack.pop()), a = Number(stack.pop()); stack.push(a - b); break; }
      case 'mul': { const b = Number(stack.pop()), a = Number(stack.pop()); stack.push(a * b); break; }
      case 'div': { const b = Number(stack.pop()), a = Number(stack.pop()); stack.push(b !== 0 ? a / b : 0); break; }
      case 'index': { const n = Math.max(0, Math.min(200, Number(stack.pop()) || 0)); stack.push(stack[stack.length - 1 - n]); break; }
      case 'copy': { const n = Math.max(0, Math.min(200, Number(stack.pop()) || 0)); const sub = stack.slice(stack.length - n); stack.push.apply(stack, sub); break; }
      case 'roll': {
        const j = Number(stack.pop()), n = Number(stack.pop());
        if (n > 0 && n <= stack.length) {
          const elements = stack.splice(stack.length - n, n);
          const rolled = elements.map(function (_, i) { const src = (((i - j) % n) + n) % n; return elements[src]; });
          stack.push.apply(stack, rolled);
        }
        break;
      }
      case 're': {
        const [x, y, w, h] = popN(4);
        const p1 = tx(x, y), p2 = tx(x + w, y), p3 = tx(x + w, y + h), p4 = tx(x, y + h);
        cmds.push({ type: 'M', x: p1.x, y: p1.y }, { type: 'L', x: p2.x, y: p2.y }, { type: 'L', x: p3.x, y: p3.y }, { type: 'L', x: p4.x, y: p4.y }, { type: 'Z' });
        cur = p1; subStart = p1; break;
      }
      case 'gsave': gstack.push({ ctm: Object.assign({}, ctm), fillColor, strokeColor }); break;
      case 'grestore': {
        const g = gstack.pop();
        if (g) { ctm = g.ctm; fillColor = g.fillColor; strokeColor = g.strokeColor; }
        break;
      }
      default: break; // unrecognized operator (fonts/images/clip/etc.): ignore and continue
    }
  }

  for (const t of topTokens) { if (truncated) break; execOne(t, 0); }
  return { shapes, bbox, truncated };
}

/* ---------- Bounding box ---------- */
function shapeBBox(s) {
  if (s.type === 'rect') return { x: s.x, y: s.y, w: s.w, h: s.h };
  if (s.type === 'ellipse') return { x: s.cx - s.rx, y: s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 };
  if (s.type === 'line') {
    const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2);
    return { x, y, w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) };
  }
  if (s.type === 'text') {
    const w = Math.max(20, (s.content || '').length * s.fontSize * 0.55);
    return { x: s.x, y: s.y - s.fontSize, w, h: s.fontSize * 1.3 };
  }
  if (s.type === 'path') {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of s.commands) {
      const pts = [];
      if (c.type === 'M' || c.type === 'L') pts.push([c.x, c.y]);
      else if (c.type === 'C') pts.push([c.x1, c.y1], [c.x2, c.y2], [c.x, c.y]);
      for (const p of pts) {
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      }
    }
    if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}
function unionBBox(boxes) {
  const real = boxes.filter(function (b) { return b && b.w >= 0 && b.h >= 0; });
  if (!real.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of real) {
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
function moveShape(s, dx, dy) {
  if (s.type === 'rect') { s.x += dx; s.y += dy; }
  else if (s.type === 'ellipse') { s.cx += dx; s.cy += dy; }
  else if (s.type === 'line') { s.x1 += dx; s.y1 += dy; s.x2 += dx; s.y2 += dy; }
  else if (s.type === 'text') { s.x += dx; s.y += dy; }
  else if (s.type === 'path') {
    for (const c of s.commands) {
      if (c.type === 'Z') continue;
      c.x += dx; c.y += dy;
      if (c.type === 'C') { c.x1 += dx; c.y1 += dy; c.x2 += dx; c.y2 += dy; }
    }
  }
}
function scaleShape(s, box0, box1) {
  const sx = box0.w === 0 ? 1 : box1.w / box0.w;
  const sy = box0.h === 0 ? 1 : box1.h / box0.h;
  function mapX(x) { return box1.x + (x - box0.x) * sx; }
  function mapY(y) { return box1.y + (y - box0.y) * sy; }
  if (s.type === 'rect') { s.x = mapX(s.x); s.y = mapY(s.y); s.w *= sx; s.h *= sy; }
  else if (s.type === 'ellipse') {
    const left = mapX(s.cx - s.rx), right = mapX(s.cx + s.rx);
    const top = mapY(s.cy - s.ry), bot = mapY(s.cy + s.ry);
    s.cx = (left + right) / 2; s.rx = Math.abs(right - left) / 2;
    s.cy = (top + bot) / 2; s.ry = Math.abs(bot - top) / 2;
  } else if (s.type === 'line') { s.x1 = mapX(s.x1); s.y1 = mapY(s.y1); s.x2 = mapX(s.x2); s.y2 = mapY(s.y2); }
  else if (s.type === 'text') { s.x = mapX(s.x); s.y = mapY(s.y); s.fontSize *= (sx + sy) / 2; }
  else if (s.type === 'path') {
    for (const c of s.commands) {
      if (c.type === 'Z') continue;
      c.x = mapX(c.x); c.y = mapY(c.y);
      if (c.type === 'C') { c.x1 = mapX(c.x1); c.y1 = mapY(c.y1); c.x2 = mapX(c.x2); c.y2 = mapY(c.y2); }
    }
  }
}

/* ---------- Matrix helpers for SVG transform flattening ---------- */
function matIdentity() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
function matMul(m1, m2) {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}
function matApply(m, x, y) { return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }; }
function parseTransformAttr(str) {
  let m = matIdentity();
  if (!str) return m;
  const re = /(translate|scale|matrix|rotate)\s*\(([^)]*)\)/g;
  let match;
  while ((match = re.exec(str))) {
    const fn = match[1];
    const args = match[2].trim().split(/[\s,]+/).map(Number);
    let mm = matIdentity();
    if (fn === 'translate') mm = { a: 1, b: 0, c: 0, d: 1, e: args[0] || 0, f: args[1] || 0 };
    else if (fn === 'scale') mm = { a: args[0], b: 0, c: 0, d: args.length > 1 ? args[1] : args[0], e: 0, f: 0 };
    else if (fn === 'matrix') mm = { a: args[0], b: args[1], c: args[2], d: args[3], e: args[4], f: args[5] };
    else if (fn === 'rotate') {
      const rad = (args[0] || 0) * Math.PI / 180;
      const cx = args[1] || 0, cy = args[2] || 0;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      mm = matMul({ a: 1, b: 0, c: 0, d: 1, e: cx, f: cy },
             matMul({ a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 },
                     { a: 1, b: 0, c: 0, d: 1, e: -cx, f: -cy }));
    }
    m = matMul(m, mm);
  }
  return m;
}

/* Walk a parsed SVG document and flatten into our internal shape list.
   Supports rect, circle, ellipse, line, polyline, polygon, path, text and
   <g> nesting with translate/scale/matrix/rotate transforms baked in. */
/* ---------- CSS / <use> / gradient resolution for SVG import ---------- */
function parseStyleAttr(el) {
  const out = {};
  const s = el.getAttribute && el.getAttribute('style');
  if (!s) return out;
  s.split(';').forEach(function (decl) {
    const idx = decl.indexOf(':');
    if (idx < 0) return;
    const k = decl.slice(0, idx).trim(), v = decl.slice(idx + 1).trim();
    if (k && v) out[k] = v;
  });
  return out;
}
function parseCssRules(doc) {
  const rules = [];
  const styleEls = doc.querySelectorAll('style');
  styleEls.forEach(function (styleEl) {
    const css = (styleEl.textContent || '').replace(/\/\*[\s\S]*?\*\//g, '');
    css.split('}').forEach(function (block) {
      const parts = block.split('{');
      if (parts.length < 2) return;
      const selectorText = parts[0].trim();
      if (!selectorText) return;
      const props = {};
      parts[1].split(';').forEach(function (decl) {
        const idx = decl.indexOf(':');
        if (idx < 0) return;
        const k = decl.slice(0, idx).trim(), v = decl.slice(idx + 1).trim();
        if (k && v) props[k] = v;
      });
      selectorText.split(',').forEach(function (sel) { rules.push({ selector: sel.trim(), props: props }); });
    });
  });
  return rules;
}
function selectorMatches(sel, el) {
  if (!sel || /[\s>+~]/.test(sel)) return false; // descendant/combinator selectors unsupported
  let tag = null, id = null; const classes = [];
  const re = /(^[a-zA-Z][\w-]*)|(\.[\w-]+)|(#[\w-]+)/g;
  let m;
  while ((m = re.exec(sel))) { if (m[1]) tag = m[1]; else if (m[2]) classes.push(m[2].slice(1)); else if (m[3]) id = m[3].slice(1); }
  const elTag = el.tagName ? el.tagName.toLowerCase() : '';
  const elId = (el.getAttribute && el.getAttribute('id')) || '';
  const elClasses = ((el.getAttribute && el.getAttribute('class')) || '').split(/\s+/).filter(Boolean);
  if (tag && tag !== elTag) return false;
  if (id && id !== elId) return false;
  for (const c of classes) if (elClasses.indexOf(c) === -1) return false;
  if (!tag && !id && !classes.length) return false;
  return true;
}
function cssStyleFor(el, rules) {
  const out = {};
  rules.forEach(function (rule) { if (selectorMatches(rule.selector, el)) Object.assign(out, rule.props); });
  return out;
}
function resolvedStyle(el, rules, inherited) {
  const css = cssStyleFor(el, rules);
  const inline = parseStyleAttr(el);
  function pick(prop) {
    if (inline[prop] !== undefined) return inline[prop];
    if (css[prop] !== undefined) return css[prop];
    const attr = el.getAttribute && el.getAttribute(prop);
    if (attr) return attr;
    return undefined;
  }
  const fillRaw = pick('fill'), strokeRaw = pick('stroke'), swRaw = pick('stroke-width'), opRaw = pick('opacity'), frRaw = pick('fill-rule');
  return {
    fill: fillRaw !== undefined ? fillRaw : inherited.fill,
    stroke: strokeRaw !== undefined ? strokeRaw : inherited.stroke,
    strokeWidth: swRaw !== undefined ? parseFloat(swRaw) : inherited.strokeWidth,
    opacity: opRaw !== undefined ? parseFloat(opRaw) : inherited.opacity,
    fillRule: frRaw !== undefined ? frRaw : (inherited.fillRule || 'nonzero'),
  };
}
function colorToRgb(c) {
  if (!c) return null;
  c = c.trim();
  if (c[0] === '#') {
    let hex = c.slice(1);
    if (hex.length === 3) hex = hex.split('').map(function (ch) { return ch + ch; }).join('');
    const num = parseInt(hex, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) { const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2] }; }
  const named = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', gray: '#808080', grey: '#808080' };
  if (named[c]) return colorToRgb(named[c]);
  return null;
}
function rgbToHexStr(r, g, b) { function h(v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); } return '#' + h(r) + h(g) + h(b); }
function resolveGradientColor(id, defsMap, depth) {
  depth = depth || 0;
  if (depth > 5) return null;
  const g = defsMap[id];
  if (!g) return null;
  const stops = Array.from(g.children || []).filter(function (c) { return c.tagName && c.tagName.toLowerCase() === 'stop'; });
  if (!stops.length) {
    const href = (g.getAttribute && (g.getAttribute('href') || g.getAttribute('xlink:href'))) || '';
    if (href.indexOf('#') === 0) return resolveGradientColor(href.slice(1), defsMap, depth + 1);
    return null;
  }
  let r = 0, gg = 0, b = 0, n = 0;
  stops.forEach(function (s) {
    let col = s.getAttribute('stop-color');
    const style = parseStyleAttr(s);
    if (style['stop-color']) col = style['stop-color'];
    const rgb = colorToRgb(col);
    if (rgb) { r += rgb.r; gg += rgb.g; b += rgb.b; n++; }
  });
  if (!n) return null;
  return rgbToHexStr(r / n, gg / n, b / n);
}
function resolvePaint(val, defsMap) {
  if (!val) return val;
  const m = val.match(/^url\(#([^)]+)\)/);
  if (m) { const c = resolveGradientColor(m[1], defsMap); return c || '#888888'; }
  return val;
}

const CONTAINER_TAGS = ['g', 'svg', 'symbol', 'a'];
const SKIP_TAGS = ['defs', 'clippath', 'mask', 'style', 'metadata', 'title', 'desc', 'filter', 'pattern', 'marker', 'lineargradient', 'radialgradient'];

/* Walk a parsed SVG document and flatten into our internal shape list.
   Supports rect, circle, ellipse, line, polyline, polygon, path, text;
   <g>/<svg>/<symbol>/<a> nesting with translate/scale/matrix/rotate;
   CSS classes and inline style= (cascading over presentation attributes);
   <use>/<symbol> reference resolution (including legacy xlink:href); and
   gradient fills/strokes, approximated as a flat average of their stops
   since this editor's shape model doesn't support gradients natively. */
function importSVGDocument(doc) {
  const out = [];
  const root = doc.documentElement;
  const rules = parseCssRules(doc);
  const defsMap = {};
  Array.from(doc.querySelectorAll('*')).forEach(function (el) {
    const id = el.getAttribute && el.getAttribute('id');
    if (id) defsMap[id] = el;
  });
  let gradientUsedCount = 0;

  function walk(el, m, inherited, visited) {
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (SKIP_TAGS.indexOf(tag) !== -1) return;
    const t = el.getAttribute && el.getAttribute('transform');
    const m2 = t ? matMul(m, parseTransformAttr(t)) : m;
    const style = resolvedStyle(el, rules, inherited);

    if (tag === 'use') {
      const href = (el.getAttribute('href') || el.getAttribute('xlink:href') || '');
      if (href.indexOf('#') === 0) {
        const targetId = href.slice(1);
        if (defsMap[targetId] && !visited.has(targetId)) {
          visited.add(targetId);
          const ux = parseFloat(el.getAttribute('x') || 0), uy = parseFloat(el.getAttribute('y') || 0);
          const useMatrix = matMul(m2, { a: 1, b: 0, c: 0, d: 1, e: ux, f: uy });
          walk(defsMap[targetId], useMatrix, style, visited);
          visited.delete(targetId);
        }
      }
      return;
    }

    if (CONTAINER_TAGS.indexOf(tag) !== -1) {
      Array.from(el.children || []).forEach(function (child) { walk(child, m2, style, visited); });
      return;
    }

    const fill = resolvePaint(style.fill, defsMap) || '#5eead4';
    const stroke = resolvePaint(style.stroke, defsMap) || 'none';
    if (/^url\(/.test(style.fill || '') || /^url\(/.test(style.stroke || '')) gradientUsedCount++;
    const sw = isFinite(style.strokeWidth) ? style.strokeWidth : 2;
    const op = isFinite(style.opacity) ? style.opacity : 1;
    function apply(shape) { shape.fill = fill === 'none' ? 'none' : fill; shape.stroke = stroke; shape.strokeWidth = sw; shape.opacity = op; if (shape.type === 'path') shape.fillRule = style.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'; return shape; }

    if (tag === 'rect') {
      const x = parseFloat(el.getAttribute('x') || 0), y = parseFloat(el.getAttribute('y') || 0);
      const w = parseFloat(el.getAttribute('width') || 0), h = parseFloat(el.getAttribute('height') || 0);
      if (m2.b === 0 && m2.c === 0) { const p = matApply(m2, x, y); out.push(apply(makeRect(p.x, p.y, w * m2.a, h * m2.d))); }
      else {
        const pts = [matApply(m2, x, y), matApply(m2, x + w, y), matApply(m2, x + w, y + h), matApply(m2, x, y + h)];
        out.push(apply(makePath([{ type: 'M', x: pts[0].x, y: pts[0].y }, { type: 'L', x: pts[1].x, y: pts[1].y }, { type: 'L', x: pts[2].x, y: pts[2].y }, { type: 'L', x: pts[3].x, y: pts[3].y }, { type: 'Z' }])));
      }
    } else if (tag === 'circle') {
      const cx = parseFloat(el.getAttribute('cx') || 0), cy = parseFloat(el.getAttribute('cy') || 0), r = parseFloat(el.getAttribute('r') || 0);
      const p = matApply(m2, cx, cy);
      out.push(apply(makeEllipse(p.x, p.y, r * m2.a, r * m2.d)));
    } else if (tag === 'ellipse') {
      const cx = parseFloat(el.getAttribute('cx') || 0), cy = parseFloat(el.getAttribute('cy') || 0);
      const rx = parseFloat(el.getAttribute('rx') || 0), ry = parseFloat(el.getAttribute('ry') || 0);
      const p = matApply(m2, cx, cy);
      out.push(apply(makeEllipse(p.x, p.y, rx * m2.a, ry * m2.d)));
    } else if (tag === 'line') {
      const p1 = matApply(m2, parseFloat(el.getAttribute('x1') || 0), parseFloat(el.getAttribute('y1') || 0));
      const p2 = matApply(m2, parseFloat(el.getAttribute('x2') || 0), parseFloat(el.getAttribute('y2') || 0));
      out.push(apply(makeLine(p1.x, p1.y, p2.x, p2.y)));
    } else if (tag === 'polyline' || tag === 'polygon') {
      const raw = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
      const cmds = [];
      for (let i = 0; i < raw.length - 1; i += 2) { const p = matApply(m2, raw[i], raw[i + 1]); cmds.push({ type: i === 0 ? 'M' : 'L', x: p.x, y: p.y }); }
      if (tag === 'polygon') cmds.push({ type: 'Z' });
      out.push(apply(makePath(cmds)));
    } else if (tag === 'path') {
      const raw = parsePathD(el.getAttribute('d') || '');
      const cmds = raw.map(function (c) {
        if (c.type === 'Z') return c;
        if (c.type === 'C') { const p1 = matApply(m2, c.x1, c.y1), p2 = matApply(m2, c.x2, c.y2), p = matApply(m2, c.x, c.y); return { type: 'C', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p.x, y: p.y }; }
        const p = matApply(m2, c.x, c.y); return { type: c.type, x: p.x, y: p.y };
      });
      out.push(apply(makePath(cmds)));
    } else if (tag === 'text') {
      const x = parseFloat(el.getAttribute('x') || 0), y = parseFloat(el.getAttribute('y') || 0);
      const p = matApply(m2, x, y);
      const shape = makeText(p.x, p.y, el.textContent || 'Text');
      shape.fontSize = parseFloat(el.getAttribute('font-size') || 24) * m2.a;
      shape.fill = fill === 'none' ? '#e8eaed' : fill;
      shape.opacity = op;
      out.push(shape);
    }
  }

  walk(root, matIdentity(), { fill: undefined, stroke: undefined, strokeWidth: undefined, opacity: undefined, fillRule: 'nonzero' }, new Set());
  return { shapes: out, gradientApproximated: gradientUsedCount > 0 };
}



/* ================= DOM / UI layer ================= */
const El = {};
let pointerState = null;
let toastTimer = null;

function $(id) { return document.getElementById(id); }

function init() {
  El.svg = $('canvasSvg');
  El.shapesLayer = $('shapesLayer');
  El.overlayLayer = $('overlayLayer');
  El.gridRect = $('gridRect');
  El.gradientDefs = $('gradientDefs');
  El.rulerTop = $('rulerTop');
  El.rulerLeft = $('rulerLeft');
  El.layersList = $('layersList');
  El.propsBody = $('propsBody');
  El.fileInput = $('fileInput');
  El.zoomLabel = $('zoomLabel');
  El.statusText = $('statusText');
  El.toast = $('toast');
  El.textEditor = $('textEditor');
  El.canvasWrap = $('canvasWrap');
  El.emptyHint = $('emptyHint');

  seedDemoContent();
  pushHistory();
  fitView();
  render();
  renderLayers();
  renderProps();

  wireToolbar();
  wireTopbar();
  wireCanvasPointerEvents();
  wireKeyboard();
  wireImport();
}

function seedDemoContent() {
  const r = makeRect(120, 320, 160, 110);
  r.fill = '#ff8a3d'; r.stroke = '#0d0f12'; r.strokeWidth = 3; r.rx = 10; r.name = 'Amber Card';
  const e = makeEllipse(430, 200, 70, 70);
  e.fill = '#38e1c6'; e.stroke = '#0d0f12'; e.strokeWidth = 3; e.name = 'Teal Circle';
  const star = makePath([
    { type: 'M', x: 620, y: 120 }, { type: 'L', x: 645, y: 190 }, { type: 'L', x: 720, y: 190 },
    { type: 'L', x: 660, y: 232 }, { type: 'L', x: 682, y: 302 }, { type: 'L', x: 620, y: 260 },
    { type: 'L', x: 558, y: 302 }, { type: 'L', x: 580, y: 232 }, { type: 'L', x: 520, y: 190 },
    { type: 'L', x: 595, y: 190 }, { type: 'Z' },
  ]);
  star.fill = '#e8eaed'; star.stroke = '#0d0f12'; star.strokeWidth = 3; star.name = 'Node Star';
  const t = makeText(120, 220, 'Vectorial');
  t.fontSize = 40; t.fill = '#e8eaed'; t.name = 'Title Text';
  const curve = makePath([
    { type: 'M', x: 380, y: 420 },
    { type: 'C', x1: 460, y1: 350, x2: 560, y2: 480, x: 660, y: 400 },
  ]);
  curve.fill = 'none'; curve.stroke = '#5eead4'; curve.strokeWidth = 4; curve.name = 'Curve';
  state.shapes.push(r, e, star, t, curve);
}

/* ---------- Coordinate transforms ---------- */
function screenToSVG(clientX, clientY) {
  const pt = El.svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  const ctm = El.svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const loc = pt.matrixTransform(ctm.inverse());
  return { x: loc.x, y: loc.y };
}
function svgToScreen(x, y) {
  const pt = El.svg.createSVGPoint();
  pt.x = x; pt.y = y;
  const ctm = El.svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const loc = pt.matrixTransform(ctm);
  return { x: loc.x, y: loc.y };
}

function updateSvgViewBox() {
  const vb = state.viewBox;
  El.svg.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h);
  El.gridRect.setAttribute('x', vb.x); El.gridRect.setAttribute('y', vb.y);
  El.gridRect.setAttribute('width', vb.w); El.gridRect.setAttribute('height', vb.h);
  El.zoomLabel.textContent = Math.round(900 / vb.w * 100) + '%';
  renderRulers();
}

function fitView() {
  const box = unionBBox(state.shapes.map(shapeBBox));
  if (box.w === 0 && box.h === 0) { state.viewBox = { x: 0, y: 0, w: 900, h: 600 }; return; }
  const pad = Math.max(box.w, box.h) * 0.12 + 20;
  state.viewBox = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
}

function zoomBy(factor, centerClient) {
  const before = centerClient ? screenToSVG(centerClient.x, centerClient.y) : { x: state.viewBox.x + state.viewBox.w / 2, y: state.viewBox.y + state.viewBox.h / 2 };
  const vb = state.viewBox;
  const newW = Math.max(20, Math.min(20000, vb.w / factor));
  const newH = newW * (vb.h / vb.w);
  vb.x = before.x - (before.x - vb.x) * (newW / vb.w);
  vb.y = before.y - (before.y - vb.y) * (newH / vb.h);
  vb.w = newW; vb.h = newH;
  updateSvgViewBox();
}

/* ---------- Rulers ---------- */
function niceStep(pxPerUnit, targetPx) {
  const raw = targetPx / pxPerUnit;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let step;
  if (norm < 2) step = 1; else if (norm < 5) step = 2; else step = 5;
  return step * mag;
}
function renderRulers() {
  if (!El.rulerTop) return;
  const vb = state.viewBox;
  const rectW = El.canvasWrap.clientWidth, rectH = El.canvasWrap.clientHeight;
  const pxPerUnitX = rectW / vb.w, pxPerUnitY = rectH / vb.h;
  const stepX = niceStep(pxPerUnitX, 70);
  const stepY = niceStep(pxPerUnitY, 70);
  let svgTop = '<svg width="100%" height="20" xmlns="http://www.w3.org/2000/svg">';
  let x0 = Math.floor(vb.x / stepX) * stepX;
  for (let v = x0; v < vb.x + vb.w; v += stepX) {
    const px = (v - vb.x) * pxPerUnitX;
    svgTop += '<line x1="' + px + '" y1="12" x2="' + px + '" y2="20" stroke="#4a5158" stroke-width="1"/>';
    svgTop += '<text x="' + (px + 3) + '" y="11" fill="#8b939c" font-size="9" font-family="JetBrains Mono, monospace">' + Math.round(v) + '</text>';
  }
  svgTop += '</svg>';
  El.rulerTop.innerHTML = svgTop;

  let svgLeft = '<svg width="20" height="100%" xmlns="http://www.w3.org/2000/svg">';
  let y0 = Math.floor(vb.y / stepY) * stepY;
  for (let v = y0; v < vb.y + vb.h; v += stepY) {
    const py = (v - vb.y) * pxPerUnitY;
    svgLeft += '<line x1="12" y1="' + py + '" x2="20" y2="' + py + '" stroke="#4a5158" stroke-width="1"/>';
    svgLeft += '<text x="2" y="' + (py + 9) + '" fill="#8b939c" font-size="9" font-family="JetBrains Mono, monospace" transform="rotate(0)">' + Math.round(v) + '</text>';
  }
  svgLeft += '</svg>';
  El.rulerLeft.innerHTML = svgLeft;
}

/* ---------- Rendering shapes ---------- */
function shapeToDOM(s) {
  let el;
  if (s.type === 'rect') {
    el = document.createElementNS(SVG_NS, 'rect');
    el.setAttribute('x', s.x); el.setAttribute('y', s.y);
    el.setAttribute('width', Math.max(0, s.w)); el.setAttribute('height', Math.max(0, s.h));
    if (s.rx) el.setAttribute('rx', s.rx);
  } else if (s.type === 'ellipse') {
    el = document.createElementNS(SVG_NS, 'ellipse');
    el.setAttribute('cx', s.cx); el.setAttribute('cy', s.cy);
    el.setAttribute('rx', Math.max(0, s.rx)); el.setAttribute('ry', Math.max(0, s.ry));
  } else if (s.type === 'line') {
    el = document.createElementNS(SVG_NS, 'line');
    el.setAttribute('x1', s.x1); el.setAttribute('y1', s.y1);
    el.setAttribute('x2', s.x2); el.setAttribute('y2', s.y2);
  } else if (s.type === 'text') {
    // Wrap in a group with an invisible full-bbox hit rect: glyph-only hit
    // testing makes clicking/double-clicking text unreliable, especially
    // for short or sparse strings.
    const g = document.createElementNS(SVG_NS, 'g');
    const b = shapeBBox(s);
    const hit = document.createElementNS(SVG_NS, 'rect');
    hit.setAttribute('x', b.x); hit.setAttribute('y', b.y);
    hit.setAttribute('width', Math.max(4, b.w)); hit.setAttribute('height', Math.max(4, b.h));
    hit.setAttribute('fill', 'transparent');
    hit.setAttribute('data-id', s.id);
    hit.setAttribute('pointer-events', s.locked ? 'none' : 'all');
    hit.style.cursor = s.locked ? 'default' : 'pointer';
    const txt = document.createElementNS(SVG_NS, 'text');
    txt.setAttribute('x', s.x); txt.setAttribute('y', s.y);
    txt.setAttribute('font-size', s.fontSize);
    txt.setAttribute('font-family', s.fontFamily || 'Space Grotesk, sans-serif');
    txt.setAttribute('fill', s.gradient ? 'url(#' + gradientIdFor(s.id) + ')' : (s.fill == null ? 'none' : s.fill));
    txt.setAttribute('stroke', s.stroke == null ? 'none' : s.stroke);
    txt.setAttribute('stroke-width', s.strokeWidth || 0);
    txt.setAttribute('opacity', s.opacity == null ? 1 : s.opacity);
    txt.setAttribute('pointer-events', 'none');
    txt.textContent = s.content;
    g.setAttribute('data-id', s.id);
    g.appendChild(hit); g.appendChild(txt);
    return g;
  } else if (s.type === 'path') {
    el = document.createElementNS(SVG_NS, 'path');
    el.setAttribute('d', commandsToD(s.commands));
    if (s.fillRule === 'evenodd') el.setAttribute('fill-rule', 'evenodd');
  }
  el.setAttribute('data-id', s.id);
  el.setAttribute('fill', s.gradient ? 'url(#' + gradientIdFor(s.id) + ')' : (s.fill == null ? 'none' : s.fill));
  el.setAttribute('stroke', s.stroke == null ? 'none' : s.stroke);
  el.setAttribute('stroke-width', s.strokeWidth || 0);
  el.setAttribute('opacity', s.opacity == null ? 1 : s.opacity);
  el.setAttribute('pointer-events', s.locked ? 'none' : 'all');
  el.style.cursor = s.locked ? 'default' : 'pointer';
  return el;
}

function gradientIdFor(shapeId) { return 'grad_' + shapeId; }
function buildGradientDefs(container, shapes) {
  container.innerHTML = '';
  for (const s of shapes) {
    if (!s.gradient || !s.gradient.stops || !s.gradient.stops.length) continue;
    const g = s.gradient;
    let el;
    if (g.type === 'radial') {
      el = document.createElementNS(SVG_NS, 'radialGradient');
      el.setAttribute('gradientUnits', 'userSpaceOnUse');
      el.setAttribute('cx', g.coords.cx); el.setAttribute('cy', g.coords.cy); el.setAttribute('r', Math.max(0.01, g.coords.r));
      if (g.coords.fx != null) el.setAttribute('fx', g.coords.fx);
      if (g.coords.fy != null) el.setAttribute('fy', g.coords.fy);
    } else {
      el = document.createElementNS(SVG_NS, 'linearGradient');
      el.setAttribute('gradientUnits', 'userSpaceOnUse');
      el.setAttribute('x1', g.coords.x1); el.setAttribute('y1', g.coords.y1);
      el.setAttribute('x2', g.coords.x2); el.setAttribute('y2', g.coords.y2);
    }
    el.setAttribute('id', gradientIdFor(s.id));
    g.stops.forEach(function (stop) {
      const stopEl = document.createElementNS(SVG_NS, 'stop');
      stopEl.setAttribute('offset', Math.max(0, Math.min(1, stop.offset)));
      stopEl.setAttribute('stop-color', stop.color);
      if (stop.opacity != null && stop.opacity < 1) stopEl.setAttribute('stop-opacity', stop.opacity);
      el.appendChild(stopEl);
    });
    container.appendChild(el);
  }
}

function render() {
  El.shapesLayer.innerHTML = '';
  buildGradientDefs(El.gradientDefs, state.shapes);
  for (const s of state.shapes) {
    if (s.visible === false) continue;
    El.shapesLayer.appendChild(shapeToDOM(s));
  }
  El.emptyHint.style.display = state.shapes.length === 0 ? 'block' : 'none';
  renderOverlay();
  updateSvgViewBox();
}

function shapeById(id) { return state.shapes.find(function (s) { return s.id === id; }); }
function selectedShapes() { return state.selectedIds.map(shapeById).filter(Boolean); }

const HANDLE_NAMES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
function handlePos(box, name) {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  switch (name) {
    case 'nw': return { x: box.x, y: box.y };
    case 'n': return { x: cx, y: box.y };
    case 'ne': return { x: box.x + box.w, y: box.y };
    case 'e': return { x: box.x + box.w, y: cy };
    case 'se': return { x: box.x + box.w, y: box.y + box.h };
    case 's': return { x: cx, y: box.y + box.h };
    case 'sw': return { x: box.x, y: box.y + box.h };
    case 'w': return { x: box.x, y: cy };
  }
}

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

function renderOverlay() {
  El.overlayLayer.innerHTML = '';
  const scale = state.viewBox.w / (El.canvasWrap.clientWidth || 900);

  if (state.tool === 'node' && state.nodeEditShapeId) {
    renderNodeOverlay(shapeById(state.nodeEditShapeId), scale);
  } else {
    const sel = selectedShapes();
    for (const s of sel) {
      const b = shapeBBox(s);
      El.overlayLayer.appendChild(svgEl('rect', {
        x: b.x - 2, y: b.y - 2, width: b.w + 4, height: b.h + 4, fill: 'none',
        stroke: '#38e1c6', 'stroke-width': 1.5 * scale, 'stroke-dasharray': (4 * scale) + ',' + (3 * scale), 'pointer-events': 'none',
      }));
    }
    if (sel.length === 1 && state.tool === 'select' && !sel[0].locked) {
      const b = shapeBBox(sel[0]);
      for (const name of HANDLE_NAMES) {
        const p = handlePos(b, name);
        const hs = 5 * scale;
        El.overlayLayer.appendChild(svgEl('rect', {
          x: p.x - hs, y: p.y - hs, width: hs * 2, height: hs * 2, fill: '#ff8a3d', stroke: '#0d0f12',
          'stroke-width': scale, 'data-handle': name, style: 'cursor:' + name + '-resize',
        }));
      }
    }
  }

  if (pointerState && pointerState.type === 'marquee') {
    const r = pointerState.rect;
    El.overlayLayer.appendChild(svgEl('rect', {
      x: r.x, y: r.y, width: r.w, height: r.h, fill: 'rgba(56,225,198,0.12)', stroke: '#38e1c6', 'stroke-width': scale, 'pointer-events': 'none',
    }));
  }

  if (state.draft) renderPenDraft(scale);
}

/* ---------- Node edit overlay ---------- */
function renderNodeOverlay(shape, scale) {
  if (!shape) return;
  const cmds = shape.commands;
  const hitPath = svgEl('path', { d: commandsToD(cmds), fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(10 * scale, 8), 'data-node-hit': '1' });
  El.overlayLayer.appendChild(hitPath);

  let prev = null, subStart = null;
  for (let i = 0; i < cmds.length; i++) {
    const c = cmds[i];
    if (c.type === 'Z') { prev = subStart; continue; }
    if (c.type === 'M') { subStart = { x: c.x, y: c.y }; }
    if (c.type === 'C' && prev) {
      El.overlayLayer.appendChild(svgEl('line', { x1: prev.x, y1: prev.y, x2: c.x1, y2: c.y1, stroke: '#ff8a3d', 'stroke-width': scale, 'stroke-dasharray': (3 * scale) + ',' + (2 * scale) }));
      El.overlayLayer.appendChild(svgEl('line', { x1: c.x, y1: c.y, x2: c.x2, y2: c.y2, stroke: '#ff8a3d', 'stroke-width': scale, 'stroke-dasharray': (3 * scale) + ',' + (2 * scale) }));
      const r1 = 3.5 * scale;
      El.overlayLayer.appendChild(svgEl('circle', { cx: c.x1, cy: c.y1, r: r1, fill: '#ff8a3d', stroke: '#0d0f12', 'stroke-width': scale, 'data-cmd': i, 'data-part': 'c1', style: 'cursor:pointer' }));
      El.overlayLayer.appendChild(svgEl('circle', { cx: c.x2, cy: c.y2, r: r1, fill: '#ff8a3d', stroke: '#0d0f12', 'stroke-width': scale, 'data-cmd': i, 'data-part': 'c2', style: 'cursor:pointer' }));
    }
    const isSel = state.nodeSel && state.nodeSel.cmdIndex === i && state.nodeSel.part === 'anchor';
    const r = (isSel ? 5.5 : 4.5) * scale;
    El.overlayLayer.appendChild(svgEl('rect', {
      x: c.x - r, y: c.y - r, width: r * 2, height: r * 2,
      fill: isSel ? '#ff8a3d' : '#38e1c6', stroke: '#0d0f12', 'stroke-width': scale,
      'data-cmd': i, 'data-part': 'anchor', style: 'cursor:pointer',
    }));
    prev = { x: c.x, y: c.y };
  }
}

function renderPenDraft(scale) {
  const pts = state.draft.points;
  if (!pts.length) return;
  let d = '';
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) { d += 'M ' + pts[0].x + ' ' + pts[0].y + ' '; continue; }
    const prev = pts[i - 1], curr = pts[i];
    const c1 = prev.handleOut ? { x: prev.x + prev.handleOut.dx, y: prev.y + prev.handleOut.dy } : { x: prev.x, y: prev.y };
    const c2 = curr.handleOut ? { x: curr.x - curr.handleOut.dx, y: curr.y - curr.handleOut.dy } : { x: curr.x, y: curr.y };
    if (prev.handleOut || curr.handleOut) d += 'C ' + c1.x + ' ' + c1.y + ' ' + c2.x + ' ' + c2.y + ' ' + curr.x + ' ' + curr.y + ' ';
    else d += 'L ' + curr.x + ' ' + curr.y + ' ';
  }
  if (state.draft.hoverPt) {
    const last = pts[pts.length - 1];
    d += 'L ' + state.draft.hoverPt.x + ' ' + state.draft.hoverPt.y + ' ';
  }
  El.overlayLayer.appendChild(svgEl('path', { d: d, fill: 'none', stroke: '#5eead4', 'stroke-width': 2 * scale, 'stroke-dasharray': (5 * scale) + ',' + (3 * scale), 'pointer-events': 'none' }));
  for (const p of pts) {
    El.overlayLayer.appendChild(svgEl('circle', { cx: p.x, cy: p.y, r: 4 * scale, fill: '#5eead4', stroke: '#0d0f12', 'stroke-width': scale, 'pointer-events': 'none' }));
    if (p.handleOut) {
      El.overlayLayer.appendChild(svgEl('line', { x1: p.x, y1: p.y, x2: p.x + p.handleOut.dx, y2: p.y + p.handleOut.dy, stroke: '#ff8a3d', 'stroke-width': scale, 'pointer-events': 'none' }));
      El.overlayLayer.appendChild(svgEl('circle', { cx: p.x + p.handleOut.dx, cy: p.y + p.handleOut.dy, r: 3 * scale, fill: '#ff8a3d', 'pointer-events': 'none' }));
    }
  }
}

function finalizePenDraft(closed) {
  const pts = state.draft.points;
  if (pts.length < 2) { state.draft = null; render(); return; }
  const cmds = [{ type: 'M', x: pts[0].x, y: pts[0].y }];
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1], curr = pts[i];
    if (prev.handleOut || curr.handleOut) {
      const c1 = prev.handleOut ? { x: prev.x + prev.handleOut.dx, y: prev.y + prev.handleOut.dy } : { x: prev.x, y: prev.y };
      const c2 = curr.handleOut ? { x: curr.x - curr.handleOut.dx, y: curr.y - curr.handleOut.dy } : { x: curr.x, y: curr.y };
      cmds.push({ type: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: curr.x, y: curr.y });
    } else {
      cmds.push({ type: 'L', x: curr.x, y: curr.y });
    }
  }
  if (closed) {
    const first = pts[0], last = pts[pts.length - 1];
    if (last.handleOut) {
      const c1 = { x: last.x + last.handleOut.dx, y: last.y + last.handleOut.dy };
      cmds.push({ type: 'C', x1: c1.x, y1: c1.y, x2: first.x, y2: first.y, x: first.x, y: first.y });
    }
    cmds.push({ type: 'Z' });
  }
  const shape = makePath(cmds);
  shape.fill = closed ? '#5eead4' : 'none';
  shape.stroke = '#0d0f12'; shape.strokeWidth = 2.5; shape.name = 'Path';
  state.shapes.push(shape);
  state.selectedIds = [shape.id];
  state.draft = null;
  state.tool = 'select';
  pushHistory();
  render(); renderLayers(); renderProps(); syncToolbarActive();
}

/* ---------- Hit testing & segment ops for node edit ---------- */
function closestPointOnShape(shape, pt) {
  const cmds = shape.commands;
  let best = null;
  let prev = null, subStart = null;
  for (let i = 0; i < cmds.length; i++) {
    const c = cmds[i];
    if (c.type === 'M') { prev = { x: c.x, y: c.y }; subStart = prev; continue; }
    if (c.type === 'Z') { if (prev && subStart) { const d = distToSeg(prev, subStart, pt); if (!best || d.dist < best.dist) best = { cmdIndex: i, t: d.t, dist: d.dist, synthClose: true }; } prev = subStart; continue; }
    const p0 = prev;
    const steps = c.type === 'C' ? 24 : 1;
    const pts = sampleSegment(p0, c, steps);
    for (let k = 0; k < pts.length - 1; k++) {
      const d = distToSeg(pts[k], pts[k + 1], pt);
      const tGlobal = (k + d.t) / steps;
      if (!best || d.dist < best.dist) best = { cmdIndex: i, t: tGlobal, dist: d.dist };
    }
    prev = { x: c.x, y: c.y };
  }
  return best;
}
function sampleSegment(p0, cmd, steps) {
  const pts = [];
  if (cmd.type === 'L') {
    for (let i = 0; i <= steps; i++) { const t = i / steps; pts.push({ x: p0.x + (cmd.x - p0.x) * t, y: p0.y + (cmd.y - p0.y) * t }); }
  } else {
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, mt = 1 - t;
      const x = mt * mt * mt * p0.x + 3 * mt * mt * t * cmd.x1 + 3 * mt * t * t * cmd.x2 + t * t * t * cmd.x;
      const y = mt * mt * mt * p0.y + 3 * mt * mt * t * cmd.y1 + 3 * mt * t * t * cmd.y2 + t * t * t * cmd.y;
      pts.push({ x, y });
    }
  }
  return pts;
}
function distToSeg(a, b, p) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + dx * t, y = a.y + dy * t;
  return { dist: Math.hypot(p.x - x, p.y - y), t };
}

function insertNodeAt(shape, hit) {
  const cmds = shape.commands;
  const cmd = cmds[hit.cmdIndex];
  let p0;
  if (hit.cmdIndex === 0) return;
  const prevCmd = cmds[hit.cmdIndex - 1];
  p0 = { x: prevCmd.x !== undefined ? prevCmd.x : 0, y: prevCmd.y !== undefined ? prevCmd.y : 0 };
  if (cmd.type === 'Z') return; // skip inserting on synthetic close for simplicity
  if (cmd.type === 'L') {
    const nx = p0.x + (cmd.x - p0.x) * hit.t, ny = p0.y + (cmd.y - p0.y) * hit.t;
    cmds.splice(hit.cmdIndex, 0, { type: 'L', x: nx, y: ny });
  } else if (cmd.type === 'C') {
    const parts = splitCubic(p0, cmd, hit.t);
    cmds.splice(hit.cmdIndex, 1, parts[0], parts[1]);
  }
}

/* ---------- Pointer interaction on canvas ---------- */
function topShapeAt(clientX, clientY) {
  const els = document.elementsFromPoint(clientX, clientY);
  for (const el of els) {
    const id = el.getAttribute && el.getAttribute('data-id');
    if (id) return id;
  }
  return null;
}

function wireCanvasPointerEvents() {
  El.svg.addEventListener('pointerdown', onCanvasPointerDown);
  window.addEventListener('pointermove', onCanvasPointerMove);
  window.addEventListener('pointerup', onCanvasPointerUp);
  El.svg.addEventListener('wheel', function (e) {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, { x: e.clientX, y: e.clientY });
  }, { passive: false });
  El.svg.addEventListener('dblclick', onCanvasDblClick);
}

function onCanvasPointerDown(e) {
  if (e.button === 1 || panMode) {
    e.preventDefault();
    pointerState = { type: 'pan', startClient: { x: e.clientX, y: e.clientY }, startVB: Object.assign({}, state.viewBox) };
    return;
  }
  const p = screenToSVG(e.clientX, e.clientY);
  const targetId = e.target.getAttribute && e.target.getAttribute('data-id');
  const handle = e.target.getAttribute && e.target.getAttribute('data-handle');
  const nodeCmd = e.target.getAttribute && e.target.getAttribute('data-cmd');

  if (state.tool === 'node') {
    if (nodeCmd !== null && nodeCmd !== undefined) {
      const idx = parseInt(nodeCmd, 10);
      const part = e.target.getAttribute('data-part');
      state.nodeSel = { cmdIndex: idx, part: part };
      pointerState = { type: 'nodeDrag', start: p };
      renderOverlay();
      return;
    }
    if (e.target.getAttribute && e.target.getAttribute('data-node-hit')) {
      const shape = shapeById(state.nodeEditShapeId);
      const hit = closestPointOnShape(shape, p);
      if (hit && hit.dist < 12 * (state.viewBox.w / El.canvasWrap.clientWidth)) {
        insertNodeAt(shape, hit);
        pushHistory(); render(); renderOverlay();
      }
      return;
    }
    if (targetId && targetId !== state.nodeEditShapeId) {
      const s = shapeById(targetId);
      if (s && s.type === 'path') { state.nodeEditShapeId = targetId; state.selectedIds = [targetId]; render(); renderProps(); }
    }
    return;
  }

  if (handle) {
    const s = selectedShapes()[0];
    pointerState = { type: 'resize', handle: handle, orig: JSON.parse(JSON.stringify(s)), origBox: shapeBBox(s), shapeId: s.id };
    return;
  }

  if (state.tool === 'select') {
    if (targetId) {
      if (e.shiftKey) {
        const i = state.selectedIds.indexOf(targetId);
        if (i >= 0) state.selectedIds.splice(i, 1); else state.selectedIds.push(targetId);
      } else if (!state.selectedIds.includes(targetId)) {
        state.selectedIds = [targetId];
      }
      renderOverlay(); renderProps(); renderLayers();
      pointerState = { type: 'move', start: p, orig: selectedShapes().map(function (s) { return JSON.parse(JSON.stringify(s)); }) };
    } else {
      pointerState = { type: 'marquee', start: p, rect: { x: p.x, y: p.y, w: 0, h: 0 } };
    }
    return;
  }

  if (['rect', 'ellipse', 'line'].includes(state.tool)) {
    let shape;
    if (state.tool === 'rect') shape = makeRect(p.x, p.y, 0, 0);
    else if (state.tool === 'ellipse') shape = makeEllipse(p.x, p.y, 0, 0);
    else shape = makeLine(p.x, p.y, p.x, p.y);
    shape.fill = state.tool === 'line' ? 'none' : '#5eead4';
    shape.stroke = '#0d0f12'; shape.strokeWidth = 2.5;
    state.shapes.push(shape);
    pointerState = { type: 'draw', shapeId: shape.id, start: p };
    render();
    return;
  }

  if (state.tool === 'pen') {
    if (!state.draft) state.draft = { points: [] };
    const pts = state.draft.points;
    if (pts.length > 2) {
      const first = pts[0];
      const screenFirst = svgToScreen(first.x, first.y);
      if (Math.hypot(screenFirst.x - e.clientX, screenFirst.y - e.clientY) < 9) {
        finalizePenDraft(true);
        return;
      }
    }
    pts.push({ x: p.x, y: p.y, handleOut: null });
    pointerState = { type: 'penHandle', index: pts.length - 1, start: p };
    renderOverlay();
    return;
  }

  if (state.tool === 'text') {
    const shape = makeText(p.x, p.y, 'Text');
    state.shapes.push(shape);
    state.selectedIds = [shape.id];
    pushHistory();
    render(); renderLayers(); renderProps();
    state.tool = 'select'; syncToolbarActive();
    openTextEditor(shape);
    return;
  }
}

function onCanvasPointerMove(e) {
  if (!pointerState) {
    if (state.tool === 'pen' && state.draft) { state.draft.hoverPt = screenToSVG(e.clientX, e.clientY); renderOverlay(); }
    return;
  }
  const p = screenToSVG(e.clientX, e.clientY);

  if (pointerState.type === 'pan') {
    const rect = El.canvasWrap.getBoundingClientRect();
    const dxScreen = e.clientX - pointerState.startClient.x, dyScreen = e.clientY - pointerState.startClient.y;
    const vb0 = pointerState.startVB;
    state.viewBox.x = vb0.x - dxScreen * (vb0.w / rect.width);
    state.viewBox.y = vb0.y - dyScreen * (vb0.h / rect.height);
    updateSvgViewBox(); render();
    return;
  }

  if (pointerState.type === 'move') {
    const dx = p.x - pointerState.start.x, dy = p.y - pointerState.start.y;
    pointerState.orig.forEach(function (origShape) {
      const clone = JSON.parse(JSON.stringify(origShape));
      moveShape(clone, dx, dy);
      Object.assign(shapeById(clone.id), clone);
    });
    render();
    return;
  }

  if (pointerState.type === 'resize') {
    const b = pointerState.origBox;
    let nb = { x: b.x, y: b.y, w: b.w, h: b.h };
    const h = pointerState.handle;
    if (h.includes('w')) { nb.x = p.x; nb.w = (b.x + b.w) - p.x; }
    if (h.includes('e')) { nb.w = p.x - b.x; }
    if (h.includes('n')) { nb.y = p.y; nb.h = (b.y + b.h) - p.y; }
    if (h.includes('s')) { nb.h = p.y - b.y; }
    if (Math.abs(nb.w) < 2) nb.w = nb.w < 0 ? -2 : 2;
    if (Math.abs(nb.h) < 2) nb.h = nb.h < 0 ? -2 : 2;
    const clone = JSON.parse(JSON.stringify(pointerState.orig));
    scaleShape(clone, b, nb);
    Object.assign(shapeById(pointerState.shapeId), clone);
    render();
    return;
  }

  if (pointerState.type === 'marquee') {
    const x = Math.min(p.x, pointerState.start.x), y = Math.min(p.y, pointerState.start.y);
    pointerState.rect = { x: x, y: y, w: Math.abs(p.x - pointerState.start.x), h: Math.abs(p.y - pointerState.start.y) };
    renderOverlay();
    return;
  }

  if (pointerState.type === 'draw') {
    const s = shapeById(pointerState.shapeId);
    const x0 = pointerState.start.x, y0 = pointerState.start.y;
    if (s.type === 'rect') { s.x = Math.min(x0, p.x); s.y = Math.min(y0, p.y); s.w = Math.abs(p.x - x0); s.h = Math.abs(p.y - y0); }
    else if (s.type === 'ellipse') { s.cx = (x0 + p.x) / 2; s.cy = (y0 + p.y) / 2; s.rx = Math.abs(p.x - x0) / 2; s.ry = Math.abs(p.y - y0) / 2; }
    else if (s.type === 'line') { s.x2 = p.x; s.y2 = p.y; }
    render();
    return;
  }

  if (pointerState.type === 'penHandle') {
    const pt = state.draft.points[pointerState.index];
    const dx = p.x - pointerState.start.x, dy = p.y - pointerState.start.y;
    if (Math.hypot(dx, dy) > 3) pt.handleOut = { dx: dx, dy: dy };
    renderOverlay();
    return;
  }

  if (pointerState.type === 'nodeDrag') {
    const shape = shapeById(state.nodeEditShapeId);
    const cmd = shape.commands[state.nodeSel.cmdIndex];
    const dx = p.x - pointerState.start.x, dy = p.y - pointerState.start.y;
    pointerState.start = p;
    if (state.nodeSel.part === 'anchor') {
      cmd.x += dx; cmd.y += dy;
      if (cmd.type === 'C') { cmd.x2 += dx; cmd.y2 += dy; }
      const next = shape.commands[state.nodeSel.cmdIndex + 1];
      if (next && next.type === 'C') { next.x1 += dx; next.y1 += dy; }
    } else if (state.nodeSel.part === 'c1') { cmd.x1 += dx; cmd.y1 += dy; }
    else if (state.nodeSel.part === 'c2') { cmd.x2 += dx; cmd.y2 += dy; }
    render();
    return;
  }
}

function onCanvasPointerUp(e) {
  if (!pointerState) return;
  if (pointerState.type === 'marquee') {
    const r = pointerState.rect;
    if (r.w > 3 || r.h > 3) {
      state.selectedIds = state.shapes.filter(function (s) {
        const b = shapeBBox(s);
        return !(b.x + b.w < r.x || b.x > r.x + r.w || b.y + b.h < r.y || b.y > r.y + r.h);
      }).map(function (s) { return s.id; });
    } else {
      state.selectedIds = [];
    }
    renderLayers(); renderProps();
  }
  if (pointerState.type === 'draw') {
    const s = shapeById(pointerState.shapeId);
    const b = shapeBBox(s);
    if (b.w < 2 && b.h < 2) {
      state.shapes = state.shapes.filter(function (x) { return x.id !== s.id; });
    } else {
      state.selectedIds = [s.id];
      state.tool = 'select'; syncToolbarActive();
    }
    renderLayers();
  }
  if (['move', 'resize', 'draw', 'nodeDrag'].includes(pointerState.type)) pushHistory();
  pointerState = null;
  render(); renderOverlay(); renderProps();
}

function onCanvasDblClick(e) {
  const targetId = e.target.getAttribute && e.target.getAttribute('data-id');
  if (state.tool === 'select' && targetId) {
    const s = shapeById(targetId);
    if (s && s.type === 'text') { openTextEditor(s); return; }
    if (s && s.type === 'path') { state.tool = 'node'; state.nodeEditShapeId = s.id; state.selectedIds = [s.id]; render(); syncToolbarActive(); return; }
    if (s && (s.type === 'rect' || s.type === 'ellipse' || s.type === 'line')) {
      const converted = convertShapeToPath(s);
      if (converted) {
        const idx = state.shapes.findIndex(function (x) { return x.id === s.id; });
        if (idx !== -1) state.shapes[idx] = converted;
        state.tool = 'node';
        state.nodeEditShapeId = converted.id;
        state.selectedIds = [converted.id];
        pushHistory();
        render(); renderLayers(); renderProps(); syncToolbarActive();
      }
      return;
    }
  }
  if (state.tool === 'pen' && state.draft && state.draft.points.length >= 2) finalizePenDraft(false);
}

/* ---------- Text editing overlay ---------- */
function openTextEditor(shape) {
  const scr = svgToScreen(shape.x, shape.y);
  const wrapRect = El.canvasWrap.getBoundingClientRect();
  const scale = El.canvasWrap.clientWidth / state.viewBox.w;
  El.textEditor.style.display = 'block';
  El.textEditor.style.left = (scr.x - wrapRect.left) + 'px';
  El.textEditor.style.top = (scr.y - wrapRect.top - shape.fontSize * scale) + 'px';
  El.textEditor.style.fontSize = (shape.fontSize * scale) + 'px';
  El.textEditor.style.fontFamily = shape.fontFamily;
  El.textEditor.style.color = shape.fill;
  El.textEditor.value = shape.content;
  El.textEditor.dataset.shapeId = shape.id;
  El.textEditor.focus();
  El.textEditor.select();
}
function closeTextEditor(commit) {
  const id = El.textEditor.dataset.shapeId;
  if (!id) return;
  if (commit) {
    const s = shapeById(id);
    if (s) { s.content = El.textEditor.value || 'Text'; pushHistory(); }
  }
  El.textEditor.style.display = 'none';
  delete El.textEditor.dataset.shapeId;
  render(); renderLayers(); renderProps();
}

/* ---------- Toolbar ---------- */
let panMode = false;
function wireToolbar() {
  document.querySelectorAll('#toolbar [data-tool]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setTool(btn.getAttribute('data-tool'));
    });
  });
  $('btnDelete').addEventListener('click', deleteSelected);
  $('btnDuplicate').addEventListener('click', duplicateSelected);
}
function setTool(tool) {
  if (state.draft) { state.draft = null; }
  if (tool === 'node') {
    const single = state.selectedIds.length === 1 ? shapeById(state.selectedIds[0]) : null;
    if (single && single.type === 'path') {
      state.nodeEditShapeId = single.id;
    } else if (single && (single.type === 'rect' || single.type === 'ellipse' || single.type === 'line')) {
      const converted = convertShapeToPath(single);
      const idx = state.shapes.findIndex(function (x) { return x.id === single.id; });
      if (idx !== -1) state.shapes[idx] = converted;
      state.nodeEditShapeId = converted.id;
      state.selectedIds = [converted.id];
      pushHistory();
      renderLayers(); renderProps();
    } else {
      toast(state.selectedIds.length === 0
        ? 'Select a shape first, or double-click one directly, to edit its nodes.'
        : 'Node editing doesn\'t support text — select a different shape.');
      return; // stay on the current tool rather than switching to one with nothing to do
    }
  } else {
    state.nodeEditShapeId = null;
  }
  state.tool = tool;
  syncToolbarActive();
  render();
  El.statusText.textContent = statusHintFor(tool);
}
function syncToolbarActive() {
  document.querySelectorAll('#toolbar [data-tool]').forEach(function (btn) {
    btn.classList.toggle('active', btn.getAttribute('data-tool') === state.tool);
  });
}
function statusHintFor(tool) {
  const hints = {
    select: 'Click to select · drag to move · drag handles to resize · shift-click for multi-select',
    node: 'Drag anchors or handles · double-click a path to add a node · Delete removes selected node',
    pen: 'Click to place points, drag for curve handles · click first point or double-click to finish',
    rect: 'Click and drag to draw a rectangle',
    ellipse: 'Click and drag to draw an ellipse',
    line: 'Click and drag to draw a line',
    text: 'Click to place a text box, then type',
  };
  return hints[tool] || '';
}

function deleteSelected() {
  if (state.tool === 'node' && state.nodeSel) {
    const shape = shapeById(state.nodeEditShapeId);
    if (shape && shape.commands[state.nodeSel.cmdIndex] && shape.commands[state.nodeSel.cmdIndex].type !== 'M') {
      shape.commands.splice(state.nodeSel.cmdIndex, 1);
      state.nodeSel = null;
      pushHistory(); render(); renderOverlay();
    }
    return;
  }
  if (!state.selectedIds.length) return;
  state.shapes = state.shapes.filter(function (s) { return !state.selectedIds.includes(s.id); });
  state.selectedIds = [];
  pushHistory(); render(); renderLayers(); renderProps();
}
function duplicateSelected() {
  if (!state.selectedIds.length) return;
  const copies = selectedShapes().map(function (s) {
    const c = JSON.parse(JSON.stringify(s)); c.id = uid(c.type); c.name = c.name + ' copy';
    moveShape(c, 16, 16); return c;
  });
  state.shapes.push.apply(state.shapes, copies);
  state.selectedIds = copies.map(function (c) { return c.id; });
  pushHistory(); render(); renderLayers(); renderProps();
}

/* ---------- Topbar ---------- */
function wireTopbar() {
  $('btnUndo').addEventListener('click', function () { undo(); render(); renderLayers(); renderProps(); });
  $('btnRedo').addEventListener('click', function () { redo(); render(); renderLayers(); renderProps(); });
  $('btnZoomIn').addEventListener('click', function () { zoomBy(1.25); });
  $('btnZoomOut').addEventListener('click', function () { zoomBy(1 / 1.25); });
  $('btnZoomFit').addEventListener('click', function () { fitView(); updateSvgViewBox(); render(); });
  $('btnZoom100').addEventListener('click', function () { const c = { x: state.viewBox.x + state.viewBox.w / 2, y: state.viewBox.y + state.viewBox.h / 2 }; state.viewBox = { x: c.x - 450, y: c.y - 300, w: 900, h: 600 }; updateSvgViewBox(); render(); });
  $('btnExportSvg').addEventListener('click', exportSVG);
  $('btnImportTrigger').addEventListener('click', function () { El.fileInput.click(); });
}

/* ---------- Keyboard ---------- */
function wireKeyboard() {
  window.addEventListener('keydown', function (e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      if (e.key === 'Escape' && tag === 'textarea') closeTextEditor(false);
      if (e.key === 'Enter' && e.target === El.textEditor && !e.shiftKey) { e.preventDefault(); closeTextEditor(true); }
      return;
    }
    if (e.code === 'Space') { panMode = true; El.svg.style.cursor = 'grab'; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) { redo(); } else { undo(); } render(); renderLayers(); renderProps(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); render(); renderLayers(); renderProps(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); state.selectedIds = state.shapes.map(function (s) { return s.id; }); renderLayers(); renderOverlay(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
    if (e.key === 'Escape') {
      if (state.draft) { state.draft = null; render(); }
      else if (state.tool === 'node') { setTool('select'); }
      else { state.selectedIds = []; renderLayers(); renderOverlay(); renderProps(); }
      return;
    }
    if (e.key === 'Enter' && state.tool === 'pen' && state.draft) { finalizePenDraft(false); return; }
    const arrowMap = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (arrowMap[e.key] && state.selectedIds.length) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const [dx, dy] = arrowMap[e.key];
      selectedShapes().forEach(function (s) { moveShape(s, dx * step, dy * step); });
      render(); pushHistory();
      return;
    }
    const toolKeys = { v: 'select', a: 'node', p: 'pen', r: 'rect', e: 'ellipse', l: 'line', t: 'text' };
    if (toolKeys[e.key.toLowerCase()] && !e.ctrlKey && !e.metaKey) setTool(toolKeys[e.key.toLowerCase()]);
  });
  window.addEventListener('keyup', function (e) { if (e.code === 'Space') { panMode = false; El.svg.style.cursor = ''; } });
  El.textEditor.addEventListener('blur', function () { closeTextEditor(true); });
}

/* ---------- Layers panel ---------- */
function renderLayers() {
  El.layersList.innerHTML = '';
  const ordered = state.shapes.slice().reverse();
  if (!ordered.length) {
    const empty = document.createElement('div');
    empty.className = 'panel-empty';
    empty.textContent = 'No objects yet — draw a shape or import a file.';
    El.layersList.appendChild(empty);
    return;
  }
  ordered.forEach(function (s) {
    const row = document.createElement('div');
    row.className = 'layer-row' + (state.selectedIds.includes(s.id) ? ' selected' : '');
    row.innerHTML =
      '<button class="icon-btn eye" title="Toggle visibility">' + (s.visible === false ? eyeOffSvg() : eyeSvg()) + '</button>' +
      '<button class="icon-btn lock" title="Toggle lock">' + (s.locked ? lockSvg() : unlockSvg()) + '</button>' +
      '<span class="layer-swatch" style="background:' + (s.fill === 'none' ? 'transparent' : s.fill) + ';border-color:' + (s.stroke === 'none' ? '#444' : s.stroke) + '"></span>' +
      '<span class="layer-name" spellcheck="false" contenteditable="false">' + escapeHtml(s.name || s.type) + '</span>' +
      '<span class="layer-type">' + s.type + '</span>' +
      '<button class="icon-btn del" title="Delete">' + trashSvg() + '</button>';
    row.querySelector('.eye').addEventListener('click', function (ev) { ev.stopPropagation(); s.visible = s.visible === false ? true : false; pushHistory(); render(); renderLayers(); });
    row.querySelector('.lock').addEventListener('click', function (ev) { ev.stopPropagation(); s.locked = !s.locked; pushHistory(); render(); renderLayers(); });
    row.querySelector('.del').addEventListener('click', function (ev) { ev.stopPropagation(); state.shapes = state.shapes.filter(function (x) { return x.id !== s.id; }); state.selectedIds = state.selectedIds.filter(function (id) { return id !== s.id; }); pushHistory(); render(); renderLayers(); renderProps(); });
    const nameEl = row.querySelector('.layer-name');
    nameEl.addEventListener('dblclick', function (ev) { ev.stopPropagation(); nameEl.contentEditable = 'true'; nameEl.focus(); document.execCommand('selectAll', false, null); });
    nameEl.addEventListener('blur', function () { nameEl.contentEditable = 'false'; s.name = nameEl.textContent.trim() || s.type; pushHistory(); });
    nameEl.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); nameEl.blur(); } });
    row.addEventListener('click', function (ev) {
      if (ev.shiftKey) {
        const i = state.selectedIds.indexOf(s.id);
        if (i >= 0) state.selectedIds.splice(i, 1); else state.selectedIds.push(s.id);
      } else state.selectedIds = [s.id];
      renderLayers(); renderOverlay(); renderProps();
    });
    El.layersList.appendChild(row);
  });
}
function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
function eyeSvg() { return '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 5c-5 0-9.3 3.1-11 7 1.7 3.9 6 7 11 7s9.3-3.1 11-7c-1.7-3.9-6-7-11-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9z"/></svg>'; }
function eyeOffSvg() { return '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M3.3 2.3 2 3.6 5.4 7C3.5 8.4 2 10.3 1 12c1.7 3.9 6 7 11 7 1.8 0 3.5-.4 5-1.1l3.4 3.4 1.3-1.3L3.3 2.3zM12 16.5a4.5 4.5 0 0 1-4.5-4.5c0-.7.2-1.4.5-2l6 6c-.6.3-1.3.5-2 .5zM12 7.5c.5 0 1 .1 1.4.3l-5.6 5.6A4.5 4.5 0 0 1 12 7.5z"/></svg>'; }
function lockSvg() { return '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M12 2a4 4 0 0 0-4 4v3H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a4 4 0 0 0-4-4zm0 2a2 2 0 0 1 2 2v3h-4V6a2 2 0 0 1 2-2z"/></svg>'; }
function unlockSvg() { return '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M17 8h-1V6a4 4 0 0 0-7.8-1.2l1.9.6A2 2 0 0 1 14 6v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z"/></svg>'; }
function trashSvg() { return '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M6 7h12l-1 13H7L6 7zm3-3h6l1 2H8l1-2zM4 7h16"/><path stroke="currentColor" stroke-width="1.5" fill="none" d="M4 7h16"/></svg>'; }

/* ---------- Properties panel ---------- */
let gradEditStopIndex = 0;
function field(label, inputHtml) { return '<label class="prop-field"><span>' + label + '</span>' + inputHtml + '</label>'; }
function renderProps() {
  const sel = selectedShapes();
  if (!sel.length) { El.propsBody.innerHTML = '<div class="panel-empty">Select an object to edit its properties.</div>'; return; }
  const s = sel[0];
  let html = '';
  if (sel.length === 1) {
    html += '<div class="props-section-title">' + s.type.toUpperCase() + '</div>';
    if (s.type === 'rect') {
      html += field('X', num('x', s.x)) + field('Y', num('y', s.y)) + field('W', num('w', s.w)) + field('H', num('h', s.h)) + field('Corner radius', num('rx', s.rx || 0));
    } else if (s.type === 'ellipse') {
      html += field('CX', num('cx', s.cx)) + field('CY', num('cy', s.cy)) + field('RX', num('rx', s.rx)) + field('RY', num('ry', s.ry));
    } else if (s.type === 'line') {
      html += field('X1', num('x1', s.x1)) + field('Y1', num('y1', s.y1)) + field('X2', num('x2', s.x2)) + field('Y2', num('y2', s.y2));
    } else if (s.type === 'text') {
      html += '<label class="prop-field full"><span>Content</span><textarea data-key="content" rows="2">' + escapeHtml(s.content) + '</textarea></label>';
      html += field('Font size', num('fontSize', s.fontSize));
      html += '<label class="prop-field full"><span>Font</span><select data-key="fontFamily">' +
        ['Space Grotesk, sans-serif', 'JetBrains Mono, monospace', 'Georgia, serif', 'Arial, sans-serif'].map(function (f) {
          return '<option value="' + f + '"' + (s.fontFamily === f ? ' selected' : '') + '>' + f.split(',')[0] + '</option>';
        }).join('') + '</select></label>';
    } else if (s.type === 'path') {
      html += '<div class="hint-text">' + s.commands.length + ' path commands · press A to edit nodes</div>';
    }
  }
  html += '<div class="props-section-title">' + (sel.length > 1 ? sel.length + ' OBJECTS · STYLE' : 'STYLE') + '</div>';
  if (sel.length === 1) {
    html += fillSectionHtml(s);
  } else {
    html += field('Fill', colorField('fill', s.fill));
  }
  html += field('Stroke', colorField('stroke', s.stroke));
  html += field('Stroke width', num('strokeWidth', s.strokeWidth || 0));
  html += field('Opacity', '<input type="range" min="0" max="1" step="0.05" data-key="opacity" value="' + (s.opacity == null ? 1 : s.opacity) + '">');
  El.propsBody.innerHTML = html;

  El.propsBody.querySelectorAll('[data-key]').forEach(function (input) {
    const key = input.getAttribute('data-key');
    const commit = function () {
      let val = input.type === 'range' || input.type === 'number' ? parseFloat(input.value) : (input.tagName === 'TEXTAREA' ? input.value : input.value);
      sel.forEach(function (shape) {
        if (key === 'fill' || key === 'stroke') { shape[key] = val; if (key === 'fill') shape.gradient = null; }
        else if (['x', 'y', 'w', 'h', 'rx', 'ry', 'cx', 'cy', 'x1', 'y1', 'x2', 'y2', 'strokeWidth', 'opacity', 'fontSize'].includes(key)) { shape[key] = isNaN(val) ? 0 : val; }
        else { shape[key] = val; }
      });
      render(); renderLayers();
    };
    input.addEventListener('input', commit);
    input.addEventListener('change', function () { commit(); pushHistory(); });
  });
  El.propsBody.querySelectorAll('.color-none').forEach(function (cb) {
    cb.addEventListener('change', function () {
      const key = cb.getAttribute('data-nonefor');
      const colorInput = El.propsBody.querySelector('[data-key="' + key + '"][type="color"]');
      sel.forEach(function (shape) { shape[key] = cb.checked ? 'none' : colorInput.value; if (key === 'fill') shape.gradient = null; });
      colorInput.disabled = cb.checked;
      render(); renderLayers(); pushHistory();
    });
  });

  if (sel.length === 1) wireGradientEditor(s);
}
function wireGradientEditor(s) {
  const fmodeBtns = El.propsBody.querySelectorAll('.fmode-btn[data-fmode]');
  fmodeBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      const mode = btn.getAttribute('data-fmode');
      if (mode === 'gradient' && !s.gradient) {
        const b = shapeBBox(s);
        const baseColor = (s.fill && s.fill !== 'none') ? s.fill : '#5eead4';
        s.gradient = {
          type: 'linear',
          stops: [{ offset: 0, color: baseColor }, { offset: 1, color: '#0d0f12' }],
          coords: { x1: b.x, y1: b.y + b.h / 2, x2: b.x + b.w, y2: b.y + b.h / 2 },
        };
        gradEditStopIndex = 0;
        pushHistory();
      } else if (mode === 'solid' && s.gradient) {
        s.fill = s.gradient.stops[0].color;
        s.gradient = null;
        pushHistory();
      }
      render(); renderLayers(); renderProps();
    });
  });
  if (!s.gradient) return;

  El.propsBody.querySelectorAll('.gtype-btn[data-gtype]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const type = btn.getAttribute('data-gtype');
      if (s.gradient.type === type) return;
      const b = shapeBBox(s);
      s.gradient.type = type;
      if (type === 'radial') {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2, r = Math.max(b.w, b.h) / 2 || 10;
        s.gradient.coords = { cx: cx, cy: cy, r: r, fx: cx, fy: cy };
      } else {
        s.gradient.coords = { x1: b.x, y1: b.y + b.h / 2, x2: b.x + b.w, y2: b.y + b.h / 2 };
      }
      pushHistory();
      render(); renderLayers(); renderProps();
    });
  });

  const stopColorInput = El.propsBody.querySelector('#gradStopColor');
  const stopOffsetInput = El.propsBody.querySelector('#gradStopOffset');
  const bar = El.propsBody.querySelector('#gradBar');

  if (stopColorInput) {
    stopColorInput.addEventListener('input', function () {
      s.gradient.stops[gradEditStopIndex].color = stopColorInput.value;
      if (bar) updateGradBarBackground(bar, s.gradient.stops);
      const handle = bar && bar.querySelector('.grad-handle[data-stop-idx="' + gradEditStopIndex + '"]');
      if (handle) handle.style.background = stopColorInput.value;
      render(); renderLayers();
    });
    stopColorInput.addEventListener('change', function () { pushHistory(); });
  }
  if (stopOffsetInput) {
    const commitOffset = function () {
      let v = parseFloat(stopOffsetInput.value);
      if (isNaN(v)) v = 0;
      v = Math.max(0, Math.min(100, v)) / 100;
      s.gradient.stops[gradEditStopIndex].offset = v;
      if (bar) updateGradBarBackground(bar, s.gradient.stops);
      const handle = bar && bar.querySelector('.grad-handle[data-stop-idx="' + gradEditStopIndex + '"]');
      if (handle) handle.style.left = (v * 100) + '%';
      render(); renderLayers();
    };
    stopOffsetInput.addEventListener('input', commitOffset);
    stopOffsetInput.addEventListener('change', function () { commitOffset(); pushHistory(); });
  }
  const removeBtn = El.propsBody.querySelector('#gradRemoveStop');
  if (removeBtn) {
    removeBtn.addEventListener('click', function () {
      if (s.gradient.stops.length <= 2) return;
      s.gradient.stops.splice(gradEditStopIndex, 1);
      gradEditStopIndex = Math.max(0, gradEditStopIndex - 1);
      pushHistory();
      render(); renderLayers(); renderProps();
    });
  }
  if (bar) {
    bar.addEventListener('click', function (e) {
      if (e.target.classList.contains('grad-handle')) return;
      const rect = bar.getBoundingClientRect();
      const offset = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const color = interpolateGradientColor(s.gradient.stops, offset);
      s.gradient.stops.push({ offset: offset, color: color });
      gradEditStopIndex = s.gradient.stops.length - 1;
      pushHistory();
      render(); renderLayers(); renderProps();
    });
    bar.querySelectorAll('.grad-handle').forEach(function (handle) {
      handle.addEventListener('pointerdown', function (e) {
        e.stopPropagation();
        e.preventDefault();
        const idx = parseInt(handle.getAttribute('data-stop-idx'), 10);
        gradEditStopIndex = idx;
        bar.querySelectorAll('.grad-handle').forEach(function (h) { h.classList.remove('selected'); });
        handle.classList.add('selected');
        if (stopColorInput) stopColorInput.value = s.gradient.stops[idx].color;
        if (stopOffsetInput) stopOffsetInput.value = Math.round(s.gradient.stops[idx].offset * 100);
        const rect = bar.getBoundingClientRect();
        function onMove(ev) {
          const offset = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
          s.gradient.stops[idx].offset = offset;
          handle.style.left = (offset * 100) + '%';
          updateGradBarBackground(bar, s.gradient.stops);
          if (stopOffsetInput) stopOffsetInput.value = Math.round(offset * 100);
          render();
        }
        function onUp() {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          pushHistory();
          renderLayers();
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    });
  }
}
function fillSectionHtml(shape) {
  const isGrad = !!shape.gradient;
  let html = '<div class="prop-field full"><span>Fill</span><div class="fill-mode-toggle">' +
    '<button type="button" class="fmode-btn' + (!isGrad ? ' active' : '') + '" data-fmode="solid">Solid</button>' +
    '<button type="button" class="fmode-btn' + (isGrad ? ' active' : '') + '" data-fmode="gradient">Gradient</button>' +
    '</div></div>';
  if (isGrad) html += gradientEditorHtml(shape);
  else html += '<label class="prop-field"><span></span>' + colorField('fill', shape.fill) + '</label>';
  return html;
}
function gradientEditorHtml(shape) {
  const g = shape.gradient;
  if (gradEditStopIndex >= g.stops.length) gradEditStopIndex = 0;
  const sorted = g.stops.map(function (st, i) { return { st: st, i: i }; }).sort(function (a, b) { return a.st.offset - b.st.offset; });
  const cssStops = sorted.map(function (o) { return o.st.color + ' ' + (o.st.offset * 100) + '%'; }).join(', ');
  const handles = g.stops.map(function (st, i) {
    return '<div class="grad-handle' + (i === gradEditStopIndex ? ' selected' : '') + '" data-stop-idx="' + i + '" style="left:' + (st.offset * 100) + '%;background:' + st.color + '" title="Drag to reposition · click to select"></div>';
  }).join('');
  const selStop = g.stops[gradEditStopIndex];
  return (
    '<div class="prop-field full"><span></span><div class="grad-type-toggle">' +
      '<button type="button" class="gtype-btn' + (g.type === 'linear' ? ' active' : '') + '" data-gtype="linear">Linear</button>' +
      '<button type="button" class="gtype-btn' + (g.type === 'radial' ? ' active' : '') + '" data-gtype="radial">Radial</button>' +
    '</div></div>' +
    '<div class="prop-field full"><span></span><div class="gradient-bar" id="gradBar" style="background:linear-gradient(to right, ' + cssStops + ')">' + handles + '</div></div>' +
    '<div class="prop-field"><span>Stop color</span><input type="color" id="gradStopColor" value="' + selStop.color + '"></div>' +
    '<div class="prop-field"><span>Stop position</span><input type="number" id="gradStopOffset" min="0" max="100" value="' + Math.round(selStop.offset * 100) + '"></div>' +
    '<button type="button" class="fmode-btn" id="gradRemoveStop"' + (g.stops.length <= 2 ? ' disabled' : '') + ' style="width:100%;margin-top:2px">Remove selected stop</button>'
  );
}
function updateGradBarBackground(bar, stops) {
  const sorted = stops.slice().sort(function (a, b) { return a.offset - b.offset; });
  bar.style.background = 'linear-gradient(to right, ' + sorted.map(function (s) { return s.color + ' ' + (s.offset * 100) + '%'; }).join(', ') + ')';
}
function interpolateGradientColor(stops, offset) {
  const sorted = stops.slice().sort(function (a, b) { return a.offset - b.offset; });
  if (offset <= sorted[0].offset) return sorted[0].color;
  if (offset >= sorted[sorted.length - 1].offset) return sorted[sorted.length - 1].color;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (offset >= sorted[i].offset && offset <= sorted[i + 1].offset) {
      const t = (offset - sorted[i].offset) / ((sorted[i + 1].offset - sorted[i].offset) || 1);
      const c1 = colorToRgb(sorted[i].color), c2 = colorToRgb(sorted[i + 1].color);
      if (!c1 || !c2) return sorted[i].color;
      return rgbToHexStr(c1.r + (c2.r - c1.r) * t, c1.g + (c2.g - c1.g) * t, c1.b + (c2.b - c1.b) * t);
    }
  }
  return sorted[0].color;
}
function num(key, val) { return '<input type="number" data-key="' + key + '" value="' + (isNaN(val) ? 0 : Math.round(val * 100) / 100) + '">'; }
function colorField(key, val) {
  const isNone = val === 'none' || val == null;
  return '<span class="color-field"><input type="color" data-key="' + key + '" value="' + (isNone ? '#000000' : val) + '"' + (isNone ? ' disabled' : '') + '>' +
    '<label class="none-toggle"><input type="checkbox" class="color-none" data-nonefor="' + key + '"' + (isNone ? ' checked' : '') + '> none</label></span>';
}

/* ---------- Toast ---------- */
function toast(msg) {
  El.toast.textContent = msg;
  El.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { El.toast.classList.remove('show'); }, 3200);
}

/* ---------- Import ---------- */
function wireImport() {
  El.fileInput.addEventListener('change', function () {
    const file = El.fileInput.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'svg') {
      const reader = new FileReader();
      reader.onload = function () {
        try { importSVGText(reader.result); }
        catch (err) { toast('Could not read that file: ' + err.message); }
        El.fileInput.value = '';
      };
      reader.readAsText(file);
      return;
    }
    if (ext === 'eps' || ext === 'ps' || ext === 'ai') {
      const reader = new FileReader();
      reader.onload = function () {
        try {
          const text = decodeEPSArrayBuffer(reader.result);
          importEPSText(text);
        } catch (err) {
          toast('Could not read that file: ' + err.message);
        }
        El.fileInput.value = '';
      };
      reader.readAsArrayBuffer(file);
      return;
    }
    toast('Unsupported file type — please choose an .svg or .eps file.');
    El.fileInput.value = '';
  });
}
/* Decode an EPS/PS/AI file from raw bytes to text. Handles the "DOS EPS
   Binary File" wrapper (magic bytes C5 D0 D3 C6) used by many Windows/
   Illustrator EPS exports that bundle a TIFF or WMF preview image inside
   the same file alongside the real PostScript text: a 30-byte header
   gives the byte offset and length of the actual PostScript section, and
   without unwrapping it, the previewimage bytes get decoded as if they
   were PostScript text (which is both wrong and can be very slow to
   tokenize). Falls back to decoding the whole buffer as plain text for
   ordinary (non-wrapped) EPS/PS files. */
function decodeEPSArrayBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  const isDosEpsBinary = bytes.length > 30 && bytes[0] === 0xC5 && bytes[1] === 0xD0 && bytes[2] === 0xD3 && bytes[3] === 0xC6;
  const decoder = new TextDecoder('latin1'); // EPS is 7/8-bit text; latin1 preserves byte values 1:1
  if (!isDosEpsBinary) return decoder.decode(bytes);
  const dv = new DataView(buffer);
  const psStart = dv.getUint32(4, true);
  const psLength = dv.getUint32(8, true);
  if (psStart + psLength > bytes.length || psLength <= 0) return decoder.decode(bytes);
  return decoder.decode(bytes.subarray(psStart, psStart + psLength));
}
function importSVGText(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror')) { toast('That SVG could not be parsed — the file may be malformed.'); return; }
  const result = importSVGDocument(doc);
  const rawImported = result.shapes;
  const imported = rawImported.filter(function (s) {
    const b = shapeBBox(s);
    return isFinite(b.x) && isFinite(b.y) && isFinite(b.w) && isFinite(b.h);
  });
  if (!imported.length) {
    toast(rawImported.length
      ? 'Found shapes in that SVG but could not place them (unsupported geometry).'
      : 'No supported shapes were found in that SVG (rect, circle, ellipse, line, polyline, polygon, path, text, <use>/<symbol>, and CSS-class or gradient fills are all supported — but clip paths, masks, patterns, and embedded images are not).');
    return;
  }
  state.shapes.push.apply(state.shapes, imported);
  state.selectedIds = imported.map(function (s) { return s.id; });
  pushHistory();
  fitView(); render(); renderLayers(); renderProps();
  const gradNote = result.gradientApproximated ? ' Gradient fills were approximated as flat colors.' : '';
  toast('Imported ' + imported.length + ' object(s) from SVG.' + gradNote);
}
function flipEpsShapes(shapes, bbox) {
  if (!bbox) return shapes;
  const h = bbox.y1 - bbox.y0;
  shapes.forEach(function (s) {
    s.commands.forEach(function (c) {
      if (c.type === 'Z') return;
      c.x -= bbox.x0; c.y = h - (c.y - bbox.y0);
      if (c.type === 'C') { c.x1 -= bbox.x0; c.y1 = h - (c.y1 - bbox.y0); c.x2 -= bbox.x0; c.y2 = h - (c.y2 - bbox.y0); }
    });
    if (s.gradient) {
      const c = s.gradient.coords;
      if (s.gradient.type === 'radial') {
        c.cx -= bbox.x0; c.cy = h - (c.cy - bbox.y0);
        c.fx -= bbox.x0; c.fy = h - (c.fy - bbox.y0);
      } else {
        c.x1 -= bbox.x0; c.y1 = h - (c.y1 - bbox.y0);
        c.x2 -= bbox.x0; c.y2 = h - (c.y2 - bbox.y0);
      }
    }
  });
  return shapes;
}
function importEPSText(text) {
  const result = parseEPS(text);
  if (!result.shapes.length) {
    const usesAGM = /Adobe_AGM_|Adobe_CoolType_/.test(text);
    if (usesAGM) {
      toast("This EPS was exported by Illustrator in \"full compatibility\" mode, which draws almost everything through Adobe's proprietary AGM/CoolType libraries rather than standard PostScript in the file itself — this converter can't reach that. Try re-exporting as SVG directly from Illustrator (or opening it in Inkscape and exporting SVG from there), then importing that instead.");
    } else if (result.truncated) {
      toast('That EPS file is unusually complex and parsing was stopped early to avoid hanging the page. No paths were recovered before the cutoff.');
    } else {
      toast('No vector paths could be extracted from that EPS file — it may rely on embedded fonts, images, or patterns this converter does not support.');
    }
    return;
  }
  const flipped = flipEpsShapes(result.shapes, result.bbox);
  const shapes = flipped.filter(function (s) {
    const b = shapeBBox(s);
    return isFinite(b.x) && isFinite(b.y) && isFinite(b.w) && isFinite(b.h);
  });
  const skipped = flipped.length - shapes.length;
  if (!shapes.length) { toast('That EPS file used PostScript features this converter could not interpret cleanly — no valid paths were recovered.'); return; }
  state.shapes.push.apply(state.shapes, shapes);
  state.selectedIds = shapes.map(function (s) { return s.id; });
  pushHistory();
  fitView(); render(); renderLayers(); renderProps();
  const skipNote = skipped ? (' ' + skipped + ' path(s) could not be recovered and were skipped.') : '';
  const truncNote = result.truncated ? ' Parsing was stopped early because this file is unusually complex — some content may be missing.' : '';
  toast('Converted ' + shapes.length + ' path(s) from EPS to editable SVG. Fonts, images, and patterns in the original are not carried over.' + skipNote + truncNote);
}

/* ---------- Export ---------- */
function shapeToSVGString(s) {
  const fill = s.gradient ? 'url(#' + gradientIdFor(s.id) + ')' : (s.fill == null ? 'none' : s.fill);
  const stroke = s.stroke == null ? 'none' : s.stroke;
  const common = 'fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + (s.strokeWidth || 0) + '" opacity="' + (s.opacity == null ? 1 : s.opacity) + '"' + (s.visible === false ? ' display="none"' : '');
  if (s.type === 'rect') return '<rect x="' + s.x + '" y="' + s.y + '" width="' + s.w + '" height="' + s.h + '"' + (s.rx ? ' rx="' + s.rx + '"' : '') + ' ' + common + '/>';
  if (s.type === 'ellipse') return '<ellipse cx="' + s.cx + '" cy="' + s.cy + '" rx="' + s.rx + '" ry="' + s.ry + '" ' + common + '/>';
  if (s.type === 'line') return '<line x1="' + s.x1 + '" y1="' + s.y1 + '" x2="' + s.x2 + '" y2="' + s.y2 + '" ' + common + '/>';
  if (s.type === 'text') return '<text x="' + s.x + '" y="' + s.y + '" font-size="' + s.fontSize + '" font-family="' + s.fontFamily + '" ' + common + '>' + escapeHtml(s.content) + '</text>';
  if (s.type === 'path') return '<path d="' + commandsToD(s.commands) + '"' + (s.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '') + ' ' + common + '/>';
  return '';
}
function gradientDefsToSVGString(shapes) {
  let out = '';
  for (const s of shapes) {
    if (!s.gradient || !s.gradient.stops || !s.gradient.stops.length) continue;
    const g = s.gradient;
    const stopsMarkup = g.stops.map(function (stop) {
      return '<stop offset="' + Math.max(0, Math.min(1, stop.offset)) + '" stop-color="' + stop.color + '"' + (stop.opacity != null && stop.opacity < 1 ? ' stop-opacity="' + stop.opacity + '"' : '') + '/>';
    }).join('');
    if (g.type === 'radial') {
      out += '<radialGradient id="' + gradientIdFor(s.id) + '" gradientUnits="userSpaceOnUse" cx="' + g.coords.cx + '" cy="' + g.coords.cy + '" r="' + Math.max(0.01, g.coords.r) + '"' +
        (g.coords.fx != null ? ' fx="' + g.coords.fx + '"' : '') + (g.coords.fy != null ? ' fy="' + g.coords.fy + '"' : '') + '>' + stopsMarkup + '</radialGradient>';
    } else {
      out += '<linearGradient id="' + gradientIdFor(s.id) + '" gradientUnits="userSpaceOnUse" x1="' + g.coords.x1 + '" y1="' + g.coords.y1 + '" x2="' + g.coords.x2 + '" y2="' + g.coords.y2 + '">' + stopsMarkup + '</linearGradient>';
    }
  }
  return out;
}
function exportSVG() {
  if (!state.shapes.length) { toast('Nothing to export yet.'); return; }
  const box = unionBBox(state.shapes.map(shapeBBox));
  const pad = 20;
  const vb = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
  const defs = gradientDefsToSVGString(state.shapes);
  let body = state.shapes.map(shapeToSVGString).join('\n  ');
  const svg = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h + '" width="' + Math.round(vb.w) + '" height="' + Math.round(vb.h) + '">\n  ' +
    (defs ? '<defs>' + defs + '</defs>\n  ' : '') +
    body + '\n</svg>\n';
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'vector-export.svg';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  toast('SVG exported.');
}

document.addEventListener('DOMContentLoaded', init);
