import 'reflect-metadata'; // 裝飾器 metadata（factory 的 registerDecorator 路徑需要）
import { validate } from 'class-validator';
import { UNCLASSIFIED_LABEL } from '../../custom-classify/custom-classify-assign.schema';
import {
  IsNotReservedLabel,
  IsNotReservedLabelConstraint,
} from './is-not-reserved-label.validator';

/**
 * M12-R4/#519：`unclassified` 保留字守衛的**在 gate 內**單元覆蓋（constraint 兩分支 + factory + 訊息）。
 * 原邏輯自 `custom-classify-assign.dto.ts` 遷來（`*.dto.ts` 被 coverage gate 整批排除、真實分支不入門檻/ratchet）。
 */
describe('IsNotReservedLabelConstraint (M12-R4)', () => {
  const c = new IsNotReservedLabelConstraint();

  it.each([UNCLASSIFIED_LABEL, 'Unclassified', '  UNCLASSIFIED  '])(
    'rejects the reserved sentinel %p (trim + case-insensitive)',
    (reserved) => {
      expect(c.validate(reserved)).toBe(false);
    },
  );

  it.each(['transactional', 'unclassified-ish', 'not classified'])(
    'accepts a normal label %p',
    (label) => {
      expect(c.validate(label)).toBe(true);
    },
  );

  it('passes a non-string value through (defers to @IsString/@IsNotEmpty)', () => {
    expect(c.validate(123)).toBe(true);
    expect(c.validate(undefined)).toBe(true);
    expect(c.validate(null)).toBe(true);
  });

  it('reports a message naming the reserved word', () => {
    expect(c.defaultMessage()).toContain(UNCLASSIFIED_LABEL);
    expect(c.defaultMessage()).toContain('reserved');
  });
});

describe('@IsNotReservedLabel decorator (factory wiring)', () => {
  class Holder {
    @IsNotReservedLabel()
    label!: string;
  }

  async function errorsFor(label: string): Promise<string[]> {
    const dto = new Holder();
    dto.label = label;
    const errors = await validate(dto);
    return Object.keys(errors[0]?.constraints ?? {});
  }

  it('flags a reserved label via the registered decorator', async () => {
    expect(await errorsFor(UNCLASSIFIED_LABEL)).toContain('isNotReservedLabel');
  });

  it('does not flag a normal label', async () => {
    expect(await errorsFor('transactional')).not.toContain('isNotReservedLabel');
  });
});
