import { useParams } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { TrackingDetailView } from './TrackingDetailView';

/**
 * Route wrapper for `/tracking/$listId` (T5.7, FR-19). Reads the `listId` path param
 * and threads it into {@link TrackingDetailView} (which stays prop-driven, so it is
 * unit-testable without a router).
 */
export function TrackingDetailRoute(): ReactElement {
  const { listId } = useParams({ from: '/tracking/$listId' });
  return <TrackingDetailView listId={listId} />;
}
