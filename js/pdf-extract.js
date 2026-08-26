/* ============================================================
   pdf-extract.js
   pdf.js 래퍼: PDF에서 위치정보 기반으로 줄/컬럼을 재구성한 텍스트 추출
   ============================================================ */
(function (global) {
  "use strict";

  const COL_GAP_PT = 12; // 이 값(pt) 이상 x간격이 벌어지면 별도 컬럼(라벨|값)으로 간주
  const LINE_TOL_PT = 2.5; // 이 값 이내 y차이는 같은 줄로 간주

  function waitForPdfJs() {
    return new Promise((resolve) => {
      if (global.__pdfjsReady && global.pdfjsLib) return resolve();
      document.addEventListener("pdfjs-ready", () => resolve(), { once: true });
      // 안전장치: 이미 이벤트를 놓쳤을 경우 폴링
      const iv = setInterval(() => {
        if (global.__pdfjsReady && global.pdfjsLib) {
          clearInterval(iv);
          resolve();
        }
      }, 50);
    });
  }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  // items(텍스트조각들)를 y좌표로 줄 그룹핑 후 x좌표 정렬
  function groupIntoLines(items) {
    const withPos = items
      .filter((it) => it.str !== undefined)
      .map((it) => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        width: it.width || 0,
      }));

    withPos.sort((a, b) => b.y - a.y || a.x - b.x);

    const lines = [];
    withPos.forEach((it) => {
      let line = lines.find((l) => Math.abs(l.y - it.y) <= LINE_TOL_PT);
      if (!line) {
        line = { y: it.y, items: [] };
        lines.push(line);
      }
      line.items.push(it);
    });

    lines.forEach((l) => l.items.sort((a, b) => a.x - b.x));
    lines.sort((a, b) => b.y - a.y);
    return lines;
  }

  // 한 줄의 items를 x간격 기준으로 "컬럼"으로 쪼갬 (넓은 간격 = 다른 셀/라벨-값 구분)
  function lineToColumns(line) {
    const cols = [];
    let cur = [];
    let prevEndX = null;
    line.items.forEach((it) => {
      if (prevEndX !== null && it.x - prevEndX > COL_GAP_PT) {
        if (cur.length) cols.push(cur.map((x) => x.str).join("").trim());
        cur = [];
      }
      cur.push(it);
      prevEndX = it.x + Math.max(it.width, it.str.length * 4);
    });
    if (cur.length) cols.push(cur.map((x) => x.str).join("").trim());
    return cols.filter((c) => c.length > 0);
  }

  function lineToPlainText(line) {
    return line.items.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim();
  }

  async function extractFromFile(file) {
    await waitForPdfJs();
    const buf = await readFileAsArrayBuffer(file);
    const loadingTask = global.pdfjsLib.getDocument({ data: buf });
    const doc = await loadingTask.promise;

    const pages = [];
    let totalChars = 0;
    let fullTextParts = [];

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      totalChars += content.items.reduce((s, it) => s + (it.str ? it.str.length : 0), 0);

      const lines = groupIntoLines(content.items);
      const pageLines = lines.map((l) => ({
        y: l.y,
        cols: lineToColumns(l),
        text: lineToPlainText(l),
      }));

      pageLines.forEach((pl) => fullTextParts.push(pl.text));
      pages.push({ pageNum, lines: pageLines });
    }

    return {
      fileName: file.name,
      numPages: doc.numPages,
      pages,
      fullText: fullTextParts.join("\n"),
      hasTextLayer: totalChars > 20, // 텍스트가 거의 없으면 스캔본(이미지)로 판단
      charCount: totalChars,
    };
  }

  global.PdfExtract = { extractFromFile, waitForPdfJs };
})(window);
