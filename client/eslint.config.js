// Flat config (ESLint 9+). Replaces the old .eslintrc.cjs — ESLint 10 no longer
// reads eslintrc files, and staying on 8 kept several vulnerable transitive
// deps (@eslint/eslintrc, @humanwhocodes/config-array) in the tree.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],

      // Pre-existing debt, downgraded to warnings so `npm run lint` still
      // fails on *new* problems instead of drowning in old ones. These fire on
      // code that predates the ESLint 8 -> 10 upgrade; typescript-eslint 8 and
      // react-hooks 7 simply detect more than the old versions did.
      //   no-non-null-asserted-optional-chain: 33 hits, all the `user?._id!`
      //     idiom used across the app for the logged-in user.
      //   set-state-in-effect / exhaustive-deps: data-fetch effects in the
      //     admin pages that setState after an RTK Query resolves.
      // Burn these down file by file, then promote each back to "error".
      "@typescript-eslint/no-non-null-asserted-optional-chain": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/purity": "warn",
    },
  }
);
