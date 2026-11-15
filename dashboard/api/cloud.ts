import type { IncomingMessage, ServerResponse } from 'node:http'
import { createCloudApp } from '../src/server/cloud-app'

const app = createCloudApp({
  url: process.env.SUPABASE_URL ?? 'https://ohbufsembuzekdnwlpsd.supabase.co',
  key: process.env.SUPABASE_SECRET_KEY,
})

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'https://localhost')
  if (url.pathname === '/api/cloud') {
    const path = url.searchParams.get('__gg_route')
    if (path && /^[a-zA-Z0-9/_-]+$/.test(path)) {
      url.pathname = `/api/${path}`
      url.searchParams.delete('__gg_route')
      req.url = url.pathname + url.search
    }
  }
  app(req, res)
}
