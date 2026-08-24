import * as Effect from "effect/Effect";
import { matches, type DeepPattern } from "./pattern.ts";

export { not, present, some } from "./pattern.ts";
export type { DeepPattern } from "./pattern.ts";

export type Severity = "error" | "warn";

export interface Violation {
  policy: string;
  severity: Severity;
  message: string;
  fqn?: string;
  type?: string;
}

export interface PolicyContext {
  stage?: string;
}

type PlanActionKind = "create" | "update" | "replace" | "noop" | "delete";

interface ResourceRef {
  Type: string;
}

interface ApplyNodeLike {
  action: "create" | "update" | "replace" | "noop";
  props?: any;
  state?: { props?: any };
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

export interface PlanAction {
  fqn: string;
  action: PlanActionKind;
  type: string;
  props?: any;
}

export interface PlanView {
  readonly actions: readonly PlanAction[];
}

export interface Diagnostic {
  readonly message: string;
  readonly severity?: Severity;
}

const actionsOf = (plan: PlanLike): PlanAction[] => [
  ...Object.entries(plan.resources).map(([fqn, node]) => ({
    fqn,
    action: node.action,
    type: node.resource.Type,
    props: node.props ?? node.state?.props ?? {},
  })),
  ...Object.entries(plan.deletions).flatMap(([fqn, node]) =>
    node ? [{ fqn, action: "delete" as const, type: node.resource.Type }] : [],
  ),
];

const violation = (
  policy: string,
  diagnostic: Diagnostic,
  action?: PlanAction,
): Violation => ({
  policy,
  severity: diagnostic.severity ?? "error",
  message: diagnostic.message,
  fqn: action?.fqn,
  type: action?.type,
});

type Declaration = (
  name: string,
  plan: PlanView,
  context: PolicyContext,
) => Violation[];

type PropsOf<Tag> = Tag extends { Props: infer Props }
  ? NonNullable<Props>
  : never;

type ResourceCheck<Props> = (
  props: Props,
  action: PlanAction,
  context: PolicyContext,
) => boolean;

class ResourceBuilder<Props> {
  constructor(readonly type: string) {}

  matches(
    pattern: DeepPattern<Props>,
    diagnostic: Diagnostic,
  ): Declaration {
    return this.refine((props) => matches(pattern, props), diagnostic);
  }

  refine(check: ResourceCheck<Props>, diagnostic: Diagnostic): Declaration {
    return (name, plan, context) =>
      plan.actions.flatMap((action) => {
        if (action.type !== this.type || action.action === "delete") return [];
        if (action.props === undefined) {
          return [
            violation(
              name,
              {
                message:
                  "policy could not evaluate unresolved resource properties",
              },
              action,
            ),
          ];
        }
        try {
          return check(action.props, action, context)
            ? []
            : [violation(name, diagnostic, action)];
        } catch (cause) {
          return [
            violation(
              name,
              { message: `policy failed to evaluate: ${cause}` },
              action,
            ),
          ];
        }
      });
  }
}

class PlanBuilder {
  refine(
    check: (plan: PlanView, context: PolicyContext) => boolean,
    diagnostic: Diagnostic,
  ): Declaration {
    return (name, plan, context) => {
      try {
        return check(plan, context) ? [] : [violation(name, diagnostic)];
      } catch (cause) {
        return [
          violation(name, { message: `policy failed to evaluate: ${cause}` }),
        ];
      }
    };
  }
}

export const resource = <Tag extends ResourceRef>(tag: Tag) =>
  new ResourceBuilder<PropsOf<Tag>>(tag.Type);

export const plan = () => new PlanBuilder();

const paint = (code: string, text: string) => `\x1b[${code}m${text}\x1b[0m`;

export const formatViolations = (
  violations: readonly Violation[],
  options: { color?: boolean } = {},
): string[] =>
  violations.map((item) => {
    const label = options.color
      ? paint(item.severity === "error" ? "31" : "33", item.severity)
      : item.severity;
    return `${label} ${item.policy}${item.fqn ? ` @ ${item.fqn}` : ""}: ${item.message}`;
  });

export class PolicyViolationError extends Error {
  readonly _tag = "PolicyViolationError";

  constructor(readonly violations: Violation[]) {
    super(
      `${violations.length} policy violation(s):\n` +
        formatViolations(violations)
          .map((line) => `  ${line}`)
          .join("\n"),
    );
    this.name = "PolicyViolationError";
  }
}

export interface PolicySet {
  evaluate(plan: PlanLike, context?: PolicyContext): Violation[];
  assert(
    plan: PlanLike,
    context?: PolicyContext,
  ): Effect.Effect<Violation[], PolicyViolationError>;
}

export const define = <const Definitions extends Record<string, Declaration>>(
  definitions: Definitions,
): PolicySet => {
  const entries = Object.entries(definitions);
  const evaluate = (plan: PlanLike, context: PolicyContext = {}) => {
    const view = { actions: actionsOf(plan) } satisfies PlanView;
    return entries.flatMap(([name, declaration]) =>
      declaration(name, view, context),
    );
  };
  return {
    evaluate,
    assert: (plan, context = {}) =>
      Effect.suspend(() => {
        const violations = evaluate(plan, context);
        const errors = violations.filter((item) => item.severity === "error");
        return errors.length > 0
          ? Effect.fail(new PolicyViolationError(errors))
          : Effect.succeed(violations);
      }),
  };
};
