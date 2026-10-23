
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export type SmokeRun = {
  runId: string;
  createdAt: string;
  dataset: "labelled" | "unlabelled";
  sampleSize: number;
  categoryAccuracy: number | null;
  priorityAccuracy: number | null;
  categoryMismatches: number | null;
  priorityMismatches: number | null;
  categoryCounts: {
  billing: number;
  technical_bug: number;
  account: number;
  feature_request: number;
  };
  priorityCounts: {
  low: number;
  medium: number;
  high: number;
 };
  averageLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  model: string;
  strategy: "mock" | "llm" | "dm" | "dm+llm";
  mode: "mock" | "live";
};

const historyPath = path.join(
  process.cwd(),
  "data",
  "smoke-test-runs.jsonl",
);

export async function saveSmokeRun(run: SmokeRun): Promise<void> {
  await mkdir(path.dirname(historyPath), { recursive: true });

  await appendFile(
    historyPath,
    `${JSON.stringify(run)}\n`,
    "utf8",
  );
}

export async function getSmokeRuns(): Promise<SmokeRun[]> {
  try {
    const contents = await readFile(historyPath, "utf8");

    return contents
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as SmokeRun)
      .reverse();
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }

    throw error;
  }
}
