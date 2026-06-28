import * as Joi from 'joi';

// T0.4 red stub：先放一個寬鬆 schema（允許未知、無必填）讓 TC-19 spec 轉紅；
// green 階段補上完整必填欄位 + Azure apiVersion allowlist 驗證。
export const validationSchema = Joi.object({}).unknown(true);
