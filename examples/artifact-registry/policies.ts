import * as Cloudflare from "alchemy/Cloudflare";
import * as p from "../../src/index.ts";

export const policies = p.define({
  preserveArtifacts: p.resource(Cloudflare.R2.Bucket).matches(
    { forceDestroy: p.not(true) },
    { message: "artifact buckets cannot enable forceDestroy" },
  ),

  requireRetention: p.resource(Cloudflare.R2.Bucket).matches(
    {
      lifecycleRules: p.some({
        enabled: p.not(false),
        deleteObjectsTransition: p.present,
      }),
    },
    {
      message: "artifact buckets require an enabled object deletion rule",
    },
  ),

  forbidWildcardCors: p.resource(Cloudflare.R2.Bucket).matches(
    {
      cors: p.not(
        p.some({ allowedOrigins: p.some("*") }),
      ),
    },
    { message: "artifact buckets cannot allow wildcard CORS origins" },
  ),

  requireDataLocality: p.resource(Cloudflare.D1.Database).matches(
    {
      jurisdiction: p.present,
      primaryLocationHint: p.present,
    },
    {
      message: "D1 databases should declare jurisdiction and primary location",
      severity: "warn",
    },
  ),

  requireObservability: p.resource(Cloudflare.Worker).matches(
    {
      observability: {
        enabled: true,
        logs: { enabled: true },
        traces: { enabled: true },
      },
    },
    {
      message: "Workers should enable logs and traces",
      severity: "warn",
    },
  ),

  protectProductionData: p.plan().refine(
    (plan, context) =>
      context.stage !== "prod" ||
      !plan.actions.some(
        (action) =>
          (action.action === "delete" || action.action === "replace") &&
          (action.type === Cloudflare.R2.Bucket.Type ||
            action.type === Cloudflare.D1.Database.Type),
      ),
    { message: "production data resources cannot be deleted or replaced" },
  ),
});
