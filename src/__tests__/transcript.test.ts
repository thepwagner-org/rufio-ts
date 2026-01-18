import type { Part, ToolState } from "@opencode-ai/sdk";
import { describe, expect, it } from "vitest";
import {
	extractToolEvents,
	findLastEditIndex,
	type MessageWithParts,
	type ToolEvent,
	wasCommandRunAfter,
} from "../transcript.js";

// Helper to create a minimal tool part
function makeToolPart(
	tool: string,
	input: Record<string, unknown>,
	status: "completed" | "running" | "pending" = "completed",
): Part {
	let state: ToolState;
	if (status === "pending") {
		state = { status: "pending", input, raw: "" };
	} else if (status === "running") {
		state = { status: "running", input, time: { start: Date.now() } };
	} else {
		state = {
			status: "completed",
			input,
			output: "",
			title: "",
			metadata: {},
			time: { start: Date.now(), end: Date.now() },
		};
	}

	return {
		id: "part-1",
		sessionID: "session-1",
		messageID: "msg-1",
		type: "tool",
		callID: "call-1",
		tool,
		state,
	};
}

function makeMessage(parts: Part[]): MessageWithParts {
	return {
		info: {
			id: "msg-1",
			sessionID: "session-1",
			role: "assistant",
			time: { created: Date.now() },
			parentID: "parent-1",
			modelID: "model-1",
			providerID: "provider-1",
			mode: "build",
			path: { cwd: "/test", root: "/test" },
			cost: 0,
			tokens: {
				input: 0,
				output: 0,
				reasoning: 0,
				cache: { read: 0, write: 0 },
			},
		},
		parts,
	};
}

describe("extractToolEvents", () => {
	it("extracts Bash commands", () => {
		const messages = [
			makeMessage([makeToolPart("Bash", { command: "cargo test" })]),
		];

		const events = extractToolEvents(messages);

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			toolName: "Bash",
			command: "cargo test",
			index: 0,
		});
	});

	it("extracts Edit file paths", () => {
		const messages = [
			makeMessage([makeToolPart("Edit", { filePath: "/src/main.rs" })]),
		];

		const events = extractToolEvents(messages);

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			toolName: "Edit",
			filePath: "/src/main.rs",
			index: 0,
		});
	});

	it("extracts Write file paths", () => {
		const messages = [
			makeMessage([makeToolPart("Write", { filePath: "/src/lib.rs" })]),
		];

		const events = extractToolEvents(messages);

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			toolName: "Write",
			filePath: "/src/lib.rs",
			index: 0,
		});
	});

	it("handles mcp_ prefixed tool names", () => {
		const messages = [
			makeMessage([makeToolPart("mcp_bash", { command: "ls" })]),
		];

		const events = extractToolEvents(messages);

		expect(events[0].toolName).toBe("Bash");
	});

	it("ignores pending tools", () => {
		const messages = [
			makeMessage([makeToolPart("Bash", { command: "test" }, "pending")]),
		];

		const events = extractToolEvents(messages);

		expect(events).toHaveLength(0);
	});

	it("assigns sequential indices", () => {
		const messages = [
			makeMessage([
				makeToolPart("Edit", { filePath: "/a.rs" }),
				makeToolPart("Bash", { command: "cargo fmt" }),
				makeToolPart("Edit", { filePath: "/b.rs" }),
			]),
		];

		const events = extractToolEvents(messages);

		expect(events.map((e) => e.index)).toEqual([0, 1, 2]);
	});
});

describe("findLastEditIndex", () => {
	const events: ToolEvent[] = [
		{ toolName: "Edit", filePath: "/src/main.rs", index: 0 },
		{ toolName: "Bash", command: "cargo test", index: 1 },
		{ toolName: "Write", filePath: "/src/lib.rs", index: 2 },
		{ toolName: "Edit", filePath: "/src/utils.rs", index: 3 },
	];

	it("finds last edit matching predicate", () => {
		const index = findLastEditIndex(events, (p) => p.endsWith(".rs"));
		expect(index).toBe(3);
	});

	it("returns -1 when no match", () => {
		const index = findLastEditIndex(events, (p) => p.endsWith(".md"));
		expect(index).toBe(-1);
	});

	it("ignores Bash events", () => {
		const index = findLastEditIndex(events, () => true);
		expect(index).toBe(3); // Last Edit/Write, not Bash
	});
});

describe("wasCommandRunAfter", () => {
	const events: ToolEvent[] = [
		{ toolName: "Edit", filePath: "/src/main.rs", index: 0 },
		{ toolName: "Bash", command: "cargo fmt", index: 1 },
		{ toolName: "Edit", filePath: "/src/lib.rs", index: 2 },
		{ toolName: "Bash", command: "cargo test --all", index: 3 },
	];

	it("returns true when command ran after index", () => {
		expect(wasCommandRunAfter(events, ["cargo test"], 2)).toBe(true);
	});

	it("returns false when command ran before index", () => {
		expect(wasCommandRunAfter(events, ["cargo fmt"], 2)).toBe(false);
	});

	it("returns false when command not found", () => {
		expect(wasCommandRunAfter(events, ["cargo clippy"], 0)).toBe(false);
	});

	it("matches any pattern in list", () => {
		expect(wasCommandRunAfter(events, ["cargo t ", "cargo test"], 2)).toBe(
			true,
		);
	});
});
