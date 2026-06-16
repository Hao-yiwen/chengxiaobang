# iOS Simulator Plugin

Plugin for model-driven iOS app development on macOS.

The package root is the plugin root. When enabled, the app loads:

- `.claude-plugin/plugin.json` for plugin metadata and skill/command paths.
- `.mcp.json` for the stdio MCP server.
- `skills/ios-dev/SKILL.md` for the model workflow.
- `commands/ios-dev.md` as a convenience slash command.

## App Usage

程小帮 bundles this package as the built-in `ios-simulator` plugin. Enable the
plugin to project its skill, slash command, and MCP server into the session.
Runtime options are stored in the app's plugin settings:

```json
{
  "plugins": {
    "enabledPlugins": {
      "ios-simulator": true
    },
    "options": {
      "ios-simulator": {
        "default_device": "iPhone 16",
        "ui_backend": "auto"
      }
    }
  }
}
```

The plugin MCP server name is `ios-simulator`. The model sees `mcp__ios_simulator__<tool>`, for example `mcp__ios_simulator__ios_preflight`. The MCP server still implements the raw MCP tool names such as `ios_preflight`; the app maps between the model-visible name and the server tool name.

Use stdio for the normal local workflow. HTTP is only useful if you later wrap this package as a long-running daemon shared by multiple clients.

## MVP Scope

- Use Apple's macOS Simulator app for rendering.
- Create a minimal SwiftUI app when no Xcode project exists.
- Discover projects, schemes, and bundle identifiers.
- Build with `xcodebuild` for iOS Simulator.
- Boot, show, install, launch, terminate, open URL, screenshot, and read logs through `simctl`.
- Expose optional UI actions through an isolated `idb` backend.

## MCP Tools

- `ios_preflight`
- `ios_list_simulators`
- `ios_boot_simulator`
- `ios_show_simulator`
- `ios_discover_project`
- `ios_create_app`
- `ios_build_app`
- `ios_build_and_run`
- `ios_install_app`
- `ios_launch_app`
- `ios_terminate_app`
- `ios_open_url`
- `ios_screenshot`
- `ios_logs`
- `ios_ui_status`
- `ios_ui_tap`
- `ios_ui_swipe`
- `ios_ui_type_text`
- `ios_ui_button`
- `ios_ui_describe`

## Requirements

- macOS.
- Full Xcode selected by `xcode-select`.
- An installed iOS Simulator runtime.
- Node.js 24.
- Optional: `idb` and `idb-companion` for tap/swipe/type/accessibility UI automation.

Run `ios_preflight` inside a model session to get precise missing setup checks.

## Development

```bash
pnpm install
pnpm --dir apps/backend/plugins/ios-simulator typecheck
pnpm --dir apps/backend/plugins/ios-simulator build
```

`.mcp.json` executes `dist/mcp/server.js` with Node.js. Run the package build
after changing TypeScript sources.

## Extension Points

- `src/providers/ui.ts` owns UI automation backend selection. P0 uses `idb`; future implementations can add XcodeBuildMCP or native Accessibility without changing tool names.
- `src/providers/project.ts` owns project discovery and creation.
- `src/providers/build.ts` owns Xcode build/install/launch orchestration.
- `src/providers/sim.ts` owns `simctl` device operations.
