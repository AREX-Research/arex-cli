import { homedir } from "node:os";
import {
	Arex,
	type ContentsTier,
	DEEP_POLL_TIMEOUT_MS,
	FAST_POLL_TIMEOUT_MS,
	RESEARCH_REQUEST_TIMEOUT_MS,
	type ResearchCreateOptions,
	ResearchRunCancelledError,
	ResearchRunFailedError,
} from "@arex-research/ts-sdk";
import { Command, CommanderError, Option } from "commander";
import packageInfo from "../package.json" with { type: "json" };
import { API_KEYS_URL, resolveCredentials } from "./config.js";
import type { CliContext } from "./context.js";
import { doctor } from "./doctor.js";
import { writeError } from "./error-output.js";
import { CliUsageError } from "./errors.js";
import { duration, integer, queryInput } from "./input.js";
import { type CliResult, writeResult } from "./output.js";
import { namingRun, waitForRun } from "./research-wait.js";
import { setup } from "./setup.js";
import { installSkill, type SkillScope, skillPath } from "./skill.js";

export type RunCliOptions = Partial<CliContext>;

/** Runs one CLI invocation and returns its exit code. Never throws. */
export async function runCli(
	arguments_: string[],
	options: RunCliOptions = {},
): Promise<number> {
	const context: CliContext = {
		environment: options.environment ?? process.env,
		cwd: options.cwd ?? process.cwd(),
		home: options.home ?? options.environment?.HOME ?? homedir(),
		input: options.input ?? process.stdin,
		io: options.io ?? { stdout: process.stdout, stderr: process.stderr },
		signal: options.signal,
		fetch: options.fetch,
	};
	const { signal } = context;
	let exitCode = 0;

	const program = new Command()
		.name("arex")
		.description("Search, read, and research the web.")
		.version(packageInfo.version)
		.option("--json", "output machine-readable JSON")
		.configureOutput({
			writeOut: (value) => context.io.stdout.write(value),
			writeErr: (value) => context.io.stderr.write(value),
			// Parse errors are rendered once, by writeError below.
			outputError: () => {},
		})
		.exitOverride()
		.addHelpText(
			"after",
			`\nStart here: arex setup\nCreate an API key: ${API_KEYS_URL}`,
		);
	const json = () => program.opts<{ json?: boolean }>().json === true;
	const emit = (result: CliResult) => writeResult(context.io, result, json());
	const connect = async () => {
		const { apiKey, baseUrl } = await resolveCredentials(context);
		return new Arex({ apiKey, baseUrl, fetch: context.fetch });
	};

	program
		.command("setup")
		.description("configure your API key interactively")
		.action(async () => {
			if (json())
				throw new CliUsageError(
					"setup is interactive; run arex setup without --json.",
				);
			emit({ kind: "setup", value: await setup(context) });
		});

	program
		.command("doctor")
		.description("check configuration, connection, and authentication")
		.action(async () => {
			const report = await doctor(context);
			emit({ kind: "doctor", value: report });
			exitCode = report.ok ? 0 : 1;
		});

	program
		.command("search")
		.description("search the web")
		.argument("<query>", "search query, or - to read stdin")
		.option("--limit <count>", "maximum number of results", integer)
		.option(
			"--published-after <timestamp>",
			"earliest publication time (UTC ISO 8601)",
		)
		.option(
			"--published-before <timestamp>",
			"latest publication time (UTC ISO 8601)",
		)
		.action(
			async (
				query: string,
				opts: {
					limit?: number;
					publishedAfter?: string;
					publishedBefore?: string;
				},
			) => {
				const arex = await connect();
				const text = await queryInput(query, context);
				emit({
					kind: "search",
					value: await arex.search(text, {
						limit: opts.limit,
						publishedAfter: opts.publishedAfter,
						publishedBefore: opts.publishedBefore,
						signal,
					}),
				});
			},
		);

	program
		.command("contents")
		.description("read a public web page")
		.argument("<url>", "public HTTP(S) URL")
		.addOption(
			new Option("--tier <tier>", "retrieval budget").choices(["auto", "flex"]),
		)
		.option("--fresh", "fetch a fresh page instead of a cached copy")
		.option(
			"--fresh-timeout <duration>",
			"fresh retrieval deadline, e.g. 30s (implies --fresh)",
			duration,
		)
		.option("--max-chars <count>", "maximum returned content length", integer)
		.action(
			async (
				url: string,
				opts: {
					tier?: ContentsTier;
					fresh?: boolean;
					freshTimeout?: number;
					maxChars?: number;
				},
			) => {
				const arex = await connect();
				emit({
					kind: "contents",
					value: await arex.contents(url, {
						tier: opts.tier,
						livecrawl:
							opts.fresh || opts.freshTimeout !== undefined || undefined,
						livecrawlTimeoutMs: opts.freshTimeout,
						maxCharacters: opts.maxChars,
						signal,
					}),
				});
			},
		);

	program
		.command("research")
		.description("research a question and wait for a cited answer")
		.argument("<question>", "research question, or - to read stdin")
		.addOption(
			new Option("--mode <mode>", "research depth").choices([
				"auto",
				"fast",
				"deep",
			]),
		)
		.option("--detach", "start the research and return its ID immediately")
		.addOption(
			new Option(
				"--timeout <duration>",
				"waiting deadline, e.g. 2m; leaves research running",
			)
				.argParser(duration)
				.conflicts("detach"),
		)
		.addHelpText(
			"after",
			"\nInterrupting stops waiting; the research keeps running. Cancel it with arex run cancel.",
		)
		.action(
			async (
				question: string,
				opts: {
					mode?: ResearchCreateOptions["mode"];
					detach?: boolean;
					timeout?: number;
				},
			) => {
				const arex = await connect();
				const query = await queryInput(question, context);
				const startedAt = Date.now();
				// Deliberately not abortable: once the server may have started the
				// run, finish the request so an interrupt can still name it.
				const created = await arex.research.create(query, {
					mode: opts.mode,
					detach: opts.detach,
					...(opts.timeout !== undefined
						? { timeoutMs: Math.min(RESEARCH_REQUEST_TIMEOUT_MS, opts.timeout) }
						: {}),
				});
				if (signal?.aborted) throw namingRun(signal.reason, created.id);
				if (opts.detach) {
					emit({ kind: "research", value: created });
					return;
				}
				if (created.status === "completed") {
					emit({ kind: "research", value: created });
					return;
				}
				if (created.status === "failed")
					throw new ResearchRunFailedError(created);
				if (created.status === "cancelled")
					throw new ResearchRunCancelledError(created);
				context.io.stderr.write(`Running research (id: ${created.id})...\n`);
				const totalTimeoutMs =
					opts.timeout ??
					(created.mode === "fast"
						? FAST_POLL_TIMEOUT_MS
						: DEEP_POLL_TIMEOUT_MS);
				const remainingTimeoutMs = Math.max(
					1,
					totalTimeoutMs - (Date.now() - startedAt),
				);
				const completed = await waitForRun(arex.research, created.id, {
					timeoutMs: remainingTimeoutMs,
					signal,
				});
				emit({ kind: "research", value: completed });
			},
		);

	const run = program
		.command("run")
		.description("inspect and manage existing research runs");
	run
		.command("status")
		.description("show the current status and any available answer")
		.argument("<run-id>")
		.action(async (id: string) => {
			const arex = await connect();
			emit({
				kind: "research",
				value: await arex.research.get(id, { signal }),
			});
		});
	run
		.command("wait")
		.description("wait for an existing research answer")
		.argument("<run-id>")
		.option(
			"--timeout <duration>",
			"waiting deadline, e.g. 2m; leaves research running",
			duration,
		)
		.addHelpText(
			"after",
			"\nInterrupting or timing out stops waiting; the research keeps running.",
		)
		.action(async (id: string, opts: { timeout?: number }) => {
			const arex = await connect();
			emit({
				kind: "research",
				value: await waitForRun(arex.research, id, {
					timeoutMs: opts.timeout ?? DEEP_POLL_TIMEOUT_MS,
					signal,
				}),
			});
		});
	run
		.command("cancel")
		.description("request cancellation of a research run")
		.argument("<run-id>")
		.action(async (id: string) => {
			const arex = await connect();
			emit({
				kind: "research",
				value: await arex.research.cancel(id, { signal }),
			});
		});
	run
		.command("delete")
		.description("delete a run, cancelling it first if necessary")
		.argument("<run-id>")
		.action(async (id: string) => {
			const arex = await connect();
			emit({
				kind: "delete",
				id,
				value: await arex.research.delete(id, { signal }),
			});
		});

	const skill = program
		.command("skill")
		.description("manage the bundled Agent Skill");
	const scopeOption = () =>
		new Option("--scope <scope>", "installation scope")
			.choices(["user", "project"])
			.default("user");
	skill
		.command("path")
		.description("show the Agent Skill installation path")
		.addOption(scopeOption())
		.action((opts: { scope: SkillScope }) =>
			emit({
				kind: "skill-path",
				value: { path: skillPath(opts.scope, context), scope: opts.scope },
			}),
		);
	skill
		.command("install")
		.description("install the bundled Agent Skill")
		.addOption(scopeOption())
		.option("--force", "replace an existing AREX Skill")
		.option("--dry-run", "show the destination without writing")
		.action(
			async (opts: { scope: SkillScope; force?: boolean; dryRun?: boolean }) =>
				emit({
					kind: "skill",
					value: await installSkill({
						...opts,
						home: context.home,
						cwd: context.cwd,
					}),
				}),
		);

	try {
		if (arguments_.length === 0) program.outputHelp();
		else await program.parseAsync(arguments_, { from: "user" });
		return exitCode;
	} catch (error) {
		if (error instanceof CommanderError) {
			if (
				error.code === "commander.helpDisplayed" ||
				error.code === "commander.version"
			)
				return 0;
			// A command group without a subcommand: its help is already on stderr.
			if (error.code === "commander.help") return 2;
			return writeError(
				context.io,
				new CliUsageError(error.message.replace(/^error: /, "")),
				json(),
			);
		}
		// After an interrupt, report the interrupt rather than whatever the
		// aborted operation happened to throw on its way out.
		return writeError(
			context.io,
			signal?.aborted ? signal.reason : error,
			json(),
		);
	}
}
