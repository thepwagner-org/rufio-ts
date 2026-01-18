import type { PluginInput } from "@opencode-ai/plugin";

/** Shell function type from plugin input */
export type BunShell = PluginInput["$"];

export type ZellijState = "active" | "stopped" | "asking";

// Braille spinner frames (10-frame cycle)
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const ASKING_CHAR = "⣿"; // Full block - all 8 dots
const DONE_CHAR = "⠶"; // 4-dot square pattern

// Per-session spinner state: sessionID -> frame index
const spinnerState = new Map<string, number>();

function getSpinnerFrame(sessionID: string): string {
	const index = spinnerState.get(sessionID) ?? 0;
	return SPINNER_FRAMES[index];
}

function advanceSpinner(sessionID: string): void {
	const index = spinnerState.get(sessionID) ?? 0;
	spinnerState.set(sessionID, (index + 1) % SPINNER_FRAMES.length);
}

function resetSpinner(sessionID: string): void {
	spinnerState.delete(sessionID);
}

/**
 * Derives a short name from the current working directory.
 *
 * Rules:
 * - `~/.meow/trees/<branch>/...` -> use the branch name
 * - `~/src/.../<project>/...` -> use the project name
 * - Fallback -> last path component
 * - Returns null if name would be "tmp"
 */
export function deriveNameFromCwd(cwd: string): string | null {
	const home = process.env.HOME || "";

	// Check for ~/.meow/trees/<branch>/...
	const meowTreesPrefix = `${home}/.meow/trees/`;
	if (cwd.startsWith(meowTreesPrefix)) {
		const rest = cwd.slice(meowTreesPrefix.length);
		const branch = rest.split("/")[0];
		if (branch && branch !== "tmp") {
			return branch;
		}
		return null;
	}

	// Check for ~/src/.../<project>/...
	const srcPrefix = `${home}/src/`;
	if (cwd.startsWith(srcPrefix)) {
		const rest = cwd.slice(srcPrefix.length);
		const parts = rest.split("/");
		// Get second component (first is category like "projects", "work", etc.)
		if (parts.length >= 2) {
			const project = parts[1];
			if (project === "tmp") {
				return null;
			}
			if (project) {
				return project;
			}
		}
		// Fallback to first component
		if (parts[0] && parts[0] !== "tmp") {
			return parts[0];
		}
		return null;
	}

	// Fallback: last path component
	const lastComponent = cwd.split("/").filter(Boolean).pop();
	if (lastComponent && lastComponent !== "tmp") {
		return lastComponent;
	}

	return null;
}

/**
 * Updates the Zellij tab name with the given state prefix.
 * Does nothing if not running in Zellij or if name would be "tmp".
 *
 * For "active" state, advances the spinner by one frame.
 * For "stopped" state, resets the spinner index.
 */
export async function updateZellijTab(
	$: BunShell,
	state: ZellijState,
	cwd: string,
	sessionID: string,
	log?: (message: string) => Promise<void>,
): Promise<void> {
	const name = deriveNameFromCwd(cwd);
	if (!name) {
		await log?.(`zellij: no name derived from cwd=${cwd}, skipping`);
		return;
	}

	// Determine prefix based on state
	let prefix: string;
	switch (state) {
		case "active":
			prefix = getSpinnerFrame(sessionID);
			advanceSpinner(sessionID);
			break;
		case "asking":
			prefix = ASKING_CHAR;
			break;
		case "stopped":
			prefix = DONE_CHAR;
			resetSpinner(sessionID);
			break;
	}

	// Use match_suffix to find tab by name (works across multiple sessions)
	const payload = JSON.stringify({
		match_suffix: name,
		name: `${prefix} ${name}`,
	});

	await log?.(
		`zellij: updating tab state=${state} match_suffix=${name} name="${prefix} ${name}"`,
	);

	try {
		// Broadcast to all sessions - the plugin will only rename tabs matching the suffix
		await $`zellij pipe --name rename-tab -- ${payload}`.quiet();
	} catch (e) {
		await log?.(`zellij: error: ${e}`);
	}
}
