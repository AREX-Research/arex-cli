import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
	configurationPath,
	resolveCredentials,
	saveConfiguration,
} from "../src/config.js";
import type { CliContext } from "../src/context.js";

const API_KEY = `sk_arex_${"a".repeat(32)}`;
const REPLACEMENT_KEY = `sk_arex_${"b".repeat(32)}`;
const OFFICIAL = "https://api.arex-research.com";
const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function fixture(): Promise<CliContext> {
	const home = await mkdtemp(join(tmpdir(), "arex-config-"));
	roots.push(home);
	return {
		home,
		cwd: home,
		environment: {},
		input: Readable.from([]),
		io: { stdout: { write() {} }, stderr: { write() {} } },
	};
}

describe("credential configuration", () => {
	it("uses an explicit environment key even when saved JSON is malformed", async () => {
		const context = await fixture();
		const path = configurationPath(context);
		await mkdir(join(context.home, ".config", "arex"), { recursive: true });
		await writeFile(path, '{"apiKey":"secret-fragment"');
		context.environment.AREX_API_KEY = API_KEY;
		expect(await resolveCredentials(context)).toMatchObject({
			apiKey: API_KEY,
			source: "environment",
		});
		delete context.environment.AREX_API_KEY;
		await expect(resolveCredentials(context)).rejects.toThrow("invalid JSON");
		await expect(resolveCredentials(context)).rejects.not.toThrow(
			"secret-fragment",
		);
	});

	it("saves replacement credentials privately at the XDG path", async () => {
		const context = await fixture();
		context.environment.XDG_CONFIG_HOME = join(context.home, "custom");
		const path = configurationPath(context);
		await saveConfiguration(path, { apiKey: API_KEY, baseUrl: OFFICIAL });
		await saveConfiguration(path, {
			apiKey: REPLACEMENT_KEY,
			baseUrl: OFFICIAL,
		});
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
			apiKey: REPLACEMENT_KEY,
		});
		expect(await resolveCredentials(context)).toMatchObject({
			apiKey: REPLACEMENT_KEY,
			baseUrl: OFFICIAL,
			source: "configuration",
		});
		if (process.platform !== "win32") {
			expect((await stat(path)).mode & 0o777).toBe(0o600);
			expect(
				(await stat(join(context.home, "custom", "arex"))).mode & 0o777,
			).toBe(0o700);
		}
	});

	it("binds a key saved for a local endpoint to that endpoint", async () => {
		const context = await fixture();
		const path = configurationPath(context);
		await saveConfiguration(path, {
			apiKey: API_KEY,
			baseUrl: "http://localhost:8080/api",
		});
		await expect(resolveCredentials(context)).rejects.toThrow("only sent to");
		context.environment.AREX_BASE_URL = "http://localhost:8080/api/";
		expect(await resolveCredentials(context)).toMatchObject({
			apiKey: API_KEY,
			baseUrl: "http://localhost:8080/api",
		});
	});

	it("refuses symlink reads and writes without changing the target", async () => {
		const context = await fixture();
		const target = join(context.home, "target.json");
		const contents = JSON.stringify({ apiKey: API_KEY });
		await writeFile(target, contents);
		await mkdir(join(context.home, ".config", "arex"), { recursive: true });
		await symlink(target, configurationPath(context));
		await expect(resolveCredentials(context)).rejects.toThrow();
		await expect(
			saveConfiguration(configurationPath(context), {
				apiKey: REPLACEMENT_KEY,
				baseUrl: OFFICIAL,
			}),
		).rejects.toThrow();
		expect(await readFile(target, "utf8")).toBe(contents);
	});
});
