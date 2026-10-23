#!/usr/bin/env node

import { InterruptedError } from "./errors.js";
import { runCli } from "./program.js";

// A reader that closes the pipe early (`arex contents … | head`) already has
// what it wanted; stop quietly instead of crashing on the next write.
for (const stream of [process.stdout, process.stderr]) {
	stream.on("error", (error: NodeJS.ErrnoException) => {
		if (error.code !== "EPIPE") throw error;
		process.exit();
	});
}

// The first signal aborts the running operation so it can report what it left
// behind; `once` lets a second signal terminate immediately.
const controller = new AbortController();
const interrupt = (signal: "SIGINT" | "SIGTERM") =>
	controller.abort(new InterruptedError(signal));
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);

process.exitCode = await runCli(process.argv.slice(2), {
	signal: controller.signal,
});
process.removeListener("SIGINT", interrupt);
process.removeListener("SIGTERM", interrupt);
