import * as Cloudflare from "alchemy/Cloudflare";
import type { PlanLike } from "../../src/index.ts";

export const unsafeBucketPlan = {
  resources: {
    "ArtifactRegistry/dev/Artifacts": {
      action: "create",
      resource: { Type: Cloudflare.R2.Bucket.Type },
      props: {
        forceDestroy: true,
        cors: [{ allowedMethods: ["GET"], allowedOrigins: ["*"] }],
      },
    },
  },
  deletions: {},
} satisfies PlanLike;

export const productionDeletePlan = {
  resources: {},
  deletions: {
    "ArtifactRegistry/prod/Metadata": {
      action: "delete",
      resource: { Type: Cloudflare.D1.Database.Type },
    },
  },
} satisfies PlanLike;
