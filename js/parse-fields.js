/* ============================================================
   parse-fields.js
   pdf-extract 결과(줄/컬럼) + field-dictionary(동의어)를 이용해
   라벨:값 쌍을 표준 필드로 매칭하는 파싱 엔진
   ============================================================ */
(function (global) {
  "use strict";

  function normalize(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[:：]+$/g, "")
      .replace(/[.,;]+$/g, "")
      .replace(/[^a-z0-9가-힣./\-\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanValue(v) {
    // 콜론/등호/전각기호 등 구분자만 제거. '-'는 음수(예: MDMT -29C)일 수 있으므로 보존.
    return String(v || "")
      .replace(/^[\s:：=–—]+/, "")
      .replace(/^-\s+/, "-") // "- 29" 같은 표기는 "-29"로 정규화(음수 유지)
      .replace(/[\s]+$/, "")
      .trim();
  }

  // 후보 라벨 문자열에 대해 사전 전체를 조회, 가장 잘 맞는 표준 필드를 반환
  // typeHint: 문서 분류 결과(장비종류) — 동점일 때 해당 장비군/공통(general) 필드를 우선시해 오매칭을 줄임
  function bestFieldMatch(labelCandidate, allFieldsCache, typeHint) {
    const norm = normalize(labelCandidate);
    if (!norm || norm.length < 2) return null;

    let best = null; // {fieldId, group, label, score, matchedSyn}
    allFieldsCache.forEach((fld) => {
      const groupBoost = fld.group === "general" || fld.group === typeHint ? 0.5 : 0;
      fld.synList.forEach((synNorm) => {
        if (!synNorm) return;
        let score = 0;
        if (norm === synNorm) {
          score = synNorm.length * 3;
        } else if (synNorm.length <= 3) {
          // 짧은 동의어(rt, id 등)는 단어경계 완전일치만 허용 (오탐 방지)
          const re = new RegExp("(^|\\s)" + escapeRe(synNorm) + "(\\s|$)");
          if (re.test(norm)) score = synNorm.length * 2;
        } else if (norm.includes(synNorm)) {
          score = synNorm.length * 2;
        } else if (synNorm.includes(norm) && norm.length >= 4) {
          score = norm.length;
        }
        if (score > 0) score += groupBoost;
        if (score > 0 && (!best || score > best.score)) {
          best = { fieldId: fld.id, group: fld.group, label: fld.label, score, matchedSyn: synNorm };
        }
      });
    });
    return best;
  }

  function buildFieldsCache() {
    return FieldDictionary.allFields().map((fld) => ({
      id: fld.id,
      group: fld.group,
      label: fld.label,
      synList: FieldDictionary.synonymsFor(fld.id).map((s) => normalize(s)),
    }));
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // 한 줄(line)에서 라벨/값 후보 쌍들을 뽑아낸다
  // - cols.length >= 2 : cols[0]을 라벨로, 나머지를 값으로 시도 (테이블형 PDF)
  // - cols.length == 1 or plain text: "라벨: 값" 또는 "라벨   값"(2칸 이상 공백) 패턴 시도
  function extractCandidatesFromLine(line) {
    const candidates = [];
    if (line.cols && line.cols.length >= 2) {
      // 여러 컬럼: 인접 쌍을 라벨-값으로 매칭 시도 (라벨,값,라벨,값... 형태 테이블 대응)
      for (let i = 0; i < line.cols.length - 1; i++) {
        candidates.push({ label: line.cols[i], value: line.cols[i + 1] });
      }
      // 첫 컬럼 + 나머지 전체를 값으로 합친 케이스도 후보로 추가
      if (line.cols.length > 2) {
        candidates.push({ label: line.cols[0], value: line.cols.slice(1).join(" / ") });
      }
    }
    const text = line.text || "";
    const colonMatch = text.match(/^(.{2,60}?)[:：]\s*(.+)$/);
    if (colonMatch) {
      candidates.push({ label: colonMatch[1], value: colonMatch[2] });
    } else {
      const gapMatch = text.match(/^(.{2,40}?)\s{2,}(.+)$/);
      if (gapMatch) candidates.push({ label: gapMatch[1], value: gapMatch[2] });
    }
    return candidates;
  }

  // 파일 1개(추출 결과)를 파싱하여 구조화된 레코드로 변환
  function parseExtraction(extraction) {
    const fieldsCache = buildFieldsCache();
    const classifyResult = Classify.classify(extraction.fullText);

    const fields = {}; // fieldId -> {value, label, group, page, alternates:[]}
    const other = []; // {label, value, page}
    const seenOtherKeys = new Set();

    extraction.pages.forEach((page) => {
      page.lines.forEach((line) => {
        const candidates = extractCandidatesFromLine(line);
        if (!candidates.length) return;

        // 이 줄에서 가장 점수 높은 (라벨,값) 매칭 하나만 채택
        let lineBest = null;
        candidates.forEach((c) => {
          const val = cleanValue(c.value);
          if (!val || val.length > 200) return;
          const match = bestFieldMatch(c.label, fieldsCache, classifyResult.type);
          if (match && (!lineBest || match.score > lineBest.match.score)) {
            lineBest = { match, value: val, rawLabel: c.label.trim() };
          }
        });

        if (lineBest) {
          const fid = lineBest.match.fieldId;
          if (!fields[fid]) {
            fields[fid] = {
              value: lineBest.value,
              label: lineBest.match.label,
              group: lineBest.match.group,
              page: page.pageNum,
              alternates: [],
            };
          } else if (fields[fid].value !== lineBest.value) {
            fields[fid].alternates.push({ value: lineBest.value, page: page.pageNum });
          }
        } else {
          // 매칭 실패 -> "기타" 후보로 최선의 라벨:값 후보 하나 저장
          const c = candidates[0];
          const val = cleanValue(c.value);
          const lab = c.label.trim();
          const key = normalize(lab) + "|" + val;
          if (val && lab && lab.length <= 60 && val.length <= 200 && !seenOtherKeys.has(key)) {
            seenOtherKeys.add(key);
            other.push({ label: lab, value: val, page: page.pageNum });
          }
        }
      });
    });

    return {
      fileName: extraction.fileName,
      hasTextLayer: extraction.hasTextLayer,
      numPages: extraction.numPages,
      equipmentType: classifyResult.type,
      equipmentLabel: classifyResult.label,
      classifyScore: classifyResult.score,
      fields,
      other,
    };
  }

  global.ParseFields = { parseExtraction, normalize, cleanValue, bestFieldMatch, buildFieldsCache };
})(window);
