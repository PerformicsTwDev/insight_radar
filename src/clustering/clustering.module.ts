import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { clusteringConfig } from '../config/clustering.config';
import { ClusterClient } from './cluster.client';
import { CLUSTERING_PROVIDER } from './clustering-provider.port';

/**
 * 分群模組（T8.5，Design §16.1）。對外只露 {@link CLUSTERING_PROVIDER}（= {@link ClusterClient} HTTP adapter）；
 * 透過 `@nestjs/axios` `HttpModule` 呼叫獨立 Python cluster-service。URL/timeout/retries 從 config 注入、不寫死。
 */
@Module({
  imports: [HttpModule, ConfigModule.forFeature(clusteringConfig)],
  providers: [ClusterClient, { provide: CLUSTERING_PROVIDER, useExisting: ClusterClient }],
  exports: [CLUSTERING_PROVIDER],
})
export class ClusteringModule {}
