# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

This package uses **Bun** as its package manager and runtime — there is no Node dependency. The scripts pass `--bun` so Vite and `json2ts` run under the Bun runtime rather than spawning Node via their shebangs. `bun.lock` is the committed lockfile (there is no `package-lock.json`).

- `bun install` — Install dependencies (use `bun install --frozen-lockfile` in CI). Note: one transitive postinstall (`rs-module-lexer`, pulled in by the optional `cem analyze` tool) is blocked by Bun's trusted-dependencies guard. Build/CI don't need it; run `bun pm trust rs-module-lexer` only if you need `bun run analyze`.
- `bun start` — Vite dev server on port 8000, opens `/demo/`, with watch-mode build running in parallel.
- `bun run build` — Production library build via Vite/Rollup. Outputs `dist/widget-toast.js` (ES module).
- `bun run watch` — `vite build --watch` only (no dev server).
- `bun run types` — Regenerate `src/definition-schema.d.ts` from `src/definition-schema.json` using `json2ts`. Run this after editing the JSON schema.
- `bun run analyze` — Generate Custom Elements Manifest (`cem analyze --litelement`).
- `bun run release` — Build, regenerate types, bump patch version, then create a **bare** semver git tag (no `v` prefix) and push commit + tag. `bun pm version` would tag with a `v` prefix, so the script uses `bun pm version patch --no-git-tag-version` and tags explicitly to match the repo convention. CI publishes to npm on tag push.
- `bun run link` / `bun run unlink` — Link this package into a sibling `../RESWARM/frontend` checkout for local integration testing.

No test runner or lint script is wired up despite README mentioning `lint`/`format` — those scripts do not exist in `package.json`. ESLint/Prettier configs are present (`.prettierrc`, eslint deps) but invocation is manual.

Bun `>=1.2.0` required (see `engines`). Unlike the other widgets in this monorepo (which use npm + `package-lock.json`), widget-toast is Bun-only.

## Architecture

This repo publishes `@record-evolution/widget-toast`, a single Lit web component consumed by the IronFlock/RESWARM platform frontend as a dashboard widget. It shows transient toast notifications (success / error / info / warning).

### Entry point and integration

- `src/widget-toast.ts` defines the Lit element. The custom element tag is `widget-toast-versionplaceholder` — the literal string `versionplaceholder` is replaced at build time by `@rollup/plugin-replace` (see `vite.config.ts`) with `pkg.version`. This versioned tag name lets multiple widget versions coexist on the same page (the host app reads the version from `package.json` and constructs the tag dynamically — see `demo/index.html`).
- The host platform passes data via two reactive properties: `inputData: InputData` (the message + config) and `theme: { theme_name, theme_object }`. Theme can also be supplied via CSS custom properties `--re-text-color` and `--re-tile-background-color`.
- **This widget is fully self-contained — it has NO `echarts` and NO peer dependencies.** `lit` and `tslib` are bundled into `dist/widget-toast.js` (unlike `widget-doughnut`, the Rollup config does not externalize anything).

### How "listening to a topic" works

Widgets in this ecosystem are purely presentational and never open their own MQTT/WebSocket connections. The host (`IronFlock-UI/src/components/widget-item.ts`) subscribes to the backend over WAMP and pushes the latest row into the widget's `inputData`. So a user "configures a topic the toast listens to" by binding the toast's `message` (and `type`) field to a backend table column in the dashboard editor; when the backend writes a row, the host replaces `inputData` with a **new object reference** and the widget reacts. There is intentionally no literal `topic` field in the widget.

### Data schema

- `src/definition-schema.json` is the source of truth for the input shape. It is consumed both as runtime documentation by the platform's widget configuration UI (note the `order`, `dataDrivenDisabled`, and rich `description` fields, which are platform-specific extensions read by the IronFlock dashboard editor) and compiled to `src/definition-schema.d.ts` via `bun run types`. The component imports `InputData` from the generated `.d.ts`.
- `message` and `type` (severity) are **data-driven** (no `dataDrivenDisabled`) — they reflect the latest published row. `displayTime`, `position`, `maxVisible`, `showIcon`, `showCloseButton`, and the per-severity color overrides are **static config** (`dataDrivenDisabled: true`).
- Note: `json2ts` maps `"type": "color"` fields to *empty interfaces*, not `string`. The component therefore reads the `*Color` overrides defensively (indexed `Record<string, unknown>` cast + `typeof === 'string'` check) in `accentColor()`.
- `src/default-data.json` is sample data used by the demo.

### Toast pipeline (inside `widget-toast.ts`)

1. **Trigger** — the host replaces `inputData` on each new backend row, so `update()` sees `changedProperties.has('inputData')`. The first such update is suppressed (it carries the stale last-persisted value on dashboard load). Every subsequent push with a non-empty `message` enqueues exactly one toast. Identical consecutive messages are intentionally NOT deduped — each push is a real event. (Tradeoff: editing a static config field in the dashboard editor also replaces `inputData` and can fire one spurious toast; accepted — the clean fix would be host-side.)
2. **`enqueueToast()`** — assigns a unique id (`Date.now() + counter`), enforces `maxVisible` by hard-dropping the oldest active toasts (clearing their timers first), and schedules a `setTimeout(displayTime)` dismissal unless `displayTime === 0` (persistent).
3. **`dismissToast()`** — sets the toast's `leaving` flag to play the CSS exit transition, then removes it after `LEAVE_MS`. **`LEAVE_MS` must equal the `transition` duration in the `.toast` style rule** — they are a coupling point.
4. **Timers** — all `setTimeout` handles live in a `Map` keyed by toast id and are cleared in `disconnectedCallback()`.
5. **Rendering** — an absolutely-positioned `.stack` inside a `position: relative; overflow: hidden` host. The `position` enum maps to CSS anchors (bottom positions use `flex-direction: column-reverse`). Each toast is a card with a colored left border, optional severity icon, the message (`white-space: pre-wrap`), and an optional close button. Sizing uses container-query units (`cqw`/`cqh`, `clamp()`), so no `ResizeObserver` is needed.

Default severity colors: success `#2e7d32` ✓, error `#c62828` ✕, info `#1565c0` ℹ, warning `#ed6c02` ⚠.

Not implemented (possible future enhancements): pause-auto-dismiss-on-hover and a `prefers-reduced-motion` opt-out.

### Build pipeline

`vite.config.ts` configures a library build:
- Single ES-module output (`dist/widget-toast.js`) with sourcemaps and a license banner.
- Nothing is externalized (self-contained widget; `lit`/`tslib` are bundled).
- `@rollup/plugin-replace` substitutes `versionplaceholder` → current `package.json` version (affects the custom element tag name and the `version` class field).
- `process.env.NODE_ENV` is hardcoded to `'production'`.

### Release flow

Tags pushed to GitHub trigger `.github/workflows/build-publish.yml` which runs on `oven-sh/setup-bun`: `bun install --frozen-lockfile`, `bun run build`, then `bun publish --access public` and creates a GitHub Release (the version is read with `jq`, no Node). `bun run release` is the canonical local command — it produces bare semver tags (e.g. `1.0.0`, not `v1.0.0`) to match the rest of the monorepo.
