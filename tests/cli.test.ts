import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
	type FetchLike,
	ResearchResource,
	type ResearchRun,
} from "@arex-research/ts-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configurationPath, saveConfiguration } from "../src/config.js";
import { InterruptedError } from "../src/errors.js";
import { runCli } from "../src/program.js";

vi.mock("@inquirer/password", () => ({
	default: async () => `sk_arex_${"a".repeat(32)}`,
}));

const API_KEY = `sk_arex_${"a".repeat(32)}`;
const ID = "550e8400-e29b-41d4-a716-446655440000";
const run = {
	id: ID,
	mode: "fast",
	requested_mode: "auto",
	created_at: "2026-09-22T00:00:00Z",
};
let home: string;

beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "arex-cli-"));
});
afterEach(async () => {
	await rm(home, { recursive: true, force: true });
});

function capture() {
	let stdout = "";
	let stderr = "";
	return {
		io: {
			stdout: {
				write(value: string) {
					stdout += value;
				},
			},
			stderr: {
				write(value: string) {
					stderr += value;
				},
			},
		},
		stdout: () => stdout,
		stderr: () => stderr,
	};
}

describe("human-first command interface", () => {
	it.each([
		{ status: 404, code: "not_found", exitCode: 0 },
		{ status: 401, code: "unauthorized", exitCode: 3 },
		{ status: 403, code: "forbidden", exitCode: 3 },
	])(
		"setup verifies access without creating a run: HTTP $status",
		async ({ status, code, exitCode }) => {
			const output = capture();
			const input = Object.assign(Readable.from([`${API_KEY}\n`]), {
				isTTY: true,
				setRawMode() {},
			});
			const requests: string[] = [];
			const environment = {};
			expect(
				await runCli(["setup"], {
					home,
					environment,
					input,
					io: {
						stdout: output.io.stdout,
						stderr: { ...output.io.stderr, isTTY: true },
					},
					fetch: async (url, init) => {
						requests.push(`${init.method} ${new URL(url).pathname}`);
						expect(new Headers(init.headers).get("Authorization")).toBe(
							`Bearer ${API_KEY}`,
						);
						return Response.json(
							{ error: { code, message: "Probe response.", retryable: false } },
							{ status },
						);
					},
				}),
			).toBe(exitCode);
			expect(requests).toEqual([
				"GET /v1/research/00000000-0000-4000-8000-000000000000",
			]);
			const saved = readFile(configurationPath({ home, environment }), "utf8");
			if (exitCode === 0) {
				expect(JSON.parse(await saved).apiKey).toBe(API_KEY);
			} else {
				await expect(saved).rejects.toMatchObject({ code: "ENOENT" });
			}
		},
	);

	it.each([
		{ flags: [], expected: {} },
		{ flags: ["--fresh"], expected: { livecrawl: true } },
		{
			flags: [
				"--tier",
				"flex",
				"--fresh-timeout",
				"30s",
				"--max-chars",
				"12000",
			],
			expected: {
				tier: "flex",
				livecrawl: true,
				livecrawl_timeout_ms: 30000,
				max_characters: 12000,
			},
		},
	])(
		"reads contents with SDK defaults and retrieval options: $flags",
		async ({ flags, expected }) => {
			const output = capture();
			const requests: unknown[] = [];
			expect(
				await runCli(
					["contents", "https://example.com/article", ...flags, "--json"],
					{
						home,
						environment: { AREX_API_KEY: API_KEY },
						io: output.io,
						fetch: async (url, init) => {
							requests.push({
								path: new URL(url).pathname,
								method: init.method,
								body: JSON.parse(init.body as string),
							});
							return Response.json({
								url: "https://example.com/article",
								title: "Article",
								content: "Page text",
								truncated: false,
							});
						},
					},
				),
			).toBe(0);
			expect(requests).toEqual([
				{
					path: "/v1/contents",
					method: "POST",
					body: { url: "https://example.com/article", ...expected },
				},
			]);
			expect(JSON.parse(output.stdout())).toMatchObject({
				url: "https://example.com/article",
				title: "Article",
				content: "Page text",
				truncated: false,
			});
			expect(output.stderr()).toBe("");
		},
	);

	it("searches with optional limit and publication bounds and renders published_at in text and JSON", async () => {
		const requests: unknown[] = [];
		const fetch: FetchLike = async (url, init) => {
			requests.push({
				path: new URL(url).pathname,
				method: init.method,
				body: JSON.parse(init.body as string),
			});
			return Response.json({
				results: [
					{
						title: "Dated result",
						url: "https://example.com/dated",
						snippet: "First snippet",
						published_at: "2026-08-22T00:00:00.000Z",
					},
					{
						title: "Undated result",
						url: "https://example.com/undated",
					},
				],
			});
		};
		const jsonOut = capture();
		expect(
			await runCli(
				[
					"search",
					"AI agents",
					"--limit",
					"5",
					"--published-after",
					"2026-08-21T00:00:00Z",
					"--published-before",
					"2026-08-23T00:00:00Z",
					"--json",
				],
				{
					home,
					environment: { AREX_API_KEY: API_KEY },
					io: jsonOut.io,
					fetch,
				},
			),
		).toBe(0);
		expect(JSON.parse(jsonOut.stdout())).toEqual({
			results: [
				{
					title: "Dated result",
					url: "https://example.com/dated",
					snippet: "First snippet",
					publishedAt: "2026-08-22T00:00:00.000Z",
				},
				{
					title: "Undated result",
					url: "https://example.com/undated",
				},
			],
		});

		const textOut = capture();
		expect(
			await runCli(["search", "AI agents"], {
				home,
				environment: { AREX_API_KEY: API_KEY },
				io: textOut.io,
				fetch,
			}),
		).toBe(0);
		expect(textOut.stdout()).toBe(
			[
				"1. Dated result",
				"   https://example.com/dated",
				"   Published: 2026-08-22T00:00:00.000Z",
				"   First snippet",
				"",
				"2. Undated result",
				"   https://example.com/undated",
				"",
			].join("\n"),
		);
		expect(requests).toEqual([
			{
				path: "/v1/search",
				method: "POST",
				body: {
					query: "AI agents",
					limit: 5,
					published_after: "2026-08-21T00:00:00Z",
					published_before: "2026-08-23T00:00:00Z",
				},
			},
			{
				path: "/v1/search",
				method: "POST",
				body: { query: "AI agents" },
			},
		]);
	});

	it.each([
		{
			flags: ["--published-after", "not-a-timestamp"],
			param: "publishedAfter",
		},
		{
			flags: ["--published-before", "2026-08-22T00:00:00+08:00"],
			param: "publishedBefore",
		},
		{
			flags: [
				"--published-after",
				"2026-08-23T00:00:00Z",
				"--published-before",
				"2026-08-22T00:00:00Z",
			],
			param: "publishedBefore",
		},
		{
			flags: [
				"--published-after",
				"2026-08-22T00:00:00.100Z",
				"--published-before",
				"2026-08-22T00:00:00.900Z",
			],
			param: "publishedBefore",
		},
	])(
		"rejects invalid search publication bounds before sending a charged request: $flags",
		async ({ flags, param }) => {
			const output = capture();
			let calls = 0;
			const code = await runCli(["--json", "search", "AI agents", ...flags], {
				home,
				environment: { AREX_API_KEY: API_KEY },
				io: output.io,
				fetch: async () => {
					calls++;
					throw new Error("must not send a search request");
				},
			});
			expect(code).toBe(2);
			expect(calls).toBe(0);
			expect(output.stdout()).toBe("");
			expect(JSON.parse(output.stderr()).error).toMatchObject({
				kind: "api",
				code: "invalid_request",
				param,
			});
		},
	);

	it("treats --json after the option terminator as query text, not output selection", async () => {
		const output = capture();
		await runCli(["search", "--", "--json"], {
			home,
			environment: { AREX_API_KEY: API_KEY },
			io: output.io,
			fetch: async () =>
				Response.json({
					results: [{ title: "Literal flag", url: "https://example.com" }],
				}),
		});
		expect(output.stdout()).toContain("1. Literal flag");
		expect(() => JSON.parse(output.stdout())).toThrow();
	});

	it("rejects conflicting detached and waiting options before creating a charged run", async () => {
		const output = capture();
		let calls = 0;
		const code = await runCli(
			["--json", "research", "question", "--detach", "--timeout", "2m"],
			{
				home,
				environment: { AREX_API_KEY: API_KEY },
				io: output.io,
				fetch: async () => {
					calls++;
					throw new Error("must not create a run");
				},
			},
		);
		expect(code).toBe(2);
		expect(calls).toBe(0);
		expect(output.stdout()).toBe("");
		expect(JSON.parse(output.stderr()).error.code).toBe("invalid_usage");
	});

	it("returns a detached ID without waiting, while ordinary research returns an answer", async () => {
		const detached = capture();
		expect(
			await runCli(["research", "question", "--detach", "--json"], {
				home,
				environment: { AREX_API_KEY: API_KEY },
				io: detached.io,
				fetch: async (_url, init) => {
					if (init.method !== "POST")
						throw new Error("detached research must not poll GET");
					expect(new Headers(init.headers).get("Prefer")).toBe("respond-async");
					return Response.json({ ...run, status: "queued" }, { status: 202 });
				},
			}),
		).toBe(0);
		expect(JSON.parse(detached.stdout())).toMatchObject({
			id: ID,
			status: "queued",
		});
		expect(detached.stderr()).toBe("");

		const completed = capture();
		expect(
			await runCli(["research", "question", "--json"], {
				home,
				environment: { AREX_API_KEY: API_KEY },
				io: completed.io,
				fetch: async (_url, init) => {
					if (init.method === "POST") {
						expect(new Headers(init.headers).get("Prefer")).toBeNull();
						return Response.json({ ...run, status: "queued" }, { status: 202 });
					}
					return Response.json({
						...run,
						status: "completed",
						result: { answer: "Cited answer", sources: [] },
					});
				},
			}),
		).toBe(0);
		expect(completed.stderr()).toBe(`Running research (id: ${ID})...\n`);
		expect(JSON.parse(completed.stdout())).toMatchObject({
			status: "completed",
			result: { answer: "Cited answer" },
		});
	});

	it("handles synchronous POST /v1/research completion and failure without polling, and negotiates non-blocking Prefer headers for short timeouts", async () => {
		for (const timeoutFlag of ["10s", "2s"]) {
			const syncCompleted = capture();
			expect(
				await runCli(
					["research", "question", "--timeout", timeoutFlag, "--json"],
					{
						home,
						environment: { AREX_API_KEY: API_KEY },
						io: syncCompleted.io,
						fetch: async (_url, init) => {
							if (init.method === "POST") {
								expect(new Headers(init.headers).get("Prefer")).toMatch(
									/^(wait=\d+|respond-async)$/,
								);
								return Response.json({
									...run,
									status: "completed",
									result: { answer: "Immediate answer", sources: [] },
								});
							}
							throw new Error("must not poll GET /v1/research/{id}");
						},
					},
				),
			).toBe(0);
			expect(syncCompleted.stderr()).toBe("");
			expect(JSON.parse(syncCompleted.stdout())).toMatchObject({
				id: ID,
				status: "completed",
				result: { answer: "Immediate answer" },
			});
		}

		const syncFailed = capture();
		expect(
			await runCli(["research", "question", "--json"], {
				home,
				environment: { AREX_API_KEY: API_KEY },
				io: syncFailed.io,
				fetch: async (_url, init) => {
					if (init.method === "POST") {
						return Response.json({
							...run,
							status: "failed",
							error: { code: "execution_failed", retryable: false },
						});
					}
					throw new Error("must not poll GET /v1/research/{id}");
				},
			}),
		).toBe(7);
		expect(syncFailed.stdout()).toBe("");
		expect(JSON.parse(syncFailed.stderr()).error).toMatchObject({
			kind: "research",
			code: "research_failed",
			run: { id: ID, status: "failed" },
		});
	});

	it.each([
		{ failure: "network", json: true },
		{ failure: "api", json: false },
	])(
		"recovers the existing run after a $failure failure without another charge",
		async ({ failure, json }) => {
			let creations = 0;
			let failNextRead = true;
			const fetch: FetchLike = async (url, init) => {
				if (init.method === "POST") {
					creations++;
					return Response.json({ ...run, status: "queued" }, { status: 202 });
				}
				if (failNextRead) {
					failNextRead = false;
					if (failure === "network") throw new TypeError("Connection closed");
					return Response.json(
						{
							error: {
								code: "internal_error",
								message: "Temporary failure",
								retryable: true,
							},
						},
						{ status: 500 },
					);
				}
				if (!url.endsWith(`/v1/research/${ID}`))
					throw new Error("Must recover the admitted run");
				return Response.json({
					...run,
					status: "completed",
					result: { answer: "Recovered answer", sources: [] },
				});
			};
			const failed = capture();
			const options = { home, environment: { AREX_API_KEY: API_KEY }, fetch };
			expect(
				await runCli(["research", "question", ...(json ? ["--json"] : [])], {
					...options,
					io: failed.io,
				}),
			).toBe(6);
			expect(failed.stdout()).toBe("");
			const recoveryId = json
				? JSON.parse(failed.stderr().trim().split("\n").at(-1) ?? "").error
						.runId
				: /arex run (?:status|wait) ([0-9a-f-]+)/.exec(failed.stderr())?.[1];
			expect(recoveryId).toBe(ID);
			const recovered = capture();
			expect(
				await runCli(["run", "wait", recoveryId, "--json"], {
					...options,
					io: recovered.io,
				}),
			).toBe(0);
			expect(JSON.parse(recovered.stdout())).toMatchObject({
				id: ID,
				status: "completed",
				result: { answer: "Recovered answer" },
			});
			expect(creations).toBe(1);
		},
	);

	it("distinguishes reading a failed run from waiting for a successful answer", async () => {
		const fetch: FetchLike = async () =>
			Response.json({
				...run,
				status: "failed",
				error: { code: "execution_failed", retryable: false },
			});
		const status = capture();
		expect(
			await runCli(["run", "status", ID, "--json"], {
				home,
				environment: { AREX_API_KEY: API_KEY },
				fetch,
				io: status.io,
			}),
		).toBe(0);
		expect(JSON.parse(status.stdout()).status).toBe("failed");
		const waiting = capture();
		expect(
			await runCli(["--json", "run", "wait", ID], {
				home,
				environment: { AREX_API_KEY: API_KEY },
				fetch,
				io: waiting.io,
			}),
		).toBe(7);
		expect(waiting.stdout()).toBe("");
		expect(JSON.parse(waiting.stderr()).error.run).toMatchObject({
			id: ID,
			status: "failed",
		});
	});

	it.each([false, true])(
		"prints an unfamiliar run status and modes without failing inspection (json: %s)",
		async (json) => {
			const value = {
				id: ID,
				status: "awaiting_confirmation",
				mode: "future_mode",
				requestedMode: "future_request",
				createdAt: run.created_at,
				message: "Research is still in progress.",
			};
			// Exercise CLI handling independently of the published SDK's closed parser.
			const get = vi
				.spyOn(ResearchResource.prototype, "get")
				.mockResolvedValue(value as unknown as ResearchRun);
			try {
				const output = capture();
				expect(
					await runCli(["run", "status", ID, ...(json ? ["--json"] : [])], {
						home,
						environment: { AREX_API_KEY: API_KEY },
						io: output.io,
					}),
				).toBe(0);
				expect(output.stderr()).toBe("");
				if (json) {
					expect(JSON.parse(output.stdout())).toEqual(value);
				} else {
					expect(output.stdout()).toContain("Status: awaiting_confirmation\n");
					expect(output.stdout()).toContain("Mode: future_mode\n");
					expect(output.stdout()).toContain("Requested mode: future_request\n");
					expect(output.stdout()).toContain(`Next: arex run wait ${ID}\n`);
				}
			} finally {
				get.mockRestore();
			}
		},
	);

	it.each([
		["research", "question"],
		["run", "wait", ID],
	])("keeps waiting on unfamiliar statuses: %s", async (...command) => {
		const value = {
			id: ID,
			status: "awaiting_confirmation",
			mode: "fast",
			requestedMode: "auto",
			createdAt: run.created_at,
		} as unknown as ResearchRun;
		const create = vi
			.spyOn(ResearchResource.prototype, "create")
			.mockResolvedValue(value);
		const get = vi
			.spyOn(ResearchResource.prototype, "get")
			.mockResolvedValue(value);
		try {
			const output = capture();
			expect(
				await runCli([...command, "--timeout", "5ms", "--json"], {
					home,
					environment: { AREX_API_KEY: API_KEY },
					io: output.io,
				}),
			).toBe(6);
			expect(output.stdout()).toBe("");
			expect(
				JSON.parse(output.stderr().trim().split("\n").at(-1) ?? "").error,
			).toMatchObject({
				kind: "timeout",
				phase: "poll",
				runId: ID,
			});
		} finally {
			create.mockRestore();
			get.mockRestore();
		}
	});

	it("rejects an invalid API key without attempting a request or leaking the key", async () => {
		const output = capture();
		const key = "secret-invalid-key";
		let calls = 0;
		const code = await runCli(["run", "status", ID, "--json"], {
			home,
			environment: { AREX_API_KEY: key },
			io: output.io,
			fetch: async () => {
				calls++;
				return new Response();
			},
		});
		expect(code).toBe(2);
		expect(calls).toBe(0);
		expect(output.stdout()).toBe("");
		expect(output.stderr()).not.toContain(key);
	});

	it.each([
		{ command: ["research", "question"], signal: "SIGINT", exitCode: 130 },
		{ command: ["run", "wait", ID], signal: "SIGTERM", exitCode: 143 },
	] as const)(
		"stops waiting on $signal without cancelling the run, and names it for resuming",
		async ({ command, signal, exitCode }) => {
			const controller = new AbortController();
			const requests: string[] = [];
			const fetch: FetchLike = async (url, init) => {
				requests.push(`${init.method} ${new URL(url).pathname}`);
				if (init.method === "POST")
					return Response.json({ ...run, status: "queued" }, { status: 202 });
				controller.abort(new InterruptedError(signal));
				return Response.json({ ...run, status: "running" });
			};
			const output = capture();
			expect(
				await runCli([...command, "--json"], {
					home,
					environment: { AREX_API_KEY: API_KEY },
					fetch,
					io: output.io,
					signal: controller.signal,
				}),
			).toBe(exitCode);
			expect(
				JSON.parse(output.stderr().trim().split("\n").at(-1) ?? "").error,
			).toMatchObject({
				kind: "aborted",
				runId: ID,
			});
			expect(requests.filter((request) => request.endsWith("/cancel"))).toEqual(
				[],
			);
		},
	);

	it("finishes creating a charged run when interrupted, so the run can still be found", async () => {
		const controller = new AbortController();
		const requests: string[] = [];
		const output = capture();
		const code = await runCli(["research", "question"], {
			home,
			environment: { AREX_API_KEY: API_KEY },
			io: output.io,
			signal: controller.signal,
			fetch: async (url, init) => {
				requests.push(`${init.method} ${new URL(url).pathname}`);
				controller.abort(new InterruptedError("SIGINT"));
				return Response.json({ ...run, status: "queued" }, { status: 202 });
			},
		});
		expect(code).toBe(130);
		expect(requests).toEqual(["POST /v1/research"]);
		expect(output.stderr()).toContain(`arex run wait ${ID}`);
		expect(output.stderr()).toContain(`arex run cancel ${ID}`);
	});

	it("never sends a saved key to an endpoint other than the one it was saved for", async () => {
		await saveConfiguration(configurationPath({ home, environment: {} }), {
			apiKey: API_KEY,
			baseUrl: "https://api.arex-research.com",
		});
		const requested: string[] = [];
		const fetch: FetchLike = async (url) => {
			requested.push(new URL(url).origin);
			return Response.json({ ...run, status: "queued" });
		};
		const redirected = capture();
		expect(
			await runCli(["run", "status", ID], {
				home,
				environment: { AREX_BASE_URL: "https://collector.example" },
				fetch,
				io: redirected.io,
			}),
		).toBe(2);
		expect(redirected.stderr()).toContain("only sent to");
		const plaintext = capture();
		expect(
			await runCli(["run", "status", ID], {
				home,
				environment: {
					AREX_API_KEY: API_KEY,
					AREX_BASE_URL: "http://collector.example",
				},
				fetch,
				io: plaintext.io,
			}),
		).toBe(2);
		expect(requested).toEqual([]);
		expect(
			await runCli(["run", "status", ID], {
				home,
				environment: {},
				fetch,
				io: capture().io,
			}),
		).toBe(0);
		expect(requested).toEqual(["https://api.arex-research.com"]);
	});
});
