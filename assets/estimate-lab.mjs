import {
  FIELDS,
  LABELS,
  REVIEW,
  DEFAULT_LAYOUT,
  validateLayout,
  validateTruth,
  compareExact,
} from "./estimate-core.mjs";
import { readEstimateDocument, renderPdfPage } from "./estimate-reader.mjs";
const clone = (x) => JSON.parse(JSON.stringify(x));
const esc = (x) =>
  String(x ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function saveJSON(value, name) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function initEstimateLab({ state, openPdf, renderAll, onEdit, status }) {
  const $ = (id) => document.getElementById(id);
  let report = null,
    truth = null,
    controller = null,
    previewJob = 0;
  $("layout-boundaries").innerHTML = [
    "左端",
    "番号／場所",
    "場所／型番",
    "型番／種類",
    "種類／寸法",
    "右端",
  ]
    .map(
      (label, i) =>
        `<label>${label} %<input type="number" min="0" max="100" step="0.1" id="layout-x-${i}" value="${DEFAULT_LAYOUT.boundaries[i] * 100}" /></label>`,
    )
    .join("");
  $("layout-order").innerHTML = FIELDS.map(
    (f, i) =>
      `<label>左から${i + 1}列目<select id="layout-order-${i}">${FIELDS.map((key) => `<option value="${key}" ${key === f ? "selected" : ""}>${LABELS[key]}</option>`).join("")}</select></label>`,
  ).join("");
  function setLayout(l) {
    l.columnOrder.forEach((f, i) => ($("layout-order-" + i).value = f));
    $("layout-name").value = l.name;
    l.boundaries.forEach(
      (x, i) => ($("layout-x-" + i).value = +(x * 100).toFixed(3)),
    );
    for (const [id, key, m] of [
      ["layout-top", "top", 100],
      ["layout-bottom", "bottom", 100],
      ["layout-row-height", "rowHeight", 100],
      ["layout-tolerance", "rowTolerance", 100],
      ["layout-confidence", "minConfidence", 1],
      ["layout-dpi", "dpi", 1],
      ["layout-threshold", "threshold", 1],
    ])
      $(id).value = +(l[key] * m).toFixed(3);
    $("layout-binarize").checked = l.binarize;
    $("layout-carry").checked = l.carryAcrossPages;
    drawColumns();
  }
  function getLayout() {
    return validateLayout({
      name: $("layout-name").value,
      columnOrder: FIELDS.map((_, i) => $("layout-order-" + i).value),
      boundaries: Array.from(
        { length: 6 },
        (_, i) => Number($("layout-x-" + i).value) / 100,
      ),
      top: Number($("layout-top").value) / 100,
      bottom: Number($("layout-bottom").value) / 100,
      rowHeight: Number($("layout-row-height").value) / 100,
      rowTolerance: Number($("layout-tolerance").value) / 100,
      minConfidence: Number($("layout-confidence").value),
      dpi: Number($("layout-dpi").value),
      binarize: $("layout-binarize").checked,
      threshold: Number($("layout-threshold").value),
      carryAcrossPages: $("layout-carry").checked,
    });
  }
  function drawColumns() {
    try {
      const l = getLayout();
      $("estimate-columns").innerHTML =
        l.columnOrder
          .map(
            (f, i) =>
              `<div class="estimate-column" style="left:${l.boundaries[i] * 100}%;width:${(l.boundaries[i + 1] - l.boundaries[i]) * 100}%;top:${l.top * 100}%;height:${(l.bottom - l.top) * 100}%"><span>${LABELS[f]}</span></div>`,
          )
          .join("") +
        (l.rowHeight
          ? Array.from(
              { length: Math.ceil((l.bottom - l.top) / l.rowHeight) },
              (_, i) =>
                `<div class="estimate-row-guide" style="top:${(l.top + i * l.rowHeight) * 100}%;left:${l.boundaries[0] * 100}%;right:${(1 - l.boundaries[5]) * 100}%"></div>`,
            ).join("")
          : "");
      $("layout-state").textContent =
        report && JSON.stringify(l) !== JSON.stringify(report.layout)
          ? "設定が変わりました。結果を更新するには再読取してください。"
          : `列順：${l.columnOrder.map((f) => LABELS[f]).join(" → ")}`;
    } catch (e) {
      $("layout-state").textContent = e.message;
    }
  }
  function setPreview(url, page) {
    $("estimate-preview-image").src = url;
    $("estimate-preview-wrap").hidden = false;
    $("estimate-preview-empty").hidden = true;
    $("estimate-preview-page").value = page;
    drawColumns();
  }
  function accuracy() {
    if (!truth || !report) return null;
    return {
      extracted: compareExact(truth, report.items),
      corrected: compareExact(truth, state.items),
      source: report.source,
    };
  }
  function payload() {
    return {
      schemaVersion: 1,
      source: report?.source || null,
      layout: report?.layout || null,
      extractedItems: report?.items || [],
      correctedItems: state.items,
      warnings: report?.warnings || [],
      unassignedRows: report?.unassignedRows || [],
      accuracy: accuracy(),
    };
  }
  function renderAccuracy() {
    const result = accuracy();
    $("truth-clear").disabled = !truth;
    $("accuracy-export").disabled = !result;
    if (!result) {
      $("accuracy-summary").textContent = truth
        ? `正解「${truth.name}」${truth.items.length}件を読み込みました。見積書を読み取ると比較できます。`
        : "実帳票の正解データがないため、精度は未測定です。";
      $("accuracy-metrics").replaceChildren();
      $("accuracy-mismatches").replaceChildren();
      return;
    }
    const synthetic = truth.synthetic || report.source.synthetic;
    $("accuracy-summary").textContent =
      `${synthetic ? "架空データの検証（実帳票の精度ではありません）" : "投入データに対する実測"}：正解${truth.items.length}件／検出${report.items.length}件。${report.source.partial ? "一部ページのみの結果です。" : ""} 出現順で比較。`;
    $("accuracy-metrics").innerHTML =
      `<table><caption>項目別完全一致率（完全一致件数／比較件数）</caption><thead><tr><th>比較対象</th>${FIELDS.map((f) => `<th>${LABELS[f]}</th>`).join("")}</tr></thead><tbody>${[
        ["extracted", "抽出時点"],
        ["corrected", "手修正後"],
      ]
        .map(
          ([key, label]) =>
            `<tr><th>${label}</th>${FIELDS.map((f) => {
              const m = result[key].metrics[f];
              return `<td>${(100 * m.rate).toFixed(1)}%<br>${m.correct}/${m.total}</td>`;
            }).join("")}</tr>`,
        )
        .join("")}</tbody></table>`;
    $("accuracy-mismatches").innerHTML = [
      ...["extracted", "corrected"].map(
        (key, i) =>
          `<details ${i === 0 ? "open" : ""}><summary>${i === 0 ? "抽出時点" : "手修正後"}の不一致 ${result[key].mismatches.length}項目</summary><div class="accuracy-errors"><table><thead><tr><th>出現順</th><th>項目</th><th>正解</th><th>読取値</th><th>理由</th></tr></thead><tbody>${result[key].mismatches.map((m) => `<tr><td>${m.record}</td><td>${m.label}</td><td>${esc(m.expected ?? "（正解なし）")}</td><td>${esc(m.actual ?? "（検出なし）")}</td><td>${m.reason}</td></tr>`).join("")}</tbody></table></div></details>`,
      ),
    ].join("");
  }
  function refresh() {
    const active = document.activeElement;
    const focus = active?.dataset?.reviewField
      ? {
          index: active.dataset.reviewIndex,
          field: active.dataset.reviewField,
          start: active.selectionStart,
          end: active.selectionEnd,
        }
      : null;
    if (!report) {
      $("reading-summary").textContent =
        "読取結果はまだありません。既存の建具リストは手動で編集できます。";
      $("reading-review").replaceChildren();
      $("reading-evidence").replaceChildren();
      $("reading-warnings").hidden = true;
      $("reading-json").value = "";
      $("reading-export").disabled = true;
      renderAccuracy();
      return;
    }
    const pending = state.items.reduce(
        (n, x) => n + FIELDS.filter((f) => !x[f] || x[f] === REVIEW).length,
        0,
      ),
      s = report.source;
    $("lab-summary").textContent = !state.items.length
      ? "候補なし・読取範囲やOCRを確認"
      : s.synthetic
        ? "架空座標の構造テスト・OCR未実行"
        : `${s.method === "ocr" ? "日本語OCR" : "PDFテキスト"}・${state.items.length}件・要確認${pending}項目`;
    $("reading-summary").textContent =
      `${s.fileName} ／ ${s.synthetic ? "架空の座標入力（OCRではありません）" : s.method === "ocr" ? "PDF画像化 → 列別日本語OCR" : "PDFテキスト＋列・行座標"} ／ ${s.processedPages}/${s.pageCount}ページ ／ ${(s.durationMs / 1000).toFixed(1)}秒。要確認 ${pending}項目。建具番号は一意に確定してから図面に配置してください。`;
    $("reading-warnings").hidden = !report.warnings.length;
    $("reading-warnings").textContent = report.warnings.join("\n");
    $("reading-review").innerHTML =
      `<table class="review-table"><thead><tr><th>出現順／ページ</th>${FIELDS.map((f) => `<th>${LABELS[f]}</th>`).join("")}</tr></thead><tbody>${state.items
        .map(
          (x, i) =>
            `<tr><th>${i + 1}<br>p.${(x.pages || []).join(", ") || "—"}</th>${FIELDS.map(
              (f) => {
                const r = x.review?.[f];
                return `<td class="${x[f] === REVIEW ? "needs-review" : ""}"><input data-review-index="${i}" data-review-field="${f}" value="${esc(x[f])}" aria-label="${i + 1}件目 ${LABELS[f]}" maxlength="100" /><small>${x.manualFields?.[f] ? "手修正済み" : esc(r?.reason || "抽出候補・未承認")}${r?.confidence != null ? ` ／ OCR信頼度 ${Math.round(r.confidence)}` : ""}</small></td>`;
              },
            ).join("")}</tr>`,
        )
        .join("")}</tbody></table>`;
    $("reading-evidence").innerHTML = report.items
      .map(
        (x, i) =>
          `<details><summary>${i + 1}件目 ${esc(x.id)} の全明細・候補（p.${x.pages.join(", ")}）</summary><pre>${esc(x.details.map((r) => `p.${r.page} y=${r.y.toFixed(4)} ${FIELDS.map((f) => `${LABELS[f]}: ${r.cells[f].text || "—"}`).join(" | ")}`).join("\n"))}</pre><pre>${esc(JSON.stringify(x.review, null, 2))}</pre></details>`,
      )
      .join("");
    if (focus) {
      const next = document.querySelector(
        `[data-review-index="${focus.index}"][data-review-field="${focus.field}"]`,
      );
      next?.focus({ preventScroll: true });
      if (next && focus.start !== null)
        next.setSelectionRange(focus.start, focus.end);
    }
    renderAccuracy();
    $("reading-json").value = JSON.stringify(payload(), null, 2);
    $("reading-export").disabled = false;
  }
  function busy(value) {
    for (const el of document.querySelectorAll(
      ".lab-settings input,.lab-settings select,.lab-settings button,#layout-file,#fixture-btn,#estimate-file,#ocr-btn,#read-text-btn,#estimate-preview-btn,#reset-btn,#json-file,#plan-file,#item-list input,#item-list [data-delete],#reading-review input,#add-btn",
    ))
      el.disabled = value;
    $("read-cancel-btn").disabled = !value;
    if (!value) {
      $("ocr-btn").disabled = !state.estimateFile;
      $("read-text-btn").disabled = !state.estimateFile;
      $("estimate-preview-btn").disabled = !state.estimateFile;
    }
  }
  async function run(method = "text") {
    if (controller || !state.estimateFile) return;
    let layout, maxPages;
    try {
      layout = getLayout();
      maxPages = Number($("read-max-pages").value);
      if (!Number.isInteger(maxPages))
        throw new Error("ページ上限を整数で指定してください");
    } catch (e) {
      $("lab-progress").textContent = e.message;
      return;
    }
    controller = new AbortController();
    previewJob++;
    busy(true);
    $("estimate-lab").open = true;
    try {
      const result = await readEstimateDocument(state.estimateFile, {
        openPdf,
        method,
        layout,
        maxPages,
        signal: controller.signal,
        onProgress: (m) => {
          $("lab-progress").textContent = m;
          status(m);
        },
        onPreview: setPreview,
      });
      report = result;
      state.items = clone(report.items);
      state.pins = {};
      state.selected = state.items.find((x) => x.id !== REVIEW)?.id || "";
      renderAll();
      refresh();
      $("estimate-preview-page").max = result.source.pageCount;
      $("lab-progress").textContent = report.items.length
        ? `${result.source.processedPages}ページの読み取り完了。${report.items.length}件の抽出候補を確認してください。`
        : "抽出候補がありません。表の範囲を確認し、画像PDFはOCRを実行してください。";
      status($("lab-progress").textContent);
    } catch (e) {
      const message = controller.signal.aborted
        ? "読み取りを中止しました。前回の結果を保持しています。"
        : "読み取りに失敗しました：" + e.message;
      $("lab-progress").textContent = message;
      status(message);
      if (!controller.signal.aborted) console.error(e);
    } finally {
      controller = null;
      busy(false);
    }
  }
  $("read-text-btn").addEventListener("click", () => run("text"));
  $("read-cancel-btn").addEventListener("click", () => controller?.abort());
  $("reading-review").addEventListener("input", (e) => {
    const el = e.target;
    if (!el.dataset.reviewField) return;
    onEdit(Number(el.dataset.reviewIndex), el.dataset.reviewField, el.value);
  });
  $("layout-save").addEventListener("click", () => {
    try {
      saveJSON(getLayout(), "doorboard-layout.json");
    } catch (e) {
      $("lab-progress").textContent = e.message;
    }
  });
  $("layout-file").addEventListener("change", async (e) => {
    try {
      const f = e.target.files?.[0];
      if (!f) return;
      if (f.size > 100000) throw new Error("設定JSONは100KB以内です");
      setLayout(validateLayout(JSON.parse(await f.text())));
      $("lab-progress").textContent =
        "レイアウトを読み込みました。再読取で反映します。";
    } catch (err) {
      $("lab-progress").textContent = err.message;
    }
    e.target.value = "";
  });
  document
    .querySelector(".lab-settings")
    .addEventListener("input", drawColumns);
  $("reading-export").addEventListener("click", () =>
    saveJSON(payload(), "doorboard-reading.json"),
  );
  $("truth-file").addEventListener("change", async (e) => {
    try {
      const f = e.target.files?.[0];
      if (!f) return;
      if (f.size > 2 * 1024 * 1024) throw new Error("正解JSONは2MB以内です");
      const next = validateTruth(JSON.parse(await f.text()));
      truth = next;
      refresh();
    } catch (err) {
      $("accuracy-summary").textContent =
        "正解JSONを読み込めません：" + err.message;
    }
    e.target.value = "";
  });
  $("truth-clear").addEventListener("click", () => {
    truth = null;
    refresh();
  });
  $("truth-template").addEventListener("click", () =>
    saveJSON(
      {
        name: "架空ひな形（原本の値に置換してください）",
        synthetic: true,
        items: [
          {
            id: "WD-1",
            room: "玄関",
            sku: "DEMO-H001",
            type: "片引戸",
            size: "W1600 × H2400",
          },
        ],
      },
      "doorboard-ground-truth-template.json",
    ),
  );
  $("accuracy-export").addEventListener("click", () =>
    saveJSON(accuracy(), "doorboard-accuracy.json"),
  );
  $("fixture-btn").addEventListener("click", async () => {
    if (controller) return;
    try {
      const [pagesResponse, truthResponse] = await Promise.all([
        fetch("./tests/fixtures/layout-pages.json"),
        fetch("./tests/fixtures/truth.json"),
      ]);
      if (!pagesResponse.ok || !truthResponse.ok)
        throw new Error("架空サンプルを読み込めません");
      const [{ extractEstimate }, pages, expected] = await Promise.all([
        import("./estimate-core.mjs"),
        pagesResponse.json(),
        truthResponse.json(),
      ]);
      report = {
        schemaVersion: 1,
        source: {
          synthetic: true,
          fileName: "架空の4ページ座標サンプル",
          method: "fixture-coordinates",
          pageCount: pages.length,
          processedPages: pages.length,
          durationMs: 0,
          partial: false,
        },
        pages,
        ...extractEstimate(pages, DEFAULT_LAYOUT),
      };
      truth = validateTruth(expected);
      setLayout(DEFAULT_LAYOUT);
      state.items = clone(report.items);
      state.pins = {};
      state.selected = state.items[0]?.id || "";
      renderAll();
      refresh();
      $("lab-progress").textContent =
        "架空の文字座標からグループ化を検証しました。PDF画像化・OCRの精度を測った結果ではありません。";
    } catch (e) {
      $("lab-progress").textContent = e.message;
    }
  });
  $("estimate-preview-btn").addEventListener("click", async () => {
    if (controller || !state.estimateFile) return;
    const job = ++previewJob;
    let pdf;
    try {
      const pageNumber = Number($("estimate-preview-page").value);
      pdf = await openPdf(state.estimateFile);
      if (
        !Number.isInteger(pageNumber) ||
        pageNumber < 1 ||
        pageNumber > pdf.numPages
      )
        throw new Error("表示ページが範囲外です");
      const canvas = await renderPdfPage(await pdf.getPage(pageNumber), 120);
      if (job === previewJob)
        setPreview(canvas.toDataURL("image/png"), pageNumber);
      canvas.width = 0;
      canvas.height = 0;
    } catch (e) {
      if (job === previewJob) $("lab-progress").textContent = e.message;
    } finally {
      if (pdf) await pdf.destroy();
    }
  });
  setLayout(DEFAULT_LAYOUT);
  refresh();
  return {
    run,
    refresh,
    clear() {
      report = null;
      truth = null;
      previewJob++;
      $("lab-summary").textContent = "実帳票の精度は未測定";
      $("estimate-preview-wrap").hidden = true;
      $("estimate-preview-empty").hidden = false;
      busy(false);
      refresh();
    },
    hasReport: () => !!report,
  };
}
