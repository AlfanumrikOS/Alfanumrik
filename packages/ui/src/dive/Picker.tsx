'use client';

/**
 * Pedagogy v2 — Wave 2 Task 5b
 * <Picker/> — three-option picker for the weekly Curiosity Dive.
 *
 * Props are everything /api/dive/state already returns; the parent owns the
 * fetch so the picker stays a pure rendering component (testable, no IO).
 */
import { useState } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';

export interface PickerPhenomenon {
  id: string;
  slug: string;
  title_en: string;
  title_hi: string;
  summary_en: string;
  summary_hi: string;
  subjects: string[];
}

export interface PickerWeakTopic {
  topicId: string;
  title: string;
  titleHi: string | null;
  masteryProbability: number;
}

export interface PickerProps {
  defaultPicker: 'phenomenon' | 'weak_topic' | 'own_topic';
  showPhenomenonOption: boolean;
  showWeakTopicOption: boolean;
  showOwnTopicOption: boolean;
  eligiblePhenomena: PickerPhenomenon[];
  weakTopics: PickerWeakTopic[];
  /** Called once the student commits a picker choice. The parent posts to /api/dive/start. */
  onCommit: (
    payload:
      | { pickerOption: 'phenomenon'; phenomenonSlug: string }
      | { pickerOption: 'weak_topic'; weakTopicId: string }
      | { pickerOption: 'own_topic'; ownTopic: string },
  ) => void;
  disabled?: boolean;
}

export default function Picker(props: PickerProps) {
  const { isHi } = useAuth();
  const [selected, setSelected] = useState<'phenomenon' | 'weak_topic' | 'own_topic'>(props.defaultPicker);
  const [phenomenonSlug, setPhenomenonSlug] = useState<string>(props.eligiblePhenomena[0]?.slug ?? '');
  const [weakTopicId, setWeakTopicId] = useState<string>(props.weakTopics[0]?.topicId ?? '');
  const [ownTopic, setOwnTopic] = useState<string>('');

  const canSubmit =
    (selected === 'phenomenon' && !!phenomenonSlug) ||
    (selected === 'weak_topic' && !!weakTopicId) ||
    (selected === 'own_topic' && ownTopic.trim().length > 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || props.disabled) return;
    if (selected === 'phenomenon') {
      props.onCommit({ pickerOption: 'phenomenon', phenomenonSlug });
    } else if (selected === 'weak_topic') {
      props.onCommit({ pickerOption: 'weak_topic', weakTopicId });
    } else {
      props.onCommit({ pickerOption: 'own_topic', ownTopic: ownTopic.trim() });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="dive-picker">
      <div className="space-y-2">
        {props.showPhenomenonOption && (
          <PickerOption
            id="phenomenon"
            selected={selected === 'phenomenon'}
            onSelect={() => setSelected('phenomenon')}
            title={isHi ? 'सुझाव: एक रोज़मर्रा का सिलसिला' : 'Suggested: a real-world phenomenon'}
            description={
              isHi
                ? 'क्रॉस-विषय जिज्ञासा — मानसून, क्रिकेट का भौतिकी, किराना दुकान का हिसाब'
                : 'Cross-subject curiosity — monsoon, cricket physics, kirana store accounting'
            }
          >
            {selected === 'phenomenon' && (
              <select
                value={phenomenonSlug}
                onChange={(e) => setPhenomenonSlug(e.target.value)}
                className="mt-2 w-full rounded-lg border border-purple-200 bg-white px-3 py-2 text-sm"
                data-testid="dive-picker-phenomenon-select"
              >
                {props.eligiblePhenomena.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {isHi ? p.title_hi : p.title_en}
                    {' '}— {p.subjects.join(', ')}
                  </option>
                ))}
              </select>
            )}
          </PickerOption>
        )}

        {props.showWeakTopicOption && (
          <PickerOption
            id="weak_topic"
            selected={selected === 'weak_topic'}
            onSelect={() => setSelected('weak_topic')}
            title={isHi ? 'कमज़ोर विषय की खोज' : 'Weak-topic dive'}
            description={
              isHi
                ? 'जिस टॉपिक पर हाल ही में गलती हुई — उसे गहराई से समझो'
                : 'A topic you got wrong recently — take it apart'
            }
          >
            {selected === 'weak_topic' && (
              <select
                value={weakTopicId}
                onChange={(e) => setWeakTopicId(e.target.value)}
                className="mt-2 w-full rounded-lg border border-purple-200 bg-white px-3 py-2 text-sm"
                data-testid="dive-picker-weaktopic-select"
              >
                {props.weakTopics.map((t) => (
                  <option key={t.topicId} value={t.topicId}>
                    {isHi && t.titleHi ? t.titleHi : t.title}
                    {' '}— {Math.round(t.masteryProbability * 100)}% mastery
                  </option>
                ))}
              </select>
            )}
          </PickerOption>
        )}

        {props.showOwnTopicOption && (
          <PickerOption
            id="own_topic"
            selected={selected === 'own_topic'}
            onSelect={() => setSelected('own_topic')}
            title={isHi ? 'अपनी पसंद का विषय' : 'Your own topic'}
            description={
              isHi
                ? 'जो भी मन में है — फॉक्सी समझाएगा'
                : 'Whatever you are curious about — Foxy will explore it with you'
            }
          >
            {selected === 'own_topic' && (
              <input
                type="text"
                maxLength={200}
                value={ownTopic}
                onChange={(e) => setOwnTopic(e.target.value)}
                placeholder={isHi ? 'जैसे: भारत में चंद्रयान कैसे काम करता है' : 'e.g., How does Chandrayaan navigate to the moon?'}
                className="mt-2 w-full rounded-lg border border-purple-200 bg-white px-3 py-2 text-sm"
                data-testid="dive-picker-owntopic-input"
              />
            )}
          </PickerOption>
        )}
      </div>

      <button
        type="submit"
        disabled={!canSubmit || props.disabled}
        className="w-full rounded-xl bg-purple-700 text-white py-3 text-sm font-semibold disabled:opacity-50"
        data-testid="dive-picker-submit"
      >
        {isHi ? 'इसी से शुरू करो →' : 'Start with this →'}
      </button>
    </form>
  );
}

function PickerOption(props: {
  id: string;
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <label
      className="block rounded-2xl border bg-white p-3 cursor-pointer transition-colors"
      style={{
        borderColor: props.selected ? '#7C3AED' : 'rgba(0,0,0,0.08)',
        background: props.selected ? 'rgba(124,58,237,0.04)' : '#fff',
      }}
      data-testid={`dive-picker-option-${props.id}`}
    >
      <div className="flex items-start gap-3">
        <input
          type="radio"
          name="picker"
          checked={props.selected}
          onChange={props.onSelect}
          className="mt-1"
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-purple-900">{props.title}</div>
          <div className="text-xs text-purple-700 mt-0.5">{props.description}</div>
          {props.children}
        </div>
      </div>
    </label>
  );
}
