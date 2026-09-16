import React, { useLayoutEffect, useRef } from 'react';

// Textarea that grows/shrinks to fit its content (no inner scrollbar).
export default function AutoTextarea({ value, ...props }) {
  const ref = useRef(null);

  // Runs after every render (not just value changes) so fields inside
  // freshly opened/collapsed cards measure correctly once visible.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  });

  return <textarea ref={ref} value={value} {...props} />;
}
