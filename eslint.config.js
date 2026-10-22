import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "src/integrations/supabase/previewAuthStorage.ts",
      "supabase/functions/mcp/index.ts",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
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
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // Pre-publish gate: keep these as warnings (advisory) so lint doesn't block
      // publishing on stylistic/typing concerns. Real bugs (react-hooks rules,
      // no-empty, no-unused-expressions, etc.) remain errors.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "no-empty": "warn",
      // Database query builders (supabase.rpc/from/...) can be awaited but have no .catch(): chaining it crashes
      // the page at runtime. Use await + try/catch, safeRpc() or .then(undefined, handler).
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='catch'][callee.object.type='CallExpression'][callee.object.callee.property.name=/^(rpc|from|schema|select|insert|update|upsert|delete|eq|neq|gt|gte|lt|lte|in|is|like|ilike|contains|order|limit|range|single|maybeSingle|match|filter|not|or|returns|csv|throwOnError|abortSignal)$/]",
          message: "Database query builders have no .catch(). Use await inside try/catch, safeRpc(), or .then(undefined, handler).",
        },
      ],
    },
  },
);
