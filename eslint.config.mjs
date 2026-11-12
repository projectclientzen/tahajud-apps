import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // CLAUDE.md: domain logic is pure TypeScript, no React, Next, UI, or data layer.
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "react", message: "src/domain must stay pure TypeScript." },
            { name: "react-dom", message: "src/domain must stay pure TypeScript." },
            { name: "next", message: "src/domain must stay pure TypeScript." },
          ],
          patterns: [
            { group: ["next/*", "react/*", "react-dom/*"], message: "src/domain must stay pure TypeScript." },
            {
              group: [
                "@/components",
                "@/components/*",
                "@/app",
                "@/app/*",
                "@/data",
                "@/data/*",
                "@/offline",
                "@/offline/*",
              ],
              message: "src/domain cannot import UI, routes, data, or offline code.",
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ["public/**", "node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts"],
  },
];

export default eslintConfig;
