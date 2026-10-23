// Smoke-tests a built release artifact offline: the npm tarball, installed the
// way a user installs it, or one standalone executable. Release CI runs it on
// each native platform before anything is published.
//
// Usage:
//   node scripts/check-release.mjs --package <file.tgz> --expected-version <v> [--sums <SHA256SUMS>]
//   node scripts/check-release.mjs --binary <file> --expected-version <v> [--sums <SHA256SUMS>]
//
// No API key or network access to AREX is used: every check stops before a request.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values: options } = parseArgs({
	options: {
		package: { type: "string" },
		binary: { type: "string" },
		"expected-version": { type: "string" },
		sums: { type: "string" },
	},
});
const expectedVersion = options["expected-version"];
const artifact = options.package ?? options.binary;
if (!artifact || !expectedVersion || (options.package && options.binary)) {
	console.error(
		"Usage: check-release.mjs (--package <tgz> | --binary <file>) --expected-version <v> [--sums <SHA256SUMS>]",
	);
	process.exit(2);
}

const windows = process.platform === "win32";
const root = mkdtempSync(join(tmpdir(), "arex-release-check-"));
const home = join(root, "home");
const project = join(root, "project");
mkdirSync(home);
mkdirSync(project);
const failures = [];

function check(name, passed, detail) {
	console.log(`${passed ? "ok  " : "FAIL"}  ${name}`);
	if (!passed) failures.push(`${name}: ${detail}`);
}

if (options.sums) {
	const sums = readFileSync(options.sums, "utf8");
	const name = basename(artifact);
	const expected = sums
		.split("\n")
		.map((line) => line.split(/\s+\*?/))
		.find(([, file]) => file === name)?.[0];
	const actual = createHash("sha256")
		.update(readFileSync(artifact))
		.digest("hex");
	check(
		"checksum matches SHA256SUMS",
		actual === expected,
		`${actual} != ${expected}`,
	);
}

let command = resolve(artifact);
if (options.package) {
	const install = join(root, "install");
	const result = spawnSync(
		"npm",
		["install", "--prefix", install, "--no-audit", "--no-fund", command],
		{ encoding: "utf8", shell: windows },
	);
	check("npm installs the tarball", result.status === 0, result.stderr);
	command = join(
		install,
		"node_modules",
		".bin",
		windows ? "arex.cmd" : "arex",
	);
} else if (!windows) {
	chmodSync(command, 0o755);
}

// A clean user: no AREX settings from the runner, configuration under a fresh home.
const environment = { ...process.env, HOME: home, USERPROFILE: home };
for (const key of Object.keys(environment))
	if (key.startsWith("AREX_") || key === "XDG_CONFIG_HOME")
		delete environment[key];

function arex(args, extra = {}) {
	return spawnSync(command, args, {
		cwd: project,
		env: { ...environment, ...extra },
		encoding: "utf8",
		shell: windows && command.endsWith(".cmd"),
	});
}

const version = arex(["--version"]);
check(
	"--version",
	version.stdout.trim() === expectedVersion,
	version.stdout + version.stderr,
);

const help = arex(["--help"]);
check(
	"--help",
	help.status === 0 && help.stdout.includes("arex setup"),
	help.stderr,
);

const unconfigured = arex(["doctor", "--json"]);
const report = JSON.parse(unconfigured.stdout || "{}");
check(
	"doctor reports missing credentials without a request",
	unconfigured.status === 1 &&
		report.checks?.some((c) => c.name === "credentials" && c.status === "fail"),
	unconfigured.stdout + unconfigured.stderr,
);

const search = arex(["search", "query", "--json"]);
check(
	"a charged command without a key is a usage error",
	search.status === 2 &&
		JSON.parse(search.stderr || "{}").error?.kind === "usage",
	search.stderr,
);

const typo = arex(["run", "stats", "x"]);
check(
	"subcommand typos are suggested",
	typo.status === 2 && typo.stderr.includes("status"),
	typo.stderr,
);

// A saved key exercises the configuration permission check (ACLs through
// PowerShell on Windows). The mismatched endpoint keeps doctor offline.
const configuration = join(home, ".config", "arex", "config.json");
mkdirSync(dirname(configuration), { recursive: true });
writeFileSync(
	configuration,
	JSON.stringify({ apiKey: `sk_arex_${"a".repeat(32)}` }),
);
const saved = arex(["doctor", "--json"], {
	AREX_BASE_URL: "http://127.0.0.1:9",
});
const savedReport = JSON.parse(saved.stdout || "{}");
check(
	"doctor inspects saved configuration and refuses to send its key elsewhere",
	saved.status === 1 &&
		savedReport.checks?.some((c) => c.name === "permissions") &&
		savedReport.checks?.some(
			(c) => c.name === "credentials" && c.status === "fail",
		),
	saved.stdout + saved.stderr,
);

const skill = arex(["skill", "install", "--scope", "project"]);
const skillFile = join(project, ".agents", "skills", "arex", "SKILL.md");
let skillText = "";
try {
	skillText = readFileSync(skillFile, "utf8");
} catch {}
check(
	"skill install writes the bundled Skill",
	skill.status === 0 && skillText.startsWith("---\nname: arex"),
	skill.stderr,
);

if (failures.length) {
	console.error(
		`\n${failures.length} check(s) failed:\n${failures.join("\n")}`,
	);
	process.exit(1);
}
console.log(
	`\nAll checks passed for ${basename(artifact)} ${expectedVersion}.`,
);
