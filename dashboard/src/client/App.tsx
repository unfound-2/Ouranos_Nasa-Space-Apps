import { useEffect } from 'react'
import earth from './assets/earth-horizon.webp'
import { CommandBar, CONTAINER, Footer, StatusRail } from './components/Shell'
import { SimWatchOverlay } from './components/SimWatch'
import { Empty } from './components/ui'
import { DataProvider, useData } from './lib/data'
import { href, useRoute, type Route } from './lib/router'
import { CrewHealth } from './pages/CrewHealth'
import { EventHistory } from './pages/EventHistory'
import { Investigation } from './pages/Investigation'
import { Overview } from './pages/Overview'
import { SessionReport } from './pages/SessionReport'
import { SystemStatus } from './pages/SystemStatus'

function Page({ route }: { route: Route }) {
  const { snapshot, error } = useData()
  if (route.name === 'system') return <SystemStatus />
  if (error)
    return (
      <div className="mx-auto max-w-2xl py-12">
        <Empty title="No data shown: the local API is not reachable" action={<a className="btn btn-ghost" href={href.system}>System status</a>}>
          This dashboard reads only from the mission-computer API on this machine and never substitutes other data. Start it with <span className="font-mono">npm start</span> (or{' '}
          <span className="font-mono">npm run dev</span>) in the dashboard folder.
        </Empty>
      </div>
    )
  if (!snapshot)
    return (
      <div className="py-16 text-center">
        <div className="micro">Loading records from this computer</div>
      </div>
    )
  switch (route.name) {
    case 'overview':
      return <Overview />
    case 'event':
      return <Investigation id={route.id} />
    case 'crew':
      return <CrewHealth />
    case 'session':
      return <SessionReport id={route.id} />
    case 'events':
      return <EventHistory />
    default:
      return (
        <div className="mx-auto max-w-2xl py-12">
          <Empty title="Page not found" action={<a className="btn btn-ghost" href={href.overview}>Overview</a>} />
        </div>
      )
  }
}

const TITLES: Partial<Record<Route['name'], string>> = {
  overview: 'Mission Health',
  event: 'Event evidence',
  crew: 'Crew Health',
  session: 'Session report',
  events: 'Event History',
  system: 'System Status',
}

/**
 * NASA photograph iss072e340644, "An orbital sunrise crowns Earth's horizon" (public domain), as a
 * single static image: the horizon behind the Overview hero, a softer band on the other pages.
 */
function EarthBackdrop({ hero }: { hero: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 overflow-hidden" style={{ height: hero ? 900 : 360 }}>
      <div
        className="absolute inset-x-0"
        style={{
          top: hero ? 170 : -70,
          height: hero ? 690 : 360,
          backgroundImage: `url(${earth})`,
          backgroundSize: 'cover',
          backgroundPosition: hero ? 'center top' : 'center 4%',
          opacity: hero ? 1 : 0.4,
          maskImage: 'linear-gradient(to bottom, black 0%, black 35%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 35%, transparent 100%)',
        }}
      />
    </div>
  )
}

function Shell() {
  const route = useRoute()
  const { workspace } = useData()
  useEffect(() => {
    document.title = `${TITLES[route.name] ?? 'GRAVITYGUARD'}${workspace === 'demo' ? ' · SIMULATED' : ''} · GRAVITYGUARD`
  }, [route.name, workspace])
  return (
    <div className="gg-backdrop relative min-h-screen">
      <header>
        <CommandBar route={route} />
      </header>
      <div className="sticky top-0 z-30">
        <StatusRail />
      </div>
      <div className="relative">
        <EarthBackdrop hero={route.name === 'overview'} />
        <main className={`relative ${CONTAINER} pt-8 pb-16`}>
          <div key={route.name === 'event' || route.name === 'session' ? `${route.name}:${route.id}` : route.name} className="page-enter">
            <Page route={route} />
          </div>
        </main>
      </div>
      <Footer />
      <SimWatchOverlay />
    </div>
  )
}

export function App() {
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  )
}
