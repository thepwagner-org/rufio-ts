import type { Message, Part, ToolPart } from "@opencode-ai/sdk";

/**
 * Represents a tool event extracted from the session transcript
 */
export interface ToolEvent {
	toolName: string;
	command?: string;
	filePath?: string;
	index: number;
}

/**
 * Message with its parts from the session transcript
 */
export interface MessageWithParts {
	info: Message;
	parts: Part[];
}

/**
 * Extracts tool events from session messages.
 * Returns events in order of appearance.
 */
export function extractToolEvents(messages: MessageWithParts[]): ToolEvent[] {
	const events: ToolEvent[] = [];
	let index = 0;

	for (const message of messages) {
		for (const part of message.parts) {
			if (part.type === "tool") {
				const toolPart = part as ToolPart;
				const event = extractToolEvent(toolPart, index);
				if (event) {
					events.push(event);
					index++;
				}
			}
		}
	}

	return events;
}

function extractToolEvent(part: ToolPart, index: number): ToolEvent | null {
	// Normalize tool name to lowercase for case-insensitive matching
	const toolName = part.tool.toLowerCase();

	// Only process completed tools
	if (part.state.status !== "completed" && part.state.status !== "running") {
		return null;
	}

	const input = part.state.input;

	// Handle Bash tool
	if (toolName === "bash" || toolName === "mcp_bash") {
		const command = input?.command as string | undefined;
		return {
			toolName: "Bash",
			command,
			index,
		};
	}

	// Handle Edit tool
	if (toolName === "edit" || toolName === "mcp_edit") {
		const filePath = input?.filePath as string | undefined;
		return {
			toolName: "Edit",
			filePath,
			index,
		};
	}

	// Handle Write tool
	if (toolName === "write" || toolName === "mcp_write") {
		const filePath = input?.filePath as string | undefined;
		return {
			toolName: "Write",
			filePath,
			index,
		};
	}

	// Return generic event for other tools (capitalize for consistency with known tools)
	return {
		toolName: toolName.charAt(0).toUpperCase() + toolName.slice(1),
		index,
	};
}

/**
 * Finds the index of the last Edit or Write to a file matching the given predicate.
 * Returns -1 if no matching edit is found.
 */
export function findLastEditIndex(
	events: ToolEvent[],
	fileMatcher: (path: string) => boolean,
): number {
	let lastIndex = -1;

	for (const event of events) {
		if (
			(event.toolName === "Edit" || event.toolName === "Write") &&
			event.filePath &&
			fileMatcher(event.filePath)
		) {
			lastIndex = event.index;
		}
	}

	return lastIndex;
}

/**
 * Checks if a command matching any of the patterns was run after the given index.
 */
export function wasCommandRunAfter(
	events: ToolEvent[],
	patterns: string[],
	afterIndex: number,
): boolean {
	return events.some(
		(event) =>
			event.toolName === "Bash" &&
			event.command &&
			event.index > afterIndex &&
			patterns.some((pattern) => event.command?.includes(pattern)),
	);
}
