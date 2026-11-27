import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    dir: "src",
    include: ["**/*.test.ts"],
    exclude: ["../../runtime/**", "**/.next/**"],
  },
});
