/**
 * Entry point: `npm run dev:api` (tsx watch) and `npm start` (NODE_ENV=production).
 *
 * Environment:
 *   GG_PORT          port (default 4317)
 *   GG_DATA_DIR      where mission.json, demo.json and device-token live (default dashboard/data)
 *   GG_LAN=1         listen on the local network (0.0.0.0) so the watch can reach this computer;
 *                    otherwise only 127.0.0.1
 *   GG_DEVICE_TOKEN  use this device token instead of the token file
 *   NODE_ENV=production  also serve the built dashboard from dashboard/dist when it exists
 */
import { existsSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp, type MissionComputer } from './app'
import { lanIPv4Addresses } from './security'

const DASHBOARD_ROOT = fileURLToPath(new URL('../../', import.meta.url))

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 4317
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`GG_PORT must be a port number (1-65535), got "${raw}".`)
    process.exit(1)
  }
  return port
}

const port = parsePort(process.env.GG_PORT)
const lan = process.env.GG_LAN === '1'
const bind = lan ? '0.0.0.0' : '127.0.0.1'
const dataDir = path.resolve(process.env.GG_DATA_DIR || path.join(DASHBOARD_ROOT, 'data'))
const production = process.env.NODE_ENV === 'production'
const distDir = path.join(DASHBOARD_ROOT, 'dist')
const staticDir = production && existsSync(path.join(distDir, 'index.html')) ? distDir : null

let mc: MissionComputer
try {
  mc = createApp({ dataDir, lan, staticDir, log: (line) => console.log(line) })
} catch (e) {
  console.error(`OURANOS mission computer did not start.\n${(e as Error).message}`)
  process.exit(1)
}

const server = http.createServer(mc.app)

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${port} on ${bind} is already in use. Stop the other server or set GG_PORT.`)
  else console.error(`Server error: ${err.message}`)
  void mc.close().finally(() => process.exit(1))
})

server.listen(port, bind, () => {
  const lines = [
    'OURANOS mission computer API (core monitoring works offline)',
    `  Local:        http://127.0.0.1:${port}/api/v1/health`,
  ]
  if (lan) {
    const ips = lanIPv4Addresses(os.networkInterfaces())
    if (ips.length) for (const ip of ips) lines.push(`  LAN:          http://${ip}:${port}/api/v1/  (for the watch)`)
    else lines.push('  LAN:          GG_LAN=1, but this computer has no local-network IPv4 address right now')
  } else {
    lines.push('  LAN:          off (start with GG_LAN=1 so the watch can reach this computer)')
  }
  lines.push(
    staticDir
      ? `  Dashboard:    http://127.0.0.1:${port}/  (serving ${staticDir})`
      : production
        ? '  Dashboard:    dist/ not found; run npm run build first'
        : `  Dashboard:    development: Vite on http://127.0.0.1:${process.env.GG_WEB_PORT ?? 5317}/ (npm run dev)`,
  )
  lines.push(`  Data dir:     ${mc.info.dataDir}`)
  for (const f of mc.info.createdFiles) lines.push(`  Created:      ${f}`)
  const where =
    mc.info.tokenSource === 'file'
      ? `${mc.info.tokenCreated ? 'new, saved in' : 'from'} ${mc.info.tokenFile}`
      : mc.info.tokenSource === 'env'
        ? 'from GG_DEVICE_TOKEN'
        : 'from the token option'
  lines.push(`  Device token: ${mc.info.tokenPrefix} (${where}); the full token is on the dashboard System Status page`)
  console.log(lines.join('\n'))
})

let stopping = false
async function shutdown(signal: string) {
  if (stopping) {
    console.log('Second signal: exiting now.')
    process.exit(1)
  }
  stopping = true
  console.log(`${signal}: finishing pending writes, then stopping.`)
  const force = setTimeout(() => {
    console.error('Shutdown took longer than 10 s; exiting.')
    process.exit(1)
  }, 10_000)
  force.unref()
  server.close()
  server.closeIdleConnections()
  let code = 0
  try {
    await mc.close()
  } catch (e) {
    console.error(`Could not finish pending writes: ${(e as Error).message}`)
    code = 1
  }
  server.closeAllConnections()
  process.exit(code)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
