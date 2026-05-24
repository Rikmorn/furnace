import { expect, test } from "bun:test";
import {
  computeP99,
  createFrameWindow,
  pushFrameMs,
} from "../../src/stats/frame-window.ts";

const FRAME_WINDOW_CAPACITY = 120;

test("createFrameWindow: returns a window with zero state", () => {
  const w = createFrameWindow();
  expect(w.ring.length).toBe(FRAME_WINDOW_CAPACITY);
  expect(w.writeIndex).toBe(0);
  expect(w.filled).toBe(0);
  expect(w.sum).toBe(0);
  expect(w.min).toBe(Number.POSITIVE_INFINITY);
  expect(w.max).toBe(Number.NEGATIVE_INFINITY);
});

test("pushFrameMs: first push populates index 0 and updates aggregates", () => {
  const w = createFrameWindow();
  pushFrameMs(w, 16.6);
  expect(w.ring[0]).toBeCloseTo(16.6);
  expect(w.writeIndex).toBe(1);
  expect(w.filled).toBe(1);
  expect(w.sum).toBeCloseTo(16.6);
  expect(w.min).toBeCloseTo(16.6);
  expect(w.max).toBeCloseTo(16.6);
});

test("pushFrameMs: 120 pushes fill the window; writeIndex wraps", () => {
  const w = createFrameWindow();
  for (let i = 0; i < FRAME_WINDOW_CAPACITY; i++) pushFrameMs(w, i);
  expect(w.filled).toBe(FRAME_WINDOW_CAPACITY);
  expect(w.writeIndex).toBe(0);
  expect(w.min).toBe(0);
  expect(w.max).toBe(FRAME_WINDOW_CAPACITY - 1);
});

test("pushFrameMs: post-fill rollover subtracts outgoing value from sum", () => {
  const w = createFrameWindow();
  for (let i = 0; i < FRAME_WINDOW_CAPACITY; i++) pushFrameMs(w, 10);
  expect(w.sum).toBeCloseTo(FRAME_WINDOW_CAPACITY * 10);
  pushFrameMs(w, 50);
  expect(w.sum).toBeCloseTo(FRAME_WINDOW_CAPACITY * 10 - 10 + 50);
});

test("pushFrameMs: outgoing equals cached min triggers re-scan", () => {
  const w = createFrameWindow();
  pushFrameMs(w, 5);
  for (let i = 1; i < FRAME_WINDOW_CAPACITY; i++) pushFrameMs(w, 20);
  expect(w.min).toBe(5);
  pushFrameMs(w, 100);
  expect(w.min).toBe(20);
  expect(w.max).toBe(100);
});

test("computeP99: empty window returns 0", () => {
  expect(computeP99(createFrameWindow())).toBe(0);
});

test("computeP99: single value returns that value", () => {
  const w = createFrameWindow();
  pushFrameMs(w, 17.3);
  expect(computeP99(w)).toBeCloseTo(17.3);
});

test("computeP99: 100 identical values returns the value", () => {
  const w = createFrameWindow();
  for (let i = 0; i < 100; i++) pushFrameMs(w, 16);
  expect(computeP99(w)).toBeCloseTo(16);
});

test("computeP99: one outlier among 119 baseline values surfaces as p99", () => {
  const w = createFrameWindow();
  for (let i = 0; i < 119; i++) pushFrameMs(w, 16);
  pushFrameMs(w, 100);
  expect(computeP99(w)).toBeCloseTo(16);
});

test("computeP99: ten outliers in 120 surface above baseline", () => {
  const w = createFrameWindow();
  for (let i = 0; i < 110; i++) pushFrameMs(w, 16);
  for (let i = 0; i < 10; i++) pushFrameMs(w, 100);
  expect(computeP99(w)).toBeCloseTo(100);
});
