import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runChecks } from "../checks/runner.js";
import { findNearestConfig, loadConfig } from "../config.js";
import type { ToolEvent } from "../transcript.js";

describe("loadConfig", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rufio-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("parses a valid config with ensure_commands", () => {
		const configPath = path.join(tmpDir, "rufio-hooks.yaml");
		fs.writeFileSync(
			configPath,
			`
checks:
  - name: biome
    when:
      paths_changed: "**/*.ts"
    then:
      ensure_commands:
        - biome check
`,
		);

		const config = loadConfig(configPath);
		expect(config.checks).toHaveLength(1);
		expect(config.checks[0].name).toBe("biome");
		expect(config.checks[0].when.paths_changed).toBe("**/*.ts");
		expect(config.checks[0].then.ensure_commands).toEqual(["biome check"]);
	});

	it("parses a valid config with ensure_changed", () => {
		const configPath = path.join(tmpDir, "rufio-hooks.yaml");
		fs.writeFileSync(
			configPath,
			`
checks:
  - name: version-bump
    when:
      paths_changed: "**/*.rs"
      path_exists: package.nix
    then:
      ensure_changed:
        - version.toml
`,
		);

		const config = loadConfig(configPath);
		expect(config.checks).toHaveLength(1);
		expect(config.checks[0].when.path_exists).toBe("package.nix");
		expect(config.checks[0].then.ensure_changed).toEqual(["version.toml"]);
	});

	it("throws on config without presets or checks", () => {
		const configPath = path.join(tmpDir, "rufio-hooks.yaml");
		fs.writeFileSync(configPath, "name: test");

		expect(() => loadConfig(configPath)).toThrow("no checks defined");
	});

	it("throws on missing name", () => {
		const configPath = path.join(tmpDir, "rufio-hooks.yaml");
		fs.writeFileSync(
			configPath,
			`
checks:
  - when:
      paths_changed: "**/*.ts"
    then:
      ensure_commands:
        - test
`,
		);

		expect(() => loadConfig(configPath)).toThrow("missing 'name'");
	});

	it("throws when both ensure_commands and ensure_changed are present", () => {
		const configPath = path.join(tmpDir, "rufio-hooks.yaml");
		fs.writeFileSync(
			configPath,
			`
checks:
  - name: bad
    when:
      paths_changed: "**/*.ts"
    then:
      ensure_commands:
        - test
      ensure_changed:
        - file.txt
`,
		);

		expect(() => loadConfig(configPath)).toThrow("cannot have both");
	});

	it("throws on empty config (no presets or checks)", () => {
		const configPath = path.join(tmpDir, "rufio-hooks.yaml");
		fs.writeFileSync(configPath, "# empty config\n");

		expect(() => loadConfig(configPath)).toThrow("no checks defined");
	});

	it("resolves a preset from XDG config directory", () => {
		// Set up mock XDG preset directory
		const xdgConfigHome = path.join(tmpDir, "xdg-config");
		const presetDir = path.join(xdgConfigHome, "rufio", "presets");
		fs.mkdirSync(presetDir, { recursive: true });
		fs.writeFileSync(
			path.join(presetDir, "meow.yaml"),
			`
checks:
  - name: meow-fmt
    when:
      paths_changed: "**/*.md"
    then:
      ensure_commands:
        - meow fmt
`,
		);

		const originalXdg = process.env.XDG_CONFIG_HOME;
		process.env.XDG_CONFIG_HOME = xdgConfigHome;

		try {
			const configPath = path.join(tmpDir, "rufio-hooks.yaml");
			fs.writeFileSync(
				configPath,
				`
presets:
  - meow
`,
			);

			const config = loadConfig(configPath);
			expect(config.checks).toHaveLength(1);
			expect(config.checks[0].name).toBe("meow-fmt");
			expect(config.checks[0].when.paths_changed).toBe("**/*.md");
		} finally {
			process.env.XDG_CONFIG_HOME = originalXdg;
		}
	});

	it("throws when preset not found in XDG directory", () => {
		// Set up empty XDG config directory
		const xdgConfigHome = path.join(tmpDir, "xdg-config");
		fs.mkdirSync(xdgConfigHome, { recursive: true });

		const originalXdg = process.env.XDG_CONFIG_HOME;
		process.env.XDG_CONFIG_HOME = xdgConfigHome;

		try {
			const configPath = path.join(tmpDir, "rufio-hooks.yaml");
			fs.writeFileSync(
				configPath,
				`
presets:
  - nonexistent
`,
			);

			expect(() => loadConfig(configPath)).toThrow(
				"preset 'nonexistent' not found",
			);
			expect(() => loadConfig(configPath)).toThrow(
				"rufio/presets/nonexistent.yaml",
			);
		} finally {
			process.env.XDG_CONFIG_HOME = originalXdg;
		}
	});
});

