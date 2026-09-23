# Desktop Tab agent instructions

## Repository and scope

- This is the separate `@opencode/desktop-tab` Git repository, normally checked out beside `packages/desktop` and `packages/7777`. The parent OpenCode repository ignores this directory. Check Git status in each repository you change; parent diffs do not include extension changes.
- This package is a build-time Electron desktop extension. Do not implement it as a server/tool plugin or introduce a runtime plugin marketplace.
- Read `README.md`, `desktop-extension.json`, and the host's public `@opencode/desktop/extension` contract before changing integration behavior.
- Keep extension implementation here. Host API changes belong in the OpenCode repository; 7777 renderer changes belong in its own repository. Do not edit another checkout's generated output.
- Use `v2` as the default branch base. New branch names contain at most three hyphen-separated words, without slashes or type prefixes. Use conventional commit messages such as `fix(desktop-tab): restore site navigation`. Do not add Changesets or invent a Git remote URL.

## Architecture boundary

- Import desktop types only from `@opencode/desktop/extension` using `import type`. Do not import runtime code or private source paths from desktop, app, core, server, or 7777.
- The host owns application lifecycle, service discovery, native menus, renderer RPC transport, window recovery, appearance, and SQLite. This package owns site configuration, sidebar UI, tab lifetimes, site policies, cookies, SSO, and its preload bridges.
- Add business behavior through host callbacks. Extend the public host contract only when a capability cannot be expressed through the existing boundary; do not move site-specific behavior back into the host.
- Keep the manifest and runtime `apiVersion` consistent. Preserve API 1 compatibility unless deliberately coordinating a version change with the host.
- Declare entry points and packaged assets in `desktop-extension.json`. Keep the base desktop build functional when this checkout is absent or `OPENCODE_DESKTOP_EXTENSION=none` is selected.
- Packaged code must use built assets, never source-checkout paths. Use `ELECTRON_7777_RENDERER_URL` and `ELECTRON_PLM_MEETING_RENDERER_URL` for the respective optional renderer development servers.

## Configuration and window behavior

- Validate unknown configuration once in `src/main/desktop-tabs.ts`; pass typed values inward. Preserve JSONC support and existing `sigmaagents.jsonc` field names and defaults.
- Keep `src/main/tabs.ts` independent of Electron. It owns per-window selection and view lifetimes; Electron wiring belongs in `src/main/index.ts`.
- Create additional views lazily. Retain them by default, release them only when `releaseWhenLostFocus` requests it, and dispose of all owned web contents when the window closes.
- `skipDisplay` hides a sidebar button, not the configured tab. The `opencode` tab must remain available for settings and sign-in actions.
- Preserve URL restoration, configured system-control colors, local agent identity, welcome text, and suggested questions.
- Distinguish primary content from active content. Settings and login target the primary renderer; navigation and native editing actions target active content.
- Return the primary view as the native content root so embedded browser panes follow its bounds and visibility. Keep window state isolated across windows, including windows sharing a site partition.
- Permanent-close cleanup may forget window state. Application quit must retain restorable state.

## IPC, navigation, and credentials

- Create trusted bundled renderers through `host.createRenderer`. Register external contents with `host.trackContents` without granting them the normal desktop RPC bridge.
- Return extension IPC handlers through the host registration hook. Do not register process-global `ipcMain` handlers elsewhere in production code.
- Keep renderers limited to explicit preload APIs. Preloads expose narrow operations, never unrestricted `ipcRenderer`, Node, or filesystem access.
- Validate IPC payloads at their boundary. Site calls must come from registered web contents, the top-level frame, and the configured origin; an embedded SSO redirect does not inherit the site's IPC privileges.
- Preserve exact-origin navigation checks, including scheme and port. The exact THAPE SSO origin is the explicit embedded redirect exception; other navigation and popups go through `host.openExternal`.
- Grant supported local-network and clipboard permissions only to registered `localServer` views at their configured origins. Shared partitions must retain independent permission decisions for each web contents.
- Preserve external `window.api.awaitInitialization()` and `window.api.getCybrosCurrentUser()` compatibility. The host's legacy `AppGetCybrosCurrentUser` RPC forwards to this package; keep its network implementation here.
- Supply the local service password only to authorized `localServer` sites. Do not broaden credential access or log credentials, bearer tokens, or sign-in passwords.
- Keep Electron sandboxing and context isolation enabled, and Node integration disabled, for site and sidebar views.

## Persistence and SSO

- Use host SQLite storage for new durable state. Keep cookie snapshots encrypted with Electron `safeStorage`; do not fall back to plaintext when encryption is unavailable.
- Preserve existing state namespaces and legacy migration behavior. Existing stored state wins over legacy files during migration.
- Retain the saved `.thape-sso-bearer-api-key` file and its precedence over environment values. This compatibility exception exists because SSO initialization precedes host storage startup; preserve restrictive file permissions.
- Failed sign-in must not save a replacement key. Bearer rejection must clear the saved and active key and refresh sign-in availability.
- Successful sign-in uses the host account dialog and quit flow. The host stops the background service before quitting.
- Reconnecting a service stream must not rewrite CORS configuration or restart the background service. Only initial service setup consumes this package's configured CORS origins.

## Code and UI conventions

- Prefer `const`, early returns, inferred types, and functional array operations. Avoid `any`, unnecessary destructuring, aliased imports, star imports, and speculative abstractions.
- Keep helpers close to their callers and extract them when they name a meaningful concept or are reused. Validate unknown input once rather than defensively revalidating typed internal values.
- Use Bun APIs in development scripts and tests where appropriate. Production main/preload code runs in Electron, so do not introduce Bun-only runtime APIs there.
- Keep sidebar copy in `src/shared/copy.ts`; do not scatter user-visible strings through rendering or event handlers. Preserve existing English copy when changing its presentation or localization mechanism.
- Obtain site labels and titles from configuration. Do not add hardcoded fallback sites to the sidebar.

## Verification

- Run tests and typechecks from package directories, never from the OpenCode repository root. Use `bun typecheck`, not `tsc` directly.
- Run `bun test` for configuration, controller, navigation-policy, and SSO changes. Test the actual implementation; avoid global mocks and duplicated implementation logic in tests.
- Run `bun run test:electron` for view, preload, IPC, layout, or disposal changes. It uses temporary profiles and local fixture pages; do not substitute the installed desktop profile or live background service. Rejected-sender and rejected-origin logs are expected assertions in this test.
- When changing the host contract or build integration, run the host typecheck and verify both extension-enabled and base desktop builds. From `packages/desktop`, use `OPENCODE_DESKTOP_EXTENSION=../desktop-tab bunx --no-install electron-vite build` and `OPENCODE_DESKTOP_EXTENSION=none bunx --no-install electron-vite build` when sidecar and renderer assets are already prepared.
- `bun dev` starts the extension-enabled development workflow. `bun run build` builds 7777 and plm-meeting separately and runs the host's normal prebuild/build; it does more work than rebuilding Electron assets alone.
- Add focused regression coverage for changed behavior. Documentation-only changes do not require runtime tests.
- Report which checks ran. Distinguish fixture-based SSO tests and local-platform Electron checks from live THAPE authentication and Windows/Linux release QA.
