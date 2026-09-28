'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Evergreen search: finds clips on any topic across every sermon, via Ask's clip finder
export default function ClipSearch() {
  const [q, setQ] = useState('');
  const router = useRouter();
  const go = () => q.trim().length > 1 && router.push(`/ask?q=${encodeURIComponent(`Find clips about ${q.trim()}`)}`);
  return (
    <div className="ac-bar clips-search">
      <input
        placeholder="Find clips on any topic, from any year"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && go()}
      />
      <button onClick={go}>Search</button>
    </div>
  );
}
