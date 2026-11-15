import { useEffect, useSyncExternalStore } from 'react'
import { DashboardOptions, CONTAINER, Footer } from './components/Shell'
import { WarningInbox } from './components/WarningInbox'
import { CrewGuide } from './pages/CrewGuide'
import { Empty } from './components/ui'
import { DataProvider, useData } from './lib/data'
import { href, navigate, useRoute, type Route } from './lib/router'
import { hasSimulatorSignIn, watchSignIn } from './lib/watch-pairing'
import { PairWatch } from './pages/PairWatch'
import { CrewHealth } from './pages/CrewHealth'
import { EventHistory } from './pages/EventHistory'
import { Investigation } from './pages/Investigation'
import { Overview } from './pages/Overview'
import { SessionReport } from './pages/SessionReport'
import { SystemStatus } from './pages/SystemStatus'

function Page({ route }: { route: Route }) {
  const { snapshot, error } = useData()
  if (route.name === 'guide') return <CrewGuide />
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
  pair: 'Pair watch',
  overview: 'Mission Health',
  event: 'Event evidence',
  crew: 'Crew Health',
  session: 'Session report',
  events: 'Event History',
  system: 'System Status',
  guide: 'Crew Guide',
}

function subscribeToHash(listener: () => void) {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

function Shell() {
  const route = useRoute()
  const pairMode = useSyncExternalStore(subscribeToHash, () => location.hash)
  const { workspace } = useData()
  const hasAccess = watchSignIn() || (workspace === 'demo' && hasSimulatorSignIn())
  const needsPairing = route.name !== 'pair' && !hasAccess
  useEffect(() => {
    if (needsPairing) navigate(href.pair)
  }, [needsPairing, route.name])
  useEffect(() => {
    document.title = `${TITLES[route.name] ?? 'GRAVITYGUARD'}${workspace === 'demo' ? ' · SIMULATED' : ''} · GRAVITYGUARD`
  }, [route.name, workspace])
  if (route.name === 'pair') return <PairWatch key={pairMode} />
  if (needsPairing) return null

  return (
    <div className="gg-backdrop relative min-h-screen">
      <main className={`relative ${CONTAINER} dashboard-main pt-9 pb-16`}>
        <div key={route.name === 'event' || route.name === 'session' ? `${route.name}:${route.id}` : route.name} className="page-enter">
          <Page route={route} />
        </div>
        <DashboardOptions />
      </main>
      {workspace === 'demo' && <p className="mb-4 text-center text-sm text-ink-2"><span>Simulated demo</span><span className="ml-3">No astronaut data</span></p>}
      <Footer />
      <WarningInbox />
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
