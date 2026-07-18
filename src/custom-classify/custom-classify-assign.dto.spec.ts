import 'reflect-metadata'; // 裝飾器 metadata（Nest app 於 bootstrap 匯入；unit 測試須自帶）
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfirmedLabelDto, CustomClassifyAssignDto } from './custom-classify-assign.dto';
import { UNCLASSIFIED_LABEL } from './custom-classify-assign.schema';

/**
 * M12-R4：`unclassified` 為保留字（gap-fallback sentinel），不得作確認標籤——否則同時進 LLM enum 又是缺漏補值，
 * `custom:{cid}` view 桶混算兩類、灌大計數。經 DTO `@IsNotReservedLabel`（trim + 大小寫不敏感）於 HTTP 邊界擋 400。
 */
describe('CustomClassifyAssignDto reserved-label guard (M12-R4)', () => {
  async function labelErrors(label: unknown): Promise<string[]> {
    const dto = plainToInstance(CustomClassifyAssignDto, {
      labels: [{ label, description: 'x' }],
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    // 巢狀：labels → children[0] → label 的失敗 constraint keys。
    const labelChild = errors[0]?.children?.[0]?.children?.find((c) => c.property === 'label');
    return Object.keys(labelChild?.constraints ?? {});
  }

  it.each([UNCLASSIFIED_LABEL, 'Unclassified', '  UNCLASSIFIED  '])(
    'flags a reserved sentinel label %p with isNotReservedLabel (trim + case-insensitive)',
    async (reserved) => {
      expect(await labelErrors(reserved)).toContain('isNotReservedLabel');
    },
  );

  it('accepts a normal label (no reserved-label error)', async () => {
    expect(await labelErrors('transactional')).not.toContain('isNotReservedLabel');
  });

  // 直接 constraint 測試（非字串分支 + 訊息 + factory）已移至
  // `src/common/validators/is-not-reserved-label.validator.spec.ts`（在 coverage gate 內，M12-R519）。

  it('exports ConfirmedLabelDto (shape guard)', () => {
    expect(new ConfirmedLabelDto()).toBeInstanceOf(ConfirmedLabelDto);
  });
});
