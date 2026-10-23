import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	chmod,
	type FileHandle,
	lstat,
	mkdir,
	open,
	rename,
	unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { isArexApiKey } from "@arex-research/ts-sdk";
import type { CliContext } from "./context.js";
import {
	configuredEndpoint,
	DEFAULT_ENDPOINT,
	normalizeEndpoint,
} from "./endpoint.js";
import { CliUsageError } from "./errors.js";
import { windowsCredentialPermissions } from "./permissions.js";

export const API_KEYS_URL = "https://arex-research.com/platform/console/keys";

/** The key to send and the only endpoint it may be sent to. */
export interface Credentials {
	apiKey: string;
	baseUrl: string;
	source: "environment" | "configuration";
}

/**
 * The saved configuration file. A saved key is bound to the endpoint it was
 * verified against (`baseUrl`, the official API when absent in the file), so
 * changing `AREX_BASE_URL` can never redirect it elsewhere.
 */
export type StoredConfiguration =
	| { state: "missing" }
	| { state: "invalid"; reason: string }
	| { state: "valid"; apiKey: string; baseUrl: string };

export function configurationPath(
	context: Pick<CliContext, "environment" | "home">,
): string {
	const root = context.environment.XDG_CONFIG_HOME;
	return join(
		root && isAbsolute(root) ? root : join(context.home, ".config"),
		"arex",
		"config.json",
	);
}

/** An unsafe configuration path; setup refuses to write there too. */
function configurationError(path: string, reason: string): CliUsageError {
	return new CliUsageError(
		`Cannot use configuration at ${path}: ${reason}. Remove or repair it, then run arex setup.`,
	);
}

export function endpointMismatchMessage(
	saved: string,
	requested: string,
): string {
	return `The saved API key is only sent to ${saved}, but AREX_BASE_URL selects ${requested}. Set AREX_API_KEY for that endpoint, or run arex setup with AREX_BASE_URL set to save a key for it.`;
}

/** The effective credentials: `AREX_API_KEY` first, then the saved key. */
export async function resolveCredentials(
	context: CliContext,
): Promise<Credentials> {
	const endpoint = configuredEndpoint(context.environment);
	const environmentKey = context.environment.AREX_API_KEY?.trim();
	let credentials: Credentials;
	if (environmentKey) {
		credentials = {
			apiKey: environmentKey,
			baseUrl: endpoint,
			source: "environment",
		};
	} else {
		const path = configurationPath(context);
		const stored = await readStoredConfiguration(path);
		if (stored.state === "missing")
			throw new CliUsageError(
				`Run arex setup to configure your API key.\nCreate a key: ${API_KEYS_URL}`,
			);
		if (stored.state === "invalid")
			throw new CliUsageError(
				`Cannot use configuration at ${path}: ${stored.reason}. Run arex setup to replace it.`,
			);
		if (stored.baseUrl !== endpoint)
			throw new CliUsageError(
				endpointMismatchMessage(stored.baseUrl, endpoint),
			);
		credentials = {
			apiKey: stored.apiKey,
			baseUrl: stored.baseUrl,
			source: "configuration",
		};
	}
	if (!isArexApiKey(credentials.apiKey))
		throw new CliUsageError(
			`The ${credentials.source === "environment" ? "AREX_API_KEY environment variable" : "saved API key"} is not a valid AREX API key. Run arex setup or replace the environment override.`,
		);
	return credentials;
}

/**
 * Reads the saved configuration without following symlinks. Unsafe paths
 * throw; unusable content is reported as `invalid` so setup can replace it.
 */
