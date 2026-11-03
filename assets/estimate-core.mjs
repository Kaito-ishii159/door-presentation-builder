export const REVIEW = "要確認";
export const FIELDS = ["id", "room", "sku", "type", "size"];
export const LABELS = {
  id: "建具番号",
  room: "設置場所",
  sku: "商品型番",
  type: "建具種類",
  size: "寸法",
};
export const DEFAULT_LAYOUT = {
  version: 1,
  name: "架空サンプル用（実帳票では調整が必要）",
  columnOrder: [...FIELDS],
  boundaries: [0.05, 0.17, 0.35, 0.6, 0.78, 0.95],
  top: 0.2,
  bottom: 0.88,
  rowTolerance: 0.008,
  rowHeight: 0,
  minConfidence: 60,
  dpi: 240,
  binarize: false,
  threshold: 190,
  carryAcrossPages: true,
};
const copy = (value) => JSON.parse(JSON.stringify(value));
export function validateLayout(raw) {
  if (!raw || typeof raw !== "object")
    throw new Error("レイアウトがありません");
  const l = { ...DEFAULT_LAYOUT, ...raw };
  if (
    !Array.isArray(l.boundaries) ||
    l.boundaries.length !== 6 ||
    l.boundaries.some(
      (v, i, a) =>
        !Number.isFinite(v) ||
        v < 0 ||
        v > 1 ||
        (i > 0 && v - a[i - 1] < 0.015),
    )
  )
    throw new Error(
      "列境界は0〜100%の昇順6点、各列の幅は1.5%以上にしてください",
    );
  if (
    !Array.isArray(l.columnOrder) ||
    l.columnOrder.length !== 5 ||
    new Set(l.columnOrder).size !== 5 ||
    l.columnOrder.some((f) => !FIELDS.includes(f))
  )
    throw new Error("列の項目は5種類を重複せず指定してください");
  for (const [key, min, max] of [
    ["top", 0, 0.98],
    ["bottom", 0.02, 1],
    ["rowTolerance", 0.001, 0.03],
    ["rowHeight", 0, 0.2],
    ["minConfidence", 0, 100],
    ["dpi", 120, 360],
    ["threshold", 1, 254],
  ]) {
    if (!Number.isFinite(l[key]) || l[key] < min || l[key] > max)
      throw new Error(`${key} の設定範囲が不正です`);
  }
  if (l.bottom - l.top < 0.05)
    throw new Error("表の上下は5%以上離してください");
  return {
    version: 1,
    name: String(l.name).slice(0, 120),
    columnOrder: [...l.columnOrder],
    boundaries: [...l.boundaries],
    top: l.top,
    bottom: l.bottom,
    rowTolerance: l.rowTolerance,
    rowHeight: l.rowHeight,
    minConfidence: l.minConfidence,
    dpi: l.dpi,
    binarize: !!l.binarize,
    threshold: l.threshold,
    carryAcrossPages: !!l.carryAcrossPages,
  };
}
export const normalizeText = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—−－]/g, "-")
    .trim();
