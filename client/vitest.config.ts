import { defineConfig } from "vitest/config";

/**
 * Unit tests for the logic that decides money and identity.
 *
 * No component rendering: that would need jsdom and testing-library, and what is
 * actually worth pinning here is not markup. It is the cart's arithmetic — which
 * is computed a second time on the server, so a divergence shows one total and
 * charges another — and the variant matching that decides what a buy box is
 * charging for.
 *
 * `environment: "node"` follows from that. Nothing under test touches the DOM.
 */
export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
