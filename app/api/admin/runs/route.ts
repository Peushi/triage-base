import { getSmokeRuns } from "../../../../lib/smoke-test-history";

export async function GET() {
  try {
    const runs = await getSmokeRuns();
    return Response.json({ runs });
  } catch (error) {
    console.error("Could not load smoke-test history:", error);

    return Response.json(
      { error: "Could not load smoke-test history." },
      { status: 500 },
    );
  }
}
