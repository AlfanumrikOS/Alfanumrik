'use client';
// Moved to `@alfanumrik/ui/foxy-panel/MessageList` (Phase 4 U1 — FoxyPanel extraction).
// The moved component takes an optional `renderScaffold` prop; this stub
// defaults it to the existing DynamicScaffold so /foxy page.tsx keeps its
// legacy `ui_action` scaffold behavior with no page-side changes.

import {
  MessageList as MessageListPanel,
  type MessageListProps as MessageListPanelProps,
  type UiActionPayload,
} from '@alfanumrik/ui/foxy-panel/MessageList';
import DynamicScaffold from './DynamicScaffold';

export type MessageListProps = MessageListPanelProps;

export function MessageList(props: MessageListProps) {
  const renderScaffold =
    props.renderScaffold ??
    ((action: UiActionPayload) => (
      // Cast: page-local DynamicScaffold has a stricter payload shape
      // (discriminated union on `type`); the panel's UiActionPayload is a
      // structural Record so the cast is safe and byte-identical to today.
      <DynamicScaffold action={action as never} />
    ));
  return <MessageListPanel {...props} renderScaffold={renderScaffold} />;
}
