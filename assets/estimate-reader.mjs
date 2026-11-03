import { FIELDS, validateLayout, extractEstimate } from "./estimate-core.mjs";
const abortIfNeeded = (signal) => {
  if (signal?.aborted)
    throw new DOMException("読み取りを中止しました", "AbortError");
};
// Tesseract terminate() does not settle an in-flight recognize promise.
// Reject our wait independently, while still handling any later job rejection.
export function withAbort(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const aborted = () =>
      reject(new DOMException("読み取りを中止しました", "AbortError"));
    signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
    if (signal.aborted) aborted();
  });
}
function previewImage(canvas) {
  const c = document.createElement("canvas"),
    ratio = Math.min(1, 1400 / canvas.width);
  c.width = Math.round(canvas.width * ratio);
  c.height = Math.round(canvas.height * ratio);
  c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}
export async function renderPdfPage(page, dpi = 120) {
  const raw = page.getViewport({ scale: 1 }),
    scale = Math.min(dpi / 72, 4000 / Math.max(raw.width, raw.height));
  const viewport = page.getViewport({ scale }),
    canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  canvas.dataset.renderDpi = String(Math.round(scale * 72));
  await page.render({ canvasContext: canvas.getContext("2d"), viewport })
    .promise;
  return canvas;
}
export function pdfTextTokens(content, viewport) {
  const tokens = [];
  for (const item of content.items || []) {
    if (!item.str?.trim()) continue;
    const [x, y] = viewport.convertToViewportPoint(
      item.transform[4],
      item.transform[5],
    );
    const height = Math.max(
      1,
      Math.abs(item.height || item.transform[3] || 10),
    );
    // PDF.js may return an entire row as one text item. Approximate intra-item
    // word positions from glyph widths, retaining this fact for manual review.
    const parts = item.str.match(/\S+|\s+/g) || [];
    const weight = (s) =>
      [...s].reduce((n, c) => n + (/[^\x00-\xff]/.test(c) ? 1 : 0.55), 0);
    const total = weight(item.str) || 1;
    let offset = 0;
    for (const part of parts) {
      const w = (weight(part) / total) * (item.width || 0);
      if (part.trim())
        tokens.push({
          text: part,
          x: (x + offset + w / 2) / viewport.width,
          y: (y - height / 2) / viewport.height,
          bbox: {
            x0: (x + offset) / viewport.width,
            y0: (y - height) / viewport.height,
            x1: (x + offset + w) / viewport.width,
            y1: y / viewport.height,
          },
          confidence: null,
          source: "pdf-text",
          positionEstimated: parts.length > 1,
        });
      offset += w;
    }
  }
  return tokens;
}
function wordsFromOcr(data) {
  if (Array.isArray(data.words)) return data.words;
  return (data.blocks || []).flatMap((b) =>
    (b.paragraphs || []).flatMap((p) =>
      (p.lines || []).flatMap((l) => l.words || []),
    ),
  );
}
async function ocrColumns(canvas, worker, layout, page, signal, onProgress) {
  const tokens = [];
  for (let i = 0; i < FIELDS.length; i++) {
    abortIfNeeded(signal);
    onProgress(`${page}ページ・${i + 1}/5列をOCRで読み取っています…`);
    const left = Math.round(layout.boundaries[i] * canvas.width) + 2,
      top = Math.round(layout.top * canvas.height) + 2;
    const right = Math.round(layout.boundaries[i + 1] * canvas.width) - 2,
      bottom = Math.round(layout.bottom * canvas.height) - 2;
    const crop = document.createElement("canvas");
    crop.width = Math.max(1, right - left);
    crop.height = Math.max(1, bottom - top);
    const ctx = crop.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(
      canvas,
      left,
      top,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height,
    );
    const pixels = ctx.getImageData(0, 0, crop.width, crop.height);
    for (let p = 0; p < pixels.data.length; p += 4) {
      let value = Math.round(
        0.299 * pixels.data[p] +
          0.587 * pixels.data[p + 1] +
          0.114 * pixels.data[p + 2],
      );
      if (layout.binarize) value = value >= layout.threshold ? 255 : 0;
      pixels.data[p] = pixels.data[p + 1] = pixels.data[p + 2] = value;
    }
    ctx.putImageData(pixels, 0, 0);
    await withAbort(
      worker.setParameters({
        tessedit_pageseg_mode: "6",
        preserve_interword_spaces: "1",
        user_defined_dpi: String(layout.dpi),
        tessedit_char_whitelist: ["id", "sku", "size"].includes(
          layout.columnOrder[i],
        )
          ? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-./:=×xX* "
          : "",
      }),
      signal,
    );
    const result = await withAbort(
      worker.recognize(
        crop,
        {},
        { text: true, blocks: true, hocr: false, tsv: false },
      ),
      signal,
    );
    const words = wordsFromOcr(result.data);
    if (result.data.text?.trim() && !words.length)
      throw new Error(
        "OCRの文字座標がありません。ライブラリの出力形式を確認してください",
      );
    for (const word of words) {
      const b = word.bbox;
      if (!b || !word.text?.trim()) continue;
      tokens.push({
        text: word.text,
        x: (left + (b.x0 + b.x1) / 2) / canvas.width,
        y: (top + (b.y0 + b.y1) / 2) / canvas.height,
        bbox: {
          x0: (left + b.x0) / canvas.width,
          y0: (top + b.y0) / canvas.height,
          x1: (left + b.x1) / canvas.width,
          y1: (top + b.y1) / canvas.height,
        },
        confidence: Number.isFinite(word.confidence) ? word.confidence : null,
        source: "ocr",
        column: layout.columnOrder[i],
      });
    }
    crop.width = 0;
    crop.height = 0;
  }
  return tokens;
}
export async function readEstimateDocument(
  file,
  {
    openPdf,
    method = "text",
    layout: input,
    maxPages = 0,
    signal,
    onProgress = () => {},
    onPreview = () => {},
  },
) {
  const layout = validateLayout(input),
    started = performance.now();
  if (!["text", "ocr"].includes(method)) throw new Error("読取方式が不正です");
  if (!Number.isInteger(maxPages) || maxPages < 0 || maxPages > 200)
    throw new Error("ページ上限は0（全ページ）〜200で指定してください");
  let pdf, worker, termination;
  const stop = () => {
    if (worker && !termination) termination = worker.terminate();
    return termination || Promise.resolve();
  };
  const onAbort = () => {
    void stop().catch(() => {});
  };
  try {
    abortIfNeeded(signal);
    onProgress("PDFを開いています…");
    pdf = await openPdf(file);
    abortIfNeeded(signal);
    if (!maxPages && pdf.numPages > 200)
      throw new Error(
        "200ページを超えています。ページ上限を明示して部分検証してください",
      );
    const count = maxPages ? Math.min(maxPages, pdf.numPages) : pdf.numPages,
      pages = [];
    if (method === "ocr") {
      if (!window.Tesseract)
        throw new Error(
          "OCRライブラリを読み込めません。接続を確認してください",
        );
      onProgress("日本語・英語OCRを準備しています…");
      const starting = window.Tesseract.createWorker("jpn+eng", 1);
      starting.then(
        (w) => {
          if (signal?.aborted) void w.terminate().catch(() => {});
        },
        () => {},
      );
      worker = await withAbort(starting, signal);
      abortIfNeeded(signal);
      signal?.addEventListener("abort", onAbort, { once: true });
    }
    for (let n = 1; n <= count; n++) {
      abortIfNeeded(signal);
      onProgress(`${n}/${count}ページを読み取っています…`);
      const page = await pdf.getPage(n),
        viewport = page.getViewport({ scale: 1 });
      let canvas, tokens;
      try {
        if (method === "ocr" || n === 1) {
          canvas = await renderPdfPage(
            page,
            method === "ocr" ? layout.dpi : 120,
          );
          if (n === 1) onPreview(previewImage(canvas), n);
        }
        tokens =
          method === "ocr"
            ? await ocrColumns(canvas, worker, layout, n, signal, onProgress)
            : pdfTextTokens(await page.getTextContent(), viewport);
        pages.push({
          number: n,
          width: viewport.width,
          height: viewport.height,
          renderDpi: method === "ocr" ? Number(canvas.dataset.renderDpi) : null,
          tokens,
        });
      } finally {
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
        page.cleanup();
      }
    }
    abortIfNeeded(signal);
    const result = extractEstimate(pages, layout),
      partial = count < pdf.numPages;
    if (pages.some((p) => p.renderDpi !== null && p.renderDpi < layout.dpi))
      result.warnings.push(
        "画像の最大辺4000pxに合わせて一部ページのDPIを下げています。細かい文字は原本で確認してください。",
      );
    if (partial)
      result.warnings.unshift(
        `全${pdf.numPages}ページ中、先頭${count}ページのみを処理しました。続きは未検証です。`,
      );
    return {
      schemaVersion: 1,
      source: {
        fileName: file.name,
        method,
        pageCount: pdf.numPages,
        processedPages: count,
        partial,
        durationMs: Math.round(performance.now() - started),
        pdfjsVersion: "4.10.38",
        ocrVersion: method === "ocr" ? "5.1.1" : null,
      },
      pages,
      ...result,
    };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    try {
      await stop();
    } finally {
      if (pdf) await pdf.destroy();
    }
  }
}
