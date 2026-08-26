/* ============================================================
   classify.js
   추출된 PDF 전체 텍스트를 바탕으로 장비 종류를 추정 (키워드 스코어링)
   ============================================================ */
(function (global) {
  "use strict";

  // 각 장비종류별 판별 키워드 (스코어 가중치 포함). 대소문자 무시.
  const RULES = [
    {
      type: "heatExchanger",
      label: "Heat Exchanger / 열교환기",
      keywords: [
        ["heat exchanger", 5], ["shell and tube", 5], ["shell & tube", 5], ["tema", 4],
        ["tube sheet", 3], ["tubesheet", 3], ["no. of tubes", 3], ["tube bundle", 3],
        ["shell side", 2], ["tube side", 2], ["열교환기", 5], ["튜브", 2], ["쉘측", 2],
      ],
    },
    {
      type: "desuperheater",
      label: "Desuperheater / 감온기",
      keywords: [
        ["desuperheater", 6], ["desuper heater", 6], ["desuperheating", 5],
        ["spray water", 3], ["attemperator", 4], ["turndown", 2], ["감온기", 5], ["탈과열기", 5],
      ],
    },
    {
      type: "filter",
      label: "Filter / 필터",
      keywords: [
        ["filter", 5], ["strainer", 4], ["filtration rating", 4], ["micron", 3],
        ["filter element", 4], ["cartridge", 2], ["필터", 5], ["스트레이너", 4], ["여과", 3],
      ],
    },
    {
      type: "vessel",
      label: "Pressure Vessel / 압력용기·컬럼",
      keywords: [
        ["pressure vessel", 5], ["vessel data sheet", 5], ["column", 3], ["tan to tan", 4],
        ["tan-tan", 4], ["skirt", 3], ["saddle", 3], ["manhole", 2], ["shell thickness", 2],
        ["head type", 2], ["압력용기", 5], ["컬럼", 3], ["동체", 2], ["경판", 2],
      ],
    },
  ];

  function classify(text) {
    const t = (text || "").toLowerCase();
    const scores = RULES.map((rule) => {
      let score = 0;
      rule.keywords.forEach(([kw, w]) => {
        const re = new RegExp(escapeRe(kw.toLowerCase()), "g");
        const matches = t.match(re);
        if (matches) score += matches.length * w;
      });
      return { type: rule.type, label: rule.label, score };
    });
    scores.sort((a, b) => b.score - a.score);
    const top = scores[0];
    if (!top || top.score === 0) {
      return { type: "unknown", label: "미분류 / Unknown", score: 0, all: scores };
    }
    return { type: top.type, label: top.label, score: top.score, all: scores };
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  global.Classify = { classify, RULES };
})(window);
