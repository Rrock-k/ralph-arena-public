import type { StorybookConfig } from "@storybook/nextjs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, "../src");
const mocksDir = path.resolve(__dirname, "mocks");

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: ["@storybook/addon-a11y", "@storybook/addon-docs"],
  framework: "@storybook/nextjs",
  webpackFinal: async (config) => {
    if (config.resolve) {
      config.resolve.alias = {
        ...config.resolve.alias,
        // Mock server actions and server-only modules
        // Use absolute src paths because @storybook/nextjs resolves @/ via tsconfig
        [path.join(srcDir, "app/actions/votes")]: path.join(
          mocksDir,
          "actions.ts"
        ),
        [path.join(srcDir, "app/actions/launch")]: path.join(
          mocksDir,
          "actions.ts"
        ),
        [path.join(srcDir, "app/actions/archive")]: path.join(
          mocksDir,
          "actions.ts"
        ),
        [path.join(srcDir, "app/actions/cancel")]: path.join(
          mocksDir,
          "actions.ts"
        ),
        [path.join(srcDir, "lib/prisma")]: path.join(
          mocksDir,
          "prisma.ts"
        ),
        [path.join(srcDir, "lib/auth")]: path.join(mocksDir, "auth.ts"),
      };
    }
    return config;
  },
};
export default config;
