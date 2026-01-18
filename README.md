# rufio-ts

OpenCode plugin that enforces lint checks before stopping and updates Zellij tab status.
This is the TypeScript sibling of [rufio](../rufio/) (Rust) - same functionality, native to OpenCode's plugin architecture.

## Installation

```bash
# Build the plugin
pnpm build

# Symlink to global plugins
mkdir -p ~/.config/opencode/plugin
ln -s /path/to/rufio-ts/dist/plugin.js ~/.config/opencode/plugin/rufio.js
```

## What it does

When a session goes idle, rufio checks:
1. **version_bump** - If `.rs` files changed and `package.nix` exists, `version.toml` must be bumped
2. **cargo** - If `.rs` files changed, `cargo test`, `cargo fmt`, `cargo clippy` must have run after the last edit
3. **meow** - If any `*.md` files changed, `meow fmt` must have run after the last edit
If any check fails, the plugin throws an error to remind you to run the missing commands.
It also updates Zellij tab names with status emojis (if running in Zellij).
