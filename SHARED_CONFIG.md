# Shared Configuration Format

Rufio hooks use a unified configuration format shared between the Rust (`rufio`) and TypeScript (`rufio-ts`) implementations.

## Config File: `rufio-hooks.yaml`

Placed in project directories. Discovery walks up from changed files to repo root.

```yaml
presets:
  - cargo
  - meow

checks:
  - name: custom-check
    when:
      paths_changed: "**/*.py"
      path_exists: pyproject.toml  # optional
    then:
      ensure_commands:
        - pytest
      # OR
      ensure_changed:
        - CHANGELOG.md
```

### Fields

- `presets`: List of preset names to include (resolved from `$XDG_CONFIG_HOME/rufio/presets/`)
- `checks`: List of custom check definitions

### Check Definition

- `name`: Identifier for error messages
- `when.paths_changed`: Glob pattern matching changed files (relative to config dir)
- `when.path_exists`: Optional condition - check only runs if this path exists
- `then.ensure_commands`: Commands that must run after last matching edit (mutually exclusive with `ensure_changed`)
- `then.ensure_changed`: Paths that must be edited in session (mutually exclusive with `ensure_commands`)

## Preset Files: `$XDG_CONFIG_HOME/rufio/presets/{name}.yaml`

Default location: `~/.config/rufio/presets/`

```yaml
checks:
  - name: cargo-checks
    when:
      paths_changed: "**/*.rs"
    then:
      ensure_commands:
        - cargo test
        - cargo fmt
        - cargo clippy

  - name: cargo-version-bump
    when:
      paths_changed: "**/*.rs"
      path_exists: package.nix
    then:
      ensure_changed:
        - version.toml
```

## Behavior

- **No config found**: Spinner/progress tracking only, no validation checks
- **Preset resolution**: User presets override built-ins with same name
- **Command matching**: Exact match only (no aliases)
- **Monorepo support**: Different configs per package, globs relative to config dir

## Implementation Plan (TypeScript)

1. Rename config file from `rufio.yaml` to `rufio-hooks.yaml`
2. Update `src/config.ts`:
   - Rename `CONFIG_FILENAME` to `rufio-hooks.yaml`
   - Rename `When.glob` to `When.paths_changed`
   - Rename `Then.commands` to `Then.ensure_commands`
   - Add XDG preset loading (check `$XDG_CONFIG_HOME/rufio/presets/` first, fall back to built-ins)
3. Update `src/presets.ts`:
   - Update field names to match new schema
   - Keep as built-in fallback
4. Update `src/checks/runner.ts`:
   - Update field references (`when.paths_changed`, `then.ensure_commands`)
5. Update tests and example config