describe("findNearestConfig", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rufio-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("finds config in same directory", () => {
		const configPath = path.join(tmpDir, "rufio-hooks.yaml");
		fs.writeFileSync(
			configPath,
			`
checks:
  - name: test
    when:
      paths_changed: "**/*.ts"
    then:
      ensure_commands:
        - test
`,
		);

		const filePath = path.join(tmpDir, "file.ts");
		const result = findNearestConfig(filePath, tmpDir);

		expect(result).not.toBeNull();
		expect(result?.configPath).toBe(configPath);
	});

	it("finds config in parent directory", () => {
		const configPath = path.join(tmpDir, "rufio-hooks.yaml");
		fs.writeFileSync(
			configPath,
			`
checks:
  - name: test
    when:
      paths_changed: "**/*.ts"
    then:
      ensure_commands:
        - test
`,
		);

		const subDir = path.join(tmpDir, "src", "lib");
		fs.mkdirSync(subDir, { recursive: true });
		const filePath = path.join(subDir, "file.ts");

		const result = findNearestConfig(filePath, tmpDir);

		expect(result).not.toBeNull();
		expect(result?.configPath).toBe(configPath);
	});

	it("finds nearest config when multiple exist", () => {
		// Root config
		fs.writeFileSync(
			path.join(tmpDir, "rufio-hooks.yaml"),
			`
checks:
  - name: root
    when:
      paths_changed: "**/*.ts"
    then:
      ensure_commands:
        - root-cmd
`,
		);

		// Nested config
		const nestedDir = path.join(tmpDir, "packages", "foo");
		fs.mkdirSync(nestedDir, { recursive: true });
		const nestedConfig = path.join(nestedDir, "rufio-hooks.yaml");
		fs.writeFileSync(
			nestedConfig,
			`
checks:
  - name: nested
    when:
      paths_changed: "**/*.ts"
    then:
      ensure_commands:
        - nested-cmd
`,
		);

		const filePath = path.join(nestedDir, "src", "index.ts");
		fs.mkdirSync(path.join(nestedDir, "src"), { recursive: true });

		const result = findNearestConfig(filePath, tmpDir);

		expect(result).not.toBeNull();
		expect(result?.configPath).toBe(nestedConfig);
		expect(result?.config.checks[0].name).toBe("nested");
	});

	it("does not find config outside repo root", () => {
		// Create a config above the "repo root"
		const repoRoot = path.join(tmpDir, "repo");
		fs.mkdirSync(repoRoot);

		// Config at tmpDir level (outside repoRoot)
		fs.writeFileSync(
			path.join(tmpDir, "rufio-hooks.yaml"),
			`
checks:
  - name: outside
    when:
      paths_changed: "**/*.ts"
    then:
      ensure_commands:
        - test
`,
		);

		const filePath = path.join(repoRoot, "file.ts");
		const result = findNearestConfig(filePath, repoRoot);

		expect(result).toBeNull();
	});

	it("returns null when no config exists", () => {
		const filePath = path.join(tmpDir, "file.ts");
		const result = findNearestConfig(filePath, tmpDir);

		expect(result).toBeNull();
	});
});

