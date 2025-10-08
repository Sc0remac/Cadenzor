import '@testing-library/jest-dom/vitest';

if (!Object.getOwnPropertyDescriptor(URLSearchParams.prototype, 'size')) {
  Object.defineProperty(URLSearchParams.prototype, 'size', {
    configurable: true,
    get() {
      let count = 0;
      for (const _entry of this) {
        count += 1;
      }
      return count;
    },
  });
}
