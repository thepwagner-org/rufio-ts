import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveNameFromCwd } from "../zellij.js";

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
