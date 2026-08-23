import { expect } from "bun:test";
import { Random, RandomProvider } from "alchemy/Random";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import * as Policy from "../src/index.ts";

const { test } = Test.make({ providers: RandomProvider() });

const noWeakSecrets = Policy.forResource(Random, "no-weak-secrets")
  .deny((props) => (props.bytes ?? 32) < 16)
  .message((props) => `secret is ${props.bytes} bytes; minimum is 16`);

const encourageExplicitBytes = Policy.forResource(Random, "explicit-bytes")
  .require((props) => props.bytes !== undefined)
  .message("prefer an explicit bytes value")
  .severity("warn");

const noDeletesInProd = Policy.forPlan("no-prod-deletes")
  .when((ctx) => ctx.stage === "prod")
  .deny((actions) => actions.some((a) => a.action === "delete"))
  .message("refusing to delete resources in prod");

const policies = Policy.set(noWeakSecrets, encourageExplicitBytes, noDeletesInProd);

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

    const violations = policies.evaluate(plan as any, { stage: "test" });

    const errors = violations.filter((v) => v.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.policy).toBe("no-weak-secrets");
    expect(errors[0]!.fqn).toContain("Weak");
    expect(errors[0]!.message).toBe("secret is 8 bytes; minimum is 16");

    const warns = violations.filter((v) => v.severity === "warn");
    expect(warns).toHaveLength(1);
    expect(warns[0]!.policy).toBe("explicit-bytes");
    expect(warns[0]!.fqn).toContain("Implicit");

    expect(() => policies.assert(plan as any, { stage: "test" })).toThrow(
      Policy.PolicyViolationError,
    );
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
    expect(policies.assert(plan as any, { stage: "test" })).toHaveLength(0);
  }),
);

// ── Effect Layer packaging ──────────────────────────────────────────────────
import { PolicyService, layer } from "../src/effect.ts";

test.provider("PolicyService layer asserts inside an Effect program", (scratch) =>
  Effect.gen(function* () {
    const plan = yield* scratch.plan(
      Effect.gen(function* () {
        const weak = yield* Random("Weak", { bytes: 8 });
        return { weak: weak.text };
      }),
    );
    const svc = yield* yield* PolicyService;
    const result = yield* svc
      .assert(plan as any, { stage: "test" })
      .pipe(Effect.flip);
    expect(result.violations[0]!.policy).toBe("no-weak-secrets");
  }).pipe(Effect.provide(layer(noWeakSecrets))),
);
