import { NextRequest, NextResponse } from "next/server";
import { TELEGRAM_WEBAPP_INIT_DATA_HEADER } from "@/lib/telegram-webapp-auth";

const JSON_SCRIPT_ESCAPE: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

function jsonForInlineScript(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => JSON_SCRIPT_ESCAPE[char] ?? char);
}

function htmlResponse(html: string, status = 200): NextResponse {
  return new NextResponse(html, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": [
        "default-src 'none'",
        "script-src 'unsafe-inline' https://telegram.org",
        "connect-src 'self'",
        "style-src 'unsafe-inline'",
        "base-uri 'none'",
        "frame-ancestors 'self' https://telegram.org https://*.telegram.org",
      ].join("; "),
      "Referrer-Policy": "no-referrer",
    },
  });
}

function safeTelegramStartParam(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return /^[A-Za-z0-9_-]{1,512}$/.test(text) ? text : null;
}

function readInitialProjectId(req: NextRequest): string | null {
  return safeTelegramStartParam(req.nextUrl.searchParams.get("projectId"))
    ?? safeTelegramStartParam(req.nextUrl.searchParams.get("tgWebAppStartParam"));
}

function buildTelegramPreviewEntryHtml(input: {
  projectId: string | null;
}): string {
  const initialProjectId = jsonForInlineScript(input.projectId);
  const initDataHeader = jsonForInlineScript(TELEGRAM_WEBAPP_INIT_DATA_HEADER);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Opening preview</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    :root { color-scheme: dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0f19; color: #f8fafc; }
    main { width: min(360px, calc(100vw - 32px)); text-align: center; }
    h1 { margin: 0 0 10px; font-size: 20px; }
    p { margin: 0; color: #94a3b8; font-size: 14px; line-height: 1.5; }
    .error { color: #fca5a5; }
  </style>
</head>
<body>
  <main>
    <h1>Opening preview</h1>
    <p id="status">Checking Telegram identity...</p>
  </main>
  <script>
    const initialProjectId = ${initialProjectId};
    const initDataHeader = ${initDataHeader};
    const statusEl = document.getElementById("status");
    const startParamPattern = /^[A-Za-z0-9_-]{1,512}$/;

    function fail(message) {
      statusEl.className = "error";
      statusEl.textContent = message;
    }

    function safeStartParam(value) {
      if (typeof value !== "string") return null;
      const text = value.trim();
      return startParamPattern.test(text) ? text : null;
    }

    function resolveProjectId(webApp) {
      const params = new URLSearchParams(window.location.search);
      return safeStartParam(initialProjectId)
        || safeStartParam(params.get("projectId"))
        || safeStartParam(params.get("tgWebAppStartParam"))
        || safeStartParam(webApp && webApp.initDataUnsafe && webApp.initDataUnsafe.start_param);
    }

    function callWebAppMethod(webApp, name) {
      const method = webApp && webApp[name];
      if (typeof method !== "function") return;
      try {
        method.call(webApp);
      } catch {
        // Telegram clients can expose partial APIs; handoff remains fail-closed.
      }
    }

    function applyViewportMode(webApp) {
      callWebAppMethod(webApp, "expand");
      callWebAppMethod(webApp, "requestFullscreen");
      callWebAppMethod(webApp, "disableVerticalSwipes");
      callWebAppMethod(webApp, "enableClosingConfirmation");
    }

    async function openPreview() {
      const webApp = window.Telegram && window.Telegram.WebApp;
      const initData = webApp && webApp.initData;
      if (!initData) {
        fail("Open this preview from the project Telegram Mini App.");
        return;
      }
      const projectId = resolveProjectId(webApp);
      if (!projectId) {
        fail("This Telegram preview link is missing a project id.");
        return;
      }
      callWebAppMethod(webApp, "ready");
      applyViewportMode(webApp);
      [100, 350, 1000, 2000].forEach((delay) => window.setTimeout(() => applyViewportMode(webApp), delay));
      if (typeof webApp.onEvent === "function") {
        try {
          webApp.onEvent("viewportChanged", () => applyViewportMode(webApp));
          webApp.onEvent("fullscreenFailed", () => applyViewportMode(webApp));
        } catch {
          // Delayed retries above still cover startup when event registration is unavailable.
        }
      }

      const response = await fetch("/api/auth/handoff", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [initDataHeader]: initData,
        },
        body: JSON.stringify({
          projectId,
          telegramBotScope: "project",
          includePreviewRedirectUrl: true,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload || typeof payload.redirectUrl !== "string") {
        const reason = payload && typeof payload.status === "string" ? payload.status : "rejected";
        fail("Telegram identity was not accepted for this private preview: " + reason + ".");
        return;
      }

      window.location.replace(payload.redirectUrl);
    }

    openPreview().catch(() => {
      fail("Telegram preview handoff failed. Please reopen the Mini App.");
    });
  </script>
</body>
</html>`;
}

export async function GET(req: NextRequest) {
  return htmlResponse(buildTelegramPreviewEntryHtml({
    projectId: readInitialProjectId(req),
  }));
}
