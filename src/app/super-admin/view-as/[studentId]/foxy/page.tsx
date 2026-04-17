'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { colors, S } from '../../../_components/admin-styles';

interface ChatSessionRecord {
  id: string;
  subject?: string;
  grade?: string;
  chapter?: string;
  title?: string;
  mode?: string;
  message_count?: number;
  last_active_at?: string;
  created_at: string;
  source: 'foxy' | 'legacy';
}

interface Message {
  id?: string;
  role: string;
  content: string;
  sources?: unknown;
  tokens_used?: number;
  created_at?: string;
}

export default function ViewAsFoxyPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = use(params);
  const [sessions, setSessions] = useState<ChatSessionRecord[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/super-admin/students/${studentId}/foxy-history`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        const body = await res
          .json()
          .catch(() => ({ error: 'Failed to load chat history' }));
        setError(body.error || 'Failed to load chat history');
        return;
      }
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  const fetchMessages = useCallback(
    async (sessionId: string) => {
      setLoadingMessages(true);
      setMessages([]);
      try {
        const res = await fetch(
          `/api/super-admin/students/${studentId}/foxy-history?sessionId=${sessionId}`,
          { credentials: 'include' }
        );
        if (res.ok) {
          const data = await res.json();
          setMessages(data.messages || []);
        }
      } catch {
        // Non-fatal
      } finally {
        setLoadingMessages(false);
      }
    },
    [studentId]
  );

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleSessionClick = (session: ChatSessionRecord) => {
    if (selectedId === session.id) {
      setSelectedId(null);
      setMessages([]);
    } else {
      setSelectedId(session.id);
      fetchMessages(session.id);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: colors.text3, fontSize: 13 }}>
        Loading Foxy chat history...
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          padding: 16,
          color: colors.danger,
          background: colors.dangerLight,
          borderRadius: 8,
          fontSize: 13,
        }}
      >
        {error}
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ ...S.h1, fontSize: 18, marginBottom: 16 }}>
        Foxy Chat History
      </h1>

      {sessions.length === 0 ? (
        <div
          style={{
            padding: 24,
            textAlign: 'center',
            color: colors.text3,
            fontSize: 13,
          }}
        >
          No Foxy chat sessions found.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {sessions.map((session) => (
            <div key={`${session.source}-${session.id}`}>
              {/* Session header */}
              <button
                onClick={() => handleSessionClick(session)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px 16px',
                  background:
                    selectedId === session.id
                      ? colors.accentLight
                      : colors.bg,
                  border: `1px solid ${
                    selectedId === session.id
                      ? colors.accent
                      : colors.border
                  }`,
                  borderRadius: selectedId === session.id ? '8px 8px 0 0' : 8,
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: colors.text1,
                    }}
                  >
                    {session.title ||
                      session.chapter ||
                      session.subject ||
                      'Chat session'}
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 500,
                        marginLeft: 8,
                        padding: '2px 6px',
                        borderRadius: 8,
                        background: colors.surface,
                        color: colors.text3,
                      }}
                    >
                      {session.source}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: colors.text3 }}>
                    {session.subject && `${session.subject}`}
                    {session.grade && ` / Grade ${session.grade}`}
                    {session.mode && ` / ${session.mode}`}
                    {session.message_count != null &&
                      ` / ${session.message_count} messages`}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: colors.text3, flexShrink: 0 }}>
                  {new Date(
                    session.last_active_at || session.created_at
                  ).toLocaleString()}
                </div>
              </button>

              {/* Expanded messages */}
              {selectedId === session.id && (
                <div
                  style={{
                    border: `1px solid ${colors.accent}`,
                    borderTop: 'none',
                    borderRadius: '0 0 8px 8px',
                    padding: 16,
                    background: colors.surface,
                    maxHeight: 500,
                    overflowY: 'auto',
                  }}
                >
                  {loadingMessages && (
                    <div
                      style={{
                        textAlign: 'center',
                        color: colors.text3,
                        fontSize: 13,
                        padding: 12,
                      }}
                    >
                      Loading messages...
                    </div>
                  )}
                  {!loadingMessages && messages.length === 0 && (
                    <div
                      style={{
                        textAlign: 'center',
                        color: colors.text3,
                        fontSize: 13,
                        padding: 12,
                      }}
                    >
                      No messages found for this session.
                    </div>
                  )}
                  {messages.map((msg, idx) => {
                    const isUser =
                      msg.role === 'user' || msg.role === 'student';
                    return (
                      <div
                        key={msg.id || idx}
                        style={{
                          display: 'flex',
                          justifyContent: isUser ? 'flex-end' : 'flex-start',
                          marginBottom: 8,
                        }}
                      >
                        <div
                          style={{
                            maxWidth: '75%',
                            padding: '10px 14px',
                            borderRadius: 12,
                            background: isUser ? '#7C3AED' : colors.bg,
                            color: isUser ? '#fff' : colors.text1,
                            fontSize: 13,
                            lineHeight: 1.5,
                            border: isUser
                              ? 'none'
                              : `1px solid ${colors.border}`,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          <div style={{ marginBottom: 4 }}>{msg.content}</div>
                          {msg.created_at && (
                            <div
                              style={{
                                fontSize: 10,
                                opacity: 0.7,
                                textAlign: 'right',
                              }}
                            >
                              {new Date(msg.created_at).toLocaleTimeString()}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}