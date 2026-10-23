import { ArexApiError } from "@arex-research/ts-sdk";
import { describe, expect, it } from "vitest";
import type { CliIO } from "../src/context.js";
import { writeError } from "../src/error-output.js";
import { writeResult } from "../src/output.js";

function capture() {
	let stdout = "";
	let stderr = "";
	const io: CliIO = {
		stdout: {
			write: (value) => {
				stdout += value;
			},
		},
		stderr: {
			write: (value) => {
				stderr += value;
			},
		},
	};
	return { io, stdout: () => stdout, stderr: () => stderr };
}

describe("presentation trust boundaries", () => {
	it("removes terminal escapes and bidi overrides from text, keeping joiners and JSON data intact", () => {
		const value = {
			results: [
				{
					title: "safe\u001b[2J\u202eevil \u{1F469}\u200D\u{1F4BB}",
					url: "https://example.com",
					snippet: "one\ntwo\u0007",
					publishedAt: "2026-08-22T00:00:00Z\u001b[31m",
				},
			],
		};
		const text = capture();
		writeResult(text.io, { kind: "search", value }, false);
		for (const control of ["\u001b", "\u202e", "\u0007"]) {
			expect(text.stdout()).not.toContain(control);
		}
		expect(text.stdout()).toContain("one\ntwo");
		expect(text.stdout()).toContain("Published: 2026-08-22T00:00:00Z");
		expect(text.stdout()).toContain("\u{1F469}\u200D\u{1F4BB}");
		const json = capture();
		writeResult(json.io, { kind: "search", value }, true);
		expect(JSON.parse(json.stdout())).toEqual(value);
		expect(json.stdout().split("\n")).toHaveLength(2);
	});

	it("preserves known API metadata but never serializes arbitrary details or credentials", () => {
		const secret = "sk_arex_abcdefghijklmnopqrstuvwxyz123456";
		const error = new ArexApiError({
			status: 429,
			code: "daily_credits_exhausted",
			message: `Rejected ${secret}`,
			requestId: "request-1",
			param: "query",
			retryAfterMs: 1200,
			details: {
				authorization: secret,
				nested: { secret },
				cause: "private",
			},
		});
		const output = capture();
		expect(writeError(output.io, error, true)).toBe(4);
		const payload = JSON.parse(output.stderr()).error;
		expect(payload).toMatchObject({
			status: 429,
			requestId: "request-1",
			param: "query",
			retryAfterMs: 1200,
		});
		expect(payload).not.toHaveProperty("details");
		expect(output.stderr()).not.toContain(secret);
		expect(payload).not.toHaveProperty("stack");
	});
});
