import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { platform } from "node:os";

const mode = process.argv[2] ?? "current";
if (mode !== "current" && mode !== "all") {
	console.error("Usage: bun scripts/build-binaries.ts current|all");
	process.exit(2);
}

await mkdir("artifacts", { recursive: true });

const targets = [
	["bun-darwin-arm64", "arex-darwin-arm64"],
	["bun-darwin-x64", "arex-darwin-x64"],
	["bun-linux-arm64", "arex-linux-arm64"],
	["bun-linux-x64", "arex-linux-x64"],
	["bun-windows-x64", "arex-windows-x64.exe"],
] as const;

if (mode === "current") {
	await compile("artifacts/arex");
} else {
	for (const [target, output] of targets) {
		await compile(`artifacts/${output}`, target);
	}
}

async function compile(output: string, target?: string): Promise<void> {
	const arguments_ = [
		"build",
		"src/index.ts",
		"--compile",
		"--no-compile-autoload-dotenv",
		`--outfile=${output}`,
	];
	if (target) arguments_.push(`--target=${target}`);
	console.error(
		`Building ${output}${target ? ` (${target})` : ` (${platform()})`}`,
	);
	const code = await new Promise<number>((resolve, reject) => {
		const child = spawn("bun", arguments_, { stdio: "inherit" });
		child.once("error", reject);
		child.once("exit", (exitCode) => resolve(exitCode ?? 1));
	});
	if (code !== 0) process.exit(code);
}
