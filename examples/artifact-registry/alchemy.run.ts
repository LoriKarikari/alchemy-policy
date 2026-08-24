import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

export const Artifacts = Cloudflare.R2.Bucket("Artifacts", {
  forceDestroy: false,
  locationHint: "weur",
  lifecycleRules: [
    {
      id: "delete-after-30-days",
      deleteObjectsTransition: {
        condition: { type: "Age", maxAge: 30 * 24 * 60 * 60 },
      },
    },
  ],
  cors: [
    {
      allowedMethods: ["GET"],
      allowedOrigins: ["*"],
    },
  ],
});

export const Metadata = Cloudflare.D1.Database("Metadata", {
  migrations: "./examples/artifact-registry/migrations",
});

export const RegistryWorker = Cloudflare.Worker("Registry", {
  main: "./examples/artifact-registry/src/worker.ts",
  compatibility: {
    date: "2026-08-24",
    flags: ["nodejs_compat"],
  },
  observability: {
    enabled: true,
    logs: { enabled: true, invocationLogs: true, headSamplingRate: 1 },
  },
  env: {
    ARTIFACTS: Artifacts,
    DB: Metadata,
    ARTIFACT_TOKEN: Config.redacted("ARTIFACT_TOKEN").pipe(
      Config.withDefault(Redacted.make("insecure-example-token")),
    ),
  },
});

export type WorkerEnv = Cloudflare.InferEnv<typeof RegistryWorker>;

export default Alchemy.Stack(
  "ArtifactRegistry",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const artifacts = yield* Artifacts;
    const metadata = yield* Metadata;
    const worker = yield* RegistryWorker;

    return {
      url: worker.url.as<string>(),
      bucketName: artifacts.bucketName,
      databaseName: metadata.databaseName,
    };
  }),
);