describe("runChecks", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rufio-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns null when no config exists", () => {
		const result = runChecks(["file.ts"], [], tmpDir);
		expect(result).toBeNull();
	});

	it("returns null when no files match the glob", () => {
		fs.writeFileSync(
			path.join(tmpDir, "rufio-hooks.yaml"),
			`
checks:
  - name: biome
    when:
      paths_changed: "**/*.ts"
    then:
      ensure_commands:
        - biome check
`,
		);

		const result = runChecks(["file.md"], [], tmpDir);
		expect(result).toBeNull();
	});

	it("returns null when matching files were not edited in session", () => {
		fs.writeFileSync(
			path.join(tmpDir, "rufio-hooks.yaml"),
			`
checks:
  - name: biome
    when:
      paths_changed: "**/*.ts"
    then:
      ensure_commands:
        - biome check
`,
		);

		// Files are dirty in git but no edits in transcript
		const events: ToolEvent[] = [{ toolName: "Bash", command: "ls", index: 0 }];
		const result = runChecks(["file.ts"], events, tmpDir);
		expect(result).toBeNull();
	});

	it("returns error when commands not run after edit", () => {
		fs.writeFileSync(
			path.join(tmpDir, "rufio-hooks.yaml"),
			`
checks:
  - name: biome
    when:
      paths_changed: "**/*.ts"
    then:
      ensure_commands:
        - biome check
`,
		);

		const events: ToolEvent[] = [
			{ toolName: "Edit", filePath: path.join(tmpDir, "file.ts"), index: 0 },
		];

		const result = runChecks(["file.ts"], events, tmpDir);
		expect(result).toContain("Check 'biome' failed");
		expect(result).toContain("biome check");
	});

	it("returns null when all commands run after edit", () => {
		fs.writeFileSync(
			path.join(tmpDir, "rufio-hooks.yaml"),
			`
checks:
  - name: biome
    when:
      paths_changed: "**/*.ts"
    then:
      ensure_commands:
        - biome check
        - pnpm test
`,
		);

		const events: ToolEvent[] = [
			{ toolName: "Edit", filePath: path.join(tmpDir, "file.ts"), index: 0 },
			{ toolName: "Bash", command: "biome check", index: 1 },
			{ toolName: "Bash", command: "pnpm test", index: 2 },
		];

		const result = runChecks(["file.ts"], events, tmpDir);
		expect(result).toBeNull();
	});

	it("requires commands to run AFTER the last edit", () => {
		fs.writeFileSync(
			path.join(tmpDir, "rufio-hooks.yaml"),
			`
checks:
  - name: biome
    when:
      paths_changed: "**/*.ts"
    then:
      ensure_commands:
        - biome check
`,
		);

		const events: ToolEvent[] = [
			{ toolName: "Bash", command: "biome check", index: 0 },
			{ toolName: "Edit", filePath: path.join(tmpDir, "file.ts"), index: 1 },
		];

		const result = runChecks(["file.ts"], events, tmpDir);
		expect(result).toContain("Check 'biome' failed");
	});

	it("respects path_exists condition", () => {
		fs.writeFileSync(
			path.join(tmpDir, "rufio-hooks.yaml"),
			`
checks:
  - name: version-bump
    when:
      paths_changed: "**/*.rs"
      path_exists: package.nix
    then:
      ensure_changed:
        - version.toml
`,
		);

		// No package.nix exists, so check should not apply
		const events: ToolEvent[] = [
			{ toolName: "Edit", filePath: path.join(tmpDir, "main.rs"), index: 0 },
		];

		const result = runChecks(["main.rs"], events, tmpDir);
		expect(result).toBeNull();
	});

	it("enforces ensure_changed when path_exists is satisfied", () => {
		fs.writeFileSync(path.join(tmpDir, "package.nix"), "");
		fs.writeFileSync(
			path.join(tmpDir, "rufio-hooks.yaml"),
			`
checks:
  - name: version-bump
    when:
      paths_changed: "**/*.rs"
      path_exists: package.nix
    then:
      ensure_changed:
        - version.toml
`,
		);

		const events: ToolEvent[] = [
			{ toolName: "Edit", filePath: path.join(tmpDir, "main.rs"), index: 0 },
		];

		const result = runChecks(["main.rs"], events, tmpDir);
		expect(result).toContain("Check 'version-bump' failed");
		expect(result).toContain("version.toml");
	});

	it("passes when ensure_changed file was edited", () => {
		fs.writeFileSync(path.join(tmpDir, "package.nix"), "");
		fs.writeFileSync(
			path.join(tmpDir, "rufio-hooks.yaml"),
			`
checks:
  - name: version-bump
    when:
      paths_changed: "**/*.rs"
      path_exists: package.nix
    then:
      ensure_changed:
        - version.toml
`,
		);

		const events: ToolEvent[] = [
			{ toolName: "Edit", filePath: path.join(tmpDir, "main.rs"), index: 0 },
			{
				toolName: "Edit",
				filePath: path.join(tmpDir, "version.toml"),
				index: 1,
			},
		];

		const result = runChecks(["main.rs", "version.toml"], events, tmpDir);
		expect(result).toBeNull();
	});

	it("handles nested configs correctly", () => {
		// Root config for markdown
		fs.writeFileSync(
			path.join(tmpDir, "rufio-hooks.yaml"),
			`
checks:
  - name: meow
    when:
      paths_changed: "**/*.md"
    then:
      ensure_commands:
        - meow fmt
`,
		);

		// Nested config for TypeScript
		const pkgDir = path.join(tmpDir, "packages", "foo");
		fs.mkdirSync(pkgDir, { recursive: true });
		fs.writeFileSync(
			path.join(pkgDir, "rufio-hooks.yaml"),
			`
checks:
  - name: biome
    when:
      paths_changed: "**/*.ts"
    then:
      ensure_commands:
        - biome check
`,
		);

		// Edit a TS file in the nested package
		const events: ToolEvent[] = [
			{
				toolName: "Edit",
				filePath: path.join(pkgDir, "src", "index.ts"),
				index: 0,
			},
		];

		const result = runChecks(["packages/foo/src/index.ts"], events, tmpDir);
		expect(result).toContain("Check 'biome' failed");
		expect(result).not.toContain("meow");
	});
});
