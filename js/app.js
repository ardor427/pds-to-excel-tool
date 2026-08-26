/* ============================================================
   app.js — 메인 앱 로직: 업로드 → 추출/분류/파싱 → 검토/수정 → 내보내기
   ============================================================ */
(function () {
  "use strict";

  const state = {
    files: [], // {id, file, status, message, record}
  };
  let idSeq = 1;
  const EQUIPMENT_TYPES = [
    { id: "vessel", label: "Vessel / 압력용기" },
    { id: "heatExchanger", label: "Heat Exchanger / 열교환기" },
    { id: "desuperheater", label: "Desuperheater / 감온기" },
    { id: "filter", label: "Filter / 필터" },
    { id: "unknown", label: "미분류 / Unknown" },
  ];

  const DISCLAIMERS = {
    pds:
      '⚠ 이 도구는 PDF의 <b>텍스트 레이어</b>를 읽어 라벨(예: "Design Pressure")을 패턴으로 찾아 값을 추출하는 <b>오프라인 방식</b>입니다. ' +
      '벤더/양식마다 레이아웃이 달라 일부 항목은 못 찾거나 잘못 매칭될 수 있습니다 — 반드시 "검토 &amp; 수정" 탭에서 확인 후 내보내세요. ' +
      "스캔본(이미지) PDF는 텍스트가 없어 자동 인식이 안 됩니다 (아래 파일목록에 표시됨). " +
      "모든 처리는 브라우저 안에서만 이루어지며 파일이 외부로 전송되지 않습니다.",
    "excel-pdf":
      "⚠ Excel 파일을 브라우저에서 PDF로 변환합니다. 수식은 엑셀에 저장된 표시값 기준으로 들어가며, 매크로·차트·조건부 서식은 표 값만 반영됩니다. " +
      "매우 큰 시트는 앞부분만 포함될 수 있습니다. 여러 파일을 넣으면 각각 PDF로 만들고, 2개 이상이면 ZIP으로 내려받습니다. 파일은 외부로 전송되지 않습니다.",
    "word-pdf":
      "⚠ Word(.docx / .docm) 파일을 브라우저에서 PDF로 변환합니다. 구버전 .doc은 지원하지 않습니다. " +
      "복잡한 머리글/바닥글·텍스트상자·SmartArt는 단순화될 수 있습니다. 여러 파일을 넣으면 각각 PDF로 만들고, 2개 이상이면 ZIP으로 내려받습니다. 파일은 외부로 전송되지 않습니다.",
    "pdf-ocr":
      "⚠ 스캔 PDF를 페이지 이미지로 읽은 뒤 <b>Tesseract OCR</b>로 글자를 인식해, 검색·복사가 되는 PDF를 만듭니다. " +
      "최초 실행 시 언어 데이터(수 MB)를 다운로드하며 페이지마다 시간이 걸립니다. 인식률은 화질·기울기·표 구조에 따라 달라질 수 있습니다. " +
      "파일은 서버로 올라가지 않고 브라우저 안에서만 처리됩니다.",
    "pdf-merge":
      "⚠ 여러 PDF를 목록 순서대로 하나의 파일로 합칩니다. 위/아래 버튼으로 순서를 바꾸세요. " +
      "암호가 걸린 파일은 빠질 수 있습니다. 처리는 브라우저 안에서만 이루어지며 파일이 외부로 전송되지 않습니다.",
  };

  // ---------------- Tabs ----------------
  function initTabs() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        const panel = document.getElementById("tab-" + btn.dataset.tab);
        if (panel) panel.classList.add("active");
        if (btn.dataset.tab === "export") renderExportFieldList();
        if (btn.dataset.tab === "dictionary") renderDictionaryTab();
        const key = DISCLAIMERS[btn.dataset.tab] ? btn.dataset.tab : "pds";
        document.querySelector(".disclaimer").innerHTML = DISCLAIMERS[key];
      });
    });
  }

  // ---------------- Upload ----------------
  function initUpload() {
    const dropZone = document.getElementById("dropZone");
    const fileInput = document.getElementById("fileInput");
    document.getElementById("btnBrowse").addEventListener("click", () => fileInput.click());
    dropZone.addEventListener("click", (e) => {
      if (e.target.id !== "btnBrowse") fileInput.click();
    });
    fileInput.addEventListener("change", (e) => handleFiles(e.target.files));

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
      const files = Array.from(e.dataTransfer.files).filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
      handleFiles(files);
    });
  }

  function handleFiles(fileList) {
    const files = Array.from(fileList).filter((f) => /\.pdf$/i.test(f.name));
    files.forEach((file) => {
      const entry = { id: idSeq++, file, status: "queued", message: "대기중", record: null };
      state.files.push(entry);
      processFile(entry);
    });
    renderFileList();
  }

  async function processFile(entry) {
    try {
      entry.status = "extracting";
      entry.message = "PDF 텍스트 추출 중...";
      renderFileList();

      const extraction = await PdfExtract.extractFromFile(entry.file);

      if (!extraction.hasTextLayer) {
        entry.status = "warn";
        entry.message = "⚠ 텍스트 레이어 없음 (스캔본 추정) — 자동 인식 불가, 수동 입력 필요";
        entry.record = {
          fileName: entry.file.name,
          hasTextLayer: false,
          numPages: extraction.numPages,
          equipmentType: "unknown",
          equipmentLabel: "미분류 / Unknown",
          fields: {},
          other: [],
        };
        renderFileList();
        renderReviewTab();
        return;
      }

      entry.status = "parsing";
      entry.message = "필드 인식 중...";
      renderFileList();

      const record = ParseFields.parseExtraction(extraction);
      // 기본값: 모든 필드/기타항목 포함 체크
      Object.keys(record.fields).forEach((fid) => (record.fields[fid].included = true));
      record.other.forEach((o) => (o.included = true));
      entry.record = record;

      const matchedCount = Object.keys(record.fields).length;
      entry.status = "done";
      entry.message = `완료 · ${record.equipmentLabel} · 표준필드 ${matchedCount}개 인식, 기타 ${record.other.length}개`;
    } catch (err) {
      entry.status = "error";
      entry.message = "오류: " + (err && err.message ? err.message : String(err));
    }
    renderFileList();
    renderReviewTab();
  }

  function statusBadge(entry) {
    if (entry.status === "done") return `<span class="badge pass">완료</span>`;
    if (entry.status === "error") return `<span class="badge fail">오류</span>`;
    if (entry.status === "warn") return `<span class="badge warn">주의</span>`;
    return `<span class="badge warn">처리중</span>`;
  }

  function renderFileList() {
    const el = document.getElementById("fileList");
    if (!state.files.length) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = state.files
      .map(
        (entry) => `
      <div class="item-card">
        <div class="item-card-head">
          <span class="tag">${escapeHtml(entry.file.name)}</span>
          ${statusBadge(entry)}
        </div>
        <div class="hint">${escapeHtml(entry.message)}</div>
      </div>`
      )
      .join("");
  }

  // ---------------- Review & Edit ----------------
  function renderReviewTab() {
    const el = document.getElementById("reviewList");
    const ready = state.files.filter((e) => e.record);
    if (!ready.length) {
      el.innerHTML = `<p class="hint">아직 처리된 파일이 없습니다. "업로드 &amp; 추출" 탭에서 PDF를 추가하세요.</p>`;
      return;
    }
    el.innerHTML = ready.map((entry) => renderRecordCard(entry)).join("");
    bindReviewEvents();
  }

  function renderRecordCard(entry) {
    const rec = entry.record;
    const typeOptions = EQUIPMENT_TYPES.map(
      (t) => `<option value="${t.id}" ${t.id === rec.equipmentType ? "selected" : ""}>${t.label}</option>`
    ).join("");

    const groupOrder = ["general", "vessel", "heatExchanger", "desuperheater", "filter"];
    let fieldRows = "";
    groupOrder.forEach((g) => {
      const groupDef = FieldDictionary.FIELD_GROUPS[g];
      const groupFields = groupDef.fields.filter((f) => rec.fields[f.id]);
      if (!groupFields.length) return;
      fieldRows += `<tr><td colspan="3" style="background:#eef2f6;font-weight:700;color:#16324f;">${escapeHtml(groupDef.title)}</td></tr>`;
      groupFields.forEach((f) => {
        const fv = rec.fields[f.id];
        fieldRows += `
          <tr>
            <td style="width:24px;"><input type="checkbox" data-file="${entry.id}" data-field="${f.id}" data-kind="std" ${fv.included !== false ? "checked" : ""}></td>
            <td style="width:220px;">${escapeHtml(f.label)}</td>
            <td><input type="text" data-file="${entry.id}" data-field="${f.id}" data-kind="std-value" value="${escapeAttr(fv.value)}"></td>
          </tr>`;
      });
    });

    let otherRows = "";
    if (rec.other && rec.other.length) {
      otherRows = rec.other
        .map(
          (o, idx) => `
        <tr>
          <td style="width:24px;"><input type="checkbox" data-file="${entry.id}" data-other="${idx}" data-kind="other" ${o.included !== false ? "checked" : ""}></td>
          <td style="width:220px;">${escapeHtml(o.label)} <span class="hint">(p.${o.page})</span></td>
          <td><input type="text" data-file="${entry.id}" data-other="${idx}" data-kind="other-value" value="${escapeAttr(o.value)}"></td>
        </tr>`
        )
        .join("");
    }

    return `
    <div class="card" style="margin-bottom:16px;">
      <div class="item-card-head">
        <span class="tag">${escapeHtml(entry.file.name)}</span>
        <label style="margin:0;font-weight:600;font-size:12px;">장비종류
          <select data-file="${entry.id}" data-kind="equip-type" style="width:auto;display:inline-block;margin-left:6px;">${typeOptions}</select>
        </label>
      </div>
      ${!fieldRows ? '<p class="hint">인식된 표준 필드가 없습니다. 스캔본이거나 형식이 매우 다른 문서일 수 있습니다 — 아래 "기타" 또는 필드사전에서 동의어를 추가해 보세요.</p>' : `
      <table class="calc-table"><thead><tr><th></th><th>필드</th><th>값 (수정 가능)</th></tr></thead><tbody>${fieldRows}</tbody></table>`}
      ${otherRows ? `<div class="section-title">기타 항목 / Other (사전에 없는 라벨 — 체크한 것만 내보내기 포함)</div>
      <table class="calc-table"><thead><tr><th></th><th>라벨(원문)</th><th>값</th></tr></thead><tbody>${otherRows}</tbody></table>` : ""}
    </div>`;
  }

  function bindReviewEvents() {
    document.querySelectorAll('#reviewList [data-kind="std"]').forEach((cb) =>
      cb.addEventListener("change", (e) => {
        const rec = findEntry(e.target.dataset.file).record;
        rec.fields[e.target.dataset.field].included = e.target.checked;
      })
    );
    document.querySelectorAll('#reviewList [data-kind="std-value"]').forEach((inp) =>
      inp.addEventListener("input", (e) => {
        const rec = findEntry(e.target.dataset.file).record;
        rec.fields[e.target.dataset.field].value = e.target.value;
      })
    );
    document.querySelectorAll('#reviewList [data-kind="other"]').forEach((cb) =>
      cb.addEventListener("change", (e) => {
        const rec = findEntry(e.target.dataset.file).record;
        rec.other[Number(e.target.dataset.other)].included = e.target.checked;
      })
    );
    document.querySelectorAll('#reviewList [data-kind="other-value"]').forEach((inp) =>
      inp.addEventListener("input", (e) => {
        const rec = findEntry(e.target.dataset.file).record;
        rec.other[Number(e.target.dataset.other)].value = e.target.value;
      })
    );
    document.querySelectorAll('#reviewList [data-kind="equip-type"]').forEach((sel) =>
      sel.addEventListener("change", (e) => {
        const rec = findEntry(e.target.dataset.file).record;
        rec.equipmentType = e.target.value;
        rec.equipmentLabel = (EQUIPMENT_TYPES.find((t) => t.id === e.target.value) || {}).label || e.target.value;
      })
    );
  }

  function findEntry(id) {
    return state.files.find((e) => String(e.id) === String(id));
  }

  // ---------------- Export Settings ----------------
  function renderExportFieldList() {
    const el = document.getElementById("fieldSelectList");
    const all = FieldDictionary.allFields();
    el.innerHTML = all
      .map(
        (f) => `<label><input type="checkbox" class="export-field-cb" value="${f.id}" checked> ${escapeHtml(f.label)}</label>`
      )
      .join("");
  }

  function initExport() {
    document.getElementById("btnExport").addEventListener("click", async () => {
      const ready = state.files.filter((e) => e.record);
      if (!ready.length) {
        setExportStatus("내보낼 데이터가 없습니다. 먼저 PDF를 업로드하세요.", true);
        return;
      }
      const mode = document.querySelector('input[name="exportMode"]:checked').value;
      const selectedFieldIds = Array.from(document.querySelectorAll(".export-field-cb:checked")).map((cb) => cb.value);

      setExportStatus("Excel 생성 중...", false);
      try {
        await ExcelExport.exportAndDownload(
          ready.map((e) => e.record),
          { mode, selectedFieldIds, includeOther: true, downloadName: "PDS_Summary_" + dateStamp() + ".xlsx" }
        );
        setExportStatus("✅ 다운로드 완료 (" + ready.length + "개 파일 반영)", false);
      } catch (err) {
        setExportStatus("오류: " + (err && err.message ? err.message : String(err)), true);
      }
    });
  }

  function setExportStatus(msg, isError) {
    const el = document.getElementById("exportStatus");
    el.textContent = msg;
    el.style.color = isError ? "#b3261e" : "#2f7d5c";
  }

  function dateStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  }

  // ---------------- Dictionary ----------------
  function renderDictionaryTab() {
    const fieldSel = document.getElementById("dict-field");
    if (!fieldSel.dataset.filled) {
      const groups = FieldDictionary.FIELD_GROUPS;
      fieldSel.innerHTML = Object.keys(groups)
        .map(
          (g) =>
            `<optgroup label="${escapeHtml(groups[g].title)}">` +
            groups[g].fields.map((f) => `<option value="${f.id}">${escapeHtml(f.label)}</option>`).join("") +
            `</optgroup>`
        )
        .join("");
      fieldSel.dataset.filled = "1";
    }
    renderCustomSynonymList();
    renderDictionaryTable();
  }

  function renderCustomSynonymList() {
    const map = FieldDictionary.loadCustom();
    const el = document.getElementById("customSynonymList");
    const ids = Object.keys(map).filter((k) => map[k] && map[k].length);
    if (!ids.length) {
      el.innerHTML = `<p class="hint">아직 추가된 커스텀 동의어가 없습니다.</p>`;
      return;
    }
    el.innerHTML = ids
      .map((fid) => {
        const fld = FieldDictionary.fieldById(fid);
        const chips = map[fid]
          .map(
            (s) =>
              `<span class="badge warn" style="margin:2px 4px 2px 0;">${escapeHtml(s)}
                <button class="btn-remove-syn" data-field="${fid}" data-syn="${escapeAttr(s)}" style="border:none;background:none;color:#b3261e;cursor:pointer;font-weight:700;">×</button>
              </span>`
          )
          .join("");
        return `<div style="margin-bottom:8px;"><b>${escapeHtml(fld ? fld.label : fid)}</b><br>${chips}</div>`;
      })
      .join("");
    el.querySelectorAll(".btn-remove-syn").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        FieldDictionary.removeSynonym(e.target.dataset.field, e.target.dataset.syn);
        renderCustomSynonymList();
      })
    );
  }

  function renderDictionaryTable() {
    const el = document.getElementById("dictionaryTable");
    const groups = FieldDictionary.FIELD_GROUPS;
    let html = "";
    Object.keys(groups).forEach((g) => {
      html += `<h3 style="margin-top:16px;">${escapeHtml(groups[g].title)}</h3><table class="calc-table"><thead><tr><th>필드</th><th>기본 동의어</th></tr></thead><tbody>`;
      groups[g].fields.forEach((f) => {
        html += `<tr><td style="width:220px;">${escapeHtml(f.label)}</td><td>${escapeHtml(f.synonyms.join(", "))}</td></tr>`;
      });
      html += "</tbody></table>";
    });
    el.innerHTML = html;
  }

  function initDictionary() {
    document.getElementById("btnAddSynonym").addEventListener("click", () => {
      const fid = document.getElementById("dict-field").value;
      const val = document.getElementById("dict-synonym").value;
      if (FieldDictionary.addSynonym(fid, val)) {
        document.getElementById("dict-synonym").value = "";
        renderCustomSynonymList();
      }
    });
  }

  // ---------------- File converters (Excel / Word / OCR) ----------------
  function initConverterTab(cfg) {
    const files = [];
    let seq = 1;
    const listEl = document.getElementById(cfg.listId);
    const statusEl = document.getElementById(cfg.statusId);
    const btn = document.getElementById(cfg.buttonId);
    const btnClear = document.getElementById(cfg.clearId);

    function setStatus(msg, isError) {
      if (!statusEl) return;
      statusEl.textContent = msg || "";
      statusEl.style.color = isError ? "#b3261e" : "#2f7d5c";
    }

    function render() {
      if (!files.length) {
        listEl.innerHTML = "";
        return;
      }
      listEl.innerHTML = files
        .map((entry) => {
          const dl =
            entry.blob && entry.status === "done"
              ? `<button class="btn btn-small" data-download="${entry.id}">PDF</button>`
              : "";
          return `
        <div class="item-card">
          <div class="item-card-head">
            <span class="tag">${escapeHtml(entry.file.name)}</span>
            <div class="item-card-actions">
              ${dl}
              ${statusBadge(entry)}
              <button class="btn btn-small btn-ghost" data-remove="${entry.id}">삭제</button>
            </div>
          </div>
          <div class="hint">${escapeHtml(entry.message)}</div>
        </div>`;
        })
        .join("");
    }

    ConvertCommon.bindDropZone({
      zoneId: cfg.zoneId,
      inputId: cfg.inputId,
      browseId: cfg.browseId,
      accept: cfg.accept,
      onFiles: (picked) => {
        let rejected = false;
        picked.forEach((file) => {
          if (cfg.onReject && cfg.onReject(file, setStatus)) {
            rejected = true;
            return;
          }
          files.push({ id: seq++, file: file, status: "queued", message: "대기중", blob: null, pdfName: null });
        });
        render();
        if (files.length) setStatus(files.length + "개 파일 대기 중", false);
        else if (!rejected) setStatus("", false);
      },
    });

    listEl.addEventListener("click", (e) => {
      const rm = e.target.closest("[data-remove]");
      if (rm) {
        const id = rm.getAttribute("data-remove");
        const idx = files.findIndex((f) => String(f.id) === id);
        if (idx >= 0) files.splice(idx, 1);
        render();
        return;
      }
      const dl = e.target.closest("[data-download]");
      if (dl) {
        const entry = files.find((f) => String(f.id) === dl.getAttribute("data-download"));
        if (entry && entry.blob) ConvertCommon.downloadBlob(entry.blob, entry.pdfName);
      }
    });

    btnClear.addEventListener("click", () => {
      files.splice(0, files.length);
      render();
      setStatus("", false);
    });

    btn.addEventListener("click", async () => {
      if (!files.length) {
        setStatus("파일을 먼저 추가하세요.", true);
        return;
      }
      btn.disabled = true;
      btnClear.disabled = true;
      const options = cfg.getOptions();
      for (let i = 0; i < files.length; i++) {
        const entry = files[i];
        entry.status = "extracting";
        entry.message = "변환 중...";
        entry.blob = null;
        render();
        try {
          const result = await cfg.convert(entry.file, options, (msg) => {
            entry.message = msg;
            render();
          });
          entry.blob = result.blob;
          entry.pdfName = result.pdfName;
          entry.status = "done";
          entry.message = result.message || "완료";
        } catch (err) {
          entry.status = "error";
          entry.message = "오류: " + (err && err.message ? err.message : String(err));
        }
        render();
      }
      const ready = files.filter((e) => e.blob);
      try {
        if (ready.length) {
          const zipName = cfg.zipPrefix + "_" + dateStamp() + ".zip";
          const out = await ConvertCommon.downloadMany(
            ready.map((e) => ({ blob: e.blob, pdfName: e.pdfName })),
            zipName
          );
          const fail = files.length - ready.length;
          setStatus(
            (out.kind === "zip" ? "✅ ZIP 다운로드 완료 (" + ready.length + "개 PDF)" : "✅ PDF 다운로드 완료") +
              (fail ? " · 실패 " + fail + "개" : ""),
            false
          );
        } else {
          setStatus("변환에 성공한 파일이 없습니다.", true);
        }
      } catch (err) {
        setStatus("다운로드 오류: " + (err && err.message ? err.message : String(err)), true);
      }
      btn.disabled = false;
      btnClear.disabled = false;
    });
  }

  function initConverters() {
    initConverterTab({
      zoneId: "excelDropZone",
      inputId: "excelFileInput",
      browseId: "btnExcelBrowse",
      listId: "excelFileList",
      statusId: "excelPdfStatus",
      buttonId: "btnExcelToPdf",
      clearId: "btnExcelClear",
      zipPrefix: "Excel_to_PDF",
      accept: (f) => ExcelToPdf.isExcelFile(f),
      getOptions: () => ({
        paper: document.querySelector('input[name="excelPaper"]:checked').value,
        orientation: document.querySelector('input[name="excelOrient"]:checked').value,
      }),
      convert: (file, options, onProgress) => ExcelToPdf.convertFile(file, options, onProgress),
    });

    initConverterTab({
      zoneId: "wordDropZone",
      inputId: "wordFileInput",
      browseId: "btnWordBrowse",
      listId: "wordFileList",
      statusId: "wordPdfStatus",
      buttonId: "btnWordToPdf",
      clearId: "btnWordClear",
      zipPrefix: "Word_to_PDF",
      accept: (f) => WordToPdf.isWordFile(f) || WordToPdf.isOldDoc(f),
      onReject: (file, setStatus) => {
        if (WordToPdf.isOldDoc(file)) {
          setStatus("구버전 .doc은 지원하지 않습니다. Word에서 .docx로 저장해 주세요: " + file.name, true);
          return true;
        }
        return false;
      },
      getOptions: () => ({
        paper: document.querySelector('input[name="wordPaper"]:checked').value,
        orientation: document.querySelector('input[name="wordOrient"]:checked').value,
      }),
      convert: (file, options, onProgress) => WordToPdf.convertFile(file, options, onProgress),
    });

    initConverterTab({
      zoneId: "ocrDropZone",
      inputId: "ocrFileInput",
      browseId: "btnOcrBrowse",
      listId: "ocrFileList",
      statusId: "ocrPdfStatus",
      buttonId: "btnPdfOcr",
      clearId: "btnOcrClear",
      zipPrefix: "PDF_OCR",
      accept: (f) => PdfOcr.isPdfFile(f),
      getOptions: () => ({
        lang: document.querySelector('input[name="ocrLang"]:checked').value,
      }),
      convert: (file, options, onProgress) => PdfOcr.convertFile(file, options, onProgress),
    });
  }

  function initPdfMerge() {
    const files = [];
    let seq = 1;
    const listEl = document.getElementById("mergeFileList");
    const statusEl = document.getElementById("mergePdfStatus");
    const btn = document.getElementById("btnPdfMerge");
    const btnClear = document.getElementById("btnMergeClear");

    function setStatus(msg, isError) {
      statusEl.textContent = msg || "";
      statusEl.style.color = isError ? "#b3261e" : "#2f7d5c";
    }

    function render() {
      if (!files.length) {
        listEl.innerHTML = "";
        return;
      }
      listEl.innerHTML = files
        .map((entry, idx) => {
          const upDis = idx === 0 ? "disabled" : "";
          const downDis = idx === files.length - 1 ? "disabled" : "";
          return `
        <div class="item-card">
          <div class="item-card-head">
            <span class="tag"><span class="merge-index">${idx + 1}.</span> ${escapeHtml(entry.file.name)}</span>
            <div class="item-card-actions">
              <button class="btn btn-small btn-ghost" data-move="up" data-id="${entry.id}" ${upDis}>위로</button>
              <button class="btn btn-small btn-ghost" data-move="down" data-id="${entry.id}" ${downDis}>아래로</button>
              <button class="btn btn-small btn-ghost" data-remove="${entry.id}">삭제</button>
            </div>
          </div>
          <div class="hint">${(entry.file.size / 1024).toFixed(1)} KB</div>
        </div>`;
        })
        .join("");
    }

    ConvertCommon.bindDropZone({
      zoneId: "mergeDropZone",
      inputId: "mergeFileInput",
      browseId: "btnMergeBrowse",
      accept: (f) => PdfMerge.isPdfFile(f),
      onFiles: (picked) => {
        picked.forEach((file) => {
          files.push({ id: seq++, file: file });
        });
        render();
        setStatus(files.length + "개 파일 · 목록 순서로 합쳐집니다", false);
      },
    });

    listEl.addEventListener("click", (e) => {
      const rm = e.target.closest("[data-remove]");
      if (rm) {
        const idx = files.findIndex((f) => String(f.id) === rm.getAttribute("data-remove"));
        if (idx >= 0) files.splice(idx, 1);
        render();
        setStatus(files.length ? files.length + "개 파일 · 목록 순서로 합쳐집니다" : "", false);
        return;
      }
      const mv = e.target.closest("[data-move]");
      if (!mv || mv.disabled) return;
      const idx = files.findIndex((f) => String(f.id) === mv.getAttribute("data-id"));
      if (idx < 0) return;
      const dir = mv.getAttribute("data-move") === "up" ? -1 : 1;
      const swap = idx + dir;
      if (swap < 0 || swap >= files.length) return;
      const tmp = files[idx];
      files[idx] = files[swap];
      files[swap] = tmp;
      render();
    });

    btnClear.addEventListener("click", () => {
      files.splice(0, files.length);
      render();
      setStatus("", false);
    });

    btn.addEventListener("click", async () => {
      if (files.length < 2) {
        setStatus("합치려면 PDF를 2개 이상 넣어 주세요.", true);
        return;
      }
      btn.disabled = true;
      btnClear.disabled = true;
      setStatus("합치는 중...", false);
      try {
        const result = await PdfMerge.mergeFiles(
          files.map((e) => e.file),
          (msg) => setStatus(msg, false)
        );
        ConvertCommon.downloadBlob(result.blob, result.pdfName);
        setStatus("✅ " + result.message, result.failed && result.failed.length > 0);
      } catch (err) {
        setStatus("오류: " + (err && err.message ? err.message : String(err)), true);
      }
      btn.disabled = false;
      btnClear.disabled = false;
    });
  }

  // ---------------- Utils ----------------
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function escapeAttr(s) {
    return escapeHtml(s);
  }

  // ---------------- Init ----------------
  document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    initUpload();
    initExport();
    initDictionary();
    initConverters();
    initPdfMerge();
    renderExportFieldList();
  });
})();
