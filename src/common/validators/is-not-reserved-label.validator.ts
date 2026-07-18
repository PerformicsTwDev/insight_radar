import {
  registerDecorator,
  type ValidationOptions,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { UNCLASSIFIED_LABEL } from '../../custom-classify/custom-classify-assign.schema';

/**
 * 保留字守衛（M12-R4）：確認標籤禁與後處理 gap-fallback sentinel `unclassified` 同名——否則該 label 同時進 LLM enum
 * 又是缺漏補值，`custom:{cid}` view 的桶會混算兩類、灌大計數。比對 `trim().toLowerCase()`（大小寫/空白不敏感，杜絕影射）。
 *
 * **位置（M12-R519）**：置於 `common/validators/`（**在** coverage gate 內）而非 `*.dto.ts`（被 `jest.config.ts` 整批
 * 排除）——本 constraint 含真實分支邏輯（非 decorator-metadata 假 branch），須進 85/90 門檻與 CI ratchet。
 */
@ValidatorConstraint({ name: 'isNotReservedLabel', async: false })
export class IsNotReservedLabelConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value !== 'string' || value.trim().toLowerCase() !== UNCLASSIFIED_LABEL;
  }
  defaultMessage(): string {
    return `label "${UNCLASSIFIED_LABEL}" is reserved (system gap-fallback sentinel) and cannot be a confirmed label`;
  }
}

/** 於確認標籤欄位標註 `@IsNotReservedLabel()`：值 `trim().toLowerCase() === 'unclassified'` 時驗證失敗（→ 400）。 */
export function IsNotReservedLabel(options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      constraints: [],
      validator: IsNotReservedLabelConstraint,
    });
  };
}
