/**
 * alchemy-policy — policy-as-code for Alchemy plans, Zod-style.
 *
 * Zero runtime dependency on alchemy: policies evaluate a structural view
 * of the Plan (`resources` / `deletions` nodes), so this survives beta
 * churn in alchemy internals. Types are inferred from the resource
 * constructor's call signature: `Policy.for(AWS.S3.Bucket)` gives the
 * predicate fully-typed props.
 */

export type Severity = "error" | "warn";

export interface Violation {
  policy: string;
  severity: Severity;
  message: string;
  /** FQN of the offending resource; absent for plan-level policies. */
  fqn?: string;
  /** Resource type token, e.g. "AWS.S3.Bucket". */
  type?: string;
}

export interface PolicyContext {
  stage?: string;
  [key: string]: unknown;
}

// ── Structural view of an alchemy Plan ──────────────────────────────────────

export type PlanActionKind = "create" | "update" | "replace" | "noop" | "delete";

interface ResourceRef {
  Type: string;
}

interface ApplyNodeLike {
  action: "create" | "update" | "replace" | "noop";
  props?: any;
  resource: ResourceRef;
}

interface DeleteNodeLike {
  action: "delete";
  resource: ResourceRef;
}

export interface PlanLike {
  resources: Record<string, ApplyNodeLike>;
  deletions: Record<string, DeleteNodeLike | undefined>;
}

/** One row of the flattened plan: what will happen to which resource. */
export interface PlanAction {
  fqn: string;
  action: PlanActionKind;
  type: string;
  props?: any;
}

export const actionsOf = (plan: PlanLike): PlanAction[] => [
  ...Object.entries(plan.resources).map(([fqn, node]) => ({
    fqn,
    action: node.action,
    type: node.resource.Type,
    props: node.props,
  })),
  ...Object.entries(plan.deletions).flatMap(([fqn, node]) =>
    node ? [{ fqn, action: "delete" as const, type: node.resource.Type }] : [],
  ),
];

// ── Policies ────────────────────────────────────────────────────────────────

export interface Policy {
  readonly name: string;
  evaluate(plan: PlanLike, ctx: PolicyContext): Violation[];
}

/** Extract props from the constructor's phantom `Props` field. */
type PropsOf<T> = T extends { Props: infer P } ? NonNullable<P> : any;

interface Rule<P> {
  deny: (props: P, action: PlanAction, ctx: PolicyContext) => boolean;
  message?: string | ((props: P, action: PlanAction) => string);
}

class ResourcePolicy<P> implements Policy {
  #type: string;
  #name: string;

  get name() {
    return this.#name;
  }
  #severity: Severity = "error";
  #rules: Rule<P>[] = [];

  constructor(type: string, name?: string) {
    this.#type = type;
    this.#name = name ?? `policy:${type}`;
  }

  /** Violation when the predicate is true. */
  deny(pred: Rule<P>["deny"]): this {
    this.#rules.push({ deny: pred });
    return this;
  }

  /** Violation when the predicate is false. */
  require(pred: Rule<P>["deny"]): this {
    this.#rules.push({ deny: (p, a, c) => !pred(p, a, c) });
    return this;
  }

  /** Message for the most recently added rule. */
  message(msg: NonNullable<Rule<P>["message"]>): this {
    const last = this.#rules.at(-1);
    if (!last) throw new Error(".message() before any .deny()/.require()");
    last.message = msg;
    return this;
  }

  severity(s: Severity): this {
    this.#severity = s;
    return this;
  }

  named(name: string): this {
    this.#name = name;
    return this;
  }

  evaluate(plan: PlanLike, ctx: PolicyContext): Violation[] {
    const violations: Violation[] = [];
    for (const action of actionsOf(plan)) {
      if (action.type !== this.#type || action.action === "delete") continue;
      for (const rule of this.#rules) {
        let hit: boolean;
        try {
          hit = rule.deny(action.props ?? ({} as P), action, ctx);
        } catch (cause) {
          violations.push({
            policy: this.#name,
            severity: "warn",
            fqn: action.fqn,
            type: action.type,
            message: `policy failed to evaluate (unresolved props?): ${cause}`,
          });
          continue;
        }
        if (hit) {
          violations.push({
            policy: this.#name,
            severity: this.#severity,
            fqn: action.fqn,
            type: action.type,
            message:
              typeof rule.message === "function"
                ? rule.message(action.props, action)
                : (rule.message ?? `${this.#name} violated`),
          });
        }
      }
    }
    return violations;
  }
}

interface PlanRule {
  deny: (actions: PlanAction[], ctx: PolicyContext) => boolean;
  message?: string;
}

class PlanPolicy implements Policy {
  #name: string;

  get name() {
    return this.#name;
  }
  #severity: Severity = "error";
  #when: (ctx: PolicyContext) => boolean = () => true;
  #rules: PlanRule[] = [];

  constructor(name = "policy:plan") {
    this.#name = name;
  }

  when(pred: (ctx: PolicyContext) => boolean): this {
    this.#when = pred;
    return this;
  }

  deny(pred: PlanRule["deny"]): this {
    this.#rules.push({ deny: pred });
    return this;
  }

  message(msg: string): this {
    const last = this.#rules.at(-1);
    if (!last) throw new Error(".message() before any .deny()");
    last.message = msg;
    return this;
  }

  severity(s: Severity): this {
    this.#severity = s;
    return this;
  }

  named(name: string): this {
    this.#name = name;
    return this;
  }

  evaluate(plan: PlanLike, ctx: PolicyContext): Violation[] {
    if (!this.#when(ctx)) return [];
    const flat = actionsOf(plan);
    return this.#rules
      .filter((rule) => rule.deny(flat, ctx))
      .map((rule) => ({
        policy: this.#name,
        severity: this.#severity,
        message: rule.message ?? `${this.#name} violated`,
      }));
  }
}

// ── Entry points ────────────────────────────────────────────────────────────

/** Per-resource-type policy. Pass the resource constructor for typed props. */
export const forResource = <T extends ResourceRef>(
  tag: T,
  name?: string,
): ResourcePolicy<PropsOf<T>> => new ResourcePolicy(tag.Type, name);

/** Policy over the whole plan (actions, deletes, replaces). */
export const forPlan = (name?: string): PlanPolicy => new PlanPolicy(name);

export class PolicyViolationError extends Error {
  constructor(readonly violations: Violation[]) {
    super(
      `${violations.length} policy violation(s):\n` +
        violations
          .map((v) => `  [${v.severity}] ${v.policy}${v.fqn ? ` @ ${v.fqn}` : ""}: ${v.message}`)
          .join("\n"),
    );
    this.name = "PolicyViolationError";
  }
}

export interface PolicySet {
  evaluate(plan: PlanLike, ctx?: PolicyContext): Violation[];
  /** Throws PolicyViolationError if any error-severity violation exists. */
  assert(plan: PlanLike, ctx?: PolicyContext): Violation[];
}

export const set = (...policies: Policy[]): PolicySet => ({
  evaluate: (plan, ctx = {}) => policies.flatMap((p) => p.evaluate(plan, ctx)),
  assert(plan, ctx = {}) {
    const violations = this.evaluate(plan, ctx);
    const errors = violations.filter((v) => v.severity === "error");
    if (errors.length > 0) throw new PolicyViolationError(errors);
    return violations;
  },
});
