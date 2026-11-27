import type { RequiredSecretEntry } from "@/lib/required-secrets";

export type ProjectAddonId = "telegram_mini_app" | "mac_electron_app";

export type ProjectAddonDefinition = {
  id: ProjectAddonId;
  label: string;
  description: string;
  specTitle: string;
  specContent: string;
  requiredSecrets: RequiredSecretEntry[];
};

export const PROJECT_ADDONS: ProjectAddonDefinition[] = [
  {
    id: "telegram_mini_app",
    label: "Telegram Mini App",
    description: "Expose this project's web preview through the project's own Telegram bot.",
    specTitle: "Addon: Telegram Mini App",
    specContent: `# Telegram Mini App Add-on

This project must expose its normal Arena web preview as a Telegram Mini App through the project's own Telegram bot.

Requirements:
- Use \`ARENA_TELEGRAM_PREVIEW_URL\` as the Telegram Web App URL when it is present.
- Do not point Telegram Mini App menu buttons at raw \`ARENA_PREVIEW_URL\`; raw preview URLs are for normal browser preview only and may require platform preview auth before Telegram identity is available.
- Use the required \`TELEGRAM_BOT_TOKEN\` project secret to configure the project bot.
- On app startup, perform bounded, idempotent Telegram Bot API setup:
  - call \`getMe\` to verify the token and read bot identity;
  - call \`setChatMenuButton\` with a \`web_app\` menu button pointing to \`ARENA_TELEGRAM_PREVIEW_URL\`;
  - use a short timeout/retry budget and never wait for human Telegram interaction.
- In the browser client, initialize \`window.Telegram.WebApp\` as early as possible when the Telegram SDK is present:
  - call \`ready()\`;
  - call \`expand()\` so the Mini App opens as Telegram's expanded sheet rather than forcing fullscreen;
  - call \`disableVerticalSwipes()\` when the method is available so vertical content swipes do not close or minimize the Mini App;
  - do not call \`requestFullscreen()\` by default; true fullscreen is outside this add-on baseline unless the product spec explicitly asks for it;
  - do not add Telegram fullscreen/safe-area event loops for the baseline add-on; keep layout owned by normal CSS viewport behavior and standard CSS \`env(safe-area-inset-*)\` where needed;
  - do not drive root, feed, carousel, or tab-shell height from Telegram \`viewportHeight\`, \`viewportStableHeight\`, or \`--tg-viewport-stable-height\`, because these values can be stale during sheet/fullscreen transitions;
  - feature-detect every Telegram WebApp method and keep the normal web preview usable outside Telegram.
- Do not require BotFather/Main Mini App short-name setup for MVP delivery.
- Never log or expose \`TELEGRAM_BOT_TOKEN\`.
- Keep the normal web preview usable outside Telegram.
- If the app reads \`Telegram.WebApp.initData\`, validate it on the backend against the same project bot before trusting Telegram user data.

Autonomous completion boundary:
- It is sufficient to implement the Telegram setup path and cover Telegram Bot API request construction with mocked or contract tests.
- No live verification with a real Telegram user sending messages is needed for autonomous completion.
- A real Telegram test chat id or real incoming Telegram messages are outside this add-on completion contract unless the main product spec explicitly asks for chat-message features.
`,
    requiredSecrets: [
      {
        key: "TELEGRAM_BOT_TOKEN",
        description: "Project-owned Telegram bot token used to expose the Arena preview as a Telegram Mini App.",
        blocking: true,
      },
    ],
  },
  {
    id: "mac_electron_app",
    label: "Mac Electron App",
    description: "Keep the normal Arena web preview and make the project buildable as a downloadable macOS Electron app.",
    specTitle: "Addon: Mac Electron App",
    specContent: `# Mac Electron App Add-on

This project must be implemented as an Electron desktop app that still exposes the normal Arena web preview for fast development.

Requirements:
- Keep the product UI and core domain logic shared between the browser preview and the Electron renderer.
- The Arena preview must run as a normal web app, bind to \`0.0.0.0\`, and stay usable without Electron APIs.
- Electron-specific behavior must be behind a narrow runtime adapter or preload bridge so the browser preview does not crash when Electron is absent.
- Provide deterministic project scripts for the Mac builder:
  - \`npm run build\` or the repo's equivalent web/type build command;
  - \`npm run dist:mac\` or the repo's documented equivalent macOS packaging command;
  - a stable output folder containing exactly one downloadable \`.zip\` or \`.dmg\` artifact for the selected version.
- Do not store Apple signing certificates, notarization credentials, local keychain material, or private update keys in the project repo.
- Do not implement remote executable-code loading as the update path. Updates must be delivered as published build artifacts with sha256 verification.
- Keep signing, notarization and local macOS build execution outside Ralph's Arena container unless the product spec explicitly adds a later signed-release requirement.
- Keep the app launchable and inspectable as a web preview before a Mac bundle exists.

Autonomous completion boundary:
- Inside Arena, it is sufficient to deliver the shared web/Electron code, the browser preview, and deterministic package scripts.
- The downloadable Mac bundle is complete only after an external trusted macOS builder publishes a validated release artifact back to Arena.
- Ralph must not claim that a Mac bundle exists merely because the web preview is healthy.
`,
    requiredSecrets: [],
  },
];

export function getProjectAddon(addonId: string): ProjectAddonDefinition | null {
  return PROJECT_ADDONS.find((addon) => addon.id === addonId) ?? null;
}

export function normalizeProjectAddonIds(addonIds: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const addonId of addonIds ?? []) {
    const id = addonId.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }

  return normalized;
}
