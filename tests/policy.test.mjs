import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUOTAS, KNOWN_TASKS, HAIKU, SONNET,
  quotaFor, quotaSummary, modelFor, clampText, prepareInput,
  maxOutputTokens, callCost, validateRequest, BOUNDARY_LOOKBACK,
} from "../supabase/functions/_shared/policy.mjs";

test("every known task has a quota row, and every quota row is a known task", () => {
  // This is the check that stops the previous project's most expensive bug:
  // an AI-calling feature that shipped with a daily counter and no monthly
  // limit, multiplying the intended cost ceiling by about ten.
  for (const task of KNOWN_TASKS) {
    assert.ok(QUOTAS[task], `task "${task}" may make calls but has no quota`);
  }
  for (const task of Object.keys(QUOTAS)) {
    assert.ok(KNOWN_TASKS.has(task), `quota "${task}" is for a task that cannot be called`);
  }
});

test("every quota is bounded on all four axes", () => {
  for (const [task, q] of Object.entries(QUOTAS)) {
    for (const field of ["perMonth", "perDay", "maxInputChars", "maxOutputTokens"]) {
      assert.equal(typeof q[field], "number", `${task}.${field}`);
      assert.ok(q[field] > 0, `${task}.${field} must be a real limit`);
      assert.ok(Number.isFinite(q[field]), `${task}.${field} must be finite`);
    }
    assert.ok(q.model, `${task} must name a model`);
  }
});

test("the daily backstop is far below the monthly limit spread over a month", () => {
  // perDay exists to stop a runaway retry loop, not to ration honest use. If
  // it ever drifts up to perMonth/28 it has stopped being a backstop.
  for (const [task, q] of Object.entries(QUOTAS)) {
    assert.ok(q.perDay < q.perMonth, `${task}: a daily cap at or above the monthly one is not a cap`);
    assert.ok(q.perDay * 28 > q.perMonth, `${task}: the daily cap makes the monthly one unreachable`);
  }
});

test("the worst case a free user can cost is bounded and small", () => {
  // Priced at the quota's own model, at the full input and output budget for
  // every one of the month's calls. If this number ever stops being small,
  // the failure is loud here rather than quiet on a bill.
  let worstMicrocents = 0;
  for (const q of Object.values(QUOTAS)) {
    const perCall = callCost(q.model, {
      input_tokens: Math.ceil(q.maxInputChars / 4),
      output_tokens: q.maxOutputTokens,
    });
    worstMicrocents += perCall * q.perMonth;
  }
  const dollars = worstMicrocents / 100_000;
  assert.ok(dollars < 1, `worst case per user per month is $${dollars.toFixed(3)}, expected under $1`);
});

test("cost is integer arithmetic that never returns NaN", () => {
  assert.equal(callCost(HAIKU, { input_tokens: 1_000_000, output_tokens: 0 }), 100_000);
  assert.equal(callCost(HAIKU, { input_tokens: 0, output_tokens: 1_000_000 }), 500_000);
  assert.equal(callCost(SONNET, { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 1_800_000);
  assert.equal(callCost(HAIKU, {}), 0);
  assert.equal(callCost(HAIKU, null), 0);
  assert.equal(callCost("some-unknown-model", { input_tokens: 999 }), 0);
  assert.equal(callCost(HAIKU, { input_tokens: -5, output_tokens: "x" }), 0);
  assert.equal(Number.isInteger(callCost(HAIKU, { input_tokens: 7, output_tokens: 3 })), true);
});

test("clampText leaves text that fits completely alone", () => {
  assert.equal(clampText("short", 100), "short");
  assert.equal(clampText("", 100), "");
  assert.equal(clampText(null, 100), "");
  assert.equal(clampText("anything", 0), "");
});

test("clampText cuts on a boundary when one is near the end, and not otherwise", () => {
  const words = "aaaa bbbb cccc dddd eeee";
  const cut = clampText(words, 22);
  assert.equal(cut, "aaaa bbbb cccc dddd", "trailing partial word is dropped");
  const noSpaces = "x".repeat(50);
  assert.equal(clampText(noSpaces, 20).length, 20, "no boundary means a hard cut, not an empty string");
});

test("prepareInput reports truncation so the student can be told", () => {
  const q = quotaFor("extract");
  const big = "word ".repeat(q.maxInputChars);
  const out = prepareInput("extract", big);
  assert.equal(out.truncated, true, "a two-page photo must not silently become one page");
  assert.ok(out.text.length <= q.maxInputChars);
  assert.equal(out.ok, true);

  const small = prepareInput("extract", "1. Solve 2x=4");
  assert.equal(small.truncated, false);
  assert.equal(small.text, "1. Solve 2x=4");
});

test("prepareInput on an unknown task refuses rather than defaulting", () => {
  const out = prepareInput("tutor", "anything");
  assert.equal(out.ok, false);
  assert.equal(out.text, "");
});

test("validateRequest is the authority, and rejects what the UI would not send", () => {
  assert.equal(validateRequest({ task: "extract", text: "1. Solve" }), null);
  assert.equal(validateRequest({ task: "tutor", text: "hi" })?.code, "unknown_task");
  assert.equal(validateRequest({ text: "hi" })?.code, "unknown_task");
  assert.equal(validateRequest({ task: "extract", text: "   " })?.code, "empty_input");
  assert.equal(validateRequest({ task: "extract" })?.code, "empty_input");
  assert.equal(validateRequest(null)?.code, "unknown_task");
  for (const bad of [{ task: "tutor" }, null, {}]) {
    const r = validateRequest(bad);
    assert.equal(r.status, 400);
    assert.ok(r.message, "a rejection the UI can show");
  }
});

test("quotaSummary is the one source for numbers shown on screen", () => {
  const s = quotaSummary("extract");
  assert.equal(s.perMonth, QUOTAS.extract.perMonth);
  assert.equal(s.perDay, QUOTAS.extract.perDay);
  assert.equal(quotaSummary("tutor"), null);
});

test("modelFor and maxOutputTokens read the quota row, not a second copy", () => {
  assert.equal(modelFor("extract"), QUOTAS.extract.model);
  assert.equal(maxOutputTokens("extract"), QUOTAS.extract.maxOutputTokens);
  assert.equal(modelFor("nope"), HAIKU, "an unknown task falls back to the cheapest model");
});

test("the boundary look-back is an absolute distance, not a share of the budget", () => {
  // The bug this pins: a fractional threshold ("boundary must be in the last
  // 10%") looks fine at a 200-character budget and silently discards two
  // thousand characters of a worksheet at a 20,000-character one.
  const budget = 20_000;
  const head = "x".repeat(budget - BOUNDARY_LOOKBACK * 4);
  const tail = "y".repeat(BOUNDARY_LOOKBACK * 8);
  const text = head + " " + tail;

  assert.equal(
    clampText(text, budget).length, budget,
    "a boundary further back than the look-back is ignored, not honoured",
  );

  const near = "z".repeat(budget - 10) + " " + "w".repeat(500);
  assert.equal(clampText(near, budget).length, budget - 10, "a nearby boundary is honoured");
});
