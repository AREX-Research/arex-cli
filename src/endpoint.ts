import { DEFAULT_BASE_URL } from "@arex-research/ts-sdk";
import { CliUsageError } from "./errors.js";

/**
 * The canonical form of an API endpoint, or `undefined` when an API key must
 * not be sent there. Plain HTTP is accepted only on loopback, for local
 * development, so a key never crosses a network unencrypted.
 */
export function normalizeEndpoint(value: string): string | undefined {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return undefined;
	}
	const loopback =
		url.hostname === "localhost" ||
		url.hostname === "[::1]" ||
		/^127(?:\.\d{1,3}){3}$/.test(url.hostname);
	if (
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		!(url.protocol === "https:" || (url.protocol === "http:" && loopback))
	)
		return undefined;
	return url.href.replace(/\/+$/, "");
}

export const DEFAULT_ENDPOINT = normalizeEndpoint(DEFAULT_BASE_URL) as string;

/** The endpoint selected by `AREX_BASE_URL`, or the official API. */
export function configuredEndpoint(environment: NodeJS.ProcessEnv): string {
	const value = environment.AREX_BASE_URL?.trim();
	if (!value) return DEFAULT_ENDPOINT;
	const endpoint = normalizeEndpoint(value);
	if (!endpoint)
		throw new CliUsageError(
			"AREX_BASE_URL must be an HTTPS URL without credentials, query, or fragment. Plain HTTP is allowed only for localhost.",
		);
	return endpoint;
}
