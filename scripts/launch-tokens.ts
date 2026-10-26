import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { fetchLaunches, readLaunchPage } from "../src/launch-api";
import type { LaunchRecord } from "../src/launch-api";
import {
  emptyLaunchTokenDocument,
  existingTokenSources,
  launchJobConfig,
  planLaunchTokens,
  serializeLaunchTokenDocument,
  validateLaunchTokenDocument,
  type LaunchJobConfig,
} from "../src/launch-tokens";
import { validateTokenListSchema } from "../src/schema";
import {
  CURATED_SOURCE,
  LAUNCH_CHAIN_IDS,
  LAUNCH_SOURCE,
} from "../src/sources";
import type { TokenProvenance } from "../src/types";

// Records listable zero-seed launch tokens in launch-tokens.json, which the
// token-list update reads as its lowest-precedence source. A dry run (the
// default) prints what would change and writes nothing but an optional
// candidate file; --write updates launch-tokens.json.

const { values: options } = parseArgs({
  options: {
    write: { type: "boolean", default: false },
    fixture: { type: "string" },
    candidate: { type: "string" },
    report: { type: "string" },
    root: { type: "string" },
  },
  strict: true,
});
const root = resolve(options.root ?? resolve(import.meta.dir, ".."));

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(resolve(root, path), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function envList(name: string): string[] | undefined {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") return undefined;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function readLaunches(config: LaunchJobConfig): Promise<LaunchRecord[]> {
  if (options.fixture) {
    const text = await readFile(resolve(options.fixture), "utf8");
    return readLaunchPage(JSON.parse(text)).launches;
  }
  const baseUrl = process.env.EKUBO_LAUNCH_API_URL?.trim();
  if (!baseUrl) {
    throw new Error(
      "EKUBO_LAUNCH_API_URL is required (or pass --fixture <launch-list.json>)",
    );
  }
  return fetchLaunches({ baseUrl, chainIds: [...config.chainIds] });
}

async function readExisting(): Promise<Map<string, string>> {
  const curated = JSON.parse(
    (await readText(CURATED_SOURCE.url)) ?? "null",
  ) as unknown;
  validateTokenListSchema(curated, CURATED_SOURCE.url);
  const provenance = JSON.parse(
    (await readText("token-sources.json")) ?? "[]",
  ) as TokenProvenance[];
  return existingTokenSources(curated.tokens, provenance);
}

async function publish(
  next: string,
  changed: boolean,
  tokenCount: number,
): Promise<void> {
  if (options.write) {
    if (changed) await writeFile(resolve(root, LAUNCH_SOURCE.url), next);
    console.warn(
      changed
        ? `Wrote ${tokenCount} tokens to ${LAUNCH_SOURCE.url}`
        : `${LAUNCH_SOURCE.url} is already current`,
    );
    return;
  }
  if (options.candidate) await writeFile(resolve(options.candidate), next);
  console.warn(
    `Dry run: ${LAUNCH_SOURCE.url} was not modified${changed ? " (it would change; rerun with --write)" : " and is already current"}`,
  );
}

async function main(): Promise<void> {
  const config = launchJobConfig(
    envList("EKUBO_LAUNCH_CHAIN_IDS") ?? LAUNCH_CHAIN_IDS,
  );
  if (config.chainIds.size === 0) {
    console.warn(
      "No launch chains are enabled (LAUNCH_CHAIN_IDS is empty and EKUBO_LAUNCH_CHAIN_IDS is unset); nothing to do",
    );
    return;
  }

  const recordedText = await readText(LAUNCH_SOURCE.url);
  const recorded =
    recordedText === null
      ? emptyLaunchTokenDocument()
      : (JSON.parse(recordedText) as unknown);
  validateLaunchTokenDocument(recorded);

  const plan = planLaunchTokens({
    launches: await readLaunches(config),
    recorded,
    existing: await readExisting(),
    config,
  });
  const next = serializeLaunchTokenDocument(plan.document);
  const changed = next !== recordedText;
  const report = `${JSON.stringify(plan.report, null, 2)}\n`;

  if (options.report) await writeFile(resolve(options.report), report);
  else process.stdout.write(report);

  const { added, unchanged, skipped, rejected, logo_rejected } = plan.report;
  console.warn(
    `Launch tokens: ${added.length} to add, ${unchanged.length} unchanged, ${skipped.length} skipped, ${rejected.length} rejected, ${logo_rejected.length} logos dropped`,
  );

  await publish(next, changed, plan.document.tokens.length);
}

main().catch((error) => {
  console.error("Launch-token job failed", error);
  process.exitCode = 1;
});
