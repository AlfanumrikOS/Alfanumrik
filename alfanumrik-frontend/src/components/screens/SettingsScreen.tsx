'use client'
import { useState } from 'react'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'

const grades = ['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12']
const subjects = ['Mathematics','Science','English','Hindi','Social Studies','Physics','Chemistry','Biology','History','Geography','Economics','Computer Science']
const languages = ['English','Hindi','Tamil','Telugu','Bengali','Marathi','Kannada','Malayalam','Gujarati','Punjabi']

export default function SettingsScreen({ profile, token, onUpdate, onBack }: {
  profile: any
  token: string
  onUpdate: (p: any) => void
  onBack: () => void
}) {
  const { signOut } = useAuth()
  const [name, setName] = useState(profile?.name || '')
  const [grade, setGrade] = useState(profile?.grade || '')
  const [subject, setSubject] = useState(profile?.subject || '')
  const [language, setLanguage] = useState(profile?.language || 'English')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const { profile: updated } = await api.saveProfile(token, { name, grade, subject, language })
      onUpdate(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      alert('Failed to save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const Section = ({ title, children }: any) => (
    <div className="mb-5">
      <p className="text-xs font-bold text-forest/40 uppercase tracking-wider mb-2">{title}</p>
      <div className="card space-y-4">{children}</div>
    </div>
  )

  return (
    <div className="screen overflow-y-auto pb-8">
      {/* Header */}
      <div className="bg-forest px-5 pt-12 pb-5 flex items-center gap-3">
        <button onClick={onBack} className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center text-white text-lg">←</button>
        <h1 className="font-display text-2xl font-extrabold text-white">Settings</h1>
      </div>

      <div className="px-5 mt-5">
        {/* Profile */}
        <Section title="Profile">
          <div>
            <label className="text-xs font-bold text-forest/50 uppercase tracking-wider mb-1.5 block">Your name</label>
            <input className="input-field" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Enter your name" />
          </div>
        </Section>

        {/* Grade */}
        <Section title="Grade">
          <div className="grid grid-cols-3 gap-2">
            {grades.map(g => (
              <button key={g} onClick={() => setGrade(g)}
                className={`py-2.5 px-1 rounded-xl font-bold text-xs transition-all ${grade === g ? 'bg-saffron text-white' : 'bg-black/5 text-forest/70'}`}>
                {g}
              </button>
            ))}
          </div>
        </Section>

        {/* Subject */}
        <Section title="Primary Subject">
          <div className="grid grid-cols-2 gap-2">
            {subjects.map(s => (
              <button key={s} onClick={() => setSubject(s)}
                className={`py-2.5 px-3 rounded-xl font-bold text-xs text-left transition-all ${subject === s ? 'bg-saffron text-white' : 'bg-black/5 text-forest/70'}`}>
                {s}
              </button>
            ))}
          </div>
        </Section>

        {/* Language */}
        <Section title="Language">
          <div className="grid grid-cols-2 gap-2">
            {languages.map(l => (
              <button key={l} onClick={() => setLanguage(l)}
                className={`py-2.5 px-3 rounded-xl font-bold text-sm transition-all ${language === l ? 'bg-saffron text-white' : 'bg-black/5 text-forest/70'}`}>
                {l}
              </button>
            ))}
          </div>
        </Section>

        {/* Save */}
        <button onClick={handleSave} disabled={saving}
          className={`btn-primary w-full flex items-center justify-center gap-2 mb-4 ${saved ? '!bg-green-600' : ''}`}>
          {saving ? <><div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />Saving...</>
            : saved ? '✅ Saved!'
            : '💾 Save Changes'}
        </button>

        {/* Danger zone */}
        <div className="mb-4">
          <p className="text-xs font-bold text-forest/40 uppercase tracking-wider mb-2">Account</p>
          <div className="card space-y-3">
            <button onClick={signOut} className="w-full text-left text-red-500 font-bold text-sm flex items-center gap-2">
              <span>🚪</span> Sign Out
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-forest/25 pb-4">Alfanumrik v1.0 · Made with 🦊 in India</p>
      </div>
    </div>
  )
}
