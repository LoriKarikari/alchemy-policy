/**
 * Effect-native packaging: `PolicyService` as a Context.Service with a
 * pluggable Layer, so a policy set composes into an Alchemy stack's layer
 * graph the same way providers and state stores do. The zero-dep core in
 * `index.ts` stays usable without Effect.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  set,
  PolicyViolationError,
  type PlanLike,
  type Policy,
  type PolicyContext,
  type Violation,
} from "./index.ts";

export interface PolicyServiceShape {
  readonly evaluate: (
    plan: PlanLike,
    ctx?: PolicyContext,
  ) => Effect.Effect<Violation[]>;
  /** Fails with PolicyViolationError on any error-severity violation. */
  readonly assert: (
    plan: PlanLike,
    ctx?: PolicyContext,
  ) => Effect.Effect<Violation[], PolicyViolationError>;
}

export class PolicyService extends Context.Service<
  PolicyService,
  Effect.Effect<PolicyServiceShape>
>()("alchemy-policy/PolicyService") {}

/** Build the pluggable Layer from a set of policies. */
export const layer = (
  ...policies: Policy[]
): Layer.Layer<PolicyService> => {
  const policySet = set(...policies);
  const shape: PolicyServiceShape = {
    evaluate: (plan, ctx) => Effect.sync(() => policySet.evaluate(plan, ctx)),
    assert: (plan, ctx) =>
      Effect.try({
        try: () => policySet.assert(plan, ctx),
        catch: (e) => e as PolicyViolationError,
      }),
  };
  return Layer.succeed(PolicyService, PolicyService.of(Effect.succeed(shape)));
};
