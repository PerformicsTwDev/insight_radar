import { useNavigate } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { TrackingListsView } from './TrackingListsView';

/**
 * Route wrapper for `/tracking` (T5.7, FR-19). Injects the navigation dependency so
 * {@link TrackingListsView} stays router-agnostic (unit-testable bare): a row's 開啟
 * navigates to that list's time-series detail (`/tracking/$listId`).
 */
export function TrackingListsRoute(): ReactElement {
  const navigate = useNavigate();
  return (
    <TrackingListsView
      onOpenList={(listId) => void navigate({ to: '/tracking/$listId', params: { listId } })}
    />
  );
}
