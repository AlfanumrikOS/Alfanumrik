'use client'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'

// Static syllabus structure — can be replaced with DB-driven content later
const SYLLABUS: Record<string, Record<string, string[]>> = {
  Mathematics: {
    'Number System': ['Natural Numbers','Whole Numbers','Integers','Rational Numbers','Irrational Numbers','Real Numbers'],
    'Algebra': ['Variables & Expressions','Linear Equations','Quadratic Equations','Polynomials','Factorization'],
    'Geometry': ['Lines & Angles','Triangles','Quadrilaterals','Circles','Coordinate Geometry'],
    'Mensuration': ['Area','Perimeter','Volume','Surface Area'],
    'Statistics': ['Mean, Median, Mode','Data Representation','Probability'],
  },
  Science: {
    'Physics': ['Motion','Force & Laws','Gravitation','Work & Energy','Sound','Light'],
    'Chemistry': ['Matter','Atoms & Molecules','Chemical Reactions','Acids, Bases & Salts','Metals & Non-metals'],
    'Biology': ['Cell Biology','Tissues','Life Processes','Reproduction','Heredity','Ecosystems'],
  },
  English: {
    'Grammar': ['Parts of Speech','Tenses','Active & Passive Voice','Direct & Indirect Speech','Punctuation'],
    'Writing': ['Essay Writing','Letter Writing','Story Writing','Report Writing'],
    'Literature': ['Poetry Analysis','Prose Comprehension','Drama'],
  },
  History: {
    'Ancient India': ['Indus Valley','Vedic Age','Maurya Empire','Gupta Empire'],
    'Medieval India': ['Delhi Sultanate','Mughal Empire','Bhakti Movement','Vijayanagara'],
    'Modern India': ['British Rule','Freedom Movement','Independence','Post-Independence'],
    'World History': ['French Revolution','World War I','World War II','Cold War'],
  },
}

export default function SyllabusScreen({ profile, token, onAskFoxy, onBack }: {
  profile: any
  token: string
  onAskFoxy: (topic: string) => void
  onBack: () => void
}) {
  const [expandedChapter, setExpandedChapter] = useState<string | null>(null)
  const subject = profile?.subject || 'Mathematics'
  const syllabus = SYLLABUS[subject] || SYLLABUS.Mathematics

  return (
    <div className="screen overflow-y-auto pb-8">
      <div className="bg-forest px-5 pt-12 pb-5 flex items-center gap-3">
        <button onClick={onBack} className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center text-white text-lg">←</button>
        <div>
          <h1 className="font-display text-2xl font-extrabold text-white">Syllabus</h1>
          <p className="text-cream/60 text-xs">{profile?.grade} · {subject}</p>
        </div>
      </div>

      <div className="px-5 mt-5 space-y-3">
        {Object.entries(syllabus).map(([chapter, topics]) => (
          <div key={chapter} className="card overflow-hidden">
            <button
              onClick={() => setExpandedChapter(expandedChapter === chapter ? null : chapter)}
              className="w-full flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-saffron/10 rounded-xl flex items-center justify-center text-xl">📖</div>
                <div className="text-left">
                  <p className="font-bold text-forest">{chapter}</p>
                  <p className="text-xs text-forest/40">{topics.length} topics</p>
                </div>
              </div>
              <span className={`text-forest/40 text-lg transition-transform duration-200 ${expandedChapter === chapter ? 'rotate-180' : ''}`}>
                ↓
              </span>
            </button>

            {expandedChapter === chapter && (
              <div className="mt-4 border-t border-black/5 pt-3 space-y-2 animate-fade-in">
                {topics.map(topic => (
                  <div key={topic} className="flex items-center justify-between py-1">
                    <span className="text-sm text-forest/80 font-medium flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-saffron rounded-full" />
                      {topic}
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => onAskFoxy(`Explain ${topic} in ${subject} for ${profile?.grade}`)}
                        className="text-xs bg-saffron/10 text-saffron font-bold px-2.5 py-1 rounded-full active:scale-95 transition-all"
                      >
                        Ask Foxy
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
