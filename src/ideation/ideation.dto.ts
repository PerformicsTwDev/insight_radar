import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { IDEATION_TEMPLATE_KEYS, type IdeationTemplate } from './ideation.templates';

/**
 * `POST /ai-ideation` body（T12.10，FR-35 / AC-35.1/35.3）。契約 = `{ template, seeds }`。`template` 須為 allowlist
 * key（`@IsIn`，未知 → **400**）；`seeds` 非空字串陣列（空陣列/空字串 → **400**）。全域 whitelist ValidationPipe
 * 擋未宣告欄位（400）。上限 `ArrayMaxSize`/`MaxLength` 防不可信輸入無界膨脹 LLM prompt（S19）。
 */
export class IdeationDto {
  @IsIn(IDEATION_TEMPLATE_KEYS)
  template!: IdeationTemplate;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(200, { each: true })
  seeds!: string[];
}
