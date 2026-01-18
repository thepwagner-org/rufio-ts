import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	_getSpinnerStateSize,
	_setSpinnerState,
	cleanupSession,
	deriveNameFromCwd,
} from "../zellij.js";

describe("deriveNameFromCwd", () => {
	const originalHome = process.env.HOME;

	beforeEach(() => {
		process.env.HOME = "/Users/test";
	});

	afterEach(() => {
		process.env.HOME = originalHome;
	});

	describe("meow trees paths", () => {
		it("extracts branch name from ~/.meow/trees/<branch>/...", () => {
			expect(
				deriveNameFromCwd("/Users/test/.meow/trees/feature-branch/some/path"),
			).toBe("feature-branch");
		});

		it("extracts branch name from ~/.meow/trees/<branch>", () => {
			expect(deriveNameFromCwd("/Users/test/.meow/trees/main")).toBe("main");
		});

		it("returns null for tmp branch", () => {
			expect(deriveNameFromCwd("/Users/test/.meow/trees/tmp/something")).toBe(
				null,
			);
		});
	});

	describe("src paths", () => {
		it("extracts project name from ~/src/<category>/<project>/...", () => {
			expect(deriveNameFromCwd("/Users/test/src/projects/rufio-ts/src")).toBe(
				"rufio-ts",
			);
		});

		it("extracts project name from ~/src/<category>/<project>", () => {
			expect(deriveNameFromCwd("/Users/test/src/work/my-app")).toBe("my-app");
		});

		it("falls back to category if only one component", () => {
			expect(deriveNameFromCwd("/Users/test/src/projects")).toBe("projects");
		});

		it("returns null for tmp project", () => {
			expect(deriveNameFromCwd("/Users/test/src/projects/tmp")).toBe(null);
		});
	});

	describe("fallback paths", () => {
		it("uses last path component", () => {
			expect(deriveNameFromCwd("/some/random/path/my-project")).toBe(
				"my-project",
			);
		});

		it("returns null for tmp", () => {
			expect(deriveNameFromCwd("/some/path/tmp")).toBe(null);
		});

		it("handles root path", () => {
			expect(deriveNameFromCwd("/")).toBe(null);
		});
	});
});

describe("cleanupSession", () => {
	afterEach(() => {
		// Clean up any state left by tests
		cleanupSession("test-session-1");
		cleanupSession("test-session-2");
	});

	it("removes spinner state for the given session", () => {
		// Set up some state
		_setSpinnerState("test-session-1", 5);
		_setSpinnerState("test-session-2", 3);
		expect(_getSpinnerStateSize()).toBe(2);

		// Clean up one session
		cleanupSession("test-session-1");
		expect(_getSpinnerStateSize()).toBe(1);

		// Clean up the other
		cleanupSession("test-session-2");
		expect(_getSpinnerStateSize()).toBe(0);
	});

	it("is idempotent - cleaning up non-existent session is safe", () => {
		expect(_getSpinnerStateSize()).toBe(0);
		cleanupSession("non-existent-session");
		expect(_getSpinnerStateSize()).toBe(0);
	});

	it("only removes the specified session, leaving others intact", () => {
		_setSpinnerState("session-a", 1);
		_setSpinnerState("session-b", 2);
		_setSpinnerState("session-c", 3);
		expect(_getSpinnerStateSize()).toBe(3);

		cleanupSession("session-b");
		expect(_getSpinnerStateSize()).toBe(2);

		// Clean up remaining for afterEach
		cleanupSession("session-a");
		cleanupSession("session-c");
	});
});
