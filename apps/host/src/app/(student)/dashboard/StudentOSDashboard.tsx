'use client';

/**
 * StudentOSDashboard — Main student dashboard surface.
 *
 * Placeholder for the Foxy OS mobile redesign (ff_foxy_os_v1).
 * Renders the existing dashboard layout until the OS redesign is enabled.
 */

import React from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';

export default function StudentOSDashboard() {
  const { isHi } = useAuth();

  return (
    <div className="min-h-screen px-4 py-6">
      <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">
        {isHi ? 'डैशबोर्ड' : 'Dashboard'}
      </h1>
      <p className="text-gray-500">
        {isHi
          ? 'अपनी पढ़ाई शुरू करने के लिए एक विषय चुनें।'
          : 'Choose a subject to start studying.'}
      </p>
    </div>
  );
}
