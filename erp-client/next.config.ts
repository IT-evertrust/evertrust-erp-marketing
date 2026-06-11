import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// ESM config: derive __dirname for outputFileTracingRoot below.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone with server.js + a
  // minimal node_modules) so the Docker runner stage stays slim. See
  // erp-client/Dockerfile.
  output: 'standalone',
  // In a monorepo the file tracer must root at the repo top so it picks up the
  // hoisted node_modules and workspace packages, not just erp-client.
  outputFileTracingRoot: path.join(__dirname, '..'),
  // Transpile the workspace package that ships raw TS source (no build step).
  transpilePackages: ['@evertrust/shared'],
  // Fail the production build on type or lint errors instead of silently shipping.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
};

export default nextConfig;
