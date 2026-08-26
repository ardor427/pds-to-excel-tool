/* ============================================================
   excel-export.js
   ExcelJS를 이용한 가독성 높은 Excel 요약 생성 (통합/분리 모드)
   ============================================================ */
(function (global) {
  "use strict";

  const NAVY = "FF10243E";
  const NAVY2 = "FF16324F";
  const ACCENT = "FFD9822B";
  const LIGHT = "FFEEF2F6";
  const BORDER_COLOR = "FFDFE4EA";
  const WHITE = "FFFFFFFF";

  function thinBorder() {
    const side = { style: "thin", color: { argb: BORDER_COLOR } };
    return { top: side, bottom: side, left: side, right: side };
  }

  function sanitizeSheetName(name, used) {
    let n = String(name || "Sheet").replace(/[\\/*?:[\]]/g, " ").trim();
    if (!n) n = "Sheet";
    if (n.length > 28) n = n.slice(0, 28);
    let candidate = n;
    let i = 2;
    while (used.has(candidate.toLowerCase())) {
      candidate = (n.length > 24 ? n.slice(0, 24) : n) + "_" + i;
      i++;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  }

  // records: parseExtraction() 결과 배열(검토탭에서 편집된 값 반영, field.included 체크 반영)
  // options: { mode: 'consolidated'|'separate', selectedFieldIds:[...], includeOther: bool }
  async function buildWorkbook(records, options) {
    const wb = new ExcelJS.Workbook();
    wb.creator = "PDS to Excel Summary Tool";
    wb.created = new Date();

    if (options.mode === "consolidated") {
      buildConsolidatedSheet(wb, records, options);
    } else {
      buildSeparateSheets(wb, records, options);
    }
    return wb;
  }

  function styleHeaderCell(cell) {
    cell.font = { bold: true, color: { argb: WHITE }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = thinBorder();
  }

  function buildConsolidatedSheet(wb, records, options) {
    const ws = wb.addWorksheet("Summary", { views: [{ state: "frozen", xSplit: 2, ySplit: 2 }] });

    const allFields = FieldDictionary.allFields();
    const selected = options.selectedFieldIds && options.selectedFieldIds.length
      ? allFields.filter((f) => options.selectedFieldIds.includes(f.id))
      : allFields;

    // 그룹별로 정렬 (general 먼저)
    const groupOrder = ["general", "vessel", "heatExchanger", "desuperheater", "filter"];
    selected.sort((a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group));

    const headerRow1 = ["", ""];
    const headerRow2 = ["File / 파일명", "Equipment Type / 장비종류"];
    selected.forEach((f) => {
      headerRow1.push(FieldDictionary.FIELD_GROUPS[f.group].title);
      headerRow2.push(f.label);
    });

    ws.addRow(headerRow1);
    ws.addRow(headerRow2);

    // 그룹 타이틀 병합
    let colIdx = 3;
    let i = 0;
    while (i < selected.length) {
      let j = i;
      while (j + 1 < selected.length && selected[j + 1].group === selected[i].group) j++;
      if (j > i) {
        ws.mergeCells(1, colIdx, 1, colIdx + (j - i));
      }
      colIdx += j - i + 1;
      i = j + 1;
    }

    for (let c = 1; c <= 2 + selected.length; c++) {
      styleHeaderCell(ws.getCell(1, c));
      styleHeaderCell(ws.getCell(2, c));
    }
    ws.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY2 } };
    ws.getCell(1, 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY2 } };

    records.forEach((rec, idx) => {
      const row = [rec.fileName, rec.equipmentLabel || rec.equipmentType || ""];
      selected.forEach((f) => {
        const fv = rec.fields && rec.fields[f.id];
        row.push(fv && fv.included !== false ? fv.value || "" : "");
      });
      const r = ws.addRow(row);
      r.eachCell((cell, colNumber) => {
        cell.border = thinBorder();
        cell.alignment = { vertical: "middle", wrapText: colNumber <= 2 };
        if (idx % 2 === 1) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
        }
        if (colNumber > 2 && !cell.value) {
          cell.font = { color: { argb: "FFB3261E" }, italic: true };
          cell.value = "—";
        }
      });
    });

    ws.getColumn(1).width = 24;
    ws.getColumn(2).width = 20;
    for (let c = 3; c <= 2 + selected.length; c++) ws.getColumn(c).width = 20;

    ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 2 + selected.length } };
    ws.getRow(1).height = 20;
    ws.getRow(2).height = 32;
  }

  function buildSeparateSheets(wb, records, options) {
    const used = new Set();
    records.forEach((rec) => {
      const tagField = rec.fields && rec.fields["tag_no"];
      const sheetTitle = sanitizeSheetName((tagField && tagField.value) || rec.fileName.replace(/\.pdf$/i, ""), used);
      const ws = wb.addWorksheet(sheetTitle, { views: [{ state: "frozen", ySplit: 1 }] });

      ws.getColumn(1).width = 30;
      ws.getColumn(2).width = 45;

      const titleRow = ws.addRow([rec.fileName, rec.equipmentLabel || rec.equipmentType || ""]);
      titleRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: WHITE }, size: 12 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
        cell.alignment = { vertical: "middle" };
      });
      ws.getRow(1).height = 22;

      const groupOrder = ["general", "vessel", "heatExchanger", "desuperheater", "filter"];
      groupOrder.forEach((g) => {
        const groupDef = FieldDictionary.FIELD_GROUPS[g];
        const fieldsInGroup = groupDef.fields.filter((f) => {
          const fv = rec.fields && rec.fields[f.id];
          return fv && fv.included !== false && fv.value;
        });
        if (!fieldsInGroup.length) return;

        const secRow = ws.addRow([groupDef.title, ""]);
        ws.mergeCells(secRow.number, 1, secRow.number, 2);
        secRow.getCell(1).font = { bold: true, color: { argb: NAVY2 } };
        secRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
        secRow.getCell(1).border = thinBorder();
        secRow.getCell(2).border = thinBorder();

        fieldsInGroup.forEach((f) => {
          const fv = rec.fields[f.id];
          const r = ws.addRow([f.label, fv.value]);
          r.getCell(1).font = { bold: true, color: { argb: "FF16324F" } };
          r.getCell(1).border = thinBorder();
          r.getCell(2).border = thinBorder();
          r.getCell(2).alignment = { wrapText: true };
        });
      });

      if (options.includeOther && rec.other && rec.other.length) {
        const secRow = ws.addRow(["기타 항목 (Other / 미분류)", ""]);
        ws.mergeCells(secRow.number, 1, secRow.number, 2);
        secRow.getCell(1).font = { bold: true, color: { argb: "FF7A4B00" } };
        secRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF4E5" } };
        secRow.getCell(1).border = thinBorder();
        secRow.getCell(2).border = thinBorder();
        rec.other.forEach((o) => {
          if (o.included === false) return;
          const r = ws.addRow([o.label, o.value]);
          r.getCell(1).border = thinBorder();
          r.getCell(2).border = thinBorder();
          r.getCell(2).alignment = { wrapText: true };
        });
      }
    });
  }

  async function exportAndDownload(records, options) {
    const wb = await buildWorkbook(records, options);
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = options.downloadName || "PDS_Summary.xlsx";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  global.ExcelExport = { buildWorkbook, exportAndDownload };
})(window);