export async function readStoredConfiguration(
	path: string,
): Promise<StoredConfiguration> {
	let handle: FileHandle | undefined;
	try {
		const directory = await lstat(dirname(path));
		if (directory.isSymbolicLink() || !directory.isDirectory())
			throw configurationError(
				path,
				"the configuration directory must be a real directory, not a symlink",
			);
		if (!(await lstat(path)).isFile())
			throw configurationError(path, "expected a regular file, not a symlink");
		// O_NOFOLLOW and the second check close the race with the lstat above;
		// O_NONBLOCK keeps a FIFO swapped in from blocking the read.
		handle = await open(
			path,
			constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
		);
		const file = await handle.stat();
		if (!file.isFile())
			throw configurationError(path, "expected a regular file");
		const content = parseConfiguration(await handle.readFile("utf8"));
		return "reason" in content
			? { state: "invalid", reason: content.reason }
			: { state: "valid", ...content };
	} catch (error) {
		if (isFilesystemError(error)) {
			if (error.code === "ENOENT") return { state: "missing" };
			if (["EACCES", "EPERM", "ELOOP", "ENOTDIR"].includes(error.code ?? ""))
				throw configurationError(
					path,
					"access denied or an unsafe filesystem path",
				);
		}
		throw error;
	} finally {
		await handle?.close();
	}
}

function parseConfiguration(
	text: string,
): { apiKey: string; baseUrl: string } | { reason: string } {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return { reason: "invalid JSON" };
	}
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		!("apiKey" in value) ||
		typeof value.apiKey !== "string" ||
		!value.apiKey.trim()
	)
		return { reason: "expected an object with a nonempty apiKey string" };
	const apiKey = value.apiKey.trim();
	if (!("baseUrl" in value)) return { apiKey, baseUrl: DEFAULT_ENDPOINT };
	const baseUrl =
		typeof value.baseUrl === "string"
			? normalizeEndpoint(value.baseUrl)
			: undefined;
	return baseUrl
		? { apiKey, baseUrl }
		: { reason: "baseUrl must be an HTTPS endpoint" };
}

/**
 * Whether only the current user can reach the configuration file and its
 * directory. Separate from reading because on Windows it starts PowerShell,
 * which is too slow to pay on every command; doctor reports it instead.
 */
export async function configurationIsPrivate(path: string): Promise<boolean> {
	if (process.platform === "win32")
		return windowsCredentialPermissions([dirname(path), path]);
	const [file, directory] = await Promise.all([
		lstat(path),
		lstat(dirname(path)),
	]);
	const owned =
		typeof process.getuid !== "function" ||
		(file.uid === process.getuid() && directory.uid === process.getuid());
	return owned && (file.mode & 0o077) === 0 && (directory.mode & 0o077) === 0;
}

/** Atomically writes owner-only configuration, refusing symlinks and foreign files. */
export async function saveConfiguration(
	path: string,
	credentials: { apiKey: string; baseUrl: string },
): Promise<void> {
	const directory = dirname(path);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const stat = await lstat(directory);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		(typeof process.getuid === "function" && stat.uid !== process.getuid())
	)
		throw configurationError(
			path,
			"the configuration directory is not a directory owned by you",
		);
	try {
		const existing = await lstat(path);
		if (
			!existing.isFile() ||
			(typeof process.getuid === "function" &&
				existing.uid !== process.getuid())
		)
			throw configurationError(
				path,
				"refusing to replace a symlink or a file not owned by you",
			);
	} catch (error) {
		if (!isFilesystemError(error) || error.code !== "ENOENT") throw error;
	}
	if (process.platform === "win32")
		await windowsCredentialPermissions([directory], "directory");
	else await chmod(directory, 0o700);

	// The official endpoint stays implicit so a future default follows the SDK.
	const content =
		credentials.baseUrl === DEFAULT_ENDPOINT
			? { apiKey: credentials.apiKey }
			: credentials;
	const temporary = join(directory, `.config-${randomUUID()}.tmp`);
	const handle = await open(
		temporary,
		constants.O_WRONLY |
			constants.O_CREAT |
			constants.O_EXCL |
			constants.O_NOFOLLOW,
		0o600,
	);
	try {
		if (process.platform === "win32")
			await windowsCredentialPermissions([temporary], "file");
		await handle.writeFile(`${JSON.stringify(content)}\n`, "utf8");
		await handle.sync();
		await handle.close();
		await rename(temporary, path);
	} finally {
		await handle.close();
		await unlink(temporary).catch((error: unknown) => {
			if (!isFilesystemError(error) || error.code !== "ENOENT") throw error;
		});
	}
}

function isFilesystemError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
