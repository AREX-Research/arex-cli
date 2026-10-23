import { InvalidArgumentError } from "commander";
import type { CliContext } from "./context.js";
import { CliUsageError } from "./errors.js";

export function integer(value: string): number {
	const number = Number(value);
	if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(number)) {
		throw new InvalidArgumentError("must be an integer");
	}
	return number;
}

export function duration(value: string): number {
	const match = /^(\d+(?:\.\d+)?)(ms|s|m)$/.exec(value);
	if (!match)
		throw new InvalidArgumentError("use a duration such as 500ms, 30s, or 2m");
	const number =
		Number(match[1]) *
		(match[2] === "m" ? 60_000 : match[2] === "s" ? 1_000 : 1);
	if (!Number.isSafeInteger(number) || number <= 0 || number > 2_147_483_647) {
		throw new InvalidArgumentError(
			"duration must fit a positive millisecond timer",
		);
	}
	return number;
}

export async function queryInput(
	value: string,
	context: CliContext,
): Promise<string> {
	if (value !== "-") return value;
	if (context.input.isTTY)
		throw new CliUsageError(
			"Pipe your question into stdin, or pass it as an argument.",
		);
	context.signal?.throwIfAborted();
	const abort = () => context.input.destroy(context.signal?.reason);
	context.signal?.addEventListener("abort", abort, { once: true });
	try {
		context.input.setEncoding("utf8");
		let query = "";
		for await (const chunk of context.input) query += chunk;
		return query.replace(/\r?\n$/, "");
	} finally {
		context.signal?.removeEventListener("abort", abort);
	}
}
