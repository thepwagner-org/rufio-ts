#!/usr/bin/env node
// Build script — single source of truth for version is package.json.
// Injects __VERSION__ via esbuild define.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const versionToml = readFileSync("version.toml", "utf8");
const version = versionToml.match(/version\s*=\s*"([^"]+)"/)[1];

execSync("tsc", { stdio: "inherit" });
execSync(
	`esbuild src/index.ts --bundle --platform=node --format=esm --minify` +
		` --external:@opencode-ai/plugin --external:@opencode-ai/sdk` +
		` --define:__VERSION__='"${version}"'` +
		` --outfile=dist/plugin.js`,
	{ stdio: "inherit" },
);
