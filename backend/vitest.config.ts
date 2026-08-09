import { defineConfig } from "vitest/config";

/**
 * Unit tests only, and deliberately so.
 *
 * Everything under `src/utils/__tests__` is a pure function over plain objects:
 * pricing, the refund arithmetic, the coupon rules, the unsubscribe HMAC and the
 * variant form parser. None of them touches Postgres, so `npm test` needs no
 * database and runs in CI without one.
 *
 * That is a real limit, stated rather than hidden: the controllers, the guards
 * and the route audit are not covered here. What is covered is the arithmetic
 * that decides money and the parsing that decides what reaches the database —
 * the two places where a silent error is expensive and a test is cheap.
 */
export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
