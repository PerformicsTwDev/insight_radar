import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from 'src/prisma';
import { createPrismaTestApp } from '../utils/create-prisma-test-app';

/**
 * T8.11（Design §16.4 Phase 2 RESERVED · Testcontainers）：驗新 migration 套用後 `topic_taxonomy`（self-FK 樹）
 * 與 `topic_audit_logs`（Json before/after）建表可用。**本期僅建表、無邏輯** → 只驗 schema/migration 正確。
 */
describe('Phase-2 reserved schema (integration · Testcontainers, T8.11)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM topic_taxonomy');
    await prisma.$executeRawUnsafe('DELETE FROM topic_audit_logs');
  });

  it('topic_taxonomy supports a self-referencing parent/child tree', async () => {
    const root = await prisma.topicTaxonomy.create({
      data: { parentId: null, level: 0, status: 'active', topicName: 'Coffee' },
    });
    const child = await prisma.topicTaxonomy.create({
      data: { parentId: root.id, level: 1, status: 'active', topicName: 'Espresso' },
    });

    const withChildren = await prisma.topicTaxonomy.findUniqueOrThrow({
      where: { id: root.id },
      include: { children: true },
    });
    expect(withChildren.children.map((c) => c.id)).toEqual([child.id]);

    const loadedChild = await prisma.topicTaxonomy.findUniqueOrThrow({
      where: { id: child.id },
      include: { parent: true },
    });
    expect(loadedChild.parent?.topicName).toBe('Coffee');
  });

  it('rejects a child whose parent_id does not exist (self-FK enforced)', async () => {
    await expect(
      prisma.topicTaxonomy.create({
        data: { parentId: randomUUID(), level: 1, status: 'active', topicName: 'Orphan' },
      }),
    ).rejects.toThrow();
  });

  it('topic_audit_logs round-trips before/after JSON', async () => {
    const log = await prisma.topicAuditLog.create({
      data: {
        action: 'rename',
        actor: 'user-1',
        before: { topicName: 'Old' },
        after: { topicName: 'New' },
      },
    });

    const loaded = await prisma.topicAuditLog.findUniqueOrThrow({ where: { id: log.id } });
    expect(loaded.action).toBe('rename');
    expect(loaded.before).toEqual({ topicName: 'Old' });
    expect(loaded.after).toEqual({ topicName: 'New' });
    expect(loaded.createdAt).toBeInstanceOf(Date);
  });

  it('allows null before/after (create/delete audit entries)', async () => {
    const log = await prisma.topicAuditLog.create({
      data: { action: 'mark_noise', actor: 'user-2' },
    });
    const loaded = await prisma.topicAuditLog.findUniqueOrThrow({ where: { id: log.id } });
    expect(loaded.before).toBeNull();
    expect(loaded.after).toBeNull();
  });
});
