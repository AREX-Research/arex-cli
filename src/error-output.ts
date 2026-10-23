import {
	ArexApiError,
	ArexError,
	ArexNetworkError,
	ArexTimeoutError,
	AuthenticationError,
	CreditsExhaustedError,
	InvalidRequestError,
	NotFoundError,
	PermissionDeniedError,
	RateLimitError,
	type ResearchRun,
	ResearchRunCancelledError,
	ResearchRunFailedError,
	ServiceUnavailableError,
	SourceNotAvailableError,
} from "@arex-research/ts-sdk";
import { API_KEYS_URL } from "./config.js";
import type { CliIO } from "./context.js";
import { CliUsageError, InterruptedError } from "./errors.js";
import { terminalText } from "./output.js";

/** The `{"error": …}` payload; every field is safe to show a user or an agent. */
interface PublicError {
	kind:
		| "usage"
		| "api"
		| "network"
		| "timeout"
		| "research"
		| "aborted"
		| "internal";
	code: string;
	message: string;
	status?: number;
	requestId?: string;
	param?: string;
	retryable?: boolean;
	retryAfterMs?: number;
	phase?: string;
	timeoutMs?: number;
	runId?: string;
	run?: ResearchRun;
}

/** Writes one error to stderr, as text or JSON, and returns the exit code. */
export function writeError(io: CliIO, error: unknown, json: boolean): number {
	const { exitCode, error: detail } = classify(error);
	if (json) {
		const serialized = JSON.stringify({ error: detail }, (_key, value) =>
			typeof value === "string" ? redact(value) : value,
		);
		io.stderr.write(`${serialized}\n`);
	} else {
		io.stderr.write(`${terminalText(redact(errorText(detail, exitCode)))}\n`);
	}
	return exitCode;
}

function classify(error: unknown): { exitCode: number; error: PublicError } {
	const result = classifyKind(error);
	if (
		(error instanceof ArexError || error instanceof InterruptedError) &&
		error.runId !== undefined
	) {
		result.error.runId = error.runId;
	}
	return result;
}

function classifyKind(error: unknown): {
	exitCode: number;
	error: PublicError;
} {
	if (error instanceof InterruptedError) {
		return {
			exitCode: error.exitCode,
			error: { kind: "aborted", code: "aborted", message: error.message },
		};
	}
	if (error instanceof CliUsageError) {
		return {
			exitCode: 2,
			error: { kind: "usage", code: "invalid_usage", message: error.message },
		};
	}
	if (error instanceof ArexApiError) {
		return {
			exitCode: apiExitCode(error),
			error: {
				kind: "api",
				code: error.code,
				message: error.message,
				status: error.status,
				requestId: error.requestId,
				param: error.param,
				retryable: error.retryable,
				retryAfterMs: error.retryAfterMs,
			},
		};
	}
	if (error instanceof ArexTimeoutError) {
		return {
			exitCode: 6,
			error: {
				kind: "timeout",
				code: `${error.phase}_timeout`,
				message: error.message,
				phase: error.phase,
				timeoutMs: error.timeoutMs,
			},
		};
	}
	if (error instanceof ArexNetworkError) {
		return {
			exitCode: 6,
			error: { kind: "network", code: error.code, message: error.message },
		};
	}
	if (
		error instanceof ResearchRunFailedError ||
		error instanceof ResearchRunCancelledError
	) {
		return {
			exitCode: 7,
			error: {
				kind: "research",
				code:
					error instanceof ResearchRunFailedError
						? "research_failed"
						: "research_cancelled",
				message: error.message,
				run: error.run,
			},
		};
	}
	return {
		exitCode: 1,
		error: {
			kind: "internal",
			code: "internal_error",
			message:
				error instanceof Error
					? error.message
					: "An unexpected error occurred.",
		},
	};
}

function apiExitCode(error: ArexApiError): number {
	if (
		error instanceof AuthenticationError ||
		error instanceof PermissionDeniedError ||
		error.status === 401 ||
		error.status === 403
	)
		return 3;
	if (
		error instanceof RateLimitError ||
		error instanceof CreditsExhaustedError ||
		error.status === 429
	)
		return 4;
	if (
		error instanceof NotFoundError ||
		error instanceof SourceNotAvailableError ||
		error.status === 404 ||
		error.status === 409
	)
		return 5;
	if (error instanceof ServiceUnavailableError || error.status >= 500) return 6;
	// Status 0 is the SDK's own validation, before any request is sent.
	if (
		error instanceof InvalidRequestError ||
		error.status === 0 ||
		error.status === 400 ||
		error.status === 422
	)
		return 2;
	return 1;
}

function errorText(detail: PublicError, exitCode: number): string {
	const lines = [`Error (${detail.code}): ${detail.message}`];
	if (detail.status !== undefined && detail.status !== 0)
		lines.push(`HTTP status: ${detail.status}`);
	if (detail.param) lines.push(`Parameter: ${detail.param}`);
	if (detail.requestId) lines.push(`Request ID: ${detail.requestId}`);
	if (detail.retryAfterMs !== undefined)
		lines.push(`Retry after: ${detail.retryAfterMs}ms`);
	if (
		exitCode === 3 ||
		(exitCode === 2 && /api.?key|AREX_API_KEY/i.test(detail.message))
	) {
		lines.push(
			`Create an API key: ${API_KEYS_URL}`,
			"Run arex setup to save it, or set AREX_API_KEY.",
		);
	}
	if (detail.runId) {
		lines.push(`Run: ${detail.runId}`);
		if (detail.run) lines.push(`Status: ${detail.run.status}`);
		if (detail.run?.status === "failed")
			lines.push(`Failure: ${detail.run.error.code}`);
		if (detail.kind === "timeout" || detail.kind === "aborted")
			lines.push(
				"The run continues on the server.",
				`Resume: arex run wait ${detail.runId}`,
				`Cancel: arex run cancel ${detail.runId}`,
			);
		else lines.push(`Inspect: arex run status ${detail.runId}`);
	}
	if (detail.kind === "network" || detail.code === "request_timeout")
		lines.push("Run arex doctor to check your connection and configuration.");
	return lines.join("\n");
}

function redact(value: string): string {
	return value
		.replace(/sk_arex_[a-zA-Z0-9_-]+/g, "[REDACTED]")
		.replace(/\b(Bearer\s+)\S+/gi, "$1[REDACTED]")
		.replace(
			/\b((?:api[_-]?key|authorization)\s*[=:]\s*)[^\s,;]+/gi,
			"$1[REDACTED]",
		);
}
