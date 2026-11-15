import { useEffect } from 'react'
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

function Shell() {
  const route = useRoute()
  const { workspace } = useData()
  useEffect(() => {
    document.title = `${TITLES[route.name] ?? 'GRAVITYGUARD'}${workspace === 'demo' ? ' · SIMULATED' : ''} · GRAVITYGUARD`
  }, [route.name, workspace])
  return (
    <div className="gg-backdrop relative min-h-screen">
      <header className="sticky top-0 z-30">
        <CommandBar route={route} />
        <StatusRail />
      </header>
      <main className={`relative ${CONTAINER} pt-6 pb-12`}>
        <div key={route.name === 'event' || route.name === 'session' ? `${route.name}:${route.id}` : route.name} className="page-enter">
          <Page route={route} />
        </div>
      </main>
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
