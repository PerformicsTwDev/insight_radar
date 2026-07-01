import { validate } from 'class-validator';
import { IsNotGreaterThan } from './is-not-greater-than.validator';

class Sample {
  @IsNotGreaterThan('max')
  min?: number;

  max?: number;
}

async function errorsFor(input: Partial<Sample>): Promise<string[]> {
  const dto = Object.assign(new Sample(), input);
  const errors = await validate(dto);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('IsNotGreaterThan (cross-field validator)', () => {
  it('fails when the decorated field exceeds the related field', async () => {
    const messages = await errorsFor({ min: 10, max: 5 });
    expect(messages.join(' ')).toMatch(/max/i);
    expect(messages).not.toHaveLength(0);
  });

  it('passes when the field is <= the related field (boundary equal included)', async () => {
    expect(await errorsFor({ min: 5, max: 5 })).toHaveLength(0);
    expect(await errorsFor({ min: 4, max: 5 })).toHaveLength(0);
  });

  it('does not compare when either side is absent or non-numeric', async () => {
    expect(await errorsFor({ min: 10 })).toHaveLength(0); // max 缺
    expect(await errorsFor({ max: 5 })).toHaveLength(0); // min 缺
    expect(await errorsFor({})).toHaveLength(0);
  });
});
