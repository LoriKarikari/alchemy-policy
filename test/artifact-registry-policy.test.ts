import { expect, test } from "bun:test";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import {
  Artifacts,
  Metadata,
  RegistryWorker,
} from "../examples/artifact-registry/alchemy.run.ts";
import { policies } from "../examples/artifact-registry/policies.ts";
import { productionDeletePlan, unsafeBucketPlan } from "./fixtures/unsafe.ts";

test("unsafe bucket is rejected", () => {
  const violations = policies.evaluate(unsafeBucketPlan, { stage: "dev" });
  expect(violations.map((violation) => violation.policy).sort()).toEqual([
    "forbidWildcardCors",
    "preserveArtifacts",
    "requireRetention",
  ]);
  expect(() =>
    Effect.runSync(policies.assert(unsafeBucketPlan, { stage: "dev" })),
  ).toThrow();
});

test("production data deletion is rejected", () => {
  expect(() =>
    Effect.runSync(policies.assert(productionDeletePlan, { stage: "prod" })),
  ).toThrow("production data resources cannot be deleted or replaced");
});

const alchemy = Test.make({ providers: Cloudflare.providers() });

alchemy.test.provider("example stack reports its deliberate breaks", (scratch) =>
  Effect.gen(function* () {
    const plan = yield* scratch.plan(
      Effect.gen(function* () {
        const artifacts = yield* Artifacts;
        const metadata = yield* Metadata;
        const worker = yield* RegistryWorker;
        return { artifacts, metadata, worker };
      }),
    );
    const violations = policies.evaluate(plan, { stage: "dev" });
    expect(
      violations.map((violation) => [violation.policy, violation.severity]),
    ).toEqual([
      ["forbidWildcardCors", "error"],
      ["requireDataLocality", "warn"],
      ["requireObservability", "warn"],
    ]);
    const failure = yield* policies.assert(plan, { stage: "dev" }).pipe(
      Effect.flip,
    );
    expect(failure.violations).toHaveLength(1);
  }),
);
