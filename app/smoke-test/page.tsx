
"use client";

import { useState, type FormEvent } from "react";

type Dataset = "labelled" | "unlabelled";

type Prediction = {
  category: string;
  priority: string;
  summary: string;
  suggested_action: string;
};

type TestResult = {
  ticketId: string;
  subject: string;
  prediction: Prediction;
  expected: {
    category: string;
    priority: string;
  } | null;
  categoryMatch: boolean | null;
  priorityMatch: boolean | null;
  latencyMs: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

type SmokeTestResponse = {
  mode: string;
  dataset: Dataset;
  sampleSize: number;
  accuracy: {
    category: number | null;
    priority: number | null;
  };
  results: TestResult[];
  note: string;
};

export default function SmokeTestPage() {
  const [dataset, setDataset] = useState<Dataset>("labelled");
  const [sampleSize, setSampleSize] = useState("5");
  const [result, setResult] = useState<SmokeTestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  async function runSmokeTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const size = Number(sampleSize);

    if (!Number.isInteger(size) || size < 1 || size > 500) {
      setError("Enter a whole number between 1 and 500.");
      return;
    }

    if (dataset === "labelled" && size > 100) {
      setError("The labelled dataset contains only 100 tickets.");
      return;
    }

    setIsRunning(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/smoke-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset,
          sampleSize: size,
        }),
      });

      const data: unknown = await response.json();

      if (!response.ok) {
        const message =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : "The smoke test failed.";
        throw new Error(message);
      }

      if (
        typeof data !== "object" ||
        data === null ||
        !("results" in data) ||
        !Array.isArray(data.results) ||
        !("accuracy" in data) ||
        !("note" in data) ||
        typeof data.note !== "string"
      ) {
        throw new Error("The server returned an invalid smoke test result.");
      }

      setResult(data as SmokeTestResponse);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to run the smoke test.",
      );
    } finally {
      setIsRunning(false);
    }
  }

  function formatAccuracy(value: number | null) {
    return value === null ? "N/A" : `${(value * 100).toFixed(1)}%`;
  }

  const totalTokens =
    result?.results.reduce(
      (total, item) => total + item.usage.totalTokens,
      0,
    ) ?? 0;

  const categoryMismatches =
    result?.results.filter((item) => item.categoryMatch === false).length ?? 0;

  const priorityMismatches =
    result?.results.filter((item) => item.priorityMatch === false).length ?? 0;

  return (
    <main className="smoke-page">
      <nav className="page-nav" aria-label="Main navigation">
        <a href="/">Support Chat</a>
        <a href="/smoke-test" aria-current="page">
          Smoke Tests
        </a>
        <a href="/admin">Admin</a>
      </nav>

      <header className="page-header">
        <p className="eyebrow">EVALUATION WORKSPACE</p>
        <h1>Smoke Test Runner</h1>
        <p>
          Evaluate support-ticket classification using a random sample from
          your datasets.
        </p>
      </header>

      <section className="panel">
        <h2>Configure a test</h2>

        <form onSubmit={runSmokeTest} className="smoke-form">
          <div className="field">
            <label htmlFor="dataset">Dataset</label>
            <select
              id="dataset"
              value={dataset}
              onChange={(event) => {
                setDataset(event.target.value as Dataset);
                setResult(null);
                setError(null);
              }}
              disabled={isRunning}
            >
              <option value="labelled">
                100 labelled tickets — accuracy evaluation
              </option>
              <option value="unlabelled">
                500 unlabelled tickets — prediction testing
              </option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="sampleSize">Random sample size</label>
            <input
              id="sampleSize"
              type="number"
              min="1"
              max={dataset === "labelled" ? "100" : "500"}
              value={sampleSize}
              onChange={(event) => setSampleSize(event.target.value)}
              required
              disabled={isRunning}
            />
            <small>
              Maximum: {dataset === "labelled" ? 100 : 500} tickets
            </small>
          </div>

          <button type="submit" disabled={isRunning}>
            {isRunning ? "Running test..." : "Run smoke test"}
          </button>

          {error && <p className="error-message" role="alert">{error}</p>}
        </form>
      </section>

      {result && (
        <>
          <section className="notice" aria-live="polite">
            <strong>Mode: {result.mode.toUpperCase()}</strong>
            <p>{result.note}</p>
          </section>

          <section className="metrics-grid" aria-label="Test summary">
            <article className="metric-card">
              <span>Tickets tested</span>
              <strong>{result.sampleSize}</strong>
            </article>
            <article className="metric-card">
              <span>Category accuracy</span>
              <strong>{formatAccuracy(result.accuracy.category)}</strong>
            </article>
            <article className="metric-card">
              <span>Priority accuracy</span>
              <strong>{formatAccuracy(result.accuracy.priority)}</strong>
            </article>
            <article className="metric-card">
              <span>Total reported tokens</span>
              <strong>{totalTokens}</strong>
            </article>
          </section>

          {result.dataset === "labelled" && (
            <section className="panel">
              <h2>Mismatch summary</h2>
              <div className="mismatch-grid">
                <p>
                  Category mismatches: <strong>{categoryMismatches}</strong>
                </p>
                <p>
                  Priority mismatches: <strong>{priorityMismatches}</strong>
                </p>
              </div>
            </section>
          )}

          <section className="panel">
            <h2>Individual results</h2>
            <p className="table-description">
              Review each prediction against its expected labels, when
              available.
            </p>

            <div className="table-wrapper">
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Subject</th>
                    <th>Predicted category</th>
                    <th>Expected category</th>
                    <th>Predicted priority</th>
                    <th>Expected priority</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((item) => (
                    <tr key={item.ticketId}>
                      <td>{item.ticketId}</td>
                      <td>{item.subject}</td>
                      <td>{item.prediction.category}</td>
                      <td>{item.expected?.category ?? "—"}</td>
                      <td>{item.prediction.priority}</td>
                      <td>{item.expected?.priority ?? "—"}</td>
                      <td>
                        {item.expected === null ? (
                          <span className="status-neutral">Unlabelled</span>
                        ) : item.categoryMatch && item.priorityMatch ? (
                          <span className="status-good">Both match</span>
                        ) : (
                          <span className="status-bad">Mismatch</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
