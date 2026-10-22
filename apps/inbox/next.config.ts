import type { NextConfig } from 'next';

const config: NextConfig = {
  // Native/optional-dependency-heavy server packages work best unbundled.
  serverExternalPackages: ['ws', 'ioredis', 'pg'],
};

export default config;
