import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createCrewAssistant } from './crew-assistant'

const prompt = {
  question: 'What changed in oxygen?', mode: 'chat', topic: 'reading-check', feed: 'demo',
  readings: [{ label: 'Oxygen saturation', unit: 'points', delta: -0.9, comparison: 'Simulated rest reference' }],
}

function app(fetch?: typeof globalThis.fetch, groq = '') {
  const server = express()
  const assistant = createCrewAssistant({ groq, url: 'https://test.supabase.co', key: 'test-key', request: fetch })
  return server.use(express.json()).get('/guide', assistant.list).post('/assist', assistant.explain)
}

describe('sourced crew assistant', () => {
  it('retrieves stored checklists and returns only a cited guide from its candidates', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (url, init) => {
      if (String(url).startsWith('https://test.supabase.co')) {
        expect(String(url)).toContain('/gg_crew_checklists')
        return Response.json([{ entry: {
          id: 'oxygen-breathing', title: 'Oxygen checklist from Supabase', category: 'Measurements', kind: 'workflow',
          summary: 'Compare readings taken together.', steps: ['Record the source.', 'Share the timeline.'],
          sources: [{ title: 'NASA spaceflight risks', url: 'https://www.nasa.gov/humans-in-space/hhc-spaceflight-risks/' }],
        } }])
      }
      expect(String(url)).toBe('https://api.groq.com/openai/v1/chat/completions')
      const body = JSON.parse(String(init?.body))
      expect(body.model).toBe('openai/gpt-oss-20b')
      expect(body.messages[1].content).toContain('Simulated rest reference')
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        answer: 'Oxygen is below the simulated reference.', guideId: 'oxygen-breathing',
      }) } }] })
    })
    const server = app(fetch, 'test-groq-key')
    const response = await request(server).post('/assist').send(prompt).expect(200)
    expect(response.body.mode).toBe('online')
    expect(response.body.guide.title).toBe('Oxygen checklist from Supabase')
    expect(response.body.guide.sources[0].url).toMatch(/^https:\/\/www\.nasa\.gov\//)
    const catalog = await request(server).get('/guide').expect(200)
    expect(catalog.body).toHaveLength(14)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('falls back to a bundled match when the model invents a citation', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"answer":"See the site","guideId":"made-up"}' } }] }))
    const response = await request(app(fetch, 'test-groq-key')).post('/assist').send(prompt).expect(200)
    expect(response.body).toMatchObject({ mode: 'local', guide: { id: 'oxygen-breathing' } })
  })
})
