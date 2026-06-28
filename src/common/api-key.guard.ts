import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * T0.5 red stub：讀取依賴但**一律放行**，讓 TC-12 的「擋下」案例（無/錯 key）轉紅。
 * green 階段補上 `x-api-key` 與 config `app.apiKey` 的常數時間比對。
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    this.config.get<string>('app.apiKey');
    return true;
  }
}
