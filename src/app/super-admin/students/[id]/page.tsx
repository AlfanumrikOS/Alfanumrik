'use client';

import { useState, use } from 'react';
import { useRouter } from 'next/navigation';
import AdminShell from '../../_components/AdminShell';
import { colors, S } from '../../_components/admin-styles';
import DataPanel from './_components/DataPanel';
import LiveViewFrame from './_components/LiveViewFrame';

type Tab = 'data' | 'live';

function StudentDetailContent({
  studentId,
}: {
  studentId: string;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('data');

  return (
    <div>
      {/* Back button + header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <button
          onClick={() => router.back()}
          style={{
            ...S.actionBtn,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '6px 12px',
          }}
        >
          &larr; Back
        </button>
        <h1 style={{ ...S.h1, marginBottom: 0 }}>Student Detail</h1>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          marginBottom: 20,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        {([
          { key: 'data' as const, label: 'Data Panel' },
          { key: 'live' as const, label: 'Live View' },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 24px',
              fontSize: 13,
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? colors.text1 : colors.text2,
              background: 'transparent',
              border: 'none',
              borderBottom:
                activeTab === tab.key
                  ? `2px solid ${colors.text1}`
                  : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'data' && <DataPanel studentId={studentId} />}
      {activeTab === 'live' && <LiveViewFrame studentId={studentId} />}
    </div>
  );
}

export default function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <AdminShell>
      <StudentDetailContent studentId={id} />
    </AdminShell>
  );
}