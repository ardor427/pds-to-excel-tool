/* ============================================================
   pdf-ocr.js
   스캔 PDF → 검색/복사 가능한 OCR PDF (여러 파일, 브라우저 내 Tesseract)
   ============================================================ */
(function (global) {
  "use strict";

  const PDF_EXT = /\.pdf$/i;
  let ocrWorker = null;
  let ocrLang = null;
  let pageCtx = { i: 1, n: 1, notify: function () {} };

  function isPdfFile(file) {
    return file && (file.type === "application/pdf" || PDF_EXT.test(file.name));
  }

  function waitPdfjs() {
    if (global.pdfjsLib) return Promise.resolve(global.pdfjsLib);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("pdf.js 로드 시간 초과")), 20000);
      document.addEventListener(
        "pdfjs-ready",
        () => {
          clearTimeout(t);
          if (global.pdfjsLib) resolve(global.pdfjsLib);
          else reject(new Error("pdf.js를 불러오지 못했습니다."));
        },
        { once: true }
      );
    });
  }

  async function getWorker(lang, notify) {
    if (ocrWorker && ocrLang === lang) return ocrWorker;
    if (ocrWorker) {
      try {
        await ocrWorker.terminate();
      } catch (e) {
        /* ignore */
      }
      ocrWorker = null;
    }
    if (!global.Tesseract) throw new Error("Tesseract.js 라이브러리가 로드되지 않았습니다.");
    notify("OCR 엔진 준비 중 (최초 1회 언어 데이터 다운로드)...");
    ocrWorker = await global.Tesseract.createWorker(lang, 1, {
      logger: (m) => {
        if (!m || !m.status) return;
        if (m.status === "loading tesseract core") notify("OCR 엔진 로딩 중...");
        else if (m.status === "loading language traineddata") notify("언어 데이터 다운로드 중 (최초 1회)...");
        else if (m.status === "initializing api") notify("OCR 초기화 중...");
        else if (m.status === "recognizing text") {
          const pct = Math.round((m.progress || 0) * 100);
          pageCtx.notify(`페이지 ${pageCtx.i}/${pageCtx.n} 문자 인식 중... ${pct}%`);
        }
      },
    });
    ocrLang = lang;
    return ocrWorker;
  }

  async function mergePdfBytes(pageBytesList) {
    if (pageBytesList.length === 1) {
      return new Blob([pageBytesList[0]], { type: "application/pdf" });
    }
    if (!global.PDFLib) throw new Error("pdf-lib 라이브러리가 로드되지 않았습니다.");
    const out = await global.PDFLib.PDFDocument.create();
    for (let i = 0; i < pageBytesList.length; i++) {
      const src = await global.PDFLib.PDFDocument.load(pageBytesList[i]);
      const copied = await out.copyPages(src, src.getPageIndices());
      copied.forEach((p) => out.addPage(p));
    }
    const bytes = await out.save();
    return new Blob([bytes], { type: "application/pdf" });
  }

  function ensureMapHelpers() {
    if (typeof Map === "undefined") return;
    if (typeof Map.prototype.getOrInsertComputed !== "function") {
      Map.prototype.getOrInsertComputed = function (key, compute) {
        if (this.has(key)) return this.get(key);
        const value = typeof compute === "function" ? compute(key) : compute;
        this.set(key, value);
        return value;
      };
    }
    if (typeof Map.prototype.getOrInsert !== "function") {
      Map.prototype.getOrInsert = function (key, value) {
        if (this.has(key)) return this.get(key);
        this.set(key, value);
        return value;
      };
    }
  }

  async function renderPageToCanvas(page, maxEdge) {
    ensureMapHelpers();
    const base = page.getViewport({ scale: 1 });
    let scale = 2;
    const longEdge = Math.max(base.width, base.height);
    if (longEdge * scale > maxEdge) scale = maxEdge / longEdge;
    const viewport = page.getViewport({ scale: scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const params = { canvas: canvas, canvasContext: ctx, viewport: viewport };
    await page.render(params).promise;
    return canvas;
  }

  async function convertFile(file, options, onProgress) {
    const opts = Object.assign({ lang: "kor+eng" }, options || {});
    const notify = typeof onProgress === "function" ? onProgress : function () {};
    pageCtx.notify = notify;

    const pdfjsLib = await waitPdfjs();
    notify("PDF 여는 중...");
    const data = new Uint8Array(await file.arrayBuffer());
    let pdf;
    try {
      pdf = await pdfjsLib.getDocument({ data: data.slice() }).promise;
    } catch (err) {
      throw new Error("PDF를 열 수 없습니다. (암호 보호 또는 손상 가능)");
    }

    const numPages = pdf.numPages;
    if (!numPages) throw new Error("페이지가 없는 PDF입니다.");

    const worker = await getWorker(opts.lang || "kor+eng", notify);
    const pagePdfs = [];
    let recognizedChars = 0;

    for (let i = 1; i <= numPages; i++) {
      pageCtx.i = i;
      pageCtx.n = numPages;
      notify(`페이지 ${i}/${numPages} 이미지로 렌더링 중...`);
      const page = await pdf.getPage(i);
      const canvas = await renderPageToCanvas(page, 2000);
      notify(`페이지 ${i}/${numPages} 문자 인식 중...`);
      const result = await worker.recognize(canvas, { pdfTitle: file.name }, { pdf: true, text: true });
      const rec = result && result.data ? result.data : {};
      if (!rec.pdf) throw new Error("OCR PDF 생성에 실패했습니다. (페이지 " + i + ")");
      pagePdfs.push(new Uint8Array(rec.pdf));
      recognizedChars += rec.text ? rec.text.replace(/\s+/g, "").length : 0;
      canvas.width = 0;
      canvas.height = 0;
    }

    notify("검색 가능한 PDF로 합치는 중...");
    const blob = await mergePdfBytes(pagePdfs);
    const stem = global.ConvertCommon
      ? global.ConvertCommon.replaceExt(file.name, "")
      : String(file.name || "document").replace(/\.pdf$/i, "");
    return {
      blob: blob,
      pdfName: stem + "_OCR.pdf",
      pageCount: numPages,
      message: `완료 · ${numPages}페이지 · 인식 글자 약 ${recognizedChars}자`,
    };
  }

  global.PdfOcr = {
    isPdfFile: isPdfFile,
    convertFile: convertFile,
  };
})(window);
