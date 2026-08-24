# alchemy-policy

Define policies for [Alchemy](https://alchemy.run) plans in TypeScript.

> This package is under development and is not published to npm yet.

## Define policies

```ts
import * as Cloudflare from "alchemy/Cloudflare";
import * as p from "alchemy-policy";

export const policies = p.define({
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

  protectProduction: p.plan().refine(
    (plan, context) =>
      context.stage !== "prod" ||
      !plan.actions.some((action) => action.action === "delete"),
    { message: "refusing to delete resources in prod" },
  ),
});
```

Resource patterns are partial and typed. Only include the properties the
policy needs. Use `p.present`, `p.not()`, and `p.some()` for composed checks:

```ts
p.resource(Cloudflare.R2.Bucket).matches(
  {
    forceDestroy: p.not(true),
    lifecycleRules: p.some({ deleteObjectsTransition: p.present }),
  },
  { message: "artifact buckets must retain their data" },
);
```

Use `.refine()` when a policy needs custom logic. Errors block by default; set
`severity: "warn"` for advisory policies.

## Check an Alchemy app

Create a policy check script:

```ts
import { run } from "alchemy-policy/check";
import app from "./alchemy.run.ts";
import { policies } from "./policies.ts";

await run(app, policies);
```

Run it with Bun:

```sh
ALCHEMY_STAGE=dev bun policy-check.ts
```

`run()` builds the plan, evaluates the policies, prints violations, and sets a
failing exit code when it finds an error.

## Use the result programmatically

```ts
import { check } from "alchemy-policy/check";

const violations = yield* check(app, policies, { stage: "dev" });
```

If you already have an Alchemy plan:

```ts
const violations = policies.evaluate(plan, { stage: "dev" });
yield* policies.assert(plan, { stage: "dev" });
```

`evaluate()` returns every warning and error. `assert()` fails with a tagged
`PolicyViolationError` when an error is present.

## Effect layer

```ts
import { layer } from "alchemy-policy/effect";

const PolicyLayer = layer(policies);
```

Use this when the application needs the PolicySet in its Effect layer graph.
