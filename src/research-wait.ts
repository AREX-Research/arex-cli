import { setTimeout as sleep } from "node:timers/promises";
import {
	ArexError,
	ArexTimeoutError,
	type CompletedResearchRun,
	DEFAULT_POLL_INTERVAL_MS,
	type ResearchResource,
	ResearchRunCancelledError,
	ResearchRunFailedError,
} from "@arex-research/ts-sdk";
import { InterruptedError } from "./errors.js";

/**
 * Polls a research run until it finishes. Unlike the SDK's `wait`, which
 * cancels the run when its signal aborts, an interrupt or deadline here only
 * stops waiting: the run is already underway and counts against the usage
 * allowance, and a host that kills a slow tool call must not destroy its work.
 */
export async function waitForRun(
	research: ResearchResource,
	runId: string,
	options: { timeoutMs: number; signal?: AbortSignal },
): Promise<CompletedResearchRun> {
	const deadline = AbortSignal.timeout(options.timeoutMs);
	const signal = options.signal
		? AbortSignal.any([options.signal, deadline])
		: deadline;
	try {
		while (true) {
			const run = await research.get(runId, { signal });
			if (run.status === "completed") return run;
			if (run.status === "failed") throw new ResearchRunFailedError(run);
			if (run.status === "cancelled") throw new ResearchRunCancelledError(run);
			// Only known terminal states stop polling; new statuses stay in progress.
			await sleep(DEFAULT_POLL_INTERVAL_MS, undefined, { signal });
		}
	} catch (error) {
		if (options.signal?.aborted) throw namingRun(options.signal.reason, runId);
		if (deadline.aborted)
			throw new ArexTimeoutError("poll", options.timeoutMs, runId);
		throw namingRun(error, runId);
	}
}

/** Attaches the run ID so the error output can say how to resume. */
export function namingRun(error: unknown, runId: string): unknown {
	if (
		(error instanceof ArexError || error instanceof InterruptedError) &&
		error.runId === undefined
	)
		error.runId = runId;
	return error;
}
