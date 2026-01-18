import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parse } from "yaml";

/**
 * Conditions that trigger a check
 */
interface When {
	/** Glob pattern for files that trigger this check (relative to config dir) */
	paths_changed: string;
	/** Optional: check only applies if this path exists (relative to config dir) */
	path_exists?: string;
}

/**
 * Actions required when check triggers - mutually exclusive
 */
interface Then {
	/** Commands that must ALL run after the last matching edit */
	ensure_commands?: string[];
	/** At least one of these paths must have been edited this session */
	ensure_changed?: string[];
}

/**
 * A single check definition
 */
export interface Check {
	/** Name of the check (for error messages) */
	name: string;
	/** Conditions that trigger this check */
	when: When;
	/** Required actions */
	then: Then;
}

/**
 * Raw configuration structure (as parsed from YAML)
 */
interface RufioConfigRaw {
	/** Built-in preset names to include */
	presets?: string[];
	/** Custom check definitions */
	checks?: Check[];
}

/**
 * Resolved configuration (presets expanded, checks always defined)
 */
export interface RufioConfig {
	checks: Check[];
}

/**
 * Parsed config with its location
 */
export interface LoadedConfig {
	config: RufioConfig;
	/** Directory containing the config file */
	configDir: string;
	/** Full path to the config file */
	configPath: string;
}

const CONFIG_FILENAME = "rufio-hooks.yaml";

/**
 * Gets the XDG config home directory
 */
function getXdgConfigHome(): string {
	return process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
}

/**
 * Loads a preset from XDG config directory if it exists
 * @returns The checks from the preset file, or null if not found
 */
function loadXdgPreset(name: string): Check[] | null {
	const presetPath = join(
		getXdgConfigHome(),
		"rufio",
		"presets",
		`${name}.yaml`,
	);
	if (!existsSync(presetPath)) {
		return null;
	}

	const content = readFileSync(presetPath, "utf-8");
	const parsed = parse(content) as { checks?: Check[] } | null;
	return parsed?.checks ?? null;
}

/**
 * Resolves preset names to their check definitions.
 * Loads presets from XDG config directory ($XDG_CONFIG_HOME/rufio/presets/{name}.yaml).
 */
function resolvePresets(presetNames: string[], configPath: string): Check[] {
	const checks: Check[] = [];
	for (const name of presetNames) {
		const preset = loadXdgPreset(name);
		if (!preset) {
			const presetPath = join(
				getXdgConfigHome(),
				"rufio",
				"presets",
				`${name}.yaml`,
			);
			throw new Error(
				`Invalid config at ${configPath}: preset '${name}' not found at ${presetPath}`,
			);
		}
		checks.push(...preset);
	}
	return checks;
}

/**
 * Validates a check definition
 */
function validateCheck(check: Check, configPath: string): void {
	if (!check.name) {
		throw new Error(`Invalid config at ${configPath}: check missing 'name'`);
	}
	if (!check.when?.paths_changed) {
		throw new Error(
			`Invalid config at ${configPath}: check '${check.name}' missing 'when.paths_changed'`,
		);
	}
	if (!check.then) {
		throw new Error(
			`Invalid config at ${configPath}: check '${check.name}' missing 'then'`,
		);
	}
	if (!check.then.ensure_commands && !check.then.ensure_changed) {
		throw new Error(
			`Invalid config at ${configPath}: check '${check.name}' must have 'then.ensure_commands' or 'then.ensure_changed'`,
		);
	}
	if (check.then.ensure_commands && check.then.ensure_changed) {
		throw new Error(
			`Invalid config at ${configPath}: check '${check.name}' cannot have both 'then.ensure_commands' and 'then.ensure_changed'`,
		);
	}
}

/**
 * Loads and parses a rufio.yaml config file.
 * Resolves presets and merges them with custom checks.
 * Returns a normalized config where presets have been expanded into checks.
 */
export function loadConfig(configPath: string): RufioConfig {
	const content = readFileSync(configPath, "utf-8");
	const parsed = parse(content) as RufioConfigRaw | null;

	// Resolve presets first
	const presetChecks = parsed?.presets
		? resolvePresets(parsed.presets, configPath)
		: [];
	const userChecks = parsed?.checks ?? [];

	// Merge: presets first, then user checks
	const mergedChecks = [...presetChecks, ...userChecks];

	if (mergedChecks.length === 0) {
		throw new Error(
			`Invalid config at ${configPath}: no checks defined (add 'presets' or 'checks')`,
		);
	}

	// Validate all checks (preset checks are trusted but user checks need validation)
	for (const check of userChecks) {
		validateCheck(check, configPath);
	}

	return { checks: mergedChecks };
}

/**
 * Finds the nearest rufio.yaml config file by walking up from a file path.
 * Stops at the repository root (does not leave the repo).
 *
 * @param filePath - Path to the changed file
 * @param repoRoot - Root of the git repository (absolute path)
 * @returns LoadedConfig if found, null otherwise
 */
export function findNearestConfig(
	filePath: string,
	repoRoot: string,
): LoadedConfig | null {
	const absoluteFilePath = resolve(filePath);
	const absoluteRepoRoot = resolve(repoRoot);

	let currentDir = dirname(absoluteFilePath);

	while (currentDir.startsWith(absoluteRepoRoot)) {
		const configPath = join(currentDir, CONFIG_FILENAME);

		if (existsSync(configPath)) {
			const config = loadConfig(configPath);
			return {
				config,
				configDir: currentDir,
				configPath,
			};
		}

		// Move up one directory
		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) {
			// Reached filesystem root
			break;
		}
		currentDir = parentDir;
	}

	return null;
}

/**
 * Groups changed files by their nearest config.
 * Returns a map of config path -> { config, files }
 */
export function groupFilesByConfig(
	changedFiles: string[],
	repoRoot: string,
): Map<string, { loaded: LoadedConfig; files: string[] }> {
	const groups = new Map<string, { loaded: LoadedConfig; files: string[] }>();

	for (const file of changedFiles) {
		const loaded = findNearestConfig(join(repoRoot, file), repoRoot);
		if (!loaded) {
			continue;
		}

		const existing = groups.get(loaded.configPath);
		if (existing) {
			existing.files.push(file);
		} else {
			groups.set(loaded.configPath, { loaded, files: [file] });
		}
	}

	return groups;
}
