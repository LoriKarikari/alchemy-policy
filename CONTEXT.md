# alchemy-policy domain vocabulary

**Policy**:
One named rule evaluated against a Plan. Named by its key in `define({...})`;
the key is the exact `Violation.policy` value.
_Avoid_: rule, check, guard

**Pattern**:
A typed partial structural description of resource props, matched recursively
(`src/pattern.ts`). Literals match exactly; objects match per listed key;
`present`, `not(...)`, and `some(...)` are the composable matchers.
Precedents: C# property patterns, ts-pattern, Jest asymmetric matchers.
_Avoid_: schema, shape, matcher DSL

**Declaration**:
The compiled form of one Policy: a function from (name, PlanView, PolicyContext)
to Violations. Produced by `resource(...).matches/refine` and `plan().refine`.
_Avoid_: rule object, builder result

**PlanView**:
The structural, alchemy-version-independent view of a Plan that policies see:
a flat list of PlanActions (create/update/replace/noop/delete with type, FQN,
props). The load-bearing seam isolating this library from alchemy beta churn.
_Avoid_: plan graph, engine plan

**Violation**:
One finding: policy name, severity (`error` blocks, `warn` advises), message,
and the offending resource's FQN and type when resource-scoped.
_Avoid_: issue, diagnostic, finding

**PolicySet**:
The evaluatable unit returned by `define({...})`: `evaluate` (pure, returns
all Violations) and `assert` (Effect; fails with `PolicyViolationError` when
any error-severity Violation exists).
_Avoid_: policy pack (reserved for future shipped rule collections)

**Check**:
The one-call runner (`src/check.ts`, exported as `alchemy-policy/check`):
build an app's Plan through the alchemy engine and evaluate a PolicySet
against it. Owns every piece of alchemy runtime plumbing (context, platform
services, CLI/state/artifact layers, `evalStack`) so callers and alchemy
beta churn meet in one file. The root `alchemy-policy` export stays free of
alchemy runtime imports; Check is the only module allowed to have them.
_Avoid_: runner, harness, policy-check (that is the example script)

**PolicyService**:
The Effect `Context.Service` packaging of a PolicySet (`src/effect.ts`).
Deliberately shallow: it exists so an eventual alchemy pre-apply hook can
discover policies in the layer graph without alchemy depending on this package.
_Avoid_: policy engine, policy layer (the layer is `layer(policies)`)
