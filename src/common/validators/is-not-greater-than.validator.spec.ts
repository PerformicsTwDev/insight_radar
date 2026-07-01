import { validate } from 'class-validator';
import { IsNotGreaterThan } from './is-not-greater-than.validator';

class Sample {
  @IsNotGreaterThan('max')
  min?: number;

  max?: number;
}

async function validateSample(
  input: Partial<Sample>,
): Promise<{ props: string[]; messages: string[] }> {
  const dto = Object.assign(new Sample(), input);
  const errors = await validate(dto);
  return {
    props: errors.map((e) => e.property),
    messages: errors.flatMap((e) => Object.values(e.constraints ?? {})),
  };
}

describe('IsNotGreaterThan (cross-field validator)', () => {
  it('fails on the decorated (min) field when it exceeds the related field', async () => {
    const { props, messages } = await validateSample({ min: 10, max: 5 });
    expect(props).toEqual(['min']); // 錯誤落在被裝飾欄位
    expect(messages.join(' ')).toMatch(/max/i); // 訊息點名 related field
  });

  it('passes when the field is <= the related field (boundary equal included)', async () => {
    expect((await validateSample({ min: 5, max: 5 })).props).toHaveLength(0);
    expect((await validateSample({ min: 4, max: 5 })).props).toHaveLength(0);
  });

  it('does not compare when either side is absent or non-numeric', async () => {
    expect((await validateSample({ min: 10 })).props).toHaveLength(0); // max 缺
    expect((await validateSample({ max: 5 })).props).toHaveLength(0); // min 缺
    expect((await validateSample({})).props).toHaveLength(0);
  });
});
