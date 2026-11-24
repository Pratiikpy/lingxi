// One lint for the whole repo. The rules of hooks guard the game: a hook placed after an early return once took the
// live game down. The recommended TypeScript rules catch the rest of the everyday mistakes.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: [".claude/**", "**/dist/**", "**/dist-test/**", "**/dist-next/**", "**/dist-deweb/**", "**/assets-kept/**", "apps/web/site/**", "**/node_modules/**", "e2e/.run/**", "test-results/**", "playwright-report/**", "contracts/**", "packages/handheld/wasm/**", "packages/handheld/firmware/**", "**/.pio/**", "**/coverage/**"] },
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
      // the React Compiler's checks, every one an error: no state set straight from an effect (each is a second
      // render), no refs read or written while rendering, nothing impure in render, nothing changed after it
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/set-state-in-render": "error",
      "react-hooks/refs": "error",
      "react-hooks/purity": "error",
      "react-hooks/immutability": "error",
      "react-hooks/globals": "error",
      "react-hooks/static-components": "error",
      "react-hooks/use-memo": "error",
      "react-hooks/void-use-memo": "error",
      "react-hooks/preserve-manual-memoization": "error",
      "react-hooks/incompatible-library": "error",
      "react-hooks/unsupported-syntax": "error",
      "react-hooks/error-boundaries": "error",
      "react-hooks/config": "error",
      "react-hooks/gating": "error",
      // a leading underscore names what is set aside on purpose: `const { gone: _gone, ...rest } = x`
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", caughtErrors: "none" }],
      // untrusted text is cleaned of control characters on purpose, and those patterns have to name them
      "no-control-regex": "off",
    },
  },
  // the game builds its requests as the server's schema types and never loads the schemas, so zod stays out of its
  // bundle; its tests may load them, to check that what the game builds is what the server accepts
  {
    files: ["apps/web/**"],
    ignores: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", { paths: [{ name: "@lingxi/api-schema", message: "import type only: the schemas are the server's; the game builds its requests as their types.", allowTypeImports: true }] }],
      // a wallet may reject with a bare string or with nothing, and reading its .message then throws inside the catch,
      // leaving the screen stuck (A21): errors are read through errorText / firstLine (apps/web/src/game/errorText.ts)
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name='message'] > TSAsExpression.object[typeAnnotation.typeName.name='Error']",
          message: "read a caught error with errorText(e) or firstLine(e) from game/errorText.ts: a wallet may throw a string or nothing.",
        },
      ],
    },
  },
  // the end-to-end suite is not React: Playwright names its fixture callback `use`, which the hooks rules would take for React's
  { files: ["e2e/**"], rules: { "react-hooks/rules-of-hooks": "off", "react-hooks/exhaustive-deps": "off" } },
  // CommonJS config files load their neighbours with require()
  { files: ["**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
);
