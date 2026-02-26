declare const __VERSION__: string;

import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import type {
	Event,
	EventSessionDeleted,
	EventSessionIdle,
} from "@opencode-ai/sdk";

import { runChecks } from "./checks/runner.js";
import { extractToolEvents, type MessageWithParts } from "./transcript.js";

/** Flip to `true` and rebuild to also write debug lines to ~/.local/share/meow/rufio.log */
const DEBUG = false;

/**
 * Create a logger that writes to both the opencode SDK and (when DEBUG) a local file.
 *
 * NOTE: client.app.log() currently fails silently when OPENCODE_SERVER_PASSWORD is set
 * because the in-process plugin SDK client doesn't include auth headers.
 * Tracked upstream: https://github.com/anomalyco/opencode/pull/9987
 * The file-based fallback exists for this reason.
 */
function createLogger(client: PluginInput["client"]) {
	return async (message: string) => {
		if (DEBUG) {
			try {
				const dir = join(homedir(), ".local", "share", "meow");
				mkdirSync(dir, { recursive: true });
				const ts = new Date().toISOString();
				appendFileSync(join(dir, "rufio.log"), `${ts} ${message}\n`);
			} catch {
				// best-effort
			}
		}
		await client.app.log({
			body: { service: "rufio", level: "info", message },
		});
	};
}

/**
 * Cache of session ID to directory.
 * Populated when we fetch session info.
 */
const sessionDirectories = new Map<string, string>();

/** Format an error for logging */
function formatError(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
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
			`getSessionDirectory: sessionID=${sessionID} error=${formatError(e)} fallback=${fallback}`,
		);
	}
	return fallback;
}

/**
 * Gets the actual git root for the current working directory.
 * Returns null if not in a git repo.
 */
async function getGitRoot($: PluginInput["$"]): Promise<string | null> {
	try {
		const result = await $`git rev-parse --show-toplevel`.quiet();
		return result.text().trim();
	} catch {
		return null;
	}
}

/**
 * Gets the list of changed files from git status.
 * Paths are relative to the git root.
 */
async function getChangedFiles($: PluginInput["$"]): Promise<string[]> {
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
	$: PluginInput["$"],
	client: PluginInput["client"],
	sessionID: string,
	cwd: string,
	log: (message: string) => Promise<void>,
): Promise<string | null> {
	// Get changed files and git root in parallel
	const [changedFiles, gitRoot] = await Promise.all([
		getChangedFiles($),
		getGitRoot($),
	]);

	// git status paths are relative to the git root, so use that as repoRoot.
	// Fall back to the session directory if we can't determine the git root.
	const repoRoot = gitRoot ?? cwd;

	await log(
		`changedFiles: ${JSON.stringify(changedFiles)} gitRoot: ${gitRoot} cwd: ${cwd} repoRoot: ${repoRoot}`,
	);
	if (changedFiles.length === 0) {
		return null;
	}

	// Get session messages for tool events
	const messagesResult = await client.session.messages({
		path: { id: sessionID },
	});

	if (messagesResult.error || !messagesResult.data) {
		// Can't get transcript, skip checks
		await log(`messages error: ${JSON.stringify(messagesResult.error)}`);
		return null;
	}

	const messages = messagesResult.data as MessageWithParts[];
	const toolEvents = extractToolEvents(messages);

	// Run checks from rufio.yaml configs
	const checkError = runChecks(changedFiles, toolEvents, repoRoot, log);
	await log(`checkError: ${checkError}`);

	return checkError || null;
}

/**
 * Rufio OpenCode Plugin
 *
 * Enforces lint checks before stopping.
 */
export const RufioPlugin: Plugin = async ({ client, $, directory }) => {
	const log = createLogger(client);

	await log(`starting version=${__VERSION__}`);

	return {
		async event({ event }: { event: Event }) {
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

					await log(`session.idle: ${sessionID} dir=${sessionDir}`);

					// Run stop checks
					const error = await runStopChecks(
						$,
						client,
						sessionID,
						sessionDir,
						log,
					);
					if (error) {
						// Inject prompt to tell the assistant what to do
						await client.session.prompt({
							path: { id: sessionID },
							body: {
								parts: [{ type: "text", text: error }],
							},
						});
						return;
					}
					break;
				}

				case "session.deleted": {
					const e = event as EventSessionDeleted;
					const sessionID = e.properties.info.id;
					sessionDirectories.delete(sessionID);
					break;
				}
			}
		},
	};
};

export default RufioPlugin;
