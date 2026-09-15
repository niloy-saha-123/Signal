import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// @testing-library/react's waitFor/asyncWrapper only auto-advance fake timers when they can
// see a global `jest` with a mocked setTimeout — a Jest-specific check that Vitest's `vi`
// never satisfies on its own. Without this alias, `waitFor()` under `vi.useFakeTimers()`
// deadlocks forever on an internal `setTimeout(..., 0)` that never fires. See
// https://github.com/testing-library/dom-testing-library/issues/987 and RTL's own
// pure.js (jestFakeTimersAreEnabled checks `typeof jest !== 'undefined'`).
(globalThis as unknown as { jest: typeof vi }).jest = vi;

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

// jsdom has never implemented DragEvent (https://github.com/jsdom/jsdom/issues/2913). RTL's
// fireEvent.dragStart/dragOver/drop looks up `window.DragEvent`, finds nothing, and silently
// falls back to a plain `Event` — whose constructor drops unrecognized init dict members, so
// `event.clientX`/`clientY` come back `undefined` in every drag-and-drop test (Board's drag
// math among them) even though the test passes them in. MouseEvent's constructor does honor
// clientX/clientY, so subclassing it restores real coordinates for fireEvent's drag* helpers.
class DragEventPolyfill extends MouseEvent implements DragEvent {
  readonly dataTransfer: DataTransfer | null;
  constructor(type: string, eventInitDict: DragEventInit = {}) {
    super(type, eventInitDict);
    this.dataTransfer = eventInitDict.dataTransfer ?? null;
  }
}
globalThis.DragEvent = globalThis.DragEvent ?? (DragEventPolyfill as unknown as typeof DragEvent);
