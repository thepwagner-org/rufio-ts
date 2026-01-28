# rufio-ts

OpenCode plugin that enforces code quality checks before stopping.

## Installation

```bash
pnpm build
mkdir -p ~/.config/opencode/plugin
ln -s /path/to/rufio-ts/dist/plugin.js ~/.config/opencode/plugin/rufio.js
```
When running in Zellij, the plugin also updates tab names with status indicators.

## Configuration

Create a `rufio-hooks.yaml` in your project root:
```yaml
checks:
  - name: my-check
    when:
      paths_changed: "src/**/*.ts"  # glob pattern (required)
      path_exists: "package.nix"    # only run if this path exists (optional)
    then:
      ensure_commands:              # commands that must have run
        - pnpm test
      # OR
      ensure_changed:               # files that must have changed
        - version.toml
```
- `ensure_commands`: verifies these commands ran (in any order) after the matching files changed
- `ensure_changed`: verifies these files were also modified in the session

### Presets

Presets are reusable check collections stored at `$XDG_CONFIG_HOME/rufio/presets/{name}.yaml`:
```yaml
# ~/.config/rufio/presets/pnpm.yaml
checks:
  - name: pnpm-checks
    when:
      paths_changed: "**/*.ts"
    then:
      ensure_commands:
        - pnpm lint
        - pnpm typecheck
        - pnpm test
```
Reference presets in your project config:
```yaml
presets:
  - pnpm

checks:
  - name: version-bump
    when:
      paths_changed: "**/*.ts"
    then:
      ensure_changed:
        - version.toml
```
