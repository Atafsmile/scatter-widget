// Shared empty-state catalog — the single source of truth for the platform's
// canonical empty/error states. Every widget renders these instead of bespoke
// copy so the wording + illustration stay consistent across the product.
//
// Each entry pairs the official UX copy (title + description, verbatim from the
// design spec) with its design-sdk illustration. Render via <WidgetEmptyState
// state="…" /> — wrap it in whatever card/chrome the host widget needs.
//
// All ten illustrations ship JS + subpath exports in @faclon-labs/design-sdk
// ^0.7.3 (older 0.6.x only bundled NoDataOne — do not downgrade).
import React from 'react';
import { EmptyState } from '@faclon-labs/design-sdk/EmptyState';
import { NoDataOneIllustration } from '@faclon-labs/design-sdk/EmptyState/illustrations/NoDataOneIllustration';
import { AddImageIllustration } from '@faclon-labs/design-sdk/EmptyState/illustrations/AddImageIllustration';
import { AddWidgetIllustration } from '@faclon-labs/design-sdk/EmptyState/illustrations/AddWidgetIllustration';
import { NoNotificationIllustration } from '@faclon-labs/design-sdk/EmptyState/illustrations/NoNotificationIllustration';
import { TechnicalHiccupIllustration } from '@faclon-labs/design-sdk/EmptyState/illustrations/TechnicalHiccupIllustration';
import { AccessDeniedIllustration } from '@faclon-labs/design-sdk/EmptyState/illustrations/AccessDeniedIllustration';
import { NoSearchResultIllustration } from '@faclon-labs/design-sdk/EmptyState/illustrations/NoSearchResultIllustration';
import { NotFound404Illustration } from '@faclon-labs/design-sdk/EmptyState/illustrations/NotFound404Illustration';

// Canonical key for every supported empty state.
export type EmptyStateKey =
  | 'data-not-available'
  | 'image-not-configured'
  | 'widget-not-configured'
  | 'no-notifications'
  | 'data-source-not-configured'
  | 'something-went-wrong'
  | 'access-restricted'
  | 'result-not-found'
  | 'page-not-found';

type IllustrationComponent = React.ComponentType<{ size?: number; className?: string }>;

interface EmptyStateDef {
  illustration: IllustrationComponent;
  title: string;
  description: string;
}

// The catalog. Copy is verbatim from the design spec — do not paraphrase.
export const WIDGET_EMPTY_STATES: Record<EmptyStateKey, EmptyStateDef> = {
  'data-not-available': {
    illustration: NoDataOneIllustration,
    title: 'Data not available',
    description: "We couldn't find any data matching your request",
  },
  'image-not-configured': {
    illustration: AddImageIllustration,
    title: 'Image not configured',
    description: 'Double click or drag and drop Image widget to configure an image',
  },
  'widget-not-configured': {
    illustration: AddWidgetIllustration,
    title: 'Widget not configured',
    description: 'Click on the setting button or double click on the widget to configure it',
  },
  'no-notifications': {
    illustration: NoNotificationIllustration,
    title: "You're all caught up",
    description: 'No new notifications right now. Updates and alerts will appear here',
  },
  'data-source-not-configured': {
    // Design spec pairs this state with the No-data-one illustration (same as
    // `data-not-available`) — a missing source and missing data read as the
    // same "nothing to show" family to the user.
    illustration: NoDataOneIllustration,
    title: 'Data Source not configured',
    description: 'Add a data source to start monitoring and visualizing data',
  },
  'something-went-wrong': {
    illustration: TechnicalHiccupIllustration,
    title: 'Something went wrong',
    description: "We couldn't load this. Refresh the page or try again in a few moments",
  },
  'access-restricted': {
    illustration: AccessDeniedIllustration,
    title: 'Access restricted',
    description: "You don't have permission to view this. Contact your admin to request access",
  },
  'result-not-found': {
    illustration: NoSearchResultIllustration,
    title: 'Result not found',
    description: "We couldn't find any matches. Try different keywords or modify your filters",
  },
  'page-not-found': {
    illustration: NotFound404Illustration,
    title: 'Page not found',
    description: "This page doesn't exist or may have been moved. Go back to continue where you left off",
  },
};

export interface WidgetEmptyStateProps {
  /** Which canonical empty state to render. */
  state: EmptyStateKey;
  /** Illustration height in px (width auto-scales). Defaults to 120. */
  size?: number;
  /** SDK EmptyState size variant — bumps the title typography. */
  emptyStateSize?: 'Medium' | 'Large';
  /** Primary action, e.g. a Retry <Button> on the error state. */
  primaryAction?: React.ReactNode;
  /** Secondary action rendered beside the primary. */
  secondaryAction?: React.ReactNode;
  /** Optional override copy — defaults to the catalog entry. */
  title?: string;
  description?: string;
}

// Generic renderer over the catalog. Picks the right illustration + canonical
// copy from the key; callers only choose the state and (optionally) an action.
export function WidgetEmptyState({
  state,
  size = 120,
  emptyStateSize,
  primaryAction,
  secondaryAction,
  title,
  description,
}: WidgetEmptyStateProps) {
  const def = WIDGET_EMPTY_STATES[state];
  const Illustration = def.illustration;
  return (
    <EmptyState
      illustration={<Illustration size={size} />}
      title={title ?? def.title}
      description={description ?? def.description}
      size={emptyStateSize}
      primaryAction={primaryAction}
      secondaryAction={secondaryAction}
    />
  );
}
