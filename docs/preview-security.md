# Preview Security Policy

`apps/governance-platform/src/components/preview/PreviewIframe.tsx` is the single runtime entry point for embedded project previews.

Rules:
- Public governance pages must never embed `localhost`, `127.0.0.1`, `[::1]`, or `*.localhost` preview URLs.
- Subdomain previews (`https://preview-*.domain`) use `sandbox="allow-scripts"` without `allow-same-origin`.
- Non-subdomain preview URLs may use `allow-scripts allow-same-origin` only through `PreviewIframe`, not through raw iframe tags.
- Runtime pages and admin screens should render previews only via `PreviewIframe` or wrappers built on top of it, such as `PreviewButton`.

Guardrail:
- `apps/governance-platform/src/components/preview/preview-security.test.ts` fails when a new runtime raw iframe appears in `src/`.

Documented exceptions:
- None.

Former Storybook-only project-card experiments were removed after the selected
design was migrated into `PreviewCard`. New project-card previews should use
`PreviewIframe` directly or stay in `.stories.tsx` files.
