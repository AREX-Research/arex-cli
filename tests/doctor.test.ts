import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
	API_KEYS_URL,
	configurationPath,
	saveConfiguration,
} from "../src/config.js";
import type { CliContext } from "../src/context.js";
import { doctor } from "../src/doctor.js";

const API_KEY = `sk_arex_${"a".repeat(32)}`;
const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function fixture(): Promise<CliContext> {
	const home = await mkdtemp(join(tmpdir(), "arex-doctor-"));
	roots.push(home);
	return {
		home,
		cwd: home,
		environment: {},
		input: Readable.from([]),
		io: { stdout: { write() {} }, stderr: { write() {} } },
	};
}

describe("doctor", () => {
	it("provides setup guidance without credentials, requests or filesystem writes", async () => {
		const context = await fixture();
		context.fetch = async () => {
			throw new Error("No request is allowed without a key");
		};
		const report = await doctor(context);
		expect(report.ok).toBe(false);
		expect(report.nextSteps.join(" ")).toContain(API_KEYS_URL);
		expect(report.nextSteps.join(" ")).toContain("arex setup");
		expect(await readdir(context.home)).toEqual([]);
	});

	it("checks the environment key through a read-only probe while reporting malformed saved configuration", async () => {
		const context = await fixture();
		await saveConfiguration(configurationPath(context), {
			apiKey: API_KEY,
			baseUrl: "https://api.arex-research.com",
		});
		const malformed = '{"apiKey":"secret-fragment"';
		await writeFile(configurationPath(context), malformed);
		context.environment.AREX_API_KEY = API_KEY;
		context.fetch = async (url, init) => {
			expect(new URL(url).pathname).toBe(
				"/v1/research/00000000-0000-4000-8000-000000000000",
			);
			expect(init.method).toBe("GET");
			expect(new Headers(init.headers).get("Authorization")).toBe(
				`Bearer ${API_KEY}`,
			);
			return Response.json(
				{
					error: {
						code: "not_found",
						message: "Research run not found.",
						retryable: false,
					},
				},
				{ status: 404 },
			);
		};
		const report = await doctor(context);
		expect(report.ok).toBe(false);
		expect(report.checks).toContainEqual(
			expect.objectContaining({ name: "configuration", status: "fail" }),
		);
		expect(report.checks).toContainEqual({
			name: "access",
			status: "ok",
			message: "The endpoint accepted this key.",
		});
		expect(JSON.stringify(report)).not.toContain(API_KEY);
		expect(JSON.stringify(report)).not.toContain("secret-fragment");
		expect(await readFile(configurationPath(context), "utf8")).toBe(malformed);
	});

	it.each([200, 404])(
		"accepts an authenticated probe response with HTTP %s",
		async (status) => {
			const context = await fixture();
			context.environment.AREX_API_KEY = API_KEY;
			context.fetch = async () =>
				Response.json(
					status === 404
						? {
								error: {
									code: "not_found",
									message: "Not found.",
									retryable: false,
								},
							}
						: {
								id: "00000000-0000-4000-8000-000000000000",
								status: "queued",
								mode: "fast",
								requested_mode: "auto",
								created_at: "2026-09-22T00:00:00Z",
							},
					{ status },
				);
			const report = await doctor(context);
			expect(report.ok).toBe(true);
			expect(report.checks.map((check) => check.name)).toEqual([
				"configuration",
				"endpoint",
				"credentials",
				"access",
			]);
		},
	);

	it("reports rejected credentials without echoing server-provided secret fragments", async () => {
		const context = await fixture();
		context.environment.AREX_API_KEY = API_KEY;
		context.fetch = async () =>
			new Response(
				JSON.stringify({
					error: {
						code: "unauthorized",
						message: `Rejected ${API_KEY} fragment`,
						retryable: false,
					},
				}),
				{ status: 401, headers: { "Content-Type": "application/json" } },
			);
		const report = await doctor(context);
		expect(report.ok).toBe(false);
		expect(report.checks).toContainEqual(
			expect.objectContaining({ name: "authentication", status: "fail" }),
		);
		expect(report.nextSteps.join(" ")).toContain(
			"Replace or unset AREX_API_KEY",
		);
		expect(JSON.stringify(report)).not.toContain(API_KEY);
	});

	it("rejects malformed effective keys locally without making a request", async () => {
		const context = await fixture();
		context.environment.AREX_API_KEY = "partial-secret";
		context.fetch = async () => {
			throw new Error("Malformed credentials must not make requests");
		};
		const report = await doctor(context);
		expect(report.ok).toBe(false);
		expect(report.checks).toContainEqual(
			expect.objectContaining({ name: "key-format", status: "fail" }),
		);
		expect(JSON.stringify(report)).not.toContain("partial-secret");
	});
});
