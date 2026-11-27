import type { Preview } from "@storybook/nextjs";
import "../src/app/globals.css";

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: "arena",
      values: [
        { name: "arena", value: "#0a0c13" },
        { name: "dark", value: "#1a1a2e" },
      ],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
