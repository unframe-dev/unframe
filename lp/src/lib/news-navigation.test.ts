import assert from "node:assert/strict";
import { test } from "node:test";
import { getNewsBackNavigation, getNewsSource } from "./news-navigation";

test("getNewsSource accepts home and news as valid sources", () => {
  assert.equal(getNewsSource("home"), "home");
  assert.equal(getNewsSource("news"), "news");
});

test("getNewsSource defaults unknown sources to news", () => {
  assert.equal(getNewsSource(null), "news");
  assert.equal(getNewsSource("docs"), "news");
});

test("getNewsBackNavigation changes the destination based on the source", () => {
  assert.deepEqual(getNewsBackNavigation("home"), {
    href: "/",
    label: "ホームに戻る",
  });
  assert.deepEqual(getNewsBackNavigation("news"), {
    href: "/news/",
    label: "ニュースに戻る",
  });
});
