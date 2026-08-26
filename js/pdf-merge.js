/* ============================================================
   pdf-merge.js
   여러 PDF를 목록 순서대로 하나의 PDF로 합치기 (브라우저, pdf-lib)
   ============================================================ */
(function (global) {
  "use strict";

  const PDF_EXT = /\.pdf$/i;

  function isPdfFile(file) {
    return file && (file.type === "application/pdf" || PDF_EXT.test(file.name));
  }

  async function mergeFiles(files, onProgress) {
    const notify = typeof onProgress === "function" ? onProgress : function () {};
    if (!global.PDFLib) throw new Error("pdf-lib 라이브러리가 로드되지 않았습니다.");
    const list = (files || []).filter(Boolean);
    if (list.length < 2) throw new Error("합치려면 PDF를 2개 이상 넣어 주세요.");

    const out = await global.PDFLib.PDFDocument.create();
    let totalPages = 0;
    const failed = [];

    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      notify(`파일 ${i + 1}/${list.length} 넣는 중... ${file.name}`);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const src = await global.PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
        const indices = src.getPageIndices();
        const copied = await out.copyPages(src, indices);
        copied.forEach((p) => out.addPage(p));
        totalPages += copied.length;
      } catch (err) {
        failed.push(file.name);
      }
    }

    if (!totalPages) {
      throw new Error(
        "합칠 페이지가 없습니다." + (failed.length ? " 실패: " + failed.join(", ") : " (암호 보호 또는 손상 가능)")
      );
    }

    notify("PDF 저장 중...");
    const bytes = await out.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const pdfName = "Merged_" + (global.ConvertCommon ? global.ConvertCommon.dateStamp() : "PDF") + ".pdf";
    let message = "완료 · " + list.length + "개 파일 · " + totalPages + "페이지";
    if (failed.length) message += " · 실패 " + failed.length + "개 (" + failed.join(", ") + ")";
    return { blob: blob, pdfName: pdfName, pageCount: totalPages, failed: failed, message: message };
  }

  global.PdfMerge = {
    isPdfFile: isPdfFile,
    mergeFiles: mergeFiles,
  };
})(window);
