export type FieldType = "text" | "number" | "boolean";

export type PrimitiveRuleValue = string | number | boolean;

export type RuleValue = PrimitiveRuleValue | PrimitiveRuleValue[] | null;

export interface RuleCondition {
  id: string;
  field: string;
  operator: string;
  value: RuleValue;
}

export type MatchType = "all" | "any";
