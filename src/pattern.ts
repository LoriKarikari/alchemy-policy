const patternType = Symbol("alchemy-policy/pattern");

class PresentPattern {
  readonly [patternType] = "present";
}

class NotPattern<Pattern> {
  readonly [patternType] = "not";

  constructor(readonly pattern: Pattern) {}
}

class SomePattern<Pattern> {
  readonly [patternType] = "some";

  constructor(readonly pattern: Pattern) {}
}

export const present = new PresentPattern();

export const not = <const Pattern>(pattern: Pattern) => new NotPattern(pattern);

export const some = <const Pattern>(pattern: Pattern) => new SomePattern(pattern);

export type DeepPattern<Value> =
  | PresentPattern
  | NotPattern<DeepPattern<Value>>
  | (NonNullable<Value> extends readonly (infer Item)[]
      ? SomePattern<DeepPattern<Item>>
      : NonNullable<Value> extends object
        ? {
            readonly [Key in keyof NonNullable<Value>]?: DeepPattern<
              NonNullable<Value>[Key]
            >;
          }
        : NonNullable<Value>);

export const matches = (pattern: any, value: any): boolean => {
  if (pattern instanceof PresentPattern) {
    return value !== undefined && value !== null;
  }
  if (pattern instanceof NotPattern) {
    return !matches(pattern.pattern, value);
  }
  if (pattern instanceof SomePattern) {
    return (
      Array.isArray(value) &&
      value.some((item) => matches(pattern.pattern, item))
    );
  }
  if (pattern === null || Object(pattern) !== pattern) {
    return Object.is(pattern, value);
  }
  if (value === null || Object(value) !== value) return false;
  return Object.entries(pattern).every(([key, expected]) =>
    matches(expected, value[key]),
  );
};
