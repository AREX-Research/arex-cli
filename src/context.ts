import type { Readable } from "node:stream";
import type { FetchLike } from "@arex-research/ts-sdk";

export interface CliWriter {
	write(value: string): unknown;
	isTTY?: boolean;
}

export interface CliIO {
	stdout: CliWriter;
	stderr: CliWriter;
}

export interface CliContext {
	environment: NodeJS.ProcessEnv;
	cwd: string;
	home: string;
	input: Readable & { isTTY?: boolean };
	io: CliIO;
	signal?: AbortSignal;
	fetch?: FetchLike;
}
