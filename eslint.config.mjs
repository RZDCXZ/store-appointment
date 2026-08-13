import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [".data/**", "**/coverage/**", "**/dist/**", "**/node_modules/**", "product-ui/**"],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["apps/admin/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: ["apps/mini-program/miniprogram/**/*.ts"],
    languageOptions: {
      globals: {
        App: "readonly",
        Page: "readonly",
        getApp: "readonly",
        wx: "readonly",
      },
    },
  },
  {
    files: ["**/*.{mjs,js}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
);
