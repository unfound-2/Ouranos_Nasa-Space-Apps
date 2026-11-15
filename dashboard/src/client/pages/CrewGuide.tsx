const chapters = [
  {
    id: 'dizziness',
    title: 'Lightheadedness after a gravity change',
    evidence: 'NASA describes postflight orthostatic intolerance as difficulty maintaining blood pressure while standing after a return to gravity. It can cause lightheadedness or fainting.',
    actions: ['Notify the crew medical officer and follow the mission’s approved procedure.', 'Log when symptoms began, the gravity transition or task, and the crew member’s posture.', 'Open the matching event and attach available readings with their source and timestamp. Use only mission-approved equipment and procedures for any follow-up measurements.'],
    source: 'NASA · The Human Body in Space',
    url: 'https://www.nasa.gov/humans-in-space/the-human-body-in-space/',
  },
  {
    id: 'nausea',
    title: 'Nausea or motion sickness',
    evidence: 'NASA reports that space adaptation sickness can affect up to 73% of crewmembers during the first two to three days of spaceflight. Symptoms can also occur when returning to Earth gravity.',
    actions: ['Tell the crew medical officer and use the mission’s approved motion sickness procedure.', 'Record when the symptoms began, whether they changed during the task, and any effect on the crew member’s ability to work.'],
    source: 'NASA · Fundamentals of Human Health',
    url: 'https://www.nasa.gov/reference/fundamentals-of-human-health/',
  },
  {
    id: 'communications',
    title: 'When Earth support is delayed',
    evidence: 'NASA’s mission duration brief describes how communications delays can limit real-time ground support and require crews to solve more problems with resources onboard.',
    actions: ['Use the onboard medical procedures and notify the designated crew medical officer. Follow mission escalation rules for time-critical situations.', 'Prepare the handoff with symptom onset in UTC, recent activities, readings and their source, actions already taken, and changes since the first report.', 'Send the update through the mission’s approved communications channel.'],
    source: 'NASA OCHMO · Mission Duration Technical Brief',
    url: 'https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-007-mission-duration.pdf',
  },
]

export function CrewGuide() {
  return (
    <article className="mx-auto grid max-w-3xl gap-6">
      <header>
        <h1 className="display faded-label text-[36px]">Crew guide</h1>
        <p className="mt-2 text-ink-2">NASA research and practical steps for recording and sharing an event. For medical decisions, follow the mission’s approved procedures and crew medical officer.</p>
      </header>
      <nav aria-label="Guide chapters" className="flex flex-wrap gap-x-5 gap-y-2">
        {chapters.map(({ id, title }) => <button key={id} type="button" className="text-ink-2 underline" onClick={() => document.getElementById(id)?.scrollIntoView()}>{title}</button>)}
      </nav>
      {chapters.map(({ id, title, evidence, actions, source, url }) => (
        <section key={id} id={id} className="panel scroll-mt-24 p-5 sm:p-7">
          <h2 className="display faded-label text-[23px]">{title}</h2>
          <p className="mt-2 text-ink-2">{evidence}</p>
          <h3 className="mt-4 font-medium">What to do</h3>
          <ol className="mt-2 list-decimal space-y-2 pl-5">
            {actions.map((action) => <li key={action}>{action}</li>)}
          </ol>
          <a className="mt-4 inline-block text-ink-2 underline" href={url} target="_blank" rel="noreferrer">{source}</a>
        </section>
      ))}
    </article>
  )
}
