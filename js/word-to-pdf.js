/* ============================================================
   word-to-pdf.js
   브라우저에서 Word(.docx/.docm) → PDF 변환 (여러 파일 지원)
   ============================================================ */
(function (global) {
  "use strict";

  const WORD_EXT = /\.(docx|docm)$/i;
  const OLD_DOC = /\.doc$/i;

  function isWordFile(file) {
    return file && WORD_EXT.test(file.name);
  }

  function isOldDoc(file) {
    return file && OLD_DOC.test(file.name) && !WORD_EXT.test(file.name);
  }

  function getSandbox() {
    let el = document.getElementById("word-pdf-sandbox");
    if (!el) {
      el = document.createElement("div");
      el.id = "word-pdf-sandbox";
      el.className = "doc-pdf-sandbox";
      el.setAttribute("aria-hidden", "true");
      document.body.appendChild(el);
    }
    return el;
  }

  function paperPx(options) {
    const landscape = options.orientation === "landscape";
    if (options.paper === "letter") {
      return landscape ? { w: 1056, h: 816 } : { w: 816, h: 1056 };
    }
    return landscape ? { w: 1123, h: 794 } : { w: 794, h: 1123 };
  }

  function waitForImages(root) {
    const imgs = Array.from(root.querySelectorAll("img"));
    return Promise.all(
      imgs.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          img.onload = img.onerror = () => resolve();
        });
      })
    );
  }

  function paginateChildren(source, maxHeight) {
    const pages = [];
    let current = document.createElement("div");
    current.className = "word-pdf-page";
    source.parentNode.appendChild(current);

    const nodes = Array.from(source.childNodes);
    nodes.forEach((node) => {
      current.appendChild(node);
      if (current.offsetHeight > maxHeight && current.childNodes.length > 1) {
        current.removeChild(node);
        pages.push(current);
        current = document.createElement("div");
        current.className = "word-pdf-page";
        source.parentNode.appendChild(current);
        current.appendChild(node);
      }
    });
    if (current.childNodes.length) pages.push(current);
    else if (current.parentNode) current.parentNode.removeChild(current);
    return pages;
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
      const img = pageCanvas.toDataURL("image/jpeg", 0.86);
      const hMm = sliceH / ratio;
      pdf.addImage(img, "JPEG", margin, margin, maxW, hMm);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(120);
      const pageNo = pdf.internal.getNumberOfPages();
      pdf.text(String(pageNo), pageW / 2, pageH - 4, { align: "center" });
      srcY += sliceH;
      firstSlice = false;
      isFirstPage = false;
    }
    return pdf.internal.getNumberOfPages();
  }

  async function convertFile(file, options, onProgress) {
    const opts = Object.assign({ paper: "a4", orientation: "portrait" }, options || {});
    const notify = typeof onProgress === "function" ? onProgress : function () {};

    if (isOldDoc(file)) {
      throw new Error("구버전 .doc은 지원하지 않습니다. Word에서 .docx로 저장한 뒤 다시 넣어 주세요.");
    }
    if (!global.mammoth) throw new Error("mammoth 라이브러리가 로드되지 않았습니다.");
    const JsPDF = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
    if (!JsPDF) throw new Error("jsPDF 라이브러리가 로드되지 않았습니다.");
    if (!global.html2canvas) throw new Error("html2canvas 라이브러리가 로드되지 않았습니다.");

    notify("Word 문서 읽는 중...");
    const buffer = await file.arrayBuffer();
    let html;
    try {
      const result = await global.mammoth.convertToHtml(
        { arrayBuffer: buffer },
        {
          convertImage: global.mammoth.images.imgElement((image) =>
            image.read("base64").then((b64) => ({
              src: "data:" + image.contentType + ";base64," + b64,
            }))
          ),
        }
      );
      html = (result.value || "").trim();
    } catch (err) {
      throw new Error("Word 파일을 읽을 수 없습니다. (.docx/.docm 만 지원, 암호 보호 파일 불가)");
    }
    if (!html) throw new Error("문서에 변환할 내용이 없습니다.");

    const pdf = new JsPDF({
      orientation: opts.orientation === "landscape" ? "landscape" : "portrait",
      unit: "mm",
      format: opts.paper === "letter" ? "letter" : "a4",
      compress: true,
    });
    const margin = 8;
    const px = paperPx(opts);
    const contentW = px.w - 80;
    const pageMaxH = px.h - 80;

    const sandbox = getSandbox();
    sandbox.innerHTML = "";
    const stage = document.createElement("div");
    stage.className = "word-pdf-stage";
    stage.style.width = contentW + "px";
    sandbox.appendChild(stage);

    const source = document.createElement("div");
    source.className = "word-pdf-source";
    source.style.width = contentW + "px";
    source.innerHTML = html;
    stage.appendChild(source);
    await waitForImages(source);

    notify("페이지 나누는 중...");
    const pages = paginateChildren(source, pageMaxH);
    if (source.parentNode) source.parentNode.removeChild(source);
    if (!pages.length) throw new Error("렌더링할 페이지가 없습니다.");

    let first = true;
    for (let i = 0; i < pages.length; i++) {
      notify(`페이지 ${i + 1}/${pages.length} 렌더링 중...`);
      pages[i].style.width = contentW + "px";
      const canvas = await global.html2canvas(pages[i], {
        scale: 2,
        backgroundColor: "#ffffff",
        logging: false,
        useCORS: true,
      });
      addCanvasSliced(pdf, canvas, margin, first);
      first = false;
    }

    sandbox.innerHTML = "";
    const blob = pdf.output("blob");
    const pdfName = global.ConvertCommon
      ? global.ConvertCommon.replaceExt(file.name, ".pdf")
      : file.name.replace(/\.[^.]+$/, "") + ".pdf";
    return {
      blob: blob,
      pdfName: pdfName,
      pageCount: pdf.internal.getNumberOfPages(),
      message: "완료 · " + pdf.internal.getNumberOfPages() + "페이지",
    };
  }

  global.WordToPdf = {
    isWordFile: isWordFile,
    isOldDoc: isOldDoc,
    convertFile: convertFile,
  };
})(window);
