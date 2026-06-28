import { type ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { IsString } from 'class-validator';
import { createValidationPipe } from './validation.pipe';

class SampleDto {
  @IsString()
  name!: string;
}

const meta: ArgumentMetadata = { type: 'body', metatype: SampleDto, data: '' };

describe('createValidationPipe (global config)', () => {
  const pipe = createValidationPipe();

  it('passes and transforms a valid body into the DTO instance', async () => {
    const result: unknown = await pipe.transform({ name: 'ok' }, meta);
    expect(result).toBeInstanceOf(SampleDto);
    expect(result).toEqual({ name: 'ok' });
  });

  it('rejects an invalid field type with a structured BadRequest (fields)', async () => {
    expect.assertions(3);
    try {
      await pipe.transform({ name: 123 }, meta);
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const res = (e as BadRequestException).getResponse() as {
        code?: string;
        fields?: Record<string, string[]>;
      };
      expect(res.code).toBe('VALIDATION_FAILED');
      expect(res.fields?.name?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('rejects unknown fields (forbidNonWhitelisted)', async () => {
    await expect(pipe.transform({ name: 'ok', extra: 'x' }, meta)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
