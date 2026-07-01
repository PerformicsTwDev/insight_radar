import {
  type ValidationArguments,
  type ValidationOptions,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
  registerDecorator,
} from 'class-validator';

/**
 * cross-field 驗證：被裝飾欄位 **不得大於** `relatedField`（即 `min <= max`）。任一側非數值（缺值 / 型別不符）
 * → 不比較（交給該欄自身的 `@IsNumber` 等驗證）。用於 range 篩選 `min>max → 400`（FR-7，Design §9.1）。
 */
@ValidatorConstraint({ name: 'isNotGreaterThan', async: false })
export class IsNotGreaterThanConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const [relatedField] = args.constraints as [string];
    const related = (args.object as Record<string, unknown>)[relatedField];
    if (typeof value !== 'number' || typeof related !== 'number') {
      return true;
    }
    return value <= related;
  }

  defaultMessage(args: ValidationArguments): string {
    const [relatedField] = args.constraints as [string];
    return `${args.property} must not be greater than ${relatedField}`;
  }
}

/** 於 `min` 欄位標註 `@IsNotGreaterThan('max')`：`min > max` 時驗證失敗（→ 400）。 */
export function IsNotGreaterThan(relatedField: string, options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      constraints: [relatedField],
      validator: IsNotGreaterThanConstraint,
    });
  };
}
