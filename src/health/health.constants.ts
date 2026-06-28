/** terminus health check indicator keys（controller 與測試共用，避免 magic string / 漂移）。 */
export const HealthIndicatorKey = {
  DATABASE: 'database',
  CACHE: 'cache',
} as const;

export type HealthIndicatorKey = (typeof HealthIndicatorKey)[keyof typeof HealthIndicatorKey];
