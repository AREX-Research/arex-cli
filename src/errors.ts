/** A problem the user fixes by changing arguments, input, or configuration. */
export class CliUsageError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CliUsageError";
	}
}

/**
 * The user or the host stopped the CLI. An interrupt never cancels server
 * work; `runId` names a research run that keeps going so it can be resumed.
 */
export class InterruptedError extends Error {
	readonly exitCode: 130 | 143;
	runId?: string;

	constructor(
		signal: "SIGINT" | "SIGTERM",
		message = "Operation interrupted.",
	) {
		super(message);
		this.name = "InterruptedError";
		this.exitCode = signal === "SIGINT" ? 130 : 143;
	}
}
