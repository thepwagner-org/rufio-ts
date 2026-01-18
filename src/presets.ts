import type { Check, Then, When } from "./config.js";

/** Helper to construct Check objects without triggering biome's noThenProperty rule */
function check(name: string, when: When, then: Then): Check {
	return { name, when, then };
}

/**
 * Built-in presets that can be referenced in rufio-hooks.yaml via `presets: ["name"]`
 */
export const PRESETS: Record<string, Check[]> = {
	cargo: [
		check(
			"cargo-checks",
			{ paths_changed: "**/*.rs" },
			{ ensure_commands: ["cargo test", "cargo fmt", "cargo clippy"] },
		),
		check(
			"cargo-version-bump",
			{ paths_changed: "**/*.rs", path_exists: "package.nix" },
			{ ensure_changed: ["version.toml"] },
		),
	],
	meow: [
		check(
			"meow-fmt",
			{ paths_changed: "**/*.md" },
			{ ensure_commands: ["meow fmt"] },
		),
	],
	pnpm: [
		check(
			"pnpm-checks",
			{ paths_changed: "**/*.ts" },
			{ ensure_commands: ["pnpm lint", "pnpm typecheck", "pnpm test"] },
		),
		check(
			"pnpm-version-bump",
			{ paths_changed: "**/*.ts", path_exists: "package.nix" },
			{ ensure_changed: ["version.toml"] },
		),
	],
	ledger: [
		check(
			"ledger-checks",
			{ paths_changed: "**/*.ledger" },
			{ ensure_commands: ["hledger check", "folio validate"] },
		),
	],
	terraform: [
		check(
			"terraform-checks",
			{ paths_changed: "**/*.tf" },
			{ ensure_commands: ["tofu fmt", "tflint", "trivy config ."] },
		),
	],
};
