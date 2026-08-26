/* ============================================================
   excel-to-pdf.js
   브라우저에서 Excel(xlsx/xlsm/xls/csv) → PDF 변환 (여러 파일 지원)
   ============================================================ */
(function (global) {
  "use strict";

  const MAX_ROWS = 2000;
  const MAX_COLS = 40;
  const EXCEL_EXT = /\.(xlsx|xlsm|xls|csv)$/i;

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

  function cellText(v) {
    if (v == null || v === "") return "";
    if (v instanceof Date && !isNaN(v.getTime())) {
      const p = (n) => String(n).padStart(2, "0");
      return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
    }
    return String(v);
  }

  function trimMatrix(rows) {
    let lastRow = rows.length - 1;
    while (lastRow >= 0 && rows[lastRow].every((c) => c === "")) lastRow--;
    if (lastRow < 0) return [];
    rows = rows.slice(0, lastRow + 1);
    let lastCol = 0;
    rows.forEach((r) => {
      for (let c = r.length - 1; c >= 0; c--) {
        if (r[c] !== "") {
          if (c > lastCol) lastCol = c;
          break;
        }
      }
    });
    return rows.map((r) => {
      const cut = r.slice(0, lastCol + 1);
      while (cut.length <= lastCol) cut.push("");
      return cut;
    });
  }

  function sheetToMatrix(ws) {
    const raw = global.XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "", blankrows: true });
    const limited = raw.slice(0, MAX_ROWS).map((row) => {
      const arr = Array.isArray(row) ? row : [];
      return arr.slice(0, MAX_COLS).map(cellText);
    });
    const truncated = raw.length > MAX_ROWS || raw.some((row) => (row || []).length > MAX_COLS);
    return { matrix: trimMatrix(limited), truncated };
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
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

  function buildChunkElement(sheetName, header, bodyRows, showTitle) {
    const wrap = document.createElement("div");
    wrap.className = "excel-pdf-page";
    if (showTitle) {
      const h = document.createElement("div");
      h.className = "excel-pdf-sheet-title";
      h.textContent = sheetName;
      wrap.appendChild(h);
    }
    const table = document.createElement("table");
    table.className = "excel-pdf-table";
    if (header && header.length) {
      const thead = document.createElement("thead");
      const tr = document.createElement("tr");
      header.forEach((cell) => {
        const th = document.createElement("th");
        th.textContent = cell;
        tr.appendChild(th);
      });
      thead.appendChild(tr);
      table.appendChild(thead);
    }
    const tbody = document.createElement("tbody");
    bodyRows.forEach((row) => {
      const tr = document.createElement("tr");
      const cols = header && header.length ? header.length : row.length;
      for (let c = 0; c < cols; c++) {
        const td = document.createElement("td");
        td.textContent = row[c] == null ? "" : String(row[c]);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function chunkSize(options) {
    if (options.orientation === "portrait") return 32;
    return 22;
  }

  function addCanvasPage(pdf, canvas, margin) {
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const maxW = pageW - margin * 2;
    const maxH = pageH - margin * 2 - 6;
    let w = maxW;
    let h = (canvas.height * w) / canvas.width;
    if (h > maxH) {
      h = maxH;
      w = (canvas.width * h) / canvas.height;
    }
    const x = margin + (maxW - w) / 2;
    const img = canvas.toDataURL("image/jpeg", 0.86);
    pdf.addImage(img, "JPEG", x, margin, w, h);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(120);
    const pageNo = pdf.internal.getNumberOfPages();
    pdf.text(String(pageNo), pageW / 2, pageH - 4, { align: "center" });
  }

  async function renderChunkToPdf(pdf, chunkEl, margin, isFirstPage) {
    const sandbox = getSandbox();
    sandbox.innerHTML = "";
    sandbox.appendChild(chunkEl);
    const canvas = await global.html2canvas(chunkEl, {
      scale: 2,
      backgroundColor: "#ffffff",
      logging: false,
      useCORS: true,
    });
    if (!isFirstPage) pdf.addPage();
    addCanvasPage(pdf, canvas, margin);
    sandbox.innerHTML = "";
  }

  async function convertFile(file, options, onProgress) {
    const opts = Object.assign({ paper: "a4", orientation: "landscape" }, options || {});
    const notify = typeof onProgress === "function" ? onProgress : function () {};

    if (!global.XLSX) throw new Error("SheetJS(XLSX) 라이브러리가 로드되지 않았습니다.");
    const JsPDF = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
    if (!JsPDF) throw new Error("jsPDF 라이브러리가 로드되지 않았습니다.");
    if (!global.html2canvas) throw new Error("html2canvas 라이브러리가 로드되지 않았습니다.");

    notify("엑셀 읽는 중...");
    const buffer = await file.arrayBuffer();
    let workbook;
    try {
      workbook = global.XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true });
    } catch (err) {
      throw new Error("엑셀 파일을 읽을 수 없습니다. (암호 보호 또는 손상 가능)");
    }

    const sheetNames = workbook.SheetNames || [];
    if (!sheetNames.length) throw new Error("시트가 없는 엑셀 파일입니다.");

    const sheets = [];
    let truncated = false;
    sheetNames.forEach((name) => {
      const parsed = sheetToMatrix(workbook.Sheets[name]);
      if (parsed.truncated) truncated = true;
      if (parsed.matrix.length) sheets.push({ name: name || "Sheet", matrix: parsed.matrix });
    });
    if (!sheets.length) throw new Error("출력할 데이터가 없습니다. (빈 시트)");

    const pdf = new JsPDF({
      orientation: opts.orientation === "portrait" ? "portrait" : "landscape",
      unit: "mm",
      format: opts.paper === "letter" ? "letter" : "a4",
      compress: true,
    });
    const margin = 8;
    const rowsPerPage = chunkSize(opts);
    let pageCount = 0;
    let firstPage = true;

    for (let s = 0; s < sheets.length; s++) {
      const sheet = sheets[s];
      const header = sheet.matrix[0] || [];
      const body = sheet.matrix.length > 1 ? sheet.matrix.slice(1) : [];
      const chunks = [];
      if (!body.length) {
        chunks.push({ header: header, body: [[]], showTitle: true });
      } else {
        for (let i = 0; i < body.length; i += rowsPerPage) {
          chunks.push({
            header: header,
            body: body.slice(i, i + rowsPerPage),
            showTitle: i === 0,
          });
        }
      }
      for (let c = 0; c < chunks.length; c++) {
        notify(`시트 ${s + 1}/${sheets.length} · 페이지 ${c + 1}/${chunks.length} 렌더링 중...`);
        const el = buildChunkElement(sheet.name, chunks[c].header, chunks[c].body, chunks[c].showTitle);
        await renderChunkToPdf(pdf, el, margin, firstPage);
        firstPage = false;
        pageCount++;
      }
    }

    clearSandbox();
    const blob = pdf.output("blob");
    return {
      blob: blob,
      pdfName: pdfNameFromExcel(file.name),
      sheetCount: sheets.length,
      pageCount: pageCount,
      truncated: truncated,
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
