import { AlchemyContextLive, inMemoryState } from "alchemy";
import { ArtifactStore, createArtifactStore } from "alchemy/Artifacts";
import { LoggingCli } from "alchemy/Cli/LoggingCli";
import * as Plan from "alchemy/Plan";
import * as Stack from "alchemy/Stack";
import { PlatformServices } from "alchemy/Util/PlatformServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  formatViolations,
  type PolicySet,
  type Violation,
} from "./index.ts";

const checkRuntime = Layer.mergeAll(
  LoggingCli,
  inMemoryState(),
  Layer.succeed(ArtifactStore, createArtifactStore()),
);

type App = Parameters<typeof Stack.evalStack>[0];

export const check = (
  app: App,
  policies: PolicySet,
  options: { stage: string },
): Effect.Effect<Violation[], unknown> =>
  Stack.evalStack(app, Plan.make, { stage: options.stage }).pipe(
    Effect.map((plan) => policies.evaluate(plan, options)),
    Effect.provide(checkRuntime),
    Effect.provide(AlchemyContextLive),
    Effect.provide(PlatformServices),
  );

export const run = async (app: App, policies: PolicySet): Promise<void> => {
  const stage = process.env.ALCHEMY_STAGE ?? "dev";
  try {
    const violations = await Effect.runPromise(check(app, policies, { stage }));
    if (violations.length === 0) {
      console.log(`no violations (${stage})`);
      return;
    }
    for (const line of formatViolations(violations, {
      color: process.stdout.isTTY,
    })) {
      console.log(line);
    }
    if (violations.some((violation) => violation.severity === "error")) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
};
