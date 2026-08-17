import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { globalIgnores } from "eslint/config";

// eslint-plugin-react-hooks@7.1.1's own configs.recommended/
// recommended-latest/flat still use the legacy eslintrc-style
// `plugins: ["react-hooks"]` (an array of strings), which flat config
// (and typescript-eslint's own config() validation) rejects outright --
// confirmed by direct inspection of the installed package, not assumed.
// Registered manually here instead of spreading the broken preset.
export default tseslint.config([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended, reactRefresh.configs.vite],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: reactHooks.configs.recommended.rules,
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
  },
]);
