import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { SessionService } from '../auth/session.service';
import { PrismaService } from '../prisma';

/** API key header 名（小寫；Express header 一律小寫）。 */
export const API_KEY_HEADER = 'x-api-key';

/**
 * 全域複合認證守衛（FR-25 / TC-60）——**RED skeleton（T10.4）**：宣告 DI 依賴與 `canActivate` 介面，
 * 尚未實作行為（一律不放行 → 斷言紅），供 red-first 測試編譯。GREEN 於此填入「先 session、後 x-api-key」邏輯。
 */
@Injectable()
export class CompositeAuthGuard implements CanActivate {
  constructor(
    _reflector: Reflector,
    _sessions: SessionService,
    _prisma: PrismaService,
    _config: ConfigService,
  ) {}

  canActivate(_context: ExecutionContext): Promise<boolean> {
    return Promise.resolve(false);
  }
}
