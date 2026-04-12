'use client';

import { useState } from 'react';
import AdminShell from '../_components/AdminShell';
import { colors, S } from '../_components/admin-styles';
import StudentSelector from './_components/StudentSelector';
import PlanChangeAction from './_components/PlanChangeAction';
import NotifyAction from './_components/NotifyAction';
import SuspendRestoreAction from './_components/SuspendRestoreAction';
import InviteResendAction from './_components/InviteResendAction';

type Tab = 'plan' | 'notify' | 'suspend' | 'invite';

const TABS: { key: Tab; label: string }[] = [
  { key: 'plan', label: 'Plan Changes' },
  { key: 'notify', label: 'Notifications' },
  { key: 'suspend', label: 'Suspend / Restore' },
  { key: 'invite', label: 'Invite Resend' },
];

function BulkActionsContent() {
  const [activeTab, setActiveTab] = useState<Tab>('plan');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={S.h1}>Bulk Actions</h1>
        <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>
          Select students and perform batch operations
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: `1px solid ${colors.border}`, paddingBottom: 0 }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            data-testid={`tab-${tab.key}`}
            style={{
              padding: '10px 18px',
              fontSize: 13,
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? colors.text1 : colors.text2,
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.key ? `2px solid ${colors.text1}` : '2px solid transparent',
              cursor: 'pointer',
              marginBottom: -1,
              transition: 'color 0.1s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Student Selector (shared across all tabs) */}
      <StudentSelector
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
      />

      {/* Action Panel */}
      {activeTab === 'plan' && <PlanChangeAction selectedIds={selectedIds} />}
      {activeTab === 'notify' && <NotifyAction selectedIds={selectedIds} />}
      {activeTab === 'suspend' && <SuspendRestoreAction selectedIds={selectedIds} />}
      {activeTab === 'invite' && <InviteResendAction selectedIds={selectedIds} />}
    </div>
  );
}

export default function BulkActionsPage() {
  return (
    <AdminShell>
      <BulkActionsContent />
    </AdminShell>
  );
}
