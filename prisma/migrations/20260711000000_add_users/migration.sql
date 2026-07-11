-- CreateTable: users (T10.1 / FR-24, Design §17.2) —— 帳號；密碼僅存 argon2id password_hash（明文絕不落 DB, S7）。
-- id 由 Prisma client 產生（無 DB default，同其他 uuid 表）；session 存 Redis、不落 DB。
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
