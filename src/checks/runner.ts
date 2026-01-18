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
): string | null {
	// Group files by their nearest config
	const groups = groupFilesByConfig(changedFiles, repoRoot);

	// Process each config
	for (const { loaded, files } of groups.values()) {
		const result = runConfigChecks(loaded, files, toolEvents, repoRoot);
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
): CheckResult {
	for (const check of loaded.config.checks) {
		const result = runSingleCheck(
			check,
			loaded,
			changedFiles,
			toolEvents,
			repoRoot,
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

	if (matchingFiles.length === 0) {
		// No matching files, check doesn't apply
		return { error: null };
	}

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

	// If no matching file was edited in this session, skip the check
	if (lastEditIndex === -1) {
		return { error: null };
	}

	// Run the appropriate check based on 'then' type
	if (check.then.ensure_commands) {
		return checkCommands(check, toolEvents, lastEditIndex);
	}

	if (check.then.ensure_changed) {
		return checkEnsureChanged(check, toolEvents, configDir);
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
 * Checks that at least one of the specified paths was edited this session.
 */
function checkEnsureChanged(
	check: Check,
	toolEvents: ToolEvent[],
	configDir: string,
): CheckResult {
	const paths = check.then.ensure_changed ?? [];

	// Check if any of the required paths were edited
	const editedPaths = toolEvents
		.filter((e) => e.toolName === "Edit" || e.toolName === "Write")
		.map((e) => e.filePath)
		.filter(Boolean) as string[];

	for (const requiredPath of paths) {
		const absoluteRequired = resolve(configDir, requiredPath);

		for (const editedPath of editedPaths) {
			// Normalize paths for comparison
			const normalizedEdited = resolve(editedPath);
			if (normalizedEdited === absoluteRequired) {
				return { error: null };
			}
		}
	}

	const error = `Check '${check.name}' failed: one of these files must be changed when editing ${check.when.paths_changed}: ${paths.join(", ")}`;
	return { error, checkName: check.name };
}
