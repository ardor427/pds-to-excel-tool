/* ============================================================
   convert-common.js — 변환 탭 공통 (다운로드, 드롭존, 파일 목록)
   ============================================================ */
(function (global) {
  "use strict";

  function dateStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
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
    if (!ready.length) throw new Error("다운로드할 파일이 없습니다.");
    if (ready.length === 1) {
      downloadBlob(ready[0].blob, ready[0].pdfName || "download.pdf");
      return { kind: "pdf", count: 1 };
    }
    if (!global.JSZip) throw new Error("JSZip 라이브러리가 로드되지 않았습니다.");
    const zip = new global.JSZip();
    const used = new Set();
    ready.forEach((it) => {
      zip.file(uniqueName(it.pdfName || "file.pdf", used), it.blob);
    });
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    downloadBlob(blob, zipName || "converted.zip");
    return { kind: "zip", count: ready.length };
  }

  function bindDropZone(opts) {
    const dropZone = document.getElementById(opts.zoneId);
    const fileInput = document.getElementById(opts.inputId);
    const browseBtn = document.getElementById(opts.browseId);
    const accept = opts.accept;
    const onFiles = opts.onFiles;
    if (!dropZone || !fileInput || !browseBtn) return;

    browseBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      fileInput.click();
    });
    dropZone.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      fileInput.click();
    });
    fileInput.addEventListener("change", (e) => {
      const files = Array.from(e.target.files || []).filter(accept);
      if (files.length) onFiles(files);
      fileInput.value = "";
    });
    ["dragenter", "dragover"].forEach((ev) =>
      dropZone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropZone.classList.add("dragover");
      })
    );
    ["dragleave", "drop"].forEach((ev) =>
      dropZone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
      })
    );
    dropZone.addEventListener("drop", (e) => {
      const files = Array.from(e.dataTransfer.files || []).filter(accept);
      if (files.length) onFiles(files);
    });
  }

  function replaceExt(name, ext) {
    const base = String(name || "file").replace(/\.[^.]+$/, "");
    return (base || "file") + ext;
  }

  global.ConvertCommon = {
    dateStamp: dateStamp,
    uniqueName: uniqueName,
    downloadBlob: downloadBlob,
    downloadMany: downloadMany,
    bindDropZone: bindDropZone,
    replaceExt: replaceExt,
  };
})(window);
