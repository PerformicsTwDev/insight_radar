import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { trackingConfig } from '../config/tracking.config';
import { scrubSecrets } from '../logger/redaction';
import { PrismaService } from '../prisma/prisma.service';

/** 排程刷新 sweep 的固定租約鍵（單列；#470）。手動刷新不套租約（per-list jobId single-flight）。 */
export const SWEEP_LEASE_NAME = 'scheduled-refresh';

/**
 * SweepLeaseService（#470，M11 gate should · NFR-16 / AC-29.2）——排程刷新 sweep 的 **DB 租約鎖 single-flight**。
 *
 * 為何用租約而非 advisory lock 或包交易：sweep 為 append-only + partial 韌性（AC-29.5，逐清單獨立提交快照），
 * **不可**包進單一長交易（末段失敗會回滾已提交快照；且橫跨慢速 Ads 呼叫的長交易＝反模式）；session 級 advisory
 * lock 又無法在 Prisma 連線池下可靠跨 sweep 持有。故 scheduled job 進場以**單一原子** `INSERT … ON CONFLICT DO
 * UPDATE … WHERE leased_until < now() RETURNING` 搶租約（pool-safe，不需 pin 連線）——搶到才 sweep、否則跳過
 * （防排程堆積雙刷 + 跨實例並發、雙耗 Ads 配額）；`finally` 釋放；TTL＝`TRACKING_SWEEP_LEASE_MS` 為 crash 復原上界。
 *
 * **殘留窄窗**（Design §17.3，比照 M12-R8 慣例）：sweep 執行久於 TTL → 租約先到期、另一 sweep 可搶並重疊；預設
 * TTL（1h）遠大於 daily cron 下的預期 sweep 時長，實務不觸發。
 */
@Injectable()
export class SweepLeaseService {
  private readonly logger = new Logger(SweepLeaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(trackingConfig.KEY) private readonly config: ConfigType<typeof trackingConfig>,
  ) {}

  /**
   * 嘗試搶排程 sweep 租約（single-flight）。單一原子語句：無列→INSERT 搶到；有列且已過期→ON CONFLICT
   * DO UPDATE（`WHERE leased_until < now()`）續搶；有列且未過期→WHERE 不成立、無列回傳→未搶到（有人持有）。
   * 回 `true`＝取得（可 sweep）；`false`＝已有進行中 sweep（跳過）。
   */
  async acquire(): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ name: string }>>`
      INSERT INTO tracking_sweep_leases (name, leased_until)
      VALUES (${SWEEP_LEASE_NAME}, now() + make_interval(secs => ${this.config.sweepLeaseMs}::double precision / 1000.0))
      ON CONFLICT (name) DO UPDATE
        SET leased_until = EXCLUDED.leased_until
        WHERE tracking_sweep_leases.leased_until < now()
      RETURNING name
    `;
    return rows.length > 0;
  }

  /**
   * 釋放租約（即時到期），使下一次 cron 可立即搶。**best-effort**：釋放失敗只 log、不逸出（sweep 已完成，
   * 且 TTL 到期後仍會自動可搶）；訊息 `scrubSecrets`（NFR-5，ioredis/PG 錯誤可夾帶連線字串）。
   */
  async release(): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        UPDATE tracking_sweep_leases SET leased_until = now() WHERE name = ${SWEEP_LEASE_NAME}
      `;
    } catch (error) {
      this.logger.warn(
        `sweep lease release failed (TTL will recover): ${scrubSecrets(String(error))}`,
      );
    }
  }
}
