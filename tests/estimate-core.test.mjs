import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_LAYOUT,
  FIELDS,
  REVIEW,
  validateLayout,
  rowsFromTokens,
  extractEstimate,
  compareExact,
  validateTruth,
} from "../assets/estimate-core.mjs";
const pages = JSON.parse(
  await readFile(new URL("./fixtures/layout-pages.json", import.meta.url)),
);
const truth = JSON.parse(
  await readFile(new URL("./fixtures/truth.json", import.meta.url)),
);
const token = (text, x, y, confidence = null) => ({
  text,
  x,
  y,
  confidence,
  source: "test",
});
test("four pages: continuation and repeated WD retain all details and flag competing SKUs", () => {
  const result = extractEstimate(pages);
  assert.equal(result.items.length, 3);
  const [a, b, c] = result.items;
  assert.deepEqual(
    FIELDS.map((f) => a[f]),
    FIELDS.map((f) => truth.items[0][f]),
  );
  assert.deepEqual(b.pages, [1, 2]);
  assert.equal(b.sku, "DEMO-D002");
  assert.equal(b.size, "W800 × H2400");
  assert.equal(b.details.length, 4);
  assert.deepEqual(c.pages, [3, 4]);
  assert.equal(c.sku, REVIEW);
  assert.deepEqual(c.review.sku.candidates, ["DEMO-F003", "DEMO-PART030"]);
  assert.equal(c.skuLookup.key, null);
  assert.equal(result.unassignedRows.length, 0);
});
test("blank and ambiguous fields stay review; low-confidence ID is not invented", () => {
  const result = extractEstimate([
    {
      number: 1,
      tokens: [
        token("W0-7", 0.1, 0.3, 95),
        token("DEMO-A007", 0.45, 0.3, 92),
        token("WD-8", 0.1, 0.4, 20),
        token("W800", 0.84, 0.4, 90),
      ],
    },
  ]);
  assert.equal(result.items.length, 2);
  assert.ok(result.items.every((x) => x.id === REVIEW));
  assert.equal(result.items[0].room, REVIEW);
  assert.equal(result.items[1].size, REVIEW);
});
test("continuation is optional and discontinuous pages never silently inherit", () => {
  const input = [
    { number: 1, tokens: [token("WD-1", 0.1, 0.3)] },
    { number: 3, tokens: [token("DEMO-X001", 0.45, 0.3)] },
  ];
  assert.equal(extractEstimate(input).items.length, 2);
  assert.equal(
    extractEstimate(pages, { ...DEFAULT_LAYOUT, carryAcrossPages: false })
      .items[1].size,
    REVIEW,
  );
});
test("coordinate filtering removes titles, footer and repeated column headings", () => {
  const tokens = [
    token("WD-99", 0.1, 0.05),
    token("WD-98", 0.1, 0.94),
    token("建具番号", 0.1, 0.21),
    token("商品型番", 0.45, 0.21),
    token("WD-1", 0.1, 0.3),
  ];
  assert.equal(extractEstimate([{ number: 1, tokens }]).items.length, 1);
  assert.equal(extractEstimate([{ number: 1, tokens }]).items[0].id, "WD-1");
});
test("fixed row bands join multiline cells and split width/height", () => {
  const rows = rowsFromTokens(
    {
      number: 1,
      tokens: [
        token("WD-1", 0.1, 0.26),
        token("W800", 0.84, 0.26),
        token("H2400", 0.84, 0.28),
      ],
    },
    { ...DEFAULT_LAYOUT, rowHeight: 0.1 },
  );
  assert.equal(rows.length, 1);
  assert.equal(
    extractEstimate(
      [
        {
          number: 1,
          tokens: [
            token("WD-1", 0.1, 0.26),
            token("W800", 0.84, 0.26),
            token("H2400", 0.84, 0.28),
          ],
        },
      ],
      { ...DEFAULT_LAYOUT, rowHeight: 0.1 },
    ).items[0].size,
    "W800 × H2400",
  );
});
test("duplicate widths and multiple product rows are review candidates, not first-match wins", () => {
  const result = extractEstimate([
    {
      number: 1,
      tokens: [
        token("WD-1", 0.1, 0.3),
        token("W800 H2400", 0.84, 0.3),
        token("W900 H2400", 0.84, 0.4),
      ],
    },
  ]);
  assert.equal(result.items[0].size, REVIEW);
});
test("exact score includes wrong WD, missing and extra records, no normalization", () => {
  const expected = {
    items: [
      {
        id: "WD-1",
        room: "玄関",
        sku: "ABC-001",
        type: "片引戸",
        size: "W800 × H2400",
      },
    ],
  };
  const wrong = [{ ...expected.items[0], id: "WD-7", sku: "abc-001" }];
  let result = compareExact(expected, wrong);
  assert.equal(result.metrics.id.correct, 0);
  assert.equal(result.metrics.sku.correct, 0);
  assert.equal(result.metrics.room.correct, 1);
  result = compareExact(expected, []);
  assert.equal(result.metrics.id.total, 1);
  assert.equal(result.mismatches.length, 5);
  result = compareExact(expected, [...expected.items, ...expected.items]);
  assert.equal(result.metrics.id.total, 2);
  assert.equal(result.metrics.id.rate, 0.5);
});
test("truth must be complete; invalid layouts and null scores are rejected", () => {
  assert.throws(() => validateTruth({ items: [] }));
  assert.throws(() => validateTruth({ items: [{ id: "WD-1" }] }));
  assert.throws(() =>
    validateTruth({ items: [{ ...truth.items[0], sku: REVIEW }] }),
  );
  assert.throws(() =>
    validateLayout({
      ...DEFAULT_LAYOUT,
      boundaries: [0, 0.5, 0.4, 0.6, 0.8, 1],
    }),
  );
  assert.throws(() => validateLayout({ ...DEFAULT_LAYOUT, dpi: NaN }));
});
test("regression fixture measures a deliberate unresolved product code", () => {
  const result = compareExact(truth, extractEstimate(pages).items);
  assert.equal(result.metrics.sku.correct, 2);
  for (const f of FIELDS.filter((x) => x !== "sku"))
    assert.equal(result.metrics[f].correct, 3);
  assert.equal(result.mismatches[0].actual, REVIEW);
});
test("manufacturer column order can be changed without changing metric field order", () => {
  const layout = {
    ...DEFAULT_LAYOUT,
    columnOrder: ["id", "sku", "type", "room", "size"],
  };
  const result = extractEstimate(
    [
      {
        number: 1,
        tokens: [
          token("WD-1", 0.1, 0.3),
          token("DEMO-H001", 0.23, 0.3),
          token("片引戸", 0.45, 0.3),
          token("玄関", 0.66, 0.3),
          token("W800 H2400", 0.84, 0.3),
        ],
      },
    ],
    layout,
  );
  assert.equal(result.items[0].sku, "DEMO-H001");
  assert.equal(result.items[0].room, "玄関");
  assert.throws(() =>
    validateLayout({
      ...DEFAULT_LAYOUT,
      columnOrder: ["id", "id", "sku", "type", "size"],
    }),
  );
});
test("abort releases a non-settling OCR job and rejects an already aborted wait", async () => {
  const { withAbort } = await import("../assets/estimate-reader.mjs");
  const controller = new AbortController();
  const waiting = withAbort(new Promise(() => {}), controller.signal);
  controller.abort();
  await assert.rejects(waiting, { name: "AbortError" });
  await assert.rejects(withAbort(Promise.resolve("late"), controller.signal), {
    name: "AbortError",
  });
});
