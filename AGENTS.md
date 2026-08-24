# alchemy-policy

Policy-as-code for Alchemy plans. Vocabulary lives in [CONTEXT.md](CONTEXT.md) —
use its terms exactly (Policy, Pattern, Declaration, PlanView, Violation,
PolicySet, Check).

## Seam rules

- The root export (`src/index.ts`) stays free of alchemy runtime imports.
  `src/check.ts` is the only module that may import alchemy; it owns all
  engine plumbing.
- Policies read the structural PlanView only. Alchemy plan internals
  (`props ?? state.props`, delete nodes, unresolved props) are absorbed
  inside `src/index.ts` before any Policy runs.
- Evaluation failures fail closed: an unevaluable Policy emits an
  error-severity Violation. Keep that severity when refactoring.

## Deliberate state

- The example stack ships three policy breaks on purpose (wildcard CORS =
  error, missing D1 locality and disabled traces = warns). `bun run
  policy:check` exiting 1 with those three lines is the working demo —
  treat a green run after stack edits as the anomaly to explain.
- `examples/artifact-registry/bunfig.toml` is a symlink and load-bearing:
  bun reads bunfig from cwd only, and it silences `bun run` noise there.
- `.alchemy/` is generated output; delete freely.

## Style and verification

- Source carries no comments; names carry intent. The one exception the
  linter enforces: `SAFETY:` lines justifying type assertions.
- Gate for every commit: `bun run check`, `bun run lint`, and `bun test`
  all green.
- The integration check is a real deploy plus live requests:
  `ARTIFACT_TOKEN=... bunx alchemy deploy
  examples/artifact-registry/alchemy.run.ts --stage dev`.
