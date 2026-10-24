'use client';

import { sendHailboxMessage } from 'hailbox';

export function BulkPricingButton() {
  return (
    <button
      type="button"
      className="cta"
      onClick={() => sendHailboxMessage('Do you offer discounts on bulk orders?')}
    >
      Ask about bulk pricing
    </button>
  );
}
