import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { PolicySet } from "./index.ts";

export class PolicyService extends Context.Service<
  PolicyService,
  Effect.Effect<PolicySet>
>()("alchemy-policy/PolicyService") {}

export const layer = (policies: PolicySet): Layer.Layer<PolicyService> =>
  Layer.succeed(PolicyService, PolicyService.of(Effect.succeed(policies)));
