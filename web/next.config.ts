import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  // Pin the file-tracing root to web/ so Next doesn't get confused by the
  // parent repo's pnpm-lock.yaml and accidentally trace files outside the
  // app. Without this Next warns and may over-include the parent workspace.
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
