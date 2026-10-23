// Embeds skills/arex in the build so npm and standalone binaries install the
// same validated Skill without reading files from disk at runtime.
import { readFile, writeFile } from "node:fs/promises";

const skill = await readFile("skills/arex/SKILL.md", "utf8");
const reference = await readFile("skills/arex/references/cli.md", "utf8");
await writeFile(
	"src/generated-skill.ts",
	[
		"// Generated from skills/arex by scripts/generate-skill-module.ts. Do not edit.",
		`export const skillMarkdown = ${JSON.stringify(skill)};`,
		`export const cliReference = ${JSON.stringify(reference)};`,
		"",
	].join("\n"),
	"utf8",
);
