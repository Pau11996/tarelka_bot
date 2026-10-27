const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/favoriteOrder.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, context);
const { moveFavorite, favoriteDropIndex, favoriteScrollStep } = context.exports;

test("moving across multiple positions preserves other records and the original list", () => {
  const items = [1, 2, 3, 4];
  assert.deepEqual(Array.from(moveFavorite(items, 0, 3)), [2, 3, 4, 1]);
  assert.deepEqual(Array.from(moveFavorite(items, 3, 0)), [4, 1, 2, 3]);
  assert.deepEqual(Array.from(moveFavorite(items, 0, -1)), items);
  assert.deepEqual(items, [1, 2, 3, 4]);
});

test("drag targets respect variable card heights, boundaries and accumulated scrolling", () => {
  const layouts = [{ y: 6, height: 120 }, { y: 135, height: 78 }, { y: 222, height: 78 }];
  assert.equal(favoriteDropIndex(layouts, 0, 0), 0);
  assert.equal(favoriteDropIndex(layouts, 0, 110), 1);
  assert.equal(favoriteDropIndex(layouts, 0, 200), 2);
  assert.equal(favoriteDropIndex(layouts, 2, -220), 0);
  assert.equal(favoriteDropIndex(layouts, 1, -1000), 0);
  assert.equal(favoriteDropIndex(layouts, 1, 1000), 2);
});

test("edge scrolling stops at both ends and does not run in the middle", () => {
  assert.equal(favoriteScrollStep(300, 100, 400, 50, 1000), 50);
  assert.equal(favoriteScrollStep(100, 100, 400, 50, 1000), 41);
  assert.equal(favoriteScrollStep(500, 100, 400, 50, 1000), 59);
  assert.equal(favoriteScrollStep(0, 100, 400, 0, 1000), 0);
  assert.equal(favoriteScrollStep(700, 100, 400, 998, 1000), 1000);
  assert.equal(favoriteScrollStep(700, 100, 400, 0, 0), 0);
});
