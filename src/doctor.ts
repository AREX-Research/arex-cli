import {
	Arex,
	ArexApiError,
	ArexNetworkError,
	ArexTimeoutError,
	AuthenticationError,
	CreditsExhaustedError,
	isArexApiKey,
	NotFoundError,
	PermissionDeniedError,
} from "@arex-research/ts-sdk";
import {
	API_KEYS_URL,
	configurationIsPrivate,
	configurationPath,
	endpointMismatchMessage,
	readStoredConfiguration,
	type StoredConfiguration,
} from "./config.js";
import type { CliContext } from "./context.js";
import { DEFAULT_ENDPOINT, normalizeEndpoint } from "./endpoint.js";
import { CliUsageError } from "./errors.js";

export interface DoctorCheck {
	name: string;
	status: "ok" | "warn" | "fail";
	message: string;
}

export interface DoctorReport {
	ok: boolean;
	checks: DoctorCheck[];
	nextSteps: string[];
}

/**
 * Read-only diagnostics. Reports every finding rather than stopping at the
 * first, and only sends a read-only API probe once the local checks pass.
 */
export async function doctor(context: CliContext): Promise<DoctorReport> {
	const checks: DoctorCheck[] = [];
	const nextSteps: string[] = [];
	const report = (check: DoctorCheck, nextStep?: string) => {
		checks.push(check);
		if (nextStep) nextSteps.push(nextStep);
	};
	const environmentKey = context.environment.AREX_API_KEY?.trim();
	const replaceKey = environmentKey
		? "Replace or unset AREX_API_KEY; it overrides saved credentials."
		: "Run arex setup to replace the saved key.";

	const path = configurationPath(context);
	let stored: StoredConfiguration | undefined;
	try {
		stored = await readStoredConfiguration(path);
	} catch (error) {
		if (!(error instanceof CliUsageError)) throw error;
		report(
			{
				name: "configuration",
				status: "fail",
				message: `Cannot safely read the configuration at ${path}.`,
			},
			`Remove or repair ${path}, then run arex setup.`,
		);
	}
	if (stored?.state === "missing")
		report({
			name: "configuration",
			status: "ok",
			message: `No saved configuration at ${path}.`,
		});
	if (stored?.state === "invalid")
		report(
			{
				name: "configuration",
				status: "fail",
				message: `The configuration at ${path} is unusable: ${stored.reason}.`,
			},
			"Run arex setup to replace it.",
		);
	if (stored?.state === "valid")
		report({
			name: "configuration",
			status: "ok",
			message: `Configuration found at ${path}.`,
		});
	if (stored !== undefined && stored.state !== "missing") {
		const isPrivate = await configurationIsPrivate(path).catch((error) => {
			if (error instanceof CliUsageError) return undefined;
			throw error;
		});
		report(
			{
				name: "permissions",
				status: isPrivate ? "ok" : "fail",
				message:
					isPrivate === undefined
						? "Could not inspect who can access the configuration."
						: isPrivate
							? "Configuration access is restricted to its owner."
							: "Configuration file or directory is accessible to other users, or is not owned by you.",
			},
			isPrivate
				? undefined
				: process.platform === "win32"
					? "Run arex setup to restrict the configuration directory and file ACLs to your Windows user account."
					: "Restrict the configuration directory to mode 0700 and its file to mode 0600, owned by your user, or rerun arex setup.",
		);
	}

	const requestedEndpoint = context.environment.AREX_BASE_URL?.trim();
	const endpoint = requestedEndpoint
		? normalizeEndpoint(requestedEndpoint)
		: DEFAULT_ENDPOINT;
	if (endpoint === undefined)
		report(
			{
				name: "endpoint",
				status: "fail",
				message:
					"AREX_BASE_URL is not an HTTPS URL without credentials, query, or fragment. Plain HTTP is allowed only for localhost.",
			},
			"Unset AREX_BASE_URL to use the official endpoint, or set a valid HTTPS endpoint.",
		);
	else
		report({
			name: "endpoint",
			status: endpoint.startsWith("http:") ? "warn" : "ok",
			message: endpoint.startsWith("http:")
				? `API endpoint: ${endpoint}. Plain HTTP on localhost is for local development only.`
				: `API endpoint: ${endpoint}.`,
		});

	let apiKey: string | undefined;
	if (environmentKey) {
		apiKey = environmentKey;
		report({
			name: "credentials",
			status: "ok",
			message:
				"Using AREX_API_KEY from the environment; it takes precedence over saved configuration.",
		});
	} else if (
		stored?.state === "valid" &&
		endpoint !== undefined &&
		stored.baseUrl !== endpoint
	) {
		report(
			{
				name: "credentials",
				status: "fail",
				message: endpointMismatchMessage(stored.baseUrl, endpoint),
			},
			"Unset AREX_BASE_URL, set AREX_API_KEY for that endpoint, or run arex setup with AREX_BASE_URL set.",
		);
	} else if (stored?.state === "valid") {
		apiKey = stored.apiKey;
		report({
			name: "credentials",
			status: "ok",
			message: "Using the saved API key.",
		});
	} else {
		report(
			{
				name: "credentials",
				status: "fail",
				message: "No API key is configured.",
			},
			`Create an API key at ${API_KEYS_URL}, then run arex setup or set AREX_API_KEY securely in your environment.`,
		);
	}
	if (apiKey !== undefined && !isArexApiKey(apiKey)) {
		report(
			{
				name: "key-format",
				status: "fail",
				message:
					"The effective API key does not have the required AREX key format.",
			},
			`Create or copy a complete key at ${API_KEYS_URL}. ${replaceKey}`,
		);
		apiKey = undefined;
	}

	if (apiKey !== undefined && endpoint !== undefined) {
		context.signal?.throwIfAborted();
		try {
			try {
				await new Arex({
					apiKey,
					baseUrl: endpoint,
					fetch: context.fetch,
				}).research.get("00000000-0000-4000-8000-000000000000", {
					signal: context.signal,
				});
			} catch (error) {
				if (!(error instanceof NotFoundError)) throw error;
			}
			report({
				name: "access",
				status: "ok",
				message: "The endpoint accepted this key.",
			});
		} catch (error) {
			context.signal?.throwIfAborted();
			report(...accessFailure(error, replaceKey));
		}
	}
	return {
		ok: checks.every((check) => check.status !== "fail"),
		checks,
		nextSteps,
	};
}

