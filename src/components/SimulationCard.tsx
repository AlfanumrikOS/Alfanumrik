'use client';

interface SimCardProps {
  id: string;
  title: string;
  description: string;
  simType: string;
  topicTitle: string;
  chapterNumber: number;
  difficulty: number;
  bloomLevel: string;
  thumbnailEmoji: string;
  estimatedTimeMinutes: number;
  boardExamRelevance: number;
  conceptTags: string[];
  onClick: (id: string) => void;
}

const difficultyLabels = ['', 'Easy', 'Medium', 'Intermediate', 'Advanced', 'Expert'];
const difficultyColors = ['', '#22c55e', '#3B8BD4', '#f59e0b', '#e24b4a', '#7c3aed'];
const bloomColors: Record<string, string> = {
  remember: '#94a3b8', understand: '#3B8BD4', apply: '#22c55e',
  analyze: '#f59e0b', evaluate: '#e24b4a', create: '#7c3aed'
};

export default function SimulationCard(props: SimCardProps) {
  const { id, title, description, topicTitle, chapterNumber, difficulty, bloomLevel, thumbnailEmoji, estimatedTimeMinutes, boardExamRelevance, conceptTags, onClick } = props;

  return (
    <div
      onClick={() => onClick(id)}
      style={{
        background: 'var(--surface-1, #fff)',
        borderRadius: '14px',
        border: '1px solid rgba(99,102,241,0.1)',
        padding: '16px',
        cursor: 'pointer',
        transition: 'all 0.2s',
        position: 'relative',
        overflow: 'hidden'
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
        (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 16px rgba(99,102,241,0.12)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
      }}
    >
      {boardExamRelevance >= 4 && (
        <div style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          background: boardExamRelevance === 5 ? '#dc2626' : '#f59e0b',
          color: '#fff',
          fontSize: '9px',
          fontWeight: 700,
          padding: '2px 8px',
          borderRadius: '6px',
          letterSpacing: '0.5px',
          textTransform: 'uppercase'
        }}>
          {boardExamRelevance === 5 ? 'Board exam' : 'Important'}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '10px' }}>
        <span style={{
          fontSize: '28px',
          width: '44px',
          height: '44px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--surface-2, #f5f3ff)',
          borderRadius: '10px',
          flexShrink: 0
        }}>
          {thumbnailEmoji}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-1, #1a1a1a)', lineHeight: 1.3 }}>{title}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-3, #888)', marginTop: '3px' }}>
            Ch {chapterNumber}: {topicTitle}
          </div>
        </div>
      </div>

      <div style={{ fontSize: '12px', color: 'var(--text-2, #666)', lineHeight: 1.5, marginBottom: '10px' }}>
        {description}
      </div>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <span style={{
          fontSize: '10px',
          padding: '2px 8px',
          borderRadius: '6px',
          background: `${difficultyColors[difficulty]}15`,
          color: difficultyColors[difficulty],
          fontWeight: 600
        }}>
          {difficultyLabels[difficulty]}
        </span>
        <span style={{
          fontSize: '10px',
          padding: '2px 8px',
          borderRadius: '6px',
          background: `${bloomColors[bloomLevel] || '#666'}15`,
          color: bloomColors[bloomLevel] || '#666',
          fontWeight: 600,
          textTransform: 'capitalize'
        }}>
          {bloomLevel}
        </span>
        <span style={{
          fontSize: '10px',
          padding: '2px 8px',
          borderRadius: '6px',
          background: 'var(--surface-2, #f5f5f5)',
          color: 'var(--text-3, #888)'
        }}>
          ~{estimatedTimeMinutes} min
        </span>
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: '8px',
        borderTop: '1px solid var(--border, #f0f0f0)'
      }}>
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {conceptTags.slice(0, 3).map((tag, i) => (
            <span key={i} style={{
              fontSize: '9px',
              padding: '1px 6px',
              borderRadius: '4px',
              background: 'var(--surface-2, #f5f3ff)',
              color: '#6366F1'
            }}>
              {tag}
            </span>
          ))}
        </div>
        <span style={{
          fontSize: '11px',
          color: '#6366F1',
          fontWeight: 600
        }}>
          Try it →
        </span>
      </div>
    </div>
  );
}