function compact(value) {
  return normalizeText(value).replace(/\s/g, "");
}
function joinTokens(tokens, tolerance) {
  const lines = [];
  for (const t of [...tokens].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let line = lines.find((l) => Math.abs(l.y - t.y) <= tolerance);
    if (!line) {
      line = { y: t.y, tokens: [] };
      lines.push(line);
    }
    line.tokens.push(t);
  }
  return lines
    .map((l) =>
      l.tokens
        .sort((a, b) => a.x - b.x)
        .map((t) => t.text)
        .join(" "),
    )
    .join("\n");
}
export function rowsFromTokens(page, rawLayout) {
  const layout = validateLayout(rawLayout),
    rows = [];
  const tokens = (page.tokens || []).filter(
    (t) =>
      t &&
      String(t.text || "").trim() &&
      Number.isFinite(t.x) &&
      Number.isFinite(t.y) &&
      t.x >= layout.boundaries[0] &&
      t.x < layout.boundaries[5] &&
      t.y >= layout.top &&
      t.y < layout.bottom,
  );
  for (const token of [...tokens].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const band = layout.rowHeight
      ? Math.floor((token.y - layout.top) / layout.rowHeight)
      : null;
    let row = rows.find((r) =>
      band === null
        ? Math.abs(r.y - token.y) <= layout.rowTolerance
        : r.band === band,
    );
    if (!row) {
      row = {
        page: page.number,
        y: token.y,
        band,
        cells: Object.fromEntries(FIELDS.map((f) => [f, []])),
      };
      rows.push(row);
    }
    const col = FIELDS.findIndex(
      (_, i) =>
        token.x >= layout.boundaries[i] && token.x < layout.boundaries[i + 1],
    );
    if (col >= 0) row.cells[layout.columnOrder[col]].push(token);
  }
  return rows.map((r) => ({
    page: r.page,
    y: r.y,
    cells: Object.fromEntries(
      FIELDS.map((f) => [
        f,
        {
          text: joinTokens(r.cells[f], layout.rowTolerance),
          confidence: r.cells[f].some((t) => Number.isFinite(t.confidence))
            ? r.cells[f]
                .filter((t) => Number.isFinite(t.confidence))
                .reduce((s, t) => s + t.confidence, 0) /
              r.cells[f].filter((t) => Number.isFinite(t.confidence)).length
            : null,
          tokens: copy(r.cells[f]),
        },
      ]),
    ),
  }));
}
function rowIsHeader(row) {
  const values = FIELDS.map((f) => compact(row.cells[f].text));
  return (
    /^(建具番号|WD番号|番号|小計|合計|消費税|総合計|備考)$/.test(values[0]) ||
    values.filter((v) =>
      /^(建具番号|設置場所|商品型番|品番|型番|建具種類|種類|寸法)$/.test(v),
    ).length >= 2
  );
}
function parseId(text) {
  const m = compact(text)
    .toUpperCase()
    .match(/^WD-?(\d{1,3})$/);
  return m ? `WD-${Number(m[1])}` : null;
}
function candidateValue(field, text) {
  const s =
    field === "room"
      ? String(text ?? "")
          .replace(/\s/g, "")
          .trim()
      : compact(text);
  if (!s || s === REVIEW || /^[-ー―]+$/.test(s)) return null;
  if (field === "id") return parseId(text);
  if (field === "sku")
    return /^[A-Za-z0-9][A-Za-z0-9./-]{3,79}$/.test(s) &&
      /[A-Za-z]/.test(s) &&
      /\d/.test(s)
      ? s
      : null;
  if (field === "room")
    return s.length <= 100 && /[\p{L}\p{N}]/u.test(s) ? s : null;
  if (field === "type")
    return /^(?:片開き?戸|片引き?戸|引き?戸|上吊り引戸|両引き?戸|両開き?戸|引違い?戸|収納折戸|[234４３２]枚折戸|折戸|ドア|収納|開き戸)$/.test(
      s,
    )
      ? s
      : null;
  return null;
}
function fieldResult(group, field, layout) {
  const sources = group.rows
    .filter((r) => r.cells[field].text.trim())
    .map((r) => ({
      page: r.page,
      y: r.y,
      raw: r.cells[field].text,
      confidence: r.cells[field].confidence,
    }));
  let candidates = [];
  if (field === "size") {
    const raw = compact(sources.map((s) => s.raw).join(" "));
    const widths = [...raw.matchAll(/W[=:：]?(\d{3,4})(?!\d)/gi)].map(
      (m) => m[1],
    );
    const heights = [...raw.matchAll(/H[=:：]?(\d{3,4})(?!\d)/gi)].map(
      (m) => m[1],
    );
    for (const m of raw.matchAll(/(?<!\d)(\d{3,4})[×xX*＊](\d{3,4})(?!\d)/g)) {
      widths.push(m[1]);
      heights.push(m[2]);
    }
    const ws = [...new Set(widths)],
      hs = [...new Set(heights)];
    if (ws.length === 1 && hs.length === 1)
      candidates = [`W${ws[0]} × H${hs[0]}`];
    else if (ws.length || hs.length)
      candidates = [...new Set(sources.map((s) => compact(s.raw)))];
    const valid = ws.length === 1 && hs.length === 1;
    if (!valid)
      return {
        value: REVIEW,
        candidates,
        sources,
        confidence: null,
        reason:
          ws.length > 1 || hs.length > 1
            ? "寸法候補が競合しています"
            : "幅・高さの両方を認識できません",
      };
  } else {
    candidates = [
      ...new Set(
        sources.map((s) => candidateValue(field, s.raw)).filter(Boolean),
      ),
    ];
  }
  const scores = sources.map((s) => s.confidence).filter(Number.isFinite);
  const confidence = scores.length ? Math.min(...scores) : null;
  const invalid = sources.some(
    (s) => field !== "size" && !candidateValue(field, s.raw),
  );
  const reason =
    candidates.length > 1
      ? "複数の候補があり、選択が必要です"
      : candidates.length === 0 || invalid
        ? "未認識または書式が不明です"
        : confidence !== null && confidence < layout.minConfidence
          ? "OCR信頼度が設定値未満です"
          : "";
  return {
    value: reason ? REVIEW : candidates[0],
    candidates,
    sources,
    confidence,
    reason,
  };
}
export function extractEstimate(pages, rawLayout = DEFAULT_LAYOUT) {
  const layout = validateLayout(rawLayout),
    groups = [],
    known = new Map(),
    warnings = [],
    unassignedRows = [];
  let current = null,
    lastPage = 0;
  for (const page of [...pages].sort((a, b) => a.number - b.number)) {
    if (!layout.carryAcrossPages || page.number !== lastPage + 1)
      current = null;
    for (const row of rowsFromTokens(page, layout)) {
      if (rowIsHeader(row)) continue;
      const idText = row.cells.id.text.trim(),
        id = parseId(idText);
      const lowId =
        row.cells.id.confidence !== null &&
        row.cells.id.confidence < layout.minConfidence;
      if (id && !lowId) {
        current = known.get(id);
        if (!current) {
          current = { recordKey: `record-${groups.length + 1}`, id, rows: [] };
          groups.push(current);
          known.set(id, current);
        }
      } else if (idText || !current) {
        // Keep unnumbered content as a separate review record; never invent a WD number.
        current = {
          recordKey: `record-${groups.length + 1}`,
          id: null,
          rows: [],
        };
        groups.push(current);
        unassignedRows.push({
          page: row.page,
          y: row.y,
          reason: idText
            ? "建具番号を確定できません"
            : "先行する建具番号がありません",
        });
      }
      current.rows.push(row);
    }
    lastPage = page.number;
  }
  const items = groups.map((g) => {
    const review = Object.fromEntries(
      FIELDS.map((f) => [f, fieldResult(g, f, layout)]),
    );
    if (!g.id)
      review.id = {
        ...review.id,
        value: REVIEW,
        reason: "建具番号を手動で確認してください",
      };
    const item = {
      recordKey: g.recordKey,
      ...Object.fromEntries(FIELDS.map((f) => [f, review[f].value])),
      color: REVIEW,
      image: null,
      review,
      details: copy(g.rows),
      pages: [...new Set(g.rows.map((r) => r.page))],
    };
    item.skuLookup = {
      raw: review.sku.sources.map((s) => s.raw).join("\n"),
      key: item.sku === REVIEW ? null : item.sku,
      matchMode: "exact",
      status: "master-not-loaded",
    };
    return item;
  });
  if (unassignedRows.length)
    warnings.push(
      `${unassignedRows.length}行の開始番号を確定できません。要確認レコードの原文を確認してください。`,
    );
  if (!items.length)
    warnings.push(
      "表の範囲内に明細がありません。列境界・上下範囲・OCR実行を確認してください。",
    );
  return { layout, items, warnings, unassignedRows };
}
export function validateTruth(raw) {
  const items = Array.isArray(raw) ? raw : raw?.items;
  if (!Array.isArray(items) || !items.length || items.length > 1000)
    throw new Error("正解JSONには1〜1000件のitems配列が必要です");
  for (const [i, item] of items.entries())
    for (const f of FIELDS)
      if (
        typeof item?.[f] !== "string" ||
        !item[f].trim() ||
        item[f] === REVIEW
      )
        throw new Error(
          `正解の${i + 1}件目・${LABELS[f]}を確定した文字列で入力してください`,
        );
  return {
    items: items.map((x) => Object.fromEntries(FIELDS.map((f) => [f, x[f]]))),
    synthetic: raw?.synthetic === true,
    name: String(raw?.name || "正解データ").slice(0, 120),
  };
}
export function compareExact(truthInput, predicted) {
  const truth = validateTruth(truthInput),
    count = Math.max(truth.items.length, predicted.length),
    metrics = {},
    mismatches = [];
  for (const f of FIELDS) {
    let correct = 0;
    for (let i = 0; i < count; i++) {
      const expected = truth.items[i]?.[f] ?? null,
        actual = predicted[i]?.[f] ?? null;
      if (
        expected !== null &&
        actual !== null &&
        actual !== REVIEW &&
        expected === actual
      )
        correct++;
      else
        mismatches.push({
          record: i + 1,
          field: f,
          label: LABELS[f],
          expected,
          actual,
          reason: !truth.items[i]
            ? "余分な検出"
            : !predicted[i]
              ? "検出漏れ"
              : "完全一致しません",
        });
    }
    metrics[f] = {
      correct,
      total: count,
      rate: count ? correct / count : null,
    };
  }
  return {
    name: truth.name,
    synthetic: truth.synthetic,
    alignment: "document-order",
    comparison: "exact-no-normalization",
    expectedCount: truth.items.length,
    detectedCount: predicted.length,
    metrics,
    mismatches,
  };
}
