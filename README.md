# rufio-ts

OpenCode plugin that blocks the session from stopping until required commands have been run. Uses `git status` to detect changed files, then parses the session transcript to verify that specified commands (like `pnpm test` or `cargo clippy`) were executed after the last write to matching files.
Also updates Zellij tab names with status indicators when running in Zellij.
Example checks:
- If `.rs` files changed, `cargo test` and `cargo clippy` must run before stopping
- If `.ts` files changed, `version.toml` must also be modified before stopping

## Installation

```bash
pnpm build
mkdir -p ~/.config/opencode/plugin
ln -s /path/to/rufio-ts/dist/plugin.js ~/.config/opencode/plugin/rufio.js
```
