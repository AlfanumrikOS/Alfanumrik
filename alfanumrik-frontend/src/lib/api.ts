// Chat with Foxy AI tutor
  async chat(token: string, messages: any, profile: any) {
    try {
      // Handle both string messages and array format
      let formattedMessages = messages
      if (typeof messages === 'string') {
        formattedMessages = [{ role: 'user', content: messages }]
      } else if (Array.isArray(messages)) {
        formattedMessages = messages
      } else {
        formattedMessages = [{ role: 'user', content: String(messages) }]
      }

      const res = await fetch(`${SB_URL}/functions/v1/foxy-tutor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: formattedMessages,
          student_name: profile?.name || 'Student',
          grade: profile?.grade || 'Grade 6',
          subject: profile?.subject || 'Mathematics',
          language: profile?.language || 'en',
        }),
      })
      const data = await res.json()
      return { text: data.text || 'Sorry, Foxy had a hiccup! Try again.', message: data.text || 'Sorry, Foxy had a hiccup! Try again.' }
    } catch (e) {
      console.error('Chat error:', e)
      return { text: 'Sorry, Foxy had a hiccup! Try again.', message: 'Sorry, Foxy had a hiccup! Try again.' }
    }
  },
