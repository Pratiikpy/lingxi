// One lint for the whole repo. The rules of hooks guard the game: a hook placed after an early return once took the
// live game down. The recommended TypeScript rules catch the rest of the everyday mistakes.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/dist-deweb/**", "**/assets-kept/**", "**/node_modules/**", "contracts/**", "packages/handheld/wasm/**", "packages/handheld/firmware/**", "**/.pio/**", "**/coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,js,mjs,cjs}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node }, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      // an effect that reads a value it does not list runs on stale data; what must not re-run it is an effect event
      "react-hooks/exhaustive-deps": "error",
      // a leading underscore names what is set aside on purpose: `const { gone: _gone, ...rest } = x`
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", caughtErrors: "none" }],
      // untrusted text is cleaned of control characters on purpose, and those patterns have to name them
      "no-control-regex": "off",
    },
  },
  // the end-to-end suite is not React: Playwright names its fixture callback `use`, which the hooks rules would take for React's
  { files: ["e2e/**"], rules: { "react-hooks/rules-of-hooks": "off", "react-hooks/exhaustive-deps": "off" } },
  // CommonJS config files load their neighbours with require()
  { files: ["**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
);
