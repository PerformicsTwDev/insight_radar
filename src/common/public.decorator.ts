import { SetMetadata } from '@nestjs/common';

/** Reflector metadata key 標記 handler/controller 為公開（免 ApiKeyGuard）。 */
export const IS_PUBLIC_KEY = 'isPublic';

/** 標記路由為公開（例如 `/health`）：全域 ApiKeyGuard 會放行。 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
