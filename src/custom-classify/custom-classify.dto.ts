import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * `POST /keyword-analyses/:id/custom-classifications` body（T12.7，FR-34 / AC-34.1）。契約 =
 * `{ name, instruction }`：`name` 顯示用、`instruction` 為要 LLM 設計標籤的**分類維度**（非可執行命令，S19 隔離）。
 * 全域 whitelist ValidationPipe 會把未宣告欄位擋成 **400**（`forbidNonWhitelisted`）；空字串 → 400
 * （`IsNotEmpty`）；長度上限避免 LLM prompt 無界膨脹（服務層再對第三方語料做隔離）。
 */
export class CustomClassifyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  instruction!: string;
}
