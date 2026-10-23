import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliUsageError } from "../src/errors.js";
import { installSkill, skillPath } from "../src/skill.js";

let home: string;
beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "arex-skill-"));
});
afterEach(async () => {
	await rm(home, { recursive: true, force: true });
});

describe("bundled AREX Agent Skill", () => {
	it("preserves an existing Skill unless replacement is explicitly requested", async () => {
		const installed = await installSkill({ scope: "user", home, cwd: home });
		const path = join(installed.path, "SKILL.md");
		const original = await readFile(path, "utf8");
		expect(original).toContain('arex search "<query>" --limit 5 --json');
		const reference = await readFile(
			join(installed.path, "references", "cli.md"),
			"utf8",
		);
		expect(reference).toContain(
			"- Search: `{results: [{title, url, snippet?, publishedAt?}]}`.",
		);
		expect(reference).toContain(
			"- Contents: `{url, title?, publishedAt?, imageUrl?, imageUrls?, content, truncated}`.",
		);
		await writeFile(path, "User-customized skill");
		await expect(
			installSkill({ scope: "user", home, cwd: home }),
		).rejects.toBeInstanceOf(CliUsageError);
		expect(await readFile(path, "utf8")).toBe("User-customized skill");
		await installSkill({ scope: "user", home, cwd: home, force: true });
		expect(await readFile(path, "utf8")).toBe(original);
	});

	it("does not create files during dry-run", async () => {
		await installSkill({ scope: "project", home, cwd: home, dryRun: true });
		await expect(
			access(skillPath("project", { home, cwd: home })),
		).rejects.toMatchObject({ code: "ENOENT" });
	});
});
