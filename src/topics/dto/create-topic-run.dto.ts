import { IsBoolean, IsInt, IsObject, IsOptional, Min } from 'class-validator';

/**
 * `POST /keyword-analyses/:id/topics` 入參（Design §16.3）。全域 ValidationPipe（whitelist +
 * forbidNonWhitelisted + transform）：未宣告欄位 → 400。全欄位 optional（皆有服務端/Python 預設）。
 * `serpEnabled` 未帶 → false（純文字 embedding）。umap/hdbscan 為進階調參（原樣傳給 cluster-service）。
 */
export class CreateTopicRunDto {
  @IsOptional()
  @IsBoolean()
  serpEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  topK?: number;

  @IsOptional()
  @IsObject()
  umap?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  hdbscan?: Record<string, unknown>;
}
