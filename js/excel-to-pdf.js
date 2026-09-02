/* ============================================================
   excel-to-pdf.js
   엑셀 시트 모양(서식·병합·열너비·행높이·테두리·글꼴)을 유지한 채 PDF로 변환
   ============================================================ */
(function (global) {
  "use strict";

  const MAX_ROWS = 4000;
  const MAX_COLS = 150;
  const EXCEL_EXT = /\.(xlsx|xlsm|xls|csv)$/i;
  const STYLED_EXT = /\.(xlsx|xlsm)$/i;
  const DEFAULT_COL_W = 8.43;
  const DEFAULT_ROW_H = 15;

  const INDEXED = {
    0: "#000000",
    1: "#FFFFFF",
    2: "#FF0000",
    3: "#00FF00",
    4: "#0000FF",
    5: "#FFFF00",
    6: "#FF00FF",
    7: "#00FFFF",
    8: "#000000",
    9: "#FFFFFF",
    10: "#FF0000",
    11: "#00FF00",
    12: "#0000FF",
    13: "#FFFF00",
    14: "#FF00FF",
    15: "#00FFFF",
    16: "#800000",
    17: "#008000",
    18: "#000080",
    19: "#808000",
    20: "#800080",
    21: "#008080",
    22: "#C0C0C0",
    23: "#808080",
    64: "#000000",
  };

  const THEME = [
    "#FFFFFF",
    "#000000",
    "#E7E6E6",
    "#44546A",
    "#4472C4",
    "#ED7D31",
    "#A5A5A5",
    "#FFC000",
    "#5B9BD5",
    "#70AD47",
  ];

  function isExcelFile(file) {
    return file && EXCEL_EXT.test(file.name);
  }

  function pdfNameFromExcel(name) {
    const base = String(name || "workbook").replace(EXCEL_EXT, "");
    return (base || "workbook") + ".pdf";
  }

  function uniqueName(name, used) {
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    let i = 2;
    let candidate;
    do {
      candidate = stem + "_" + i + ext;
      i++;
    } while (used.has(candidate));
    used.add(candidate);
    return candidate;
  }

  function colWidthPx(width) {
    const w = width == null || width === 0 ? DEFAULT_COL_W : Number(width);
    return Math.max(8, Math.round(w * 8));
  }

  function rowHeightPx(height) {
    const h = height == null || height === 0 ? DEFAULT_ROW_H : Number(height);
    return Math.max(12, Math.round((h * 96) / 72));
  }

  function colorToCss(color) {
    if (!color) return "";
    if (typeof color === "string") {
      if (/^#/.test(color)) return color;
      if (/^[0-9A-Fa-f]{6,8}$/.test(color)) return argbToCss(color);
      return "";
    }
    if (color.argb) return argbToCss(color.argb);
    if (color.theme != null) {
      const base = THEME[color.theme] || "";
      if (!base) return "";
      if (color.tint) return applyTint(base, color.tint);
      return base;
    }
    if (color.indexed != null && INDEXED[color.indexed]) return INDEXED[color.indexed];
    return "";
  }

  function argbToCss(argb) {
    const a = String(argb || "").replace("#", "");
    if (a.length === 8) {
      const aa = parseInt(a.slice(0, 2), 16) / 255;
      const r = parseInt(a.slice(2, 4), 16);
      const g = parseInt(a.slice(4, 6), 16);
      const b = parseInt(a.slice(6, 8), 16);
      if (aa >= 0.999) return "rgb(" + r + "," + g + "," + b + ")";
      return "rgba(" + r + "," + g + "," + b + "," + aa.toFixed(3) + ")";
    }
    if (a.length === 6) return "#" + a;
    return "";
  }

  function applyTint(hex, tint) {
    const h = hex.replace("#", "");
    const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const t = Number(tint);
    const out = rgb.map((c) => {
      let v = t < 0 ? c * (1 + t) : c + (1 - c) * t;
      return Math.round(Math.min(1, Math.max(0, v)) * 255);
    });
    return "rgb(" + out.join(",") + ")";
  }

  function borderCss(side) {
    if (!side || !side.style || side.style === "none") return "";
    const color = colorToCss(side.color) || "#000000";
    const map = {
      hair: "1px solid",
      thin: "1px solid",
      medium: "2px solid",
      thick: "3px solid",
      dotted: "1px dotted",
      dashed: "1px dashed",
      dashDot: "1px dashed",
      dashDotDot: "1px dashed",
      double: "3px double",
      mediumDashed: "2px dashed",
      mediumDashDot: "2px dashed",
      slantDashDot: "1px dashed",
    };
    return (map[side.style] || "1px solid") + " " + color;
  }

  function colLettersToNum(letters) {
    let n = 0;
    const s = String(letters).toUpperCase();
    for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n;
  }

  function parseA1(ref) {
    const m = /^([A-Z]+)(\d+)$/i.exec(String(ref).trim());
    if (!m) return null;
    return { c: colLettersToNum(m[1]), r: parseInt(m[2], 10) };
  }

  function parseMergeRef(ref) {
    const parts = String(ref).split(":");
    const a = parseA1(parts[0]);
    const b = parts[1] ? parseA1(parts[1]) : a;
    if (!a || !b) return null;
    return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
  }

  function collectMerges(ws) {
    const skip = new Set();
    const span = new Map();
    const list = [];
    if (ws.model && Array.isArray(ws.model.merges)) list.push.apply(list, ws.model.merges);
    if (ws._merges) {
      Object.keys(ws._merges).forEach((k) => {
        const m = ws._merges[k];
        if (m && m.top != null) {
          list.push({ r1: m.top, c1: m.left, r2: m.bottom, c2: m.right });
        }
      });
    }
    list.forEach((item) => {
      const range = typeof item === "string" ? parseMergeRef(item) : item;
      if (!range) return;
      span.set(range.r1 + "," + range.c1, {
        rowspan: range.r2 - range.r1 + 1,
        colspan: range.c2 - range.c1 + 1,
      });
      for (let r = range.r1; r <= range.r2; r++) {
        for (let c = range.c1; c <= range.c2; c++) {
          if (r === range.r1 && c === range.c1) continue;
          skip.add(r + "," + c);
        }
      }
    });
    return { skip: skip, span: span };
  }

  function formatWithSsf(numFmt, value) {
    try {
      if (global.XLSX && global.XLSX.SSF && numFmt && value != null && value !== "") {
        return String(global.XLSX.SSF.format(numFmt, value));
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  function cellDisplay(cell) {
    if (!cell) return "";
    if (cell.text != null && cell.text !== "" && typeof cell.text === "string") {
      if (cell.value == null || typeof cell.value !== "object" || !cell.value.richText) {
        return cell.text;
      }
    }
    const v = cell.value;
    if (v == null || v === "") return "";
    if (typeof v === "number") {
      return formatWithSsf(cell.numFmt, v) || String(v);
    }
    if (v instanceof Date && !isNaN(v.getTime())) {
      return formatWithSsf(cell.numFmt, v) || v.toISOString().slice(0, 10);
    }
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (typeof v === "object") {
      if (Array.isArray(v.richText)) return v.richText.map((p) => p.text || "").join("");
      if (v.hyperlink && v.text) return v.text;
      if (v.text && v.hyperlink == null && !v.formula) return v.text;
      if (v.formula != null || v.sharedFormula != null) {
        const res = v.result;
        if (res == null) return "";
        if (typeof res === "number") return formatWithSsf(cell.numFmt, res) || String(res);
        if (res instanceof Date) return formatWithSsf(cell.numFmt, res) || res.toISOString().slice(0, 10);
        if (typeof res === "object" && res.error) return String(res.error);
        return String(res);
      }
      if (v.error) return String(v.error);
      if (v.result != null) return String(v.result);
    }
    return String(v);
  }

  function applyFont(el, font) {
    if (!font) return;
    if (font.name) el.style.fontFamily = '"' + font.name + '", Calibri, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
    if (font.size) el.style.fontSize = font.size + "pt";
    if (font.bold) el.style.fontWeight = "700";
    if (font.italic) el.style.fontStyle = "italic";
    if (font.underline) el.style.textDecoration = "underline";
    if (font.strike) el.style.textDecoration = (el.style.textDecoration ? el.style.textDecoration + " " : "") + "line-through";
    const color = colorToCss(font.color);
    if (color) el.style.color = color;
  }

  function applyCellStyle(td, cell, showGrid) {
    td.style.padding = "1px 4px";
    td.style.overflow = "hidden";
    td.style.boxSizing = "border-box";
    td.style.verticalAlign = "middle";
    td.style.whiteSpace = "pre";

    if (cell && cell.font) applyFont(td, cell.font);

    if (cell && cell.fill) {
      const fill = cell.fill;
      let bg = "";
      if (fill.fgColor) bg = colorToCss(fill.fgColor);
      if (!bg && fill.bgColor) bg = colorToCss(fill.bgColor);
      if (!bg && fill.stops && fill.stops[0]) bg = colorToCss(fill.stops[0].color);
      if (bg) td.style.background = bg;
    }

    const b = cell && cell.border ? cell.border : {};
    const sides = [
      ["Top", b.top],
      ["Right", b.right],
      ["Bottom", b.bottom],
      ["Left", b.left],
    ];
    let anyBorder = false;
    sides.forEach((pair) => {
      const css = borderCss(pair[1]);
      if (css) {
        td.style["border" + pair[0]] = css;
        anyBorder = true;
      }
    });
    if (!anyBorder && showGrid) {
      td.style.border = "1px solid #D0D0D0";
    }

    const al = cell && cell.alignment ? cell.alignment : null;
    if (al) {
      if (al.horizontal && al.horizontal !== "general") td.style.textAlign = al.horizontal;
      if (al.vertical === "top") td.style.verticalAlign = "top";
      if (al.vertical === "bottom") td.style.verticalAlign = "bottom";
      if (al.vertical === "middle" || al.vertical === "center") td.style.verticalAlign = "middle";
      if (al.wrapText) td.style.whiteSpace = "pre-wrap";
      if (al.indent) td.style.paddingLeft = 4 + al.indent * 10 + "px";
    } else if (cell && typeof cell.value === "number") {
      td.style.textAlign = "right";
    }
  }

  function fillCell(td, cell) {
    const v = cell && cell.value;
    if (v && v.richText && Array.isArray(v.richText)) {
      v.richText.forEach((part) => {
        const span = document.createElement("span");
        span.textContent = part.text || "";
        if (part.font) applyFont(span, part.font);
        td.appendChild(span);
      });
      return;
    }
    td.textContent = cellDisplay(cell);
  }

  function showGridLines(ws) {
    if (ws.pageSetup && ws.pageSetup.printGridLines === true) return true;
    if (ws.pageSetup && ws.pageSetup.printGridLines === false) return false;
    const views = ws.views || [];
    if (views[0] && views[0].showGridLines === false) return false;
    return true;
  }

  function usedRange(ws) {
    const dim = ws.dimensions;
    if (!dim || dim.bottom == null) return null;
    return {
      r1: dim.top || 1,
      c1: dim.left || 1,
      r2: dim.bottom,
      c2: dim.right,
    };
  }

  function buildSheetElement(ws, wb) {
    const range = usedRange(ws);
    if (!range) return null;
    const truncated = range.r2 - range.r1 + 1 > MAX_ROWS || range.c2 - range.c1 + 1 > MAX_COLS;
    const r1 = range.r1;
    const r2 = Math.min(range.r2, r1 + MAX_ROWS - 1);
    const c1 = range.c1;
    const c2 = Math.min(range.c2, c1 + MAX_COLS - 1);
    const merges = collectMerges(ws);
    const grid = showGridLines(ws);

    const wrap = document.createElement("div");
    wrap.className = "excel-pdf-sheet-wrap";

    const table = document.createElement("table");
    table.className = "excel-pdf-sheet";

    const colgroup = document.createElement("colgroup");
    const colPx = [];
    for (let c = c1; c <= c2; c++) {
      const def = ws.getColumn(c);
      const hidden = def && def.hidden;
      const px = hidden ? 0 : colWidthPx(def && def.width);
      colPx.push(px);
      const col = document.createElement("col");
      col.style.width = px + "px";
      if (hidden) col.style.display = "none";
      colgroup.appendChild(col);
    }
    table.appendChild(colgroup);

    const rowPx = [];
    for (let r = r1; r <= r2; r++) {
      const row = ws.getRow(r);
      if (row.hidden) {
        rowPx.push(0);
        continue;
      }
      const tr = document.createElement("tr");
      const h = rowHeightPx(row.height);
      rowPx.push(h);
      tr.style.height = h + "px";
      for (let c = c1; c <= c2; c++) {
        const def = ws.getColumn(c);
        if (def && def.hidden) continue;
        const key = r + "," + c;
        if (merges.skip.has(key)) continue;
        const td = document.createElement("td");
        const sp = merges.span.get(key);
        if (sp) {
          if (sp.rowspan > 1) td.rowSpan = sp.rowspan;
          if (sp.colspan > 1) td.colSpan = sp.colspan;
        }
        const cell = row.getCell(c);
        applyCellStyle(td, cell, grid);
        fillCell(td, cell);
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    wrap.appendChild(table);
    overlayImages(wrap, ws, wb, c1, r1, colPx, rowPx);
    return { el: wrap, truncated: truncated };
  }

  function overlayImages(wrap, ws, wb, c1, r1, colPx, rowPx) {
    let images = [];
    try {
      if (typeof ws.getImages === "function") images = ws.getImages() || [];
    } catch (e) {
      images = [];
    }
    if (!images.length) return;
    wrap.style.position = "relative";
    images.forEach((meta) => {
      try {
        const id = meta.imageId;
        const imgData = wb.getImage(typeof id === "string" ? parseInt(id, 10) : id);
        if (!imgData || !imgData.buffer) return;
        const ext = String(imgData.extension || "png").toLowerCase();
        const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : "image/png";
        const url = URL.createObjectURL(new Blob([imgData.buffer], { type: mime }));
        const img = document.createElement("img");
        img.src = url;
        img.className = "excel-pdf-drawing";
        const box = imageBox(meta, c1, r1, colPx, rowPx);
        img.style.left = box.left + "px";
        img.style.top = box.top + "px";
        img.style.width = box.width + "px";
        img.style.height = box.height + "px";
        wrap.appendChild(img);
      } catch (e) {
        /* skip broken drawing */
      }
    });
  }

  function sumRange(arr, from, to) {
    let s = 0;
    for (let i = from; i < to && i < arr.length; i++) s += arr[i];
    return s;
  }

  function imageBox(meta, c1, r1, colPx, rowPx) {
    const range = meta.range || {};
    const tl = range.tl || {};
    const br = range.br || {};
    const tlCol = tl.nativeCol != null ? tl.nativeCol : tl.col != null ? tl.col : 0;
    const tlRow = tl.nativeRow != null ? tl.nativeRow : tl.row != null ? tl.row : 0;
    const brCol = br.nativeCol != null ? br.nativeCol : br.col != null ? br.col : tlCol + 1;
    const brRow = br.nativeRow != null ? br.nativeRow : br.row != null ? br.row : tlRow + 1;
    const left = sumRange(colPx, 0, Math.max(0, Math.floor(tlCol) - (c1 - 1))) + (tlCol % 1) * (colPx[Math.floor(tlCol) - (c1 - 1)] || 0);
    const top = sumRange(rowPx, 0, Math.max(0, Math.floor(tlRow) - (r1 - 1))) + (tlRow % 1) * (rowPx[Math.floor(tlRow) - (r1 - 1)] || 0);
    let width = 80;
    let height = 60;
    if (range.ext && range.ext.width && range.ext.height) {
      width = range.ext.width > 200 ? range.ext.width / 9525 : range.ext.width;
      height = range.ext.height > 200 ? range.ext.height / 9525 : range.ext.height;
    } else {
      width = Math.max(8, sumRange(colPx, Math.max(0, Math.floor(tlCol) - (c1 - 1)), Math.max(0, Math.ceil(brCol) - (c1 - 1))));
      height = Math.max(8, sumRange(rowPx, Math.max(0, Math.floor(tlRow) - (r1 - 1)), Math.max(0, Math.ceil(brRow) - (r1 - 1))));
    }
    return { left: left, top: top, width: width, height: height };
  }

  function getSandbox() {
    let el = document.getElementById("excel-pdf-sandbox");
    if (!el) {
      el = document.createElement("div");
      el.id = "excel-pdf-sandbox";
      el.className = "excel-pdf-sandbox";
      el.setAttribute("aria-hidden", "true");
      document.body.appendChild(el);
    }
    return el;
  }

  function clearSandbox() {
    const el = document.getElementById("excel-pdf-sandbox");
    if (el) el.innerHTML = "";
  }

  function addCanvasSliced(pdf, canvas, margin, isFirstPage) {
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const maxW = pageW - margin * 2;
    const maxH = pageH - margin * 2 - 6;
    const ratio = canvas.width / maxW;
    const pageHeightPx = Math.max(1, Math.floor(maxH * ratio));
    const pageCanvas = document.createElement("canvas");
    const ctx = pageCanvas.getContext("2d");
    let srcY = 0;
    let firstSlice = true;
    while (srcY < canvas.height) {
      const sliceH = Math.min(pageHeightPx, canvas.height - srcY);
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceH;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      ctx.drawImage(canvas, 0, srcY, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
      if (!(isFirstPage && firstSlice)) pdf.addPage();
      const img = pageCanvas.toDataURL("image/jpeg", 0.92);
      const hMm = sliceH / ratio;
      pdf.addImage(img, "JPEG", margin, margin, maxW, hMm);
      srcY += sliceH;
      firstSlice = false;
      isFirstPage = false;
    }
    return pdf.internal.getNumberOfPages();
  }

  async function renderElementToPdf(pdf, el, margin, isFirstPage) {
    const sandbox = getSandbox();
    sandbox.innerHTML = "";
    sandbox.appendChild(el);
    const w = Math.max(el.scrollWidth, el.offsetWidth, 1);
    const h = Math.max(el.scrollHeight, el.offsetHeight, 1);
    const scale = Math.max(1, Math.min(2, 16000 / w, 16000 / h));
    const canvas = await global.html2canvas(el, {
      scale: scale,
      backgroundColor: "#ffffff",
      logging: false,
      useCORS: true,
      width: w,
      height: h,
      windowWidth: w,
      windowHeight: h,
    });
    addCanvasSliced(pdf, canvas, margin, isFirstPage);
    sandbox.innerHTML = "";
  }

  async function loadStyledWorkbook(buffer) {
    if (!global.ExcelJS) throw new Error("ExcelJS 라이브러리가 로드되지 않았습니다.");
    const wb = new global.ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    return wb;
  }

  async function loadFallbackWorkbook(buffer, fileName) {
    if (!global.XLSX) throw new Error("엑셀 파일을 읽을 수 없습니다.");
    const raw = global.XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true, cellStyles: true });
    const out = global.XLSX.write(raw, { bookType: "xlsx", type: "array" });
    return loadStyledWorkbook(out);
  }

  function visibleSheets(wb) {
    const all = wb.worksheets || [];
    const vis = all.filter((s) => !s.state || s.state === "visible");
    return vis.length ? vis : all;
  }

  async function convertFile(file, options, onProgress) {
    const opts = Object.assign({ paper: "a4", orientation: "landscape" }, options || {});
    const notify = typeof onProgress === "function" ? onProgress : function () {};
    const JsPDF = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
    if (!JsPDF) throw new Error("jsPDF 라이브러리가 로드되지 않았습니다.");
    if (!global.html2canvas) throw new Error("html2canvas 라이브러리가 로드되지 않았습니다.");

    notify("엑셀 읽는 중...");
    const buffer = await file.arrayBuffer();
    let workbook;
    try {
      if (STYLED_EXT.test(file.name)) workbook = await loadStyledWorkbook(buffer);
      else workbook = await loadFallbackWorkbook(buffer, file.name);
    } catch (err) {
      try {
        workbook = await loadFallbackWorkbook(buffer, file.name);
      } catch (err2) {
        throw new Error("엑셀 파일을 읽을 수 없습니다. (암호 보호이거나 지원하지 않는 형식일 수 있습니다)");
      }
    }

    const sheets = visibleSheets(workbook);
    if (!sheets.length) throw new Error("시트가 없는 엑셀 파일입니다.");

    const pdf = new JsPDF({
      orientation: opts.orientation === "portrait" ? "portrait" : "landscape",
      unit: "mm",
      format: opts.paper === "letter" ? "letter" : "a4",
      compress: true,
    });
    const margin = 6;
    let firstPage = true;
    let rendered = 0;
    let truncated = false;

    for (let s = 0; s < sheets.length; s++) {
      const ws = sheets[s];
      notify("시트 " + (s + 1) + "/" + sheets.length + " 서식 유지하며 그리는 중...");
      const built = buildSheetElement(ws, workbook);
      if (!built) continue;
      if (built.truncated) truncated = true;
      await renderElementToPdf(pdf, built.el, margin, firstPage);
      firstPage = false;
      rendered++;
    }

    clearSandbox();
    if (!rendered) throw new Error("출력할 내용이 없습니다. (빈 시트)");

    const blob = pdf.output("blob");
    return {
      blob: blob,
      pdfName: pdfNameFromExcel(file.name),
      sheetCount: rendered,
      pageCount: pdf.internal.getNumberOfPages(),
      truncated: truncated,
      message:
        "완료 · " +
        rendered +
        "개 시트 · " +
        pdf.internal.getNumberOfPages() +
        "페이지" +
        (truncated ? " (큰 시트는 앞부분만 포함)" : ""),
    };
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name || "download";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function downloadMany(items, zipName) {
    const ready = (items || []).filter((it) => it && it.blob);
    if (!ready.length) throw new Error("다운로드할 PDF가 없습니다.");
    if (ready.length === 1) {
      downloadBlob(ready[0].blob, ready[0].pdfName || "workbook.pdf");
      return { kind: "pdf", count: 1 };
    }
    if (!global.JSZip) throw new Error("JSZip 라이브러리가 로드되지 않았습니다.");
    const zip = new global.JSZip();
    const used = new Set();
    ready.forEach((it) => {
      zip.file(uniqueName(it.pdfName || "workbook.pdf", used), it.blob);
    });
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    downloadBlob(blob, zipName || "Excel_to_PDF.zip");
    return { kind: "zip", count: ready.length };
  }

  global.ExcelToPdf = {
    isExcelFile: isExcelFile,
    convertFile: convertFile,
    downloadBlob: downloadBlob,
    downloadMany: downloadMany,
    pdfNameFromExcel: pdfNameFromExcel,
  };
})(window);
