import type { Writable } from "node:stream";
import { Arex, isArexApiKey, NotFoundError } from "@arex-research/ts-sdk";
import password from "@inquirer/password";
import {
	API_KEYS_URL,
	configurationPath,
	readStoredConfiguration,
	saveConfiguration,
} from "./config.js";
import type { CliContext } from "./context.js";
import { configuredEndpoint } from "./endpoint.js";
import { CliUsageError, InterruptedError } from "./errors.js";

export interface SetupResult {
	path: string;
	baseUrl: string;
	overridden: boolean;
}

const PROBE_RUN_ID = "00000000-0000-4000-8000-000000000000";

/** Verifies a key with a read-only probe, then saves it for this endpoint. */
export async function setup(context: CliContext): Promise<SetupResult> {
	if (
		!context.input.isTTY ||
		!context.io.stderr.isTTY ||
		!("setRawMode" in context.input) ||
		typeof context.input.setRawMode !== "function"
	) {
		throw new CliUsageError(
			`Setup requires an interactive terminal. Run arex setup in a terminal, or set AREX_API_KEY securely in your environment. Create a key at ${API_KEYS_URL}`,
		);
	}
	context.signal?.throwIfAborted();
	const path = configurationPath(context);
	const baseUrl = configuredEndpoint(context.environment);
	const stored = await readStoredConfiguration(path);
	// A saved key is only offered again for the endpoint it was saved for.
	const savedKey =
		stored.state === "valid" && stored.baseUrl === baseUrl
			? stored.apiKey
			: undefined;
	const overridden = Boolean(context.environment.AREX_API_KEY?.trim());

	const notes = [
		`Create an API key: ${API_KEYS_URL}`,
		`Configuration: ${path}`,
		`Endpoint: ${baseUrl}`,
		"Your key will be stored as plaintext with owner-only file and directory access.",
	];
	if (stored.state === "invalid")
		notes.push(
			`The existing configuration is unusable (${stored.reason}) and will be replaced.`,
		);
	if (stored.state === "valid" && stored.baseUrl !== baseUrl)
		notes.push(
			`The saved key belongs to ${stored.baseUrl} and will be replaced.`,
		);
	if (overridden)
		notes.push(
			"AREX_API_KEY is set and will override the saved key until you unset it.",
		);
	context.io.stderr.write(`${notes.join("\n")}\n`);

	let entered: string;
	try {
		entered = await password(
			{
				message: savedKey
					? "API key (leave empty to keep the saved key):"
					: "API key:",
				mask: false,
			},
			{
				input: context.input,
				output: context.io.stderr as Writable,
				signal: context.signal,
			},
		);
	} catch (error) {
		context.signal?.throwIfAborted();
		// Ctrl-C inside the prompt arrives as a keypress in raw mode, not SIGINT.
		if (error instanceof Error && error.name === "ExitPromptError")
			throw new InterruptedError(
				"SIGINT",
				"Setup cancelled. No configuration was saved.",
			);
		throw error;
	}
	const apiKey = entered.trim() || savedKey;
	if (!apiKey)
		throw new CliUsageError(
			`No key was entered and no saved key exists. Create a key at ${API_KEYS_URL}, then run arex setup.`,
		);
	if (!isArexApiKey(apiKey))
		throw new CliUsageError(
			`The entered API key does not have the AREX key format. No configuration was saved. Copy a complete key from ${API_KEYS_URL}.`,
		);
	try {
		await new Arex({ apiKey, baseUrl, fetch: context.fetch }).research.get(
			PROBE_RUN_ID,
			{ signal: context.signal },
		);
	} catch (error) {
		if (!(error instanceof NotFoundError)) throw error;
	}
	context.signal?.throwIfAborted();
	await saveConfiguration(path, { apiKey, baseUrl });
	return { path, baseUrl, overridden };
}