function accessFailure(
	error: unknown,
	replaceKey: string,
): [DoctorCheck, string] {
	if (error instanceof AuthenticationError)
		return [
			{
				name: "authentication",
				status: "fail",
				message: "The endpoint rejected the effective API key.",
			},
			`Create or check your key at ${API_KEYS_URL}. ${replaceKey}`,
		];
	if (error instanceof PermissionDeniedError)
		return [
			{
				name: "access",
				status: "fail",
				message: "The endpoint denied account access.",
			},
			"Check account permissions and the selected API endpoint.",
		];
	if (error instanceof CreditsExhaustedError)
		return [
			{
				name: "access",
				status: "fail",
				message: "The endpoint reported that the usage allowance is exhausted.",
			},
			"Wait for the usage window to reset.",
		];
	if (error instanceof ArexNetworkError || error instanceof ArexTimeoutError)
		return [
			{
				name: "connectivity",
				status: "fail",
				message: "The diagnostic request did not receive a usable response.",
			},
			"Check your connection and AREX_BASE_URL, then rerun arex doctor.",
		];
	if (error instanceof ArexApiError)
		return [
			{
				name: "access",
				status: "fail",
				message: `The endpoint returned HTTP ${error.status}.`,
			},
			"Check service availability and account access, then rerun arex doctor.",
		];
	throw error;
}
