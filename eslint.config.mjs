import nextVitals from "eslint-config-next/core-web-vitals";
import prettierConfig from "eslint-config-prettier";

const eslintConfig = [
  ...(Array.isArray(nextVitals) ? nextVitals : [nextVitals]),
  prettierConfig,
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "node_modules/**"
    ]
  }
];

export default eslintConfig;