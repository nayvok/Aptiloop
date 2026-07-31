import "@testing-library/jest-dom/vitest";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class IntersectionObserverMock {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

Object.defineProperty(globalThis, "ResizeObserver", {
  value: ResizeObserverMock,
  configurable: true,
});
Object.defineProperty(globalThis, "IntersectionObserver", {
  value: IntersectionObserverMock,
  configurable: true,
});
Object.defineProperty(Element.prototype, "scrollTo", {
  value: () => undefined,
  configurable: true,
});
