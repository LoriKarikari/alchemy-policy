import { expect } from "bun:test";
import { Random, RandomProvider } from "alchemy/Random";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import { PolicyService, layer } from "../src/effect.ts";
import * as p from "../src/index.ts";

const { test } = Test.make({ providers: RandomProvider() });

const policies = p.define({
  noWeakSecrets: p.resource(Random).refine(
    (props) => (props.bytes ?? 32) >= 16,
    { message: "secret must contain at least 16 bytes" },
  ),
  explicitBytes: p.resource(Random).matches(
    { bytes: p.present },
    { message: "prefer an explicit bytes value", severity: "warn" },
  ),
  noProdDeletes: p.plan().refine(
    (plan, context) =>
      context.stage !== "prod" ||
      !plan.actions.some((action) => action.action === "delete"),
    { message: "refusing to delete resources in prod" },
  ),
});

test.provider("flags weak secrets in a real engine plan", (scratch) =>
  Effect.gen(function* () {
    const plan = yield* scratch.plan(
      Effect.gen(function* () {
        const weak = yield* Random("Weak", { bytes: 8 });
        const strong = yield* Random("Strong", { bytes: 32 });
        const implicit = yield* Random("Implicit");
        return { weak: weak.text, strong: strong.text, implicit: implicit.text };
      }),
    );

    const violations = policies.evaluate(plan, { stage: "test" });

    const errors = violations.filter((violation) => violation.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.policy).toBe("noWeakSecrets");
    expect(errors[0]!.fqn).toContain("Weak");
    expect(errors[0]!.message).toBe("secret must contain at least 16 bytes");

    const warnings = violations.filter(
      (violation) => violation.severity === "warn",
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.policy).toBe("explicitBytes");
    expect(warnings[0]!.fqn).toContain("Implicit");

    const failure = yield* policies.assert(plan, { stage: "test" }).pipe(
      Effect.flip,
    );
    expect(failure).toBeInstanceOf(p.PolicyViolationError);
  }),
);

test.provider("clean stack passes", (scratch) =>
  Effect.gen(function* () {
    const plan = yield* scratch.plan(
      Effect.gen(function* () {
        const ok = yield* Random("Ok", { bytes: 32 });
        return { ok: ok.text };
      }),
    );
    expect(yield* policies.assert(plan, { stage: "test" })).toHaveLength(0);
  }),
);

test.provider("PolicyService layer asserts inside an Effect program", (scratch) =>
  Effect.gen(function* () {
    const plan = yield* scratch.plan(
      Effect.gen(function* () {
        const weak = yield* Random("Weak", { bytes: 8 });
        return { weak: weak.text };
      }),
    );
    const service = yield* yield* PolicyService;
    const failure = yield* service
      .assert(plan, { stage: "test" })
      .pipe(Effect.flip);
    expect(failure.violations[0]!.policy).toBe("noWeakSecrets");
  }).pipe(Effect.provide(layer(policies))),
);
