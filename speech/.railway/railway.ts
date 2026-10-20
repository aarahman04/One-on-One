// Railway Infrastructure as Code for the private `speech` service only (docs/SPEECH-SERVICE.md).
// A named partial: `railway config plan|apply` from speech/ manages this one service and never
// touches the backend or anything else in the environment. Plan first; apply only after review.
//
// Not expressible here (set in the dashboard, see the doc): Serverless (sleep when idle),
// replica CPU/memory limits, no public domain, and the SPEECH_SERVICE_TOKEN secret value.
import { defineRailway, github, preserve, project, service } from "railway/iac";

export const partial = "speech";

export default defineRailway((ctx) => {
  if (!ctx.projectName) throw new Error("Run `railway link` (project + environment) before planning.");
  const projectName = ctx.projectName
  const speech = service("speech", {
    source: github("aarahman04/One-on-One", { rootDirectory: "speech" }),
    healthcheck: "/health",
    healthcheckTimeout: 120,
    replicas: 1,
    env: {
      SPEECH_SERVICE_TOKEN: preserve(),
      PORT: "8000",
      SPEECH_NUM_THREADS: "2",
      SPEECH_MAX_CONCURRENCY: "1",
      SPEECH_MODEL_TTL: "120",
    },
  });
  // The linked project (railway link), so this file never renames it.
  return project(projectName, { resources: [speech] });
});
