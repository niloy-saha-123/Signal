import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest.config.ts doesn't set `test.globals`, so RTL's own auto-cleanup (which only
// registers when it finds a global `afterEach`) never fires — without this, multiple
// `render()` calls in one test file pile up in the same jsdom document instead of each
// test getting a clean slate.
afterEach(() => {
  cleanup();
});

// Recharts' ResponsiveContainer uses ResizeObserver, which jsdom doesn't implement. A no-op
// stub is enough — these tests assert on rendered text/attributes, not real pixel layout.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? ResizeObserverStub;

// jsdom elements measure 0x0 by default. ResponsiveContainer renders none of its chart's SVG
// children until it measures a nonzero size — without this, every Recharts test in this phase
// would see an empty <div class="recharts-responsive-container"> and nothing inside it.
Element.prototype.getBoundingClientRect = () =>
  ({
    width: 500,
    height: 300,
    top: 0,
    left: 0,
    bottom: 300,
    right: 500,
    x: 0,
    y: 0,
    toJSON() {
      return this;
    },
  }) as DOMRect;
