'use client';

import { openHailbox } from 'hailbox';

export function ContactButton() {
  return (
    <button type="button" className="cta" onClick={openHailbox}>
      Contact sales
    </button>
  );
}
