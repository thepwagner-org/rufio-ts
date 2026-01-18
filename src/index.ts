import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import type {
	Event,
	EventMessagePartUpdated,
	EventPermissionReplied,
	EventPermissionUpdated,
	EventSessionDeleted,
	EventSessionIdle,
	EventSessionStatus,
} from "@opencode-ai/sdk";

import { runChecks } from "./checks/runner.js";
import { extractToolEvents, type MessageWithParts } from "./transcript.js";
import {
	type BunShell,
	cleanupSession,
	updateZellijTab,
	type ZellijState,
} from "./zellij.js";

/**
 * State management for tracking "asking" state across events.
 * Maps session ID to whether permission is being requested.
 */
const askingState = new Map<string, boolean>();

/**
 * Cache of session ID to directory.
 * Populated when we fetch session info.
 */
const sessionDirectories = new Map<string, string>();

/**
 * Throttle state for spinner updates.
 * Maps session ID to the last time the spinner was updated (ms timestamp).
 */
const lastSpinnerUpdate = new Map<string, number>();

/** Minimum interval between spinner updates in milliseconds */
const SPINNER_THROTTLE_MS = 100;

/** Checks if a tool name represents a question/prompt tool */
function isQuestionTool(tool: string): boolean {
	return (
		tool === "question" || tool === "mcp_question" || tool.endsWith("_question")
	);
}

/** Gets the directory for a session, fetching and caching if needed */
async function getSessionDirectory(
	client: PluginInput["client"],
	sessionID: string,
	fallback: string,
	log?: (message: string) => Promise<void>,
): Promise<string> {
	const cached = sessionDirectories.get(sessionID);
	if (cached) {
		await log?.(`getSessionDirectory: sessionID=${sessionID} cached=${cached}`);
		return cached;
	}

	try {
		const session = await client.session.get({ path: { id: sessionID } });
		await log?.(
			`getSessionDirectory: sessionID=${sessionID} fetched=${session.data?.directory} fallback=${fallback}`,
		);
		if (session.data?.directory) {
			sessionDirectories.set(sessionID, session.data.directory);
			return session.data.directory;
		}
	} catch (e) {
		await log?.(
			`getSessionDirectory: sessionID=${sessionID} error=${e instanceof Error ? e.message : String(e)} fallback=${fallback}`,
		);
	}
	return fallback;
}

/**
 * Gets the list of changed files from git status.
 */
async function getChangedFiles($: BunShell): Promise<string[]> {
	try {
		const result = await $`git status --porcelain -uall`.quiet();
		const output = result.text();
		return output
			.split("\n")
			.filter((line: string) => line.trim())
			.map((line: string) => line.slice(3).trim()); // Remove status prefix (e.g., " M ", "?? ")
	} catch {
		return [];
	}
}

/**
 * Runs all stop checks and returns the first error message, or null if all pass.
 */
async function runStopChecks(
	$: BunShell,
	client: PluginInput["client"],
	sessionID: string,
	cwd: string,
): Promise<string | null> {
	// Get changed files
	const changedFiles = await getChangedFiles($);
	await client.app.log({
		body: {
			service: "rufio",
			level: "info",
			message: `changedFiles: ${JSON.stringify(changedFiles)}`,
		},
	});
	if (changedFiles.length === 0) {
		return null;
	}

	// Get session messages for tool events
	const messagesResult = await client.session.messages({
		path: { id: sessionID },
	});

	if (messagesResult.error || !messagesResult.data) {
		// Can't get transcript, skip checks
		await client.app.log({
			body: {
				service: "rufio",
				level: "info",
				message: `messages error: ${JSON.stringify(messagesResult.error)}`,
			},
		});
		return null;
	}

	const messages = messagesResult.data as MessageWithParts[];
	const toolEvents = extractToolEvents(messages);

	// Run checks from rufio.yaml configs
	const checkError = runChecks(changedFiles, toolEvents, cwd);
	await client.app.log({
		body: {
			service: "rufio",
			level: "info",
			message: `checkError: ${checkError}`,
		},
	});
	if (checkError) {
		return checkError;
	}

	return null;
}

/**
 * Rufio OpenCode Plugin
 *
 * Enforces lint checks before stopping and updates Zellij tab status.
 */
