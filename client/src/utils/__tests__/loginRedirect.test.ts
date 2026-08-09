import { describe, expect, it } from "vitest";
import { loginState, readLoginState, safeReturnTo } from "../loginRedirect";

/**
 * The return path after signing in.
 *
 * This value is handed straight to `<Navigate to={from}>`, so it decides where
 * a signed-in customer lands — including, if it is wrong, on another site
 * entirely. The interesting cases are all ones nobody reproduces by hand:
 * history entries from an older build, a `from` that points back at /login, and
 * the protocol-relative forms a browser reads as an absolute URL.
 */

describe("safeReturnTo", () => {
  it("keeps an ordinary internal path", () => {
    expect(safeReturnTo("/orders")).toBe("/orders");
  });

  it("keeps the query string", () => {
    expect(safeReturnTo("/search?q=shoes&category=tech")).toBe(
      "/search?q=shoes&category=tech"
    );
  });

  it("falls back home when there is nothing to return to", () => {
    expect(safeReturnTo(undefined)).toBe("/");
    expect(safeReturnTo(null)).toBe("/");
    expect(safeReturnTo("")).toBe("/");
  });

  it("refuses /login, which would be a redirect loop", () => {
    expect(safeReturnTo("/login")).toBe("/");
    expect(safeReturnTo("/login?next=/orders")).toBe("/");
  });

  it("refuses protocol-relative paths, which leave the site", () => {
    expect(safeReturnTo("//evil.example")).toBe("/");
    expect(safeReturnTo("/\\evil.example")).toBe("/");
  });

  it("refuses anything that is not a path", () => {
    expect(safeReturnTo("https://evil.example")).toBe("/");
    expect(safeReturnTo("javascript:alert(1)")).toBe("/");
    expect(safeReturnTo(42 as unknown as string)).toBe("/");
  });

  it("allows a path that merely contains login further along", () => {
    expect(safeReturnTo("/product/login-cable")).toBe("/product/login-cable");
  });
});

describe("loginState", () => {
  it("sanitises as it builds", () => {
    expect(loginState("//evil.example")).toEqual({ from: "/" });
  });

  it("carries an intent when one is given", () => {
    expect(loginState("/search", { type: "wishlist", productId: "p1" })).toEqual({
      from: "/search",
      intent: { type: "wishlist", productId: "p1" },
    });
  });
});

describe("readLoginState", () => {
  it("survives history entries with no state", () => {
    expect(readLoginState(null)).toEqual({ from: "/" });
    expect(readLoginState(undefined)).toEqual({ from: "/" });
    expect(readLoginState({})).toEqual({ from: "/" });
  });

  it("drops an intent it does not recognise", () => {
    expect(readLoginState({ from: "/search", intent: { type: "wat" } })).toEqual({
      from: "/search",
    });
    expect(readLoginState({ from: "/search", intent: { type: "wishlist" } })).toEqual({
      from: "/search",
    });
  });

  it("re-sanitises the path, since history outlives this build", () => {
    expect(readLoginState({ from: "//evil.example" })).toEqual({ from: "/" });
  });
});
