import { stripVTControlCharacters } from "node:util";
import type {
	ContentsDocument,
	ResearchRun,
	SearchResponse,
} from "@arex-research/ts-sdk";
import type { CliIO } from "./context.js";
import type { DoctorReport } from "./doctor.js";
import type { SetupResult } from "./setup.js";
import type { SkillInstallResult, SkillScope } from "./skill.js";

export type CliResult =
	| { kind: "search"; value: SearchResponse }
	| { kind: "contents"; value: ContentsDocument }
	| { kind: "research"; value: ResearchRun }
	| { kind: "delete"; id: string; value: ResearchRun | undefined }
	| { kind: "setup"; value: SetupResult }
	| { kind: "doctor"; value: DoctorReport }
	| { kind: "skill"; value: SkillInstallResult }
	| { kind: "skill-path"; value: { path: string; scope: SkillScope } };

/**
 * Keeps line breaks and tabs, but removes terminal escapes, other control
 * characters and bidirectional overrides that could disguise text. Other
 * format characters (joiners in emoji and Indic or Persian script) stay.
 */
export function terminalText(value: string): string {
	return stripVTControlCharacters(value).replace(
		/[\p{Cc}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu,
		(character) => (character === "\n" || character === "\t" ? character : ""),
	);
}

function researchLines(run: ResearchRun): string[] {
	const lines: string[] = [];
	if (run.status === "completed") {
		lines.push(run.result.answer);
		if (run.result.sources.length) {
			lines.push("", "Sources:");
			for (const [index, source] of run.result.sources.entries()) {
				lines.push(`${index + 1}. ${source.title}`, `   ${source.url}`);
			}
		}
		lines.push("");
	}
	lines.push(`Run: ${run.id}`, `Status: ${run.status}`, `Mode: ${run.mode}`);
	if (run.requestedMode !== run.mode)
		lines.push(`Requested mode: ${run.requestedMode}`);
	lines.push(`Created: ${run.createdAt}`);
	if (run.startedAt) lines.push(`Started: ${run.startedAt}`);
	if (run.completedAt) lines.push(`Completed: ${run.completedAt}`);
	if (run.status === "failed") {
		lines.push(
			`Failure: ${run.error.code}`,
			`Retryable: ${run.error.retryable ? "yes" : "no"}`,
		);
	}
	if (
		run.status !== "completed" &&
		run.status !== "failed" &&
		run.status !== "cancelled"
	) {
		lines.push(`Next: arex run wait ${run.id}`);
	}
	return lines;
}

export function writeResult(io: CliIO, result: CliResult, json: boolean): void {
	if (json) {
		io.stdout.write(`${JSON.stringify(result.value ?? null)}\n`);
		return;
	}
	const lines: string[] = [];
	switch (result.kind) {
		case "search":
			if (!result.value.results.length) lines.push("No results found.");
			for (const [index, item] of result.value.results.entries()) {
				if (index) lines.push("");
				lines.push(`${index + 1}. ${item.title}`, `   ${item.url}`);
				if (item.publishedAt) lines.push(`   Published: ${item.publishedAt}`);
				if (item.snippet) lines.push(`   ${item.snippet}`);
			}
			break;
		case "contents": {
			const document = result.value;
			if (document.title) lines.push(document.title);
			lines.push(document.url);
			if (document.publishedAt)
				lines.push(`Published: ${document.publishedAt}`);
			lines.push("", document.content);
			if (document.truncated) lines.push("", "Content truncated.");
			const images = new Set([
				...(document.imageUrls ?? []),
				...(document.imageUrl ? [document.imageUrl] : []),
			]);
			if (images.size) lines.push("", "Images:", ...images);
			break;
		}
		case "research":
			lines.push(...researchLines(result.value));
			break;
		case "delete":
			if (result.value === undefined) lines.push(`Deleted run ${result.id}.`);
			else
				lines.push(
					`Deletion pending for run ${result.id}.`,
					...researchLines(result.value),
					`Check: arex run status ${result.id}`,
				);
			break;
		case "setup":
			lines.push(
				`Saved API key for ${result.value.baseUrl} to ${result.value.path}.`,
			);
			if (result.value.overridden)
				lines.push(
					"Warning: AREX_API_KEY overrides the saved key. Unset it to use this configuration.",
				);
			lines.push('Try: arex search "AI agents"');
			break;
		case "doctor":
			for (const check of result.value.checks) {
				lines.push(
					`${check.status.toUpperCase().padEnd(4)}  ${check.name}: ${check.message}`,
				);
			}
			if (result.value.nextSteps.length)
				lines.push(
					"",
					"Next steps:",
					...result.value.nextSteps.map((step) => `  ${step}`),
				);
			if (result.value.ok) lines.push("", "Ready to use.");
			break;
		case "skill":
			lines.push(
				`${result.value.dryRun ? "Would install" : "Installed"} ${result.value.scope} skill: ${result.value.path}`,
			);
			break;
		case "skill-path":
			lines.push(result.value.path);
			break;
	}
	io.stdout.write(`${terminalText(lines.join("\n"))}\n`);
}