export const RufioPlugin: Plugin = async ({ client, $, directory }) => {
	// Shared logging helper
	const log = async (message: string) => {
		await client.app.log({
			body: { service: "rufio", level: "info", message },
		});
	};

	return {
		async event({ event }: { event: Event }) {
			// Log all events for debugging
			await log(`event: ${event.type}`);

			switch (event.type) {
				case "session.idle": {
					const e = event as EventSessionIdle;
					const sessionID = e.properties.sessionID;

					// Get the session's directory (may differ from plugin's directory)
					const sessionDir = await getSessionDirectory(
						client,
						sessionID,
						directory,
						log,
					);

					// Debug log
					await log(`session.idle: ${sessionID} dir=${sessionDir}`);

					// Clear asking state
					askingState.delete(sessionID);

					// Run stop checks
					const error = await runStopChecks($, client, sessionID, sessionDir);
					if (error) {
						// Update Zellij to active (still working)
						await updateZellijTab($, "active", sessionDir, sessionID, log);
						// Inject prompt to tell the assistant what to do
						await client.session.prompt({
							path: { id: sessionID },
							body: {
								parts: [{ type: "text", text: error }],
							},
						});
						// Don't throw - the injected prompt will continue the session
						return;
					}

					// Update Zellij to stopped
					await updateZellijTab($, "stopped", sessionDir, sessionID, log);
					break;
				}

				case "session.status": {
					const e = event as EventSessionStatus;
					const status = e.properties.status;
					const sessionID = e.properties.sessionID;

					// Get the session's directory
					const sessionDir = await getSessionDirectory(
						client,
						sessionID,
						directory,
						log,
					);

					let state: ZellijState;
					switch (status.type) {
						case "busy":
							// Clear asking state when session becomes busy (user responded)
							if (askingState.get(sessionID)) {
								await log("session.status: busy - clearing asking state");
								askingState.delete(sessionID);
							}
							state = "active";
							break;
						case "idle":
							state = "stopped";
							break;
						case "retry":
							state = "active";
							break;
						default:
							return;
					}

					await updateZellijTab($, state, sessionDir, sessionID, log);
					break;
				}

				case "permission.updated": {
					const e = event as EventPermissionUpdated;
					const sessionID = e.properties.sessionID;

					const sessionDir = await getSessionDirectory(
						client,
						sessionID,
						directory,
						log,
					);

					await log(
						`permission.updated: sessionID=${sessionID} type=${e.properties.type}`,
					);

					// Set asking state and update Zellij
					askingState.set(sessionID, true);
					await updateZellijTab($, "asking", sessionDir, sessionID, log);
					break;
				}

				case "permission.replied": {
					const e = event as EventPermissionReplied;
					const sessionID = e.properties.sessionID;

					const sessionDir = await getSessionDirectory(
						client,
						sessionID,
						directory,
						log,
					);

					// User responded to permission request - clear asking state immediately
					if (askingState.get(sessionID)) {
						await log("permission.replied: clearing asking state");
						askingState.delete(sessionID);
						await updateZellijTab($, "active", sessionDir, sessionID, log);
					}
					break;
				}

				case "message.part.updated": {
					const e = event as EventMessagePartUpdated;
					const sessionID = e.properties.part.sessionID;

					// Skip if we're in asking state (waiting for user input)
					if (askingState.get(sessionID)) {
						break;
					}

					// Throttle spinner updates to avoid excessive zellij calls
					const now = Date.now();
					const lastUpdate = lastSpinnerUpdate.get(sessionID) ?? 0;
					if (now - lastUpdate < SPINNER_THROTTLE_MS) {
						break;
					}
					lastSpinnerUpdate.set(sessionID, now);

					// Get session directory and tick the spinner
					const sessionDir = await getSessionDirectory(
						client,
						sessionID,
						directory,
						log,
					);
					await updateZellijTab($, "active", sessionDir, sessionID, log);
					break;
				}

				case "session.deleted": {
					const e = event as EventSessionDeleted;
					const sessionID = e.properties.info.id;

					// Clean up all session state
					askingState.delete(sessionID);
					sessionDirectories.delete(sessionID);
					lastSpinnerUpdate.delete(sessionID);
					cleanupSession(sessionID);
					break;
				}
			}
		},

		async "tool.execute.before"({ sessionID, tool }) {
			const sessionDir = await getSessionDirectory(
				client,
				sessionID,
				directory,
				log,
			);

			if (isQuestionTool(tool)) {
				// Set asking state and update Zellij to question mark
				await log(`tool.execute.before: question tool detected: ${tool}`);
				askingState.set(sessionID, true);
				await updateZellijTab($, "asking", sessionDir, sessionID, log);
			} else {
				// Clear asking state if set, and tick the spinner
				if (askingState.get(sessionID)) {
					askingState.delete(sessionID);
				}
				await updateZellijTab($, "active", sessionDir, sessionID, log);
			}
		},

		async "tool.execute.after"({ sessionID, tool }) {
			const sessionDir = await getSessionDirectory(
				client,
				sessionID,
				directory,
				log,
			);

			if (isQuestionTool(tool)) {
				// Question tools set asking state, which persists until user responds
				// Keep asking state - it was set in before hook
				await log(`tool.execute.after: question tool completed: ${tool}`);
			} else {
				// Tick the spinner for non-question tools
				await updateZellijTab($, "active", sessionDir, sessionID, log);
			}
		},
	};
};

export default RufioPlugin;
