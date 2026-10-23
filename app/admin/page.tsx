
"use client";

import { useEffect, useState } from "react";

type Run = {
  runId: string;
  createdAt: string;
  dataset: "labelled" | "unlabelled";
  sampleSize: number;
  categoryAccuracy: number | null;
  priorityAccuracy: number | null;
  categoryMismatches: number | null;
  priorityMismatches: number | null;
  categoryCounts: Record<string, number>;
  priorityCounts: Record<string, number>;
  averageLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  model: string;
  strategy: string;
  mode: string;
};

export default function AdminPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadRuns() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/runs");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to load history.");
      }

      setRuns(data.runs);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load history.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRuns();
  }, []);

  const labelledRuns = runs.filter((run) => run.categoryAccuracy !== null);

  return (
    <main className="smoke-page">
      <nav className="page-nav">
        <a href="/">Support Chat</a>
        <a href="/smoke-test">Smoke Tests</a>
        <a href="/admin" aria-current="page">Admin</a>
      </nav>

      <header className="page-header">
        <p className="eyebrow">ADMINISTRATION</p>
        <h1>Smoke Test History</h1>
        <p>Review previous test runs and their evaluation metrics.</p>
      </header>

      <div className="metrics-grid">
        <article className="metric-card">
          <span>Total runs</span>
          <strong>{runs.length}</strong>
        </article>
        <article className="metric-card">
          <span>Labelled runs</span>
          <strong>{labelledRuns.length}</strong>
        </article>
        <article className="metric-card">
          <span>Tickets tested</span>
          <strong>
            {runs.reduce((sum, run) => sum + run.sampleSize, 0)}
          </strong>
        </article>
        <article className="metric-card">
          <span>Recorded tokens</span>
          <strong>
            {runs.reduce((sum, run) => sum + run.totalTokens, 0)}
          </strong>
        </article>
      </div>

      <section className="panel">
        <div className="mismatch-grid">
          <h2>Previous runs</h2>
          <button onClick={() => void loadRuns()} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {error && <p className="error-message">{error}</p>}
        {loading && <p>Loading run history...</p>}

        {!loading && !error && runs.length === 0 && (
          <p>No runs recorded yet. Run a smoke test first.</p>
        )}

        {!loading && runs.length > 0 && (
          <div className="table-wrapper">
            <table className="results-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Dataset</th>
                  <th>Sample</th>
                  <th>Category accuracy</th>
                  <th>Priority accuracy</th>
                  <th>Category mismatches</th>
                  <th>Priority mismatches</th>
                  <th>Avg latency</th>
                  <th>Tokens</th>
                  <th>Cost (USD)</th>
                  <th>Model</th>
                  <th>Strategy</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.runId}>
                    <td>{new Date(run.createdAt).toLocaleString()}</td>
                    <td>{run.dataset}</td>
                    <td>{run.sampleSize}</td>
                    <td>
                      {run.categoryAccuracy === null
                        ? "N/A"
                        : `${(run.categoryAccuracy * 100).toFixed(1)}%`}
                    </td>
                    <td>
                      {run.priorityAccuracy === null
                        ? "N/A"
                        : `${(run.priorityAccuracy * 100).toFixed(1)}%`}
                    </td>
                    <td>{run.categoryMismatches ?? "N/A"}</td>
                    <td>{run.priorityMismatches ?? "N/A"}</td>
                    <td>{run.averageLatencyMs} ms</td>
                    <td>{run.totalTokens}</td>
                    <td>
                      {run.estimatedCostUsd === null
                        ? "N/A (mock)"
                        : `$${run.estimatedCostUsd.toFixed(6)}`}
                    </td>
                    <td>{run.model}</td>
                    <td>{run.strategy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {runs.length > 0 && (
        <section className="panel">
          <h2>Prediction outcome counts</h2>
          {runs.slice(0, 5).map((run) => (
            <div key={run.runId}>
              <h3>
                {new Date(run.createdAt).toLocaleString()} — {run.strategy}
              </h3>
              <p>
                Categories:{" "}
                {Object.entries(run.categoryCounts)
                  .map(([key, value]) => `${key}: ${value}`)
                  .join(" · ")}
              </p>
              <p>
                Priorities:{" "}
                {Object.entries(run.priorityCounts)
                  .map(([key, value]) => `${key}: ${value}`)
                  .join(" · ")}
              </p>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
