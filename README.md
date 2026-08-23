# alchemy-policy

Policy-as-code for [Alchemy](https://alchemy.run) plans — OPA's job with Zod's ergonomics.

Policies are typed TypeScript predicates over the plan. Select by resource
constructor and the props are fully inferred; typo a property and it's a
compile error, not a silently-passing policy.

```ts
import * as Policy from "alchemy-policy";
import * as AWS from "alchemy/AWS";

const noPublicBuckets = Policy.forResource(AWS.S3.Bucket, "no-public-buckets")
  .deny((b) => b.acl === "public-read" || b.acl === "public-read-write")
  .message("S3 buckets must not be public");

const noProdDeletes = Policy.forPlan("no-prod-deletes")
  .when((ctx) => ctx.stage === "prod")
  .deny((actions) => actions.some((a) => a.action === "delete"))
  .message("refusing to delete resources in prod");

const policies = Policy.set(noPublicBuckets, noProdDeletes);

// Given a Plan (e.g. from alchemy's test harness scratch.plan(...)):
policies.assert(plan, { stage: "prod" }); // throws PolicyViolationError
policies.evaluate(plan, { stage: "dev" }); // -> Violation[]
```

- `.deny(pred)` / `.require(pred)` — violation when true / when false
- `.severity("warn")` — advisory instead of blocking (default `"error"`)
- `.message(string | (props, action) => string)` — per-rule message
- `Policy.forPlan()` — rules over the flattened action list (creates,
  replaces, deletes) for change-shaped policies, not just prop-shaped ones

Zero runtime dependency on alchemy: evaluation uses a structural view of the
plan (`resources` / `deletions` nodes), so alchemy beta churn can't break it.
Predicates that throw (e.g. on unresolved `Output` exprs) are reported as
`warn` violations instead of crashing the run.

Tests run real plans through alchemy's own engine via `alchemy/Test/Bun` and
the credential-free `Alchemy.Random` resource: `bun test`.
