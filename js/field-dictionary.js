/* ============================================================
   field-dictionary.js
   표준 필드 정의 + 라벨 동의어(synonym) 사전 + 사용자 커스텀 동의어(localStorage)
   ============================================================ */
(function (global) {
  "use strict";

  const LS_KEY = "pds2xl_custom_synonyms_v1";

  // ---- 표준 필드 그룹 정의 ----
  // id: 내부 고유키, label: 한/영 표시명, group: 소속 카테고리, unitHint: 기대 단위(참고용)
  // synonyms: 라벨 매칭용 정규식 소스(케이스 무시, 부분/전체 매칭에 사용)
  const FIELD_GROUPS = {
    general: {
      title: "공통 (General)",
      fields: [
        f("tag_no", "Tag No. / 장비번호", ["tag no", "tag number", "item no", "equipment no", "장비번호", "태그"]),
        f("service", "Service / 용도", ["service", "service name", "용도", "서비스"]),
        f("equipment_type", "Equipment Type / 장비종류", ["equipment type", "type of equipment", "장비종류", "장비형식"]),
        f("quantity", "Quantity / 수량", ["quantity", "qty", "no. required", "수량"]),
        f("design_code", "Design Code / 설계코드", ["design code", "code", "applicable code", "설계코드", "적용코드"]),
        f("design_pressure", "Design Pressure / 설계압력", ["design pressure", "des. pressure", "des press", "설계압력", "design press"]),
        f("design_temperature", "Design Temperature / 설계온도", ["design temperature", "des. temperature", "des temp", "설계온도"]),
        f("operating_pressure", "Operating Pressure / 운전압력", ["operating pressure", "op. pressure", "normal pressure", "운전압력"]),
        f("operating_temperature", "Operating Temperature / 운전온도", ["operating temperature", "op. temperature", "normal temperature", "운전온도"]),
        f("mdmt", "MDMT / 최저설계금속온도", ["mdmt", "minimum design metal temperature", "최저설계금속온도"]),
        f("material", "Material / 재질", ["material", "material of construction", "shell material", "재질", "재료"]),
        f("corrosion_allowance", "Corrosion Allowance / 부식여유", ["corrosion allowance", "c.a.", "부식여유", "부식대"]),
        f("pwht", "PWHT 여부", ["pwht", "post weld heat treatment", "후열처리"]),
        f("radiography", "Radiography / 방사선검사", ["radiography", "rt", "x-ray", "방사선검사"]),
        f("insulation", "Insulation / 보온·보냉", ["insulation", "보온", "보냉"]),
        f("paint_coating", "Paint/Coating / 도장", ["paint", "coating", "도장"]),
        f("weight_empty", "Empty Weight / 공중량", ["empty weight", "shipping weight", "공중량"]),
        f("weight_operating", "Operating Weight / 운전중량", ["operating weight", "운전중량"]),
        f("orientation", "Orientation / 설치방향", ["orientation", "horizontal", "vertical", "설치방향"]),
        f("dimensions", "Dimensions (I.D. x T/T) / 규격", ["size", "dimension", "i.d.", "id x", "t/t", "규격", "치수"]),
        f("remarks", "Remarks / 비고", ["remarks", "note", "notes", "비고"]),
      ],
    },
    vessel: {
      title: "Vessel / 압력용기",
      fields: [
        f("shell_id", "Shell I.D. / 동체 내경", ["shell i.d.", "inside diameter", "shell diameter", "동체내경", "내경"]),
        f("shell_thickness", "Shell Thickness / 동체두께", ["shell thickness", "동체두께"]),
        f("head_type", "Head Type / 경판형식", ["head type", "closure type", "경판형식", "경판타입"]),
        f("head_thickness", "Head Thickness / 경판두께", ["head thickness", "경판두께"]),
        f("tan_to_tan", "Tan-to-Tan Length / T/L-T/L", ["tan to tan", "tan-tan", "t/t length", "tl-tl", "t/l-t/l"]),
        f("nozzle_schedule", "Nozzle Schedule / 노즐목록", ["nozzle schedule", "nozzle list", "노즐목록"]),
        f("support_type", "Support Type / 지지구조", ["support type", "skirt", "saddle", "leg", "지지구조", "스커트", "새들"]),
      ],
    },
    heatExchanger: {
      title: "Heat Exchanger / 열교환기",
      fields: [
        f("hx_type", "HX Type (Shell&Tube 등)", ["exchanger type", "type of exchanger", "shell and tube", "열교환기형식"]),
        f("shell_side_fluid", "Shell Side Fluid / 쉘측 유체", ["shell side fluid", "shellside fluid", "쉘측유체"]),
        f("tube_side_fluid", "Tube Side Fluid / 튜브측 유체", ["tube side fluid", "tubeside fluid", "튜브측유체"]),
        f("shell_design_pressure", "Shell Design Pressure", ["shell design pressure", "shell side design pressure"]),
        f("tube_design_pressure", "Tube Design Pressure", ["tube design pressure", "tube side design pressure"]),
        f("shell_design_temperature", "Shell Design Temperature", ["shell design temperature"]),
        f("tube_design_temperature", "Tube Design Temperature", ["tube design temperature"]),
        f("heat_transfer_area", "Heat Transfer Area / 전열면적", ["heat transfer area", "surface area", "전열면적"]),
        f("no_of_tubes", "No. of Tubes / 튜브수", ["no. of tubes", "number of tubes", "튜브수"]),
        f("tube_od", "Tube O.D. / 튜브외경", ["tube o.d.", "tube od", "튜브외경"]),
        f("tube_length", "Tube Length / 튜브길이", ["tube length", "튜브길이"]),
        f("duty", "Duty (Heat Load) / 열부하", ["duty", "heat duty", "heat load", "열부하"]),
        f("tema_class", "TEMA Class", ["tema class", "tema type"]),
      ],
    },
    desuperheater: {
      title: "Desuperheater / 감온기",
      fields: [
        f("steam_flow", "Steam Flow / 증기 유량", ["steam flow", "steam flowrate", "증기유량"]),
        f("inlet_steam_temp", "Inlet Steam Temp. / 입구 증기온도", ["inlet temperature", "inlet steam temp", "입구온도"]),
        f("outlet_steam_temp", "Outlet Steam Temp. / 출구 증기온도", ["outlet temperature", "outlet steam temp", "출구온도"]),
        f("spray_water_flow", "Spray Water Flow / 분사수 유량", ["spray water flow", "water flow", "분사수유량"]),
        f("spray_water_pressure", "Spray Water Pressure / 분사수 압력", ["spray water pressure", "분사수압력"]),
        f("turndown_ratio", "Turndown Ratio", ["turndown ratio", "turn down ratio"]),
        f("line_size", "Line Size / 배관 규격", ["line size", "pipe size", "배관규격"]),
        f("end_connection", "End Connection / 연결방식", ["end connection", "connection type", "연결방식"]),
      ],
    },
    filter: {
      title: "Filter / 필터",
      fields: [
        f("filter_type", "Filter Type / 필터형식", ["filter type", "filter media type", "필터형식"]),
        f("filtration_rating", "Filtration Rating (micron) / 여과등급", ["filtration rating", "micron rating", "여과등급"]),
        f("flow_rate", "Flow Rate / 유량", ["flow rate", "capacity", "유량", "용량"]),
        f("differential_pressure", "Differential Pressure / 차압", ["differential pressure", "delta p", "pressure drop", "차압"]),
        f("no_of_elements", "No. of Elements / 엘리먼트 수", ["no. of elements", "number of elements", "엘리먼트수"]),
        f("housing_material", "Housing Material / 하우징 재질", ["housing material", "하우징재질"]),
        f("element_material", "Element Material / 엘리먼트 재질", ["element material", "엘리먼트재질"]),
      ],
    },
  };

  function f(id, label, synonyms) {
    return { id, label, synonyms };
  }

  // ---- 전체 필드 평면 목록 ----
  function allFields() {
    const out = [];
    Object.keys(FIELD_GROUPS).forEach((g) => {
      FIELD_GROUPS[g].fields.forEach((fld) => out.push(Object.assign({ group: g }, fld)));
    });
    return out;
  }

  // ---- 커스텀(사용자 추가) 동의어 : localStorage 저장 { fieldId: [synonym, ...] } ----
  function loadCustom() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveCustom(map) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(map));
    } catch (e) {
      /* ignore quota errors */
    }
  }

  function addSynonym(fieldId, synonymText) {
    const s = String(synonymText || "").trim();
    if (!s) return false;
    const map = loadCustom();
    if (!map[fieldId]) map[fieldId] = [];
    if (map[fieldId].some((x) => x.toLowerCase() === s.toLowerCase())) return false;
    map[fieldId].push(s);
    saveCustom(map);
    return true;
  }

  function removeSynonym(fieldId, synonymText) {
    const map = loadCustom();
    if (!map[fieldId]) return;
    map[fieldId] = map[fieldId].filter((x) => x !== synonymText);
    saveCustom(map);
  }

  // ---- 필드별 전체 동의어(기본+커스텀) 반환 ----
  function synonymsFor(fieldId) {
    const base = allFields().find((x) => x.id === fieldId);
    const custom = loadCustom()[fieldId] || [];
    return (base ? base.synonyms.slice() : []).concat(custom);
  }

  function fieldById(fieldId) {
    return allFields().find((x) => x.id === fieldId) || null;
  }

  global.FieldDictionary = {
    FIELD_GROUPS,
    allFields,
    synonymsFor,
    fieldById,
    loadCustom,
    saveCustom,
    addSynonym,
    removeSynonym,
  };
})(window);
