'use client';
import { useState } from 'react';

type AnimalId = string;
const ANIMALS: { id: AnimalId; name: string; correct: string; emoji: string }[] = [
  { id: 'fish', name: 'Fish', correct: 'Pisces', emoji: '🐟' },
  { id: 'frog', name: 'Frog', correct: 'Amphibia', emoji: '🐸' },
  { id: 'snake', name: 'Snake', correct: 'Reptilia', emoji: '🐍' },
  { id: 'sparrow', name: 'Sparrow', correct: 'Aves', emoji: '🐦' },
  { id: 'bat', name: 'Bat', correct: 'Mammalia', emoji: '🦇' },
  { id: 'whale', name: 'Whale', correct: 'Mammalia', emoji: '🐋' },
  { id: 'earthworm', name: 'Earthworm', correct: 'Invertebrate', emoji: '🪱' },
  { id: 'butterfly', name: 'Butterfly', correct: 'Invertebrate', emoji: '🦋' },
  { id: 'octopus', name: 'Octopus', correct: 'Invertebrate', emoji: '🐙' },
  { id: 'starfish', name: 'Starfish', correct: 'Invertebrate', emoji: '⭐' },
];

const CLASSES = ['Pisces', 'Amphibia', 'Reptilia', 'Aves', 'Mammalia', 'Invertebrate'];
const CLASS_INFO: Record<string, string> = {
  Pisces: 'Cold-blooded, scales, gills, lay eggs in water, paired fins',
  Amphibia: 'Cold-blooded, moist skin, lay eggs in water, can live on land & water',
  Reptilia: 'Cold-blooded, dry scaly skin, lay eggs on land, breathe with lungs',
  Aves: 'Warm-blooded, feathers, beak, lay eggs, forelimbs modified as wings',
  Mammalia: 'Warm-blooded, hair/fur, give birth to young, nurse with milk',
  Invertebrate: 'No backbone, diverse groups: insects, worms, molluscs, echinoderms',
};

export default function AnimalClassification() {
  const [selected, setSelected] = useState<AnimalId | null>(null);
  const [placed, setPlaced] = useState<Record<AnimalId, string>>({});
  const [showAnswers, setShowAnswers] = useState(false);

  const unplaced = ANIMALS.filter(a => !placed[a.id]);
  const score = Object.entries(placed).filter(([id, cls]) => ANIMALS.find(a => a.id === id)?.correct === cls).length;

  const handlePlace = (cls: string) => {
    if (!selected) return;
    setPlaced(p => ({ ...p, [selected]: cls }));
    setSelected(null);
  };

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Animal Classification</h3>
      <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 8 }}>Click an animal, then click its class to place it. Score: <strong>{score}/{ANIMALS.length}</strong></p>
      <div style={{ padding: 10, background: 'var(--surface-2)', borderRadius: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 6 }}>Unclassified animals:</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {unplaced.map(a => (
            <button key={a.id} onClick={() => setSelected(a.id === selected ? null : a.id)}
              style={{ padding: '4px 10px', background: selected === a.id ? 'var(--orange)' : '#fff', color: selected === a.id ? '#fff' : '#333', border: `2px solid ${selected === a.id ? 'var(--orange)' : '#ddd'}`, borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
              {a.emoji} {a.name}
            </button>
          ))}
          {unplaced.length === 0 && <span style={{ fontSize: 12, color: '#4CAF50' }}>All placed! Check your score above.</span>}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {CLASSES.map(cls => {
          const items = showAnswers ? ANIMALS.filter(a => a.correct === cls) : ANIMALS.filter(a => placed[a.id] === cls);
          const isInvert = cls === 'Invertebrate';
          return (
            <div key={cls} onClick={() => handlePlace(cls)}
              style={{ padding: 8, background: isInvert ? '#EDE7F6' : '#E3F2FD', borderRadius: 8, border: `2px dashed ${isInvert ? '#7C3AED' : '#1565C0'}`, cursor: selected ? 'pointer' : 'default', minHeight: 60 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: isInvert ? '#7C3AED' : '#1565C0', marginBottom: 4 }}>{cls}</div>
              <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 4 }}>{CLASS_INFO[cls].substring(0, 40)}…</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {items.map(a => {
                  const correct = a.correct === placed[a.id];
                  return (
                    <span key={a.id} style={{ fontSize: 11, padding: '2px 6px', background: showAnswers ? '#E8F5E9' : correct ? '#E8F5E9' : '#FFEBEE', borderRadius: 4, color: showAnswers ? '#2E7D32' : correct ? '#2E7D32' : '#C62828' }}>
                      {a.emoji} {a.name}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {selected && (
        <div style={{ marginTop: 8, padding: '6px 10px', background: '#FFF3E0', borderRadius: 8, fontSize: 12, color: '#E65100' }}>
          Placing: <strong>{ANIMALS.find(a => a.id === selected)?.emoji} {ANIMALS.find(a => a.id === selected)?.name}</strong> — click a class above
        </div>
      )}
      <div style={{ marginTop: 8, display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button onClick={() => setShowAnswers(s => !s)} style={{ padding: '6px 16px', background: 'var(--purple)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
          {showAnswers ? 'Hide Answers' : 'Show All Answers'}
        </button>
        <button onClick={() => { setPlaced({}); setSelected(null); setShowAnswers(false); }} style={{ padding: '6px 16px', background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Reset</button>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: '#EDE7F6', borderRadius: 8, fontSize: 13, color: '#4527A0', borderLeft: '3px solid #7C3AED' }}>
        <strong>Vertebrates</strong> have a backbone (notochord → vertebral column). <strong>Invertebrates</strong> do not.
      </div>
    </div>
  );
}
