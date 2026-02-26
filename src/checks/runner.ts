import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { minimatch } from "minimatch";
import type { Check, LoadedConfig } from "../config.js";
import { groupFilesByConfig } from "../config.js";
import type { ToolEvent } from "../transcript.js";
import { findLastEditIndex, wasCommandRunAfter } from "../transcript.js";

/**
 * Result of running checks
 */
interface CheckResult {
	/** Error message if check failed, null if passed */
	error: string | null;
	/** Name of the check that failed (if any) */
	checkName?: string;
}

/**
 * Runs all checks from rufio.yaml configs for the given changed files.
 *
 * @param changedFiles - List of changed files (relative to repo root)
 * @param toolEvents - Tool events from the session transcript
 * @param repoRoot - Absolute path to the repository root
 * @returns First error encountered, or null if all checks pass
 */
export function runChecks(
	changedFiles: string[],
	toolEvents: ToolEvent[],
	repoRoot: string,
	debug?: (msg: string) => void,
): string | null {
	// Group files by their nearest config
	const groups = groupFilesByConfig(changedFiles, repoRoot);

	debug?.(
		`runChecks: ${groups.size} config group(s), ${toolEvents.length} toolEvents`,
	);
	for (const [configPath, { files }] of groups.entries()) {
		debug?.(`  config=${configPath} files=${JSON.stringify(files)}`);
	}

	// Process each config
	for (const { loaded, files } of groups.values()) {
		const result = runConfigChecks(loaded, files, toolEvents, repoRoot, debug);
		if (result.error) {
			return result.error;
		}
	}

	return null;
}

/**
 * Runs all checks from a single config against its relevant files.
 */
function runConfigChecks(
	loaded: LoadedConfig,
	changedFiles: string[],
	toolEvents: ToolEvent[],
	repoRoot: string,
	debug?: (msg: string) => void,
): CheckResult {
	for (const check of loaded.config.checks) {
		const result = runSingleCheck(
			check,
			loaded,
			changedFiles,
			toolEvents,
			repoRoot,
			debug,
		);
		if (result.error) {
			return result;
		}
	}

	return { error: null };
}

/**
 * Runs a single check against the changed files.
 */
function runSingleCheck(
	check: Check,
	loaded: LoadedConfig,
	changedFiles: string[],
	toolEvents: ToolEvent[],
	repoRoot: string,
	debug?: (msg: string) => void,
): CheckResult {
	const { configDir } = loaded;

	// Check path_exists condition first
	if (check.when.path_exists) {
		const requiredPath = join(configDir, check.when.path_exists);
		if (!existsSync(requiredPath)) {
			// Condition not met, skip this check
			return { error: null };
		}
	}

	// Find files that match the glob (relative to config dir)
	const matchingFiles = changedFiles.filter((file) => {
		// Convert to path relative to config dir
		const absoluteFile = join(repoRoot, file);
		const relativeToConfig = relative(configDir, absoluteFile);

		// Skip files outside the config directory
		if (relativeToConfig.startsWith("..")) {
			return false;
		}

		return minimatch(relativeToConfig, check.when.paths_changed);
	});

	debug?.(
		`  check=${check.name} matchingFiles=${JSON.stringify(matchingFiles)}`,
	);

	if (matchingFiles.length === 0) {
		// No matching files, check doesn't apply
		return { error: null };
	}

	// For ensure_changed: purely git-status-based. If dirty files match the glob,
	// the ensure_changed files must also be dirty. No transcript needed.
	if (check.then.ensure_changed) {
		return checkEnsureChanged(check, changedFiles, repoRoot, configDir, debug);
	}

	// For ensure_commands: transcript-based. Commands must run after the last edit.
	// Create a matcher for the glob pattern
	const globMatcher = (path: string): boolean => {
		// Path from tool events might be absolute
		const relativeToConfig = relative(configDir, path);
		if (relativeToConfig.startsWith("..")) {
			return false;
		}
		return minimatch(relativeToConfig, check.when.paths_changed);
	};

	// Find the last edit to a matching file
	const lastEditIndex = findLastEditIndex(toolEvents, globMatcher);

	debug?.(
		`  check=${check.name} lastEditIndex=${lastEditIndex} toolEventPaths=${JSON.stringify(toolEvents.filter((e) => e.toolName === "Edit" || e.toolName === "Write").map((e) => e.filePath))}`,
	);

	// If no matching file was edited in this session, skip the check
	if (lastEditIndex === -1) {
		return { error: null };
	}

	if (check.then.ensure_commands) {
		return checkCommands(check, toolEvents, lastEditIndex);
	}

	return { error: null };
}

/**
 * Checks that all required commands were run after the last edit.
 */
function checkCommands(
	check: Check,
	toolEvents: ToolEvent[],
	lastEditIndex: number,
): CheckResult {
	const commands = check.then.ensure_commands ?? [];
	const missingCommands: string[] = [];

	for (const command of commands) {
		// Check if command was run after last edit (substring match)
		if (!wasCommandRunAfter(toolEvents, [command], lastEditIndex)) {
			missingCommands.push(command);
		}
	}

	if (missingCommands.length > 0) {
		const error = `Check '${check.name}' failed: these commands must run after editing ${check.when.paths_changed}: ${missingCommands.join(", ")}`;
		return { error, checkName: check.name };
	}

	return { error: null };
}

/**
 * Checks that at least one of the specified paths appears in git status (is dirty).
 * This is commit-aware: if the file was edited earlier in the session but then committed,
 * it won't appear in changedFiles and the check will fail again.
 */
function checkEnsureChanged(
	check: Check,
	changedFiles: string[],
	repoRoot: string,
	configDir: string,
	debug?: (msg: string) => void,
): CheckResult {
	const paths = check.then.ensure_changed ?? [];

	// Build set of absolute paths for all dirty files from git status
	const dirtyAbsolute = new Set(
		changedFiles.map((f) => resolve(join(repoRoot, f))),
	);

	for (const requiredPath of paths) {
		const absoluteRequired = resolve(configDir, requiredPath);
		if (dirtyAbsolute.has(absoluteRequired)) {
			debug?.(
				`  check=${check.name} ensure_changed: ${requiredPath} is dirty in git status`,
			);
			return { error: null };
		}
	}

	debug?.(
		`  check=${check.name} ensure_changed: none of [${paths.join(", ")}] found in changedFiles`,
	);

	const error = `Check '${check.name}' failed: one of these files must be changed when editing ${check.when.paths_changed}: ${paths.join(", ")}`;
	return { error, checkName: check.name };
}
