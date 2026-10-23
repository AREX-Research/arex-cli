import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CliUsageError } from "./errors.js";
import { cliReference, skillMarkdown } from "./generated-skill.js";

export type SkillScope = "user" | "project";

export interface SkillInstallResult {
	path: string;
	scope: SkillScope;
	installed: boolean;
	dryRun: boolean;
}

export function skillPath(
	scope: SkillScope,
	roots: { home: string; cwd: string },
): string {
	return join(
		scope === "user" ? roots.home : roots.cwd,
		".agents",
		"skills",
		"arex",
	);
}

/**
 * Installs the bundled Skill. The files are staged next to the destination and
 * moved into place, so a failed install never leaves a partial Skill behind.
 */
export async function installSkill(options: {
	scope: SkillScope;
	force?: boolean;
	dryRun?: boolean;
	home: string;
	cwd: string;
}): Promise<SkillInstallResult> {
	const target = skillPath(options.scope, options);
	const exists = await lstat(target).then(
		() => true,
		() => false,
	);
	if (exists && !options.force)
		throw new CliUsageError(
			`Skill already exists at ${target}; pass --force to replace it`,
		);
	const result = {
		path: target,
		scope: options.scope,
		installed: !options.dryRun,
		dryRun: options.dryRun === true,
	};
	if (options.dryRun) return result;

	await mkdir(dirname(target), { recursive: true });
	const staging = await mkdtemp(join(dirname(target), ".arex-skill-"));
	try {
		await mkdir(join(staging, "references"));
		await writeFile(join(staging, "SKILL.md"), skillMarkdown, "utf8");
		await writeFile(
			join(staging, "references", "cli.md"),
			cliReference,
			"utf8",
		);
		if (exists) await rm(target, { recursive: true, force: true });
		await rename(staging, target);
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
	return result;
}
