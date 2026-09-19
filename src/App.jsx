import { useState, useEffect } from 'react'
import { compressFile } from './compress'
import { db, storage, auth } from './firebase'
import {
  collection, addDoc, onSnapshot, query,
  orderBy, serverTimestamp, deleteDoc, doc, updateDoc, getDocs, setDoc
} from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { signInAnonymously } from 'firebase/auth'
import './App.css'

const ORG_PASSWORD = 'lustrum'
const TOTAL_DAYS = 9
const ONE_HOUR_MS = 60 * 60 * 1000
const CHUGS_PER_FAST_WIN = 3

// ─── BORREL PILOT: seed data ─────────────────────────────────────────────────
// 8 competing teams from "Rally to Heaven 2027" line-up (Rolex - Camel Trophy
// excluded — that's the organizer team).
const BORREL_TEAMS_SEED = [
  { name: 'BP Club Heineken', members: ['Freek Schoffelmeer', 'Ludo van der Velde', 'Mateo Overes', 'Tom Calis', 'Justin Hansen', 'Jip van der Teems', 'Sjaars 1', 'Sjaars 2'] },
  { name: 'Team Hermès - Licor 43', members: ['Mats Voogelaar', 'Marten Buist', 'Silvan Dijkstra', 'Flemming Velde', 'Olivier Hart', 'Pieter Bondam', 'Lars Deenekamp', 'Florian Tilburg'] },
  { name: 'Lucky Strike Omega Cup', members: ['Maarten de Ruiter', 'Stephan van Eijndhoven', 'Arnoud Rebel', 'Teun Schrikkema', 'Niels Rijk', 'Lex van den Herik', 'Dirk van Amelsfort', 'Justus Kerckhaert'] },
  { name: 'Martini Fendi Forza', members: ['Darius Bakker', "Lasse l'Istelle", 'Bob ten Dolle', 'Bas Houben', 'Floris Kraaijeveld', 'Charlie Biesbroeck', "Daniel D'olivera de Marreiros", 'Mats Meijaard'] },
  { name: 'Marlboro Michelin Racing', members: ['Thijs Ballieux', 'Mark Heezen', 'Clemens van Riet', 'Jules Immers', 'Bob Hagenbeek', 'Silvester Giesen', 'Sjaars 3', 'Sjaars 4'] },
  { name: 'Johnny Walker - John Player Special', members: ['Florens Ballegooijen', 'Mo Gaff', 'Sjaars 5', 'Sjaars 6', 'Oscar Galjaard', 'Lucas Erkens', 'Quinten Allemans Hartog', 'Niels Fitton'] },
  { name: 'Team Prada Pirelli', members: ['Merlijn Dries', 'Chen Nelen', 'Quentin de Groot', 'Jens Mekel', 'Darius Béränos', 'Tijn van Rijswijk', 'Florian Vreeburg', 'Jens de Bruijn'] },
  { name: 'Land Rover Experience', members: ['Rob Coenen', 'Willibrord Grinwis', 'Thomas Hoos'] },
]

const BORREL_STATIONS_SEED = [
  { order: 1,  name: 'Wiel vervangen', time: '17:15 - 17:45', scoreDirection: 'asc',  unit: 'seconden', desc: '50%: 2 teams tegelijk in actie, 2 teams kijken toe. Materiaal: Landrover van Hidde, assteunen, ratel, krik, stopwatch.' },
  { order: 2,  name: 'Push-up maxxing', time: '17:15 - 17:45', scoreDirection: 'desc', unit: 'push-ups', desc: '50%: 2 teams tegelijk in actie, 2 teams kijken toe. Materiaal: yogamatje, eventueel een verhoging.' },
  { order: 3,  name: 'Skadi startje', time: '17:45 - 18:05', scoreDirection: 'asc',  unit: 'seconden (gemiddeld)', desc: 'Collectief station. Materiaal: bier, aantal deelnemers x3.' },
  { order: 4,  name: 'Feta eenhapsen', time: '18:05 - 18:30', scoreDirection: 'asc',  unit: 'seconden', desc: '50%: 2 teams tegelijk in actie, 2 teams kijken toe. Materiaal: 16 blokken feta.' },
  { order: 5,  name: 'Olijfproppen en rakja drinken', time: '18:05 - 18:30', scoreDirection: 'desc', unit: 'olijven in 1 mond', desc: '50%: 2 teams tegelijk in actie, 2 teams kijken toe. Materiaal: 320 olijven, 8 flessen rakja.' },
  { order: 6,  name: 'Ananas werpen', time: '', scoreDirection: 'desc', unit: 'meter', desc: 'Materiaal: 8 ananassen en handdoeken. Verste worp wint (bonusscore).' },
  { order: 7,  name: 'Rook estafette', time: '18:30 - 19:00', scoreDirection: 'asc',  unit: 'seconden', desc: '2 rondes, 4 teams per keer. Stappen: 1. shagje draaien, 2. shag oproken, 3. powerpeuk.' },
  { order: 8,  name: 'Borden darten van het balkon', time: '19:00 - 19:15', scoreDirection: 'desc', unit: 'borden door het gat', desc: '8 rondes. Materiaal: borden (4 per team), bouwfolie, cirkel op 2m hoogte (3 cirkels, bij missen terug naar 0, standaard op 1m).' },
  { order: 9,  name: 'Rondje tapkeuten', time: '19:15 - 19:45', scoreDirection: 'asc',  unit: 'seconden', desc: 'Materiaal: emmer, bhs, skadistart.' },
  { order: 10, name: 'Boksbal slaan', time: '', scoreDirection: 'desc', unit: 'punten (teamgemiddelde)', desc: 'Materiaal: boksbal, checkhelm, bokshandschoenen. Score is het teamgemiddelde.' },
]

function slugify(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

async function seedBorrel() {
  for (const t of BORREL_TEAMS_SEED) {
    await setDoc(doc(db, 'borrelTeams', slugify(t.name)), { name: t.name, members: t.members })
  }
  for (const s of BORREL_STATIONS_SEED) {
    await setDoc(doc(db, 'borrelStations', slugify(s.name)), s)
  }
}

function computeBorrelStandings(teamsList, stationsList, scoresMap) {
  const totals = Object.fromEntries(teamsList.map(t => [t.id, 0]))
  const perStation = {}
  stationsList.forEach(st => {
    const entries = teamsList
      .map(t => ({ id: t.id, val: scoresMap[`${st.id}_${t.id}`]?.value }))
      .filter(e => e.val !== undefined && e.val !== null && e.val !== '')
    entries.sort((a, b) => st.scoreDirection === 'asc' ? a.val - b.val : b.val - a.val)
    entries.forEach((e, i) => {
      totals[e.id] += entries.length - i
    })
    perStation[st.id] = entries.map((e, i) => ({ ...e, rank: i + 1 }))
  })
  return { totals, perStation }
}

function loadSession() {
  try { return JSON.parse(localStorage.getItem('lustrum_session') || 'null') } catch { return null }
}
function saveSession(s) { localStorage.setItem('lustrum_session', JSON.stringify(s)) }
function loadDay() { return parseInt(localStorage.getItem('lustrum_day') || '1', 10) }
function saveDay(d) { localStorage.setItem('lustrum_day', String(d)) }

// ─── MAIN APP ────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession]       = useState(loadSession)
  const [currentTab, setCurrentTab] = useState('challenges')
  const [currentDay, setCurrentDay] = useState(loadDay)
  const [teams, setTeams]           = useState({})
  const [challenges, setChallenges] = useState([])
  const [messages, setMessages]     = useState([])
  const [media, setMedia]           = useState([])
  const [chugs, setChugs]           = useState([])
  const [borrelTeams, setBorrelTeams]       = useState({})
  const [borrelStations, setBorrelStations] = useState({})
  const [borrelScores, setBorrelScores]     = useState({})

  useEffect(() => { signInAnonymously(auth).catch(console.error) }, [])

  useEffect(() => {
    if (session?.kind === 'borrel_team') setCurrentTab('borrel')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.kind])

  useEffect(() => {
    const unsubs = [
      onSnapshot(collection(db, 'teams'), snap => {
        const t = {}
        snap.forEach(d => { t[d.id] = { id: d.id, ...d.data() } })
        setTeams(t)
      }),
      onSnapshot(query(collection(db, 'challenges'), orderBy('postedAt', 'desc')), snap =>
        setChallenges(snap.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(query(collection(db, 'messages'), orderBy('sentAt', 'desc')), snap =>
        setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(query(collection(db, 'media'), orderBy('uploadedAt', 'desc')), snap =>
        setMedia(snap.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'chugs'), snap =>
        setChugs(snap.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'borrelTeams'), snap => {
        const t = {}
        snap.forEach(d => { t[d.id] = { id: d.id, ...d.data() } })
        setBorrelTeams(t)
      }),
      onSnapshot(collection(db, 'borrelStations'), snap => {
        const t = {}
        snap.forEach(d => { t[d.id] = { id: d.id, ...d.data() } })
        setBorrelStations(t)
      }),
      onSnapshot(collection(db, 'borrelScores'), snap => {
        const t = {}
        snap.forEach(d => { t[d.id] = { id: d.id, ...d.data() } })
        setBorrelScores(t)
      }),
    ]
    return () => unsubs.forEach(u => u())
  }, [])

  function handleSetSession(s) { saveSession(s); setSession(s) }
  function handleSignOut() { saveSession(null); setSession(null); setCurrentTab('challenges') }
  function handleChangeDay(d) { saveDay(d); setCurrentDay(d) }

  function pointsFor(teamId) {
    return challenges
      .filter(c => teams[teamId]?.completed?.[c.id])
      .reduce((sum, c) => sum + (c.points || 0), 0)
  }

  const ctx = {
    session, teams, challenges, messages, media, chugs,
    borrelTeams, borrelStations, borrelScores,
    currentDay, setCurrentDay: handleChangeDay,
    setSession: handleSetSession, signOut: handleSignOut,
  }

  const isOrg = session?.kind === 'org'
  const team  = session?.kind === 'team' ? teams[session.teamId] : null
  const borrelTeam = session?.kind === 'borrel_team' ? borrelTeams[session.teamId] : null

  const tabsList = isOrg
    ? [
        { id: 'challenges',  icon: '🎯', label: 'Challenges'  },
        { id: 'leaderboard', icon: '🏆', label: 'Leaderboard' },
        { id: 'messages',    icon: '💬', label: 'Messages'    },
        { id: 'memories',    icon: '🎞️', label: 'Memories'  },
        { id: 'team',        icon: '👥', label: 'Team'        },
        { id: 'borrel',      icon: '',  label: 'Benzineborrel' },
      ]
    : session?.kind === 'borrel_team'
    ? [
        { id: 'borrel',   icon: '',  label: 'Benzineborrel' },
        { id: 'messages', icon: '💬', label: 'Messages' },
      ]
    : [
        { id: 'challenges',  icon: '🎯', label: 'Challenges'  },
        { id: 'leaderboard', icon: '🏆', label: 'Leaderboard' },
        { id: 'messages',    icon: '💬', label: 'Messages'    },
        { id: 'memories',    icon: '🎞️', label: 'Memories'  },
        { id: 'team',        icon: '👥', label: 'Team'        },
      ]

  if (!session) return <SignIn ctx={ctx} />

  return (
    <div id="app">
      <header className="topbar">
        <div className="logo-small" />
        <div>
          <div className="app-title">Lustrum Reis</div>
          <div className="subtitle">Day {currentDay} of {TOTAL_DAYS}</div>
        </div>
        <div className="spacer" />
        <div className="who">
          {isOrg
            ? <><b>Reisco</b><span>Posting as host</span></>
            : team ? <><b>{team.name}</b><span>{session.memberName} · Team</span></>
            : borrelTeam ? <><b>{borrelTeam.name}</b><span>{session.memberName} · Benzineborrel</span></> : null}
        </div>
        <button className="btn secondary small" style={{marginLeft:10}} onClick={handleSignOut}>Uitloggen</button>
      </header>

      <main>
        {currentTab === 'challenges'  && <Challenges  ctx={ctx} pointsFor={pointsFor} />}
        {currentTab === 'leaderboard' && <Leaderboard ctx={ctx} pointsFor={pointsFor} />}
        {currentTab === 'messages'    && <Messages    ctx={ctx} />}
        {currentTab === 'memories'    && <Memories    ctx={ctx} />}
        {currentTab === 'team'        && <Team        ctx={ctx} pointsFor={pointsFor} />}
        {currentTab === 'borrel'      && <Borrel      ctx={ctx} />}
      </main>

      <nav className="tabs" style={{ gridTemplateColumns: `repeat(${tabsList.length},1fr)` }}>
        {tabsList.map(t => (
          <button key={t.id} className={currentTab === t.id ? 'active' : ''} onClick={() => setCurrentTab(t.id)}>
            <span className="ic">{t.icon}</span><span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

// ─── SIGN IN ─────────────────────────────────────────────────────────────────
function SignIn({ ctx }) {
  const { teams, borrelTeams, setSession } = ctx
  const [mode, setMode]             = useState('team')
  const [teamId, setTeamId]         = useState('')
  const [memberName, setMemberName] = useState('')
  const [orgPass, setOrgPass]       = useState('')
  const [newTeamName, setNewTeamName] = useState('')
  const [members, setMembers]       = useState(['', '', '', ''])
  const [error, setError]           = useState('')
  const [borrelTeamId, setBorrelTeamId]     = useState('')
  const [borrelMemberName, setBorrelMemberName] = useState('')

  const teamList     = Object.values(teams)
  const selectedTeam = teams[teamId]
  const borrelTeamList     = Object.values(borrelTeams).sort((a, b) => a.name.localeCompare(b.name))
  const selectedBorrelTeam = borrelTeams[borrelTeamId]

  function loginBorrel() {
    if (!borrelTeamId) { setError('Kies eerst een team.'); return }
    if (!borrelMemberName) { setError('Kies je naam.'); return }
    setSession({ kind: 'borrel_team', teamId: borrelTeamId, memberName: borrelMemberName })
  }

  function loginTeam() {
    if (!teamId) { setError('Pick a team first.'); return }
    if (!memberName) { setError('Pick your name.'); return }
    setSession({ kind: 'team', teamId, memberName })
  }

  async function createTeam() {
    const name = newTeamName.trim()
    const mems = members.map(m => m.trim()).filter(Boolean)
    if (!name) { setError('Give the team a name.'); return }
    if (mems.length !== 4) { setError('Fill in all 4 members.'); return }
    if (teamList.some(t => t.name.toLowerCase() === name.toLowerCase())) {
      setError('A team with that name already exists.'); return
    }
    const r = await addDoc(collection(db, 'teams'), { name, members: mems, completed: {} })
    setSession({ kind: 'team', teamId: r.id, memberName: mems[0] })
  }

  function loginOrg() {
    if (orgPass === ORG_PASSWORD) setSession({ kind: 'org' })
    else setError('Wrong password.')
  }

  return (
    <div className="signin-wrap">
      <h2>Dolgedraaid Lustrumreis 2027</h2>
      <p className="hint">Sign in as a team, or as Reisco.</p>
      <div className="switcher">
        <button className={mode === 'team' ? 'active' : ''} onClick={() => { setMode('team'); setError('') }}>Team</button>
        <button className={mode === 'borrel' ? 'active' : ''} onClick={() => { setMode('borrel'); setError('') }}>Benzineborrel</button>
        <button className={mode === 'org'  ? 'active' : ''} onClick={() => { setMode('org');  setError('') }}>Reisco</button>
      </div>

      {mode === 'team' && (
        <div className="card">
          <label className="field"><span>Choose a team</span>
            <select value={teamId} onChange={e => { setTeamId(e.target.value); setMemberName('') }}>
              <option value="">— pick a team —</option>
              {teamList.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          {selectedTeam && (
            <label className="field"><span>Your name</span>
              <select value={memberName} onChange={e => setMemberName(e.target.value)}>
                <option value="">— pick your name —</option>
                {selectedTeam.members.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          )}
          <button className="btn full" onClick={loginTeam}>Sign in</button>
          <div className="divider" />
          <p className="muted">No team yet? Create one:</p>
          <label className="field"><span>Team name</span>
            <input value={newTeamName} onChange={e => setNewTeamName(e.target.value)} placeholder="e.g. The Paddling Panthers" />
          </label>
          {[0,1,2,3].map(i => (
            <label key={i} className="field"><span>Member {i+1}</span>
              <input value={members[i]} onChange={e => { const m=[...members]; m[i]=e.target.value; setMembers(m) }} />
            </label>
          ))}
          <button className="btn full" style={{marginTop:4}} onClick={createTeam}>Create team + sign in</button>
          {error && <div className="error">{error}</div>}
        </div>
      )}

      {mode === 'borrel' && (
        <div className="card">
          <p className="muted">Doe mee met de borrel-pilot. Kies je team en daarna jezelf.</p>
          <label className="field"><span>Team</span>
            <select value={borrelTeamId} onChange={e => { setBorrelTeamId(e.target.value); setBorrelMemberName('') }}>
              <option value="">— kies een team —</option>
              {borrelTeamList.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          {borrelTeamList.length === 0 && (
            <p className="muted" style={{fontSize:12}}>Nog geen teams geladen — Reisco moet eerst inloggen en de teams &amp; stations laden op het Benzineborrel-tabblad.</p>
          )}
          {selectedBorrelTeam && (
            <label className="field"><span>Jouw naam</span>
              <select value={borrelMemberName} onChange={e => setBorrelMemberName(e.target.value)}>
                <option value="">— kies je naam —</option>
                {selectedBorrelTeam.members.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          )}
          <button className="btn full" onClick={loginBorrel}>Inloggen</button>
          {error && <div className="error">{error}</div>}
        </div>
      )}

      {mode === 'org' && (
        <div className="card">
          <p className="muted">Reisco posts daily challenges and messages.</p>
          <label className="field"><span>Reisco password</span>
            <input type="password" value={orgPass} onChange={e => setOrgPass(e.target.value)} />
          </label>
          <button className="btn full" onClick={loginOrg}>Sign in as Reisco</button>
          {error && <div className="error">{error}</div>}
        </div>
      )}
    </div>
  )
}

// ─── CHALLENGES ──────────────────────────────────────────────────────────────
function Challenges({ ctx }) {
  const { session, teams, challenges, chugs, currentDay, setCurrentDay } = ctx
  const isOrg  = session.kind === 'org'
  const teamId = session.teamId

  const [ncTitle, setNcTitle]   = useState('')
  const [ncDesc, setNcDesc]     = useState('')
  const [ncPoints, setNcPoints] = useState(10)
  const [ncDay, setNcDay]       = useState(currentDay)
  const [modal, setModal]       = useState(null)

  const forDay  = challenges.filter(c => c.day === currentDay)
  const incoming = !isOrg
    ? chugs.filter(c => c.toTeamId === teamId && c.status === 'assigned' && c.dayAssigned === currentDay)
    : []

  async function postChallenge() {
    if (!ncTitle.trim() || !ncDesc.trim() || ncPoints <= 0) {
      alert('Fill in title, description, and points.'); return
    }
    await addDoc(collection(db, 'challenges'), {
      day: ncDay, title: ncTitle, desc: ncDesc,
      points: Number(ncPoints), postedAt: Date.now()
    })
    await addDoc(collection(db, 'messages'), {
      from: 'Reisco',
      body: `📢 New challenge for Day ${ncDay}: ${ncTitle} (${ncPoints} pts). First team done within the hour earns ${CHUGS_PER_FAST_WIN} beer-forfeit cards!`,
      sentAt: serverTimestamp()
    })
    setNcTitle(''); setNcDesc(''); setNcPoints(10)
  }

  async function deleteChallenge(id) {
    if (!confirm('Delete this challenge?')) return
    await deleteDoc(doc(db, 'challenges', id))
  }

  async function undoDone(challengeId) {
    const completed = { ...(teams[teamId]?.completed || {}) }
    delete completed[challengeId]
    await updateDoc(doc(db, 'teams', teamId), { completed })
  }

  return (
    <section>
      <div className="row">
        <h2 style={{margin:0}}>Challenges</h2>
        <div className="spacer" />
        <select className="btn secondary small" value={currentDay} onChange={e => setCurrentDay(Number(e.target.value))}>
          {Array.from({length:TOTAL_DAYS},(_,i)=>i+1).map(d => <option key={d} value={d}>Day {d}</option>)}
        </select>
      </div>

      {incoming.length > 0 && (
        <div className="card" style={{marginTop:12}}>
          <b>🍺 Beer forfeit assigned to your team</b>
          {incoming.map(c => (
            <div key={c.id} className="chug incoming" style={{marginTop:8}}>
              <div className="chug-title">🍺 Chug 1 beer — from {teams[c.fromTeamId]?.name || '?'}</div>
              <p className="muted" style={{fontSize:12,margin:'4px 0 8px'}}>Upload proof before the day ends.</p>
              <button className="btn beer small" onClick={() => setModal({ type:'chug', id:c.id })}>Upload proof</button>
            </div>
          ))}
        </div>
      )}

      {isOrg && (
        <div className="card" style={{marginTop:12}}>
          <b>Post a new challenge</b>
          <label className="field"><span>Day</span>
            <select value={ncDay} onChange={e => setNcDay(Number(e.target.value))}>
              {Array.from({length:TOTAL_DAYS},(_,i)=>i+1).map(d => <option key={d} value={d}>Day {d}</option>)}
            </select>
          </label>
          <label className="field"><span>Title</span>
            <input value={ncTitle} onChange={e => setNcTitle(e.target.value)} placeholder="e.g. Best sunset photo" />
          </label>
          <label className="field"><span>Description</span>
            <textarea value={ncDesc} onChange={e => setNcDesc(e.target.value)} placeholder="What teams should do" />
          </label>
          <label className="field"><span>Points</span>
            <input type="number" value={ncPoints} onChange={e => setNcPoints(e.target.value)} min="1" />
          </label>
          <p className="muted" style={{fontSize:12}}>⏱ Teams finishing within 1 hour earn {CHUGS_PER_FAST_WIN} beer-forfeit cards.</p>
          <button className="btn" onClick={postChallenge}>Post challenge</button>
        </div>
      )}

      {forDay.length === 0
        ? <div className="card" style={{marginTop:12}}><i className="muted">No challenges for day {currentDay} yet.</i></div>
        : forDay.map(c => {
            const completion = !isOrg ? teams[teamId]?.completed?.[c.id] : null
            const done    = !!completion
            const inHour  = (Date.now() - c.postedAt) <= ONE_HOUR_MS
            const minsLeft = Math.max(0, Math.ceil((c.postedAt + ONE_HOUR_MS - Date.now()) / 60000))
            return (
              <div key={c.id} className={`card challenge${done?' done':''}`} style={{marginTop:12}}>
                <div className="row">
                  <div className="challenge-title">{c.title}</div>
                  <div className="spacer" />
                  <span className="pill">{c.points} pts</span>
                </div>
                <div className="desc">{c.desc}</div>
                <div className="row" style={{flexWrap:'wrap',gap:6,marginTop:8}}>
                  <div className="meta">Day {c.day}</div>
                  {!done && inHour && <span className="countdown">⏱ {minsLeft} min left for bonus</span>}
                  <div className="spacer" />
                  {isOrg
                    ? <button className="btn secondary small" onClick={() => deleteChallenge(c.id)}>Delete</button>
                    : done
                      ? <><span className="pill green">✓ {completion.by}</span>
                          <button className="btn secondary small" onClick={() => undoDone(c.id)}>Undo</button></>
                      : <button className="btn small" onClick={() => setModal({ type:'done', id:c.id })}>✓ Mark done + upload proof</button>
                  }
                </div>
              </div>
            )
          })
      }

      {modal?.type === 'done' && <MarkDoneModal  challengeId={modal.id} ctx={ctx} onClose={() => setModal(null)} />}
      {modal?.type === 'chug' && <ChugProofModal chugId={modal.id}      ctx={ctx} onClose={() => setModal(null)} />}
    </section>
  )
}

// ─── MARK DONE MODAL ─────────────────────────────────────────────────────────
function MarkDoneModal({ challengeId, ctx, onClose }) {
  const { session, teams, challenges, currentDay } = ctx
  const ch     = challenges.find(c => c.id === challengeId)
  const inHour = ch ? (Date.now() - ch.postedAt) <= ONE_HOUR_MS : false
  const [file, setFile]         = useState(null)
  const [caption, setCaption]   = useState('')
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  async function save() {
    if (!file) { alert('Pick a photo or video first.'); return }
    setUploading(true)
    setProgress(0)
    try {
      const compressed = await compressFile(file, setProgress)
      const storageRef = ref(storage, `proof/${challengeId}_${session.teamId}_${Date.now()}`)
      await uploadBytes(storageRef, compressed)
      const url = await getDownloadURL(storageRef)
      const mediaDoc = await addDoc(collection(db, 'media'), {
        url, type: file.type.startsWith('video') ? 'video' : 'photo',
        teamId: session.teamId, memberName: session.memberName,
        challengeId, kind: 'challenge_proof', caption,
        uploadedAt: serverTimestamp(), dayUploaded: currentDay
      })
      const completed = { ...(teams[session.teamId]?.completed || {}), [challengeId]: { at: Date.now(), by: session.memberName, proofMediaId: mediaDoc.id } }
      await updateDoc(doc(db, 'teams', session.teamId), { completed })

      if (inHour) {
        for (let i = 0; i < CHUGS_PER_FAST_WIN; i++) {
          await addDoc(collection(db, 'chugs'), {
            fromTeamId: session.teamId, toTeamId: null,
            sourceChallengeId: challengeId, dayEarned: currentDay, status: 'unassigned'
          })
        }
        await addDoc(collection(db, 'messages'), {
          from: 'App',
          body: `🍺 ${teams[session.teamId]?.name} finished "${ch.title}" within the hour — they earned ${CHUGS_PER_FAST_WIN} beer-forfeit cards!`,
          sentAt: serverTimestamp()
        })
      }
      onClose()
    } catch (e) { alert('Upload failed: ' + e.message) }
    setUploading(false)
  }

  return (
    <div className="modal">
      <div className="sheet">
        <button className="close" onClick={onClose}>×</button>
        <h3>Complete: {ch?.title}</h3>
        <p className="muted">Upload a photo or video as proof.</p>
        {inHour && <div className="pill beer" style={{display:'inline-block',marginBottom:8}}>⏱ Within the hour → {CHUGS_PER_FAST_WIN} beer-forfeit cards!</div>}
        <label className="drop">
          <input type="file" accept="image/*,video/*" onChange={e => setFile(e.target.files[0])} />
          <div>{file ? `✓ ${file.name}` : '📷 Tap to choose a photo or video'}</div>
        </label>
        <label className="field" style={{marginTop:10}}><span>Caption (optional)</span>
          <input value={caption} onChange={e => setCaption(e.target.value)} placeholder="e.g. on top of the cliff!" />
        </label>
        <div className="row" style={{marginTop:10}}>
          <div className="spacer" />
          <button className="btn secondary small" onClick={onClose}>Cancel</button>
          <button className="btn small" onClick={save} disabled={uploading}>
            {uploading ? `${progress < 100 ? `Compressing… ${progress}%` : 'Uploading…'}` : 'Save & mark done'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── CHUG PROOF MODAL ────────────────────────────────────────────────────────
function ChugProofModal({ chugId, ctx, onClose }) {
  const { session, teams, chugs, currentDay } = ctx
  const c    = chugs.find(x => x.id === chugId)
  const from = teams[c?.fromTeamId]?.name || '?'
  const [file, setFile]           = useState(null)
  const [caption, setCaption]     = useState('')
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress]   = useState(0)

  async function save() {
    if (!file) { alert('Pick a photo or video first.'); return }
    setUploading(true)
    setProgress(0)
    try {
      const compressed = await compressFile(file, setProgress)
      const storageRef = ref(storage, `chugs/${chugId}_${Date.now()}`)
      await uploadBytes(storageRef, compressed)
      const url = await getDownloadURL(storageRef)
      const mediaDoc = await addDoc(collection(db, 'media'), {
        url, type: file.type.startsWith('video') ? 'video' : 'photo',
        teamId: c.toTeamId, memberName: session.memberName,
        kind: 'chug_proof', caption: caption || 'Beer forfeit 🍺',
        uploadedAt: serverTimestamp(), dayUploaded: currentDay
      })
      await updateDoc(doc(db, 'chugs', chugId), { proofMediaId: mediaDoc.id, completedAt: Date.now(), status: 'completed' })
      onClose()
    } catch (e) { alert('Upload failed: ' + e.message) }
    setUploading(false)
  }

  return (
    <div className="modal">
      <div className="sheet">
        <button className="close" onClick={onClose}>×</button>
        <h3>🍺 Upload chug proof</h3>
        <p className="muted">Assigned by {from}. One member chugs, another films.</p>
        <label className="drop">
          <input type="file" accept="image/*,video/*" onChange={e => setFile(e.target.files[0])} />
          <div>{file ? `✓ ${file.name}` : '📷 Tap to choose a photo or video'}</div>
        </label>
        <label className="field" style={{marginTop:10}}><span>Caption (optional)</span>
          <input value={caption} onChange={e => setCaption(e.target.value)} placeholder="e.g. Revenge is sweet" />
        </label>
        <div className="row" style={{marginTop:10}}>
          <div className="spacer" />
          <button className="btn secondary small" onClick={onClose}>Cancel</button>
          <button className="btn beer small" onClick={save} disabled={uploading}>
            {uploading ? `${progress < 100 ? `Compressing… ${progress}%` : 'Uploading…'}` : 'Save proof'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── LEADERBOARD ─────────────────────────────────────────────────────────────
function Leaderboard({ ctx, pointsFor }) {
  const { teams } = ctx
  const sorted = Object.values(teams).map(t => ({ t, pts: pointsFor(t.id) })).sort((a,b) => b.pts - a.pts)
  return (
    <section>
      <h2>Leaderboard</h2>
      <p className="hint">Most points at the end of day {TOTAL_DAYS} wins.</p>
      <div className="card">
        {sorted.length === 0
          ? <i className="muted">No teams yet.</i>
          : sorted.map((r,i) => (
            <div key={r.t.id} className={`rank p${i+1}`}>
              <div className="pos">{i+1}</div>
              <div className="tname">
                {r.t.name}
                <div className="muted" style={{fontWeight:400,fontSize:12}}>{r.t.members?.join(', ')}</div>
              </div>
              <div className="pts">{r.pts} pts</div>
            </div>
          ))
        }
      </div>
    </section>
  )
}

// ─── MESSAGES ────────────────────────────────────────────────────────────────
function Messages({ ctx }) {
  const { session, messages } = ctx
  const isOrg = session.kind === 'org'
  const [body, setBody] = useState('')

  async function postMessage() {
    if (!body.trim()) return
    await addDoc(collection(db, 'messages'), { from: 'Reisco', body, sentAt: serverTimestamp() })
    setBody('')
  }

  return (
    <section>
      <h2>Messages</h2>
      <p className="hint">Announcements from Reisco. Everyone sees them.</p>
      {isOrg && (
        <div className="card">
          <b>New broadcast message</b>
          <label className="field" style={{marginTop:8}}><span>Message</span>
            <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="e.g. Dinner tonight at 19:00!" />
          </label>
          <button className="btn" onClick={postMessage}>Send to everyone</button>
        </div>
      )}
      {messages.length === 0
        ? <div className="card"><i className="muted">No messages yet.</i></div>
        : messages.map(m => (
          <div key={m.id} className="msg">
            <div className="msg-from"><b>{m.from}</b></div>
            <div className="msg-body">{m.body}</div>
          </div>
        ))
      }
    </section>
  )
}

// ─── MEMORIES ────────────────────────────────────────────────────────────────
function Memories({ ctx }) {
  const { session, teams, challenges, chugs, media, currentDay } = ctx
  const isOrg = session.kind === 'org'
  const [caption, setCaption]     = useState('')
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress]   = useState(0)
  const [assignSelections, setAssignSelections] = useState({})

  const myUnassignedChugs = !isOrg
    ? chugs.filter(c => c.fromTeamId === session.teamId && c.status === 'unassigned')
    : []

  const todayMedia = media
    .filter(m => m.dayUploaded === currentDay)
    .sort((a,b) => {
      const ta = a.uploadedAt?.seconds ?? 0
      const tb = b.uploadedAt?.seconds ?? 0
      return tb - ta
    })

  async function handleUpload(files) {
    if (!files.length) return
    setUploading(true)
    const all = Array.from(files)
    for (let i = 0; i < all.length; i++) {
      const file = all[i]
      setProgress(0)
      try {
        const compressed = await compressFile(file, setProgress)
        const storageRef = ref(storage, `memories/${session.teamId}_${Date.now()}_${file.name}`)
        await uploadBytes(storageRef, compressed)
        const url = await getDownloadURL(storageRef)
        await addDoc(collection(db, 'media'), {
          url, type: file.type.startsWith('video') ? 'video' : 'photo',
          teamId: session.teamId, memberName: session.memberName,
          kind: 'general', caption,
          uploadedAt: serverTimestamp(), dayUploaded: currentDay
        })
      } catch (e) { alert('Upload failed: ' + e.message) }
    }
    setCaption('')
    setUploading(false)
  }

  async function assignChug(chugId, toTeamId) {
    if (!toTeamId) { alert('Pick a team first.'); return }
    await updateDoc(doc(db, 'chugs', chugId), {
      toTeamId, assignedAt: Date.now(), dayAssigned: currentDay, status: 'assigned'
    })
    const target = teams[toTeamId]?.name
    await addDoc(collection(db, 'messages'), {
      from: teams[session.teamId]?.name || 'A team',
      body: `🍺 Beer forfeit sent to ${target}: chug 1 beer today, upload proof in the Challenges tab.`,
      sentAt: serverTimestamp()
    })
  }

  const otherTeams = Object.values(teams).filter(t => t.id !== session.teamId)

  return (
    <section>
      <h2>Memories</h2>
      <p className="hint">Upload photos or videos any time. Everyone on the trip sees them.</p>

      {myUnassignedChugs.length > 0 && (
        <div className="card">
          <b>🍺 Your beer-forfeit cards</b>
          <p className="muted" style={{fontSize:12,marginBottom:8}}>Hand them out — the target team must chug a beer and film it.</p>
          {myUnassignedChugs.map(c => {
            const ch = challenges.find(x => x.id === c.sourceChallengeId)
            const selected = assignSelections[c.id] || ''
            return (
              <div key={c.id} className="chug">
                <div className="chug-title">🍺 Beer-forfeit card</div>
                <p className="muted" style={{fontSize:12,margin:'4px 0 8px'}}>From: "{ch?.title || '?'}"</p>
                <div className="row">
                  <select
                    className="btn secondary small"
                    style={{padding:'8px 10px'}}
                    value={selected}
                    onChange={e => setAssignSelections(prev => ({...prev, [c.id]: e.target.value}))}
                  >
                    <option value="">— pick a team —</option>
                    {otherTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <button className="btn beer small" onClick={() => assignChug(c.id, selected)}>Send</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="card">
        <b>Share a moment</b>
        <p className="muted" style={{fontSize:12}}>Any member can add to the shared feed.</p>
        <label className="drop">
          <input type="file" accept="image/*,video/*" multiple onChange={e => handleUpload(e.target.files)} disabled={uploading} />
          <div>{uploading ? `${progress < 100 ? `Compressing… ${progress}%` : 'Uploading…'}` : '📷 Tap to upload a photo or video'}</div>
        </label>
        <label className="field" style={{marginTop:10}}><span>Caption (optional)</span>
          <input value={caption} onChange={e => setCaption(e.target.value)} placeholder="e.g. breakfast chaos" />
        </label>
      </div>

      <div className="card">
        <b>Today — Day {currentDay}</b>
        <span className="muted" style={{marginLeft:8,fontSize:13}}>{todayMedia.length} item{todayMedia.length !== 1 ? 's' : ''}</span>
        <div className="thumb-grid">
          {todayMedia.length === 0
            ? <p className="muted" style={{gridColumn:'1/-1'}}>No photos yet today.</p>
            : todayMedia.map(m => (
              <div key={m.id} className={`thumb${m.type === 'video' ? ' video' : ''}`}>
                {m.type === 'video'
                  ? <video src={m.url} muted playsInline />
                  : <img src={m.url} alt={m.caption || ''} loading="lazy" />
                }
                {m.caption && <div className="cap">{m.caption}</div>}
              </div>
            ))
          }
        </div>
      </div>
    </section>
  )
}

// ─── TEAM / SETTINGS ─────────────────────────────────────────────────────────
function Team({ ctx, pointsFor }) {
  const { session, teams, chugs, currentDay, setCurrentDay, signOut } = ctx
  const isOrg = session.kind === 'org'
  const team  = teams[session.teamId]

  async function removeTeam(id) {
    if (!confirm('Remove this team?')) return
    await deleteDoc(doc(db, 'teams', id))
  }

  async function resetAll() {
    if (!confirm('Erase EVERYTHING and start from scratch? This cannot be undone.')) return
    for (const col of ['teams','challenges','messages','media','chugs']) {
      const snap = await getDocs(collection(db, col))
      for (const d of snap.docs) await deleteDoc(doc(db, col, d.id))
    }
    signOut()
  }

  return (
    <section>
      <h2>{isOrg ? 'Reisco' : 'Your team'}</h2>

      <div className="card">
        {isOrg ? (
          <>
            <b>You are Reisco</b>
            <p className="muted">Post challenges and broadcast messages.</p>
            <div className="divider" />
            <b>All teams</b>
            {Object.values(teams).map(t => (
              <div key={t.id} className="row" style={{padding:'6px 0',borderBottom:'1px dashed var(--border)'}}>
                <div style={{flex:1}}>
                  <b>{t.name}</b>
                  <div className="muted" style={{fontSize:12}}>{t.members?.join(', ')}</div>
                </div>
                <span className="pill green">{pointsFor(t.id)} pts</span>
                <button className="btn secondary small" onClick={() => removeTeam(t.id)} style={{marginLeft:8}}>Remove</button>
              </div>
            ))}
          </>
        ) : team ? (
          <>
            <b>{team.name}</b>
            <div className="muted" style={{marginBottom:8}}>{team.members?.join(' · ')}</div>
            <div style={{marginBottom:6}}>Signed in as <b>{session.memberName}</b></div>
            <span className="pill green">{pointsFor(team.id)} points</span>
            <span className="pill soft" style={{marginLeft:6}}>{Object.keys(team.completed||{}).length} challenges done</span>
            <span className="pill beer" style={{marginLeft:6}}>
              {chugs.filter(c => c.fromTeamId === team.id && c.status !== 'unassigned').length} beer-cards given
            </span>
          </>
        ) : <p className="muted">Loading…</p>}
      </div>

      <div className="card">
        <b>Settings</b>
        <div className="row" style={{marginTop:8}}>
          <span className="muted">Current day</span>
          <div className="spacer" />
          <button className="btn secondary small" onClick={() => currentDay > 1 && setCurrentDay(currentDay - 1)}>◀</button>
          <b style={{minWidth:70,textAlign:'center'}}>Day {currentDay}</b>
          <button className="btn secondary small" onClick={() => currentDay < TOTAL_DAYS && setCurrentDay(currentDay + 1)}>▶</button>
        </div>
        <div className="divider" />
        <button className="btn secondary" onClick={signOut}>Sign out</button>
        {isOrg && <button className="btn warn" onClick={resetAll} style={{marginLeft:8}}>Reset all data</button>}
      </div>
    </section>
  )
}

// ─── BORREL (PILOT EVENT) ────────────────────────────────────────────────────
function Borrel({ ctx }) {
  const { session, borrelTeams, borrelStations, borrelScores } = ctx
  const isOrg = session.kind === 'org'
  const [seeding, setSeeding] = useState(false)

  const teamsList    = Object.values(borrelTeams).sort((a, b) => a.name.localeCompare(b.name))
  const stationsList = Object.values(borrelStations).sort((a, b) => (a.order || 0) - (b.order || 0))
  const { totals, perStation } = computeBorrelStandings(teamsList, stationsList, borrelScores)
  const standings = teamsList.map(t => ({ t, pts: totals[t.id] || 0 })).sort((a, b) => b.pts - a.pts)

  async function doSeed() {
    setSeeding(true)
    try { await seedBorrel() } catch (e) { alert('Laden mislukt: ' + e.message) }
    setSeeding(false)
  }

  return (
    <section>
      <h2>Benzineborrel</h2>
      <p className="hint">Pilot-avond met stations. Organisator voert scores live in, iedereen ziet de tussenstand. Bekendmaking om 20:00.</p>

      {session.kind === 'borrel_team' && (
        <p className="muted" style={{marginTop:-8,marginBottom:12}}>Ingelogd als <b>{session.memberName}</b></p>
      )}

      {isOrg && teamsList.length === 0 && (
        <div className="card">
          <b>Eerste keer instellen</b>
          <p className="muted">Laad de 8 teams en 10 stations in de app.</p>
          <button className="btn" onClick={doSeed} disabled={seeding}>{seeding ? 'Bezig…' : 'Teams & stations laden'}</button>
        </div>
      )}

      <div className="card">
        <b>Tussenstand</b>
        {standings.length === 0
          ? <p className="muted">Nog geen teams geladen.</p>
          : standings.map((r, i) => (
            <div key={r.t.id} className={`rank p${i + 1}`}>
              <div className="pos">{i + 1}</div>
              <div className="tname">{r.t.name}</div>
              <div className="pts">{r.pts} pt</div>
            </div>
          ))
        }
      </div>

      {stationsList.map(st => (
        <StationCard
          key={st.id} station={st} teamsList={teamsList} scoresMap={borrelScores}
          isOrg={isOrg} rankInfo={perStation[st.id] || []} myTeamId={session.teamId}
        />
      ))}
    </section>
  )
}

function StationCard({ station, teamsList, scoresMap, isOrg, rankInfo, myTeamId }) {
  const [desc, setDesc]     = useState(station.desc || '')
  const [values, setValues] = useState(() => {
    const v = {}
    teamsList.forEach(t => { v[t.id] = scoresMap[`${station.id}_${t.id}`]?.value ?? '' })
    return v
  })
  const [saving, setSaving] = useState(false)

  async function saveDesc() {
    await updateDoc(doc(db, 'borrelStations', station.id), { desc })
  }

  async function saveScores() {
    setSaving(true)
    try {
      for (const t of teamsList) {
        const val = values[t.id]
        if (val === '' || val === undefined) continue
        await setDoc(doc(db, 'borrelScores', `${station.id}_${t.id}`), {
          stationId: station.id, teamId: t.id, value: Number(val), updatedAt: Date.now()
        })
      }
    } catch (e) { alert('Opslaan mislukt: ' + e.message) }
    setSaving(false)
  }

  const myResult = rankInfo.find(r => r.id === myTeamId)

  return (
    <div className="card">
      <div className="row">
        <b>{station.name}</b>
        <div className="spacer" />
        {station.time && <span className="pill soft">{station.time}</span>}
      </div>
      <div className="muted" style={{fontSize:12,marginTop:4}}>
        {station.scoreDirection === 'asc' ? 'Laagste score wint' : 'Hoogste score wint'} · eenheid: {station.unit}
      </div>

      {isOrg ? (
        <>
          <label className="field" style={{marginTop:8}}><span>Uitleg voor teams</span>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} />
          </label>
          <button className="btn secondary small" onClick={saveDesc}>Uitleg opslaan</button>
          <div className="divider" />
          {teamsList.map(t => (
            <label key={t.id} className="field" style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{flex:1}}>{t.name}</span>
              <input
                type="number" style={{width:110}} value={values[t.id]}
                onChange={e => setValues(v => ({ ...v, [t.id]: e.target.value }))}
                placeholder={station.unit}
              />
            </label>
          ))}
          <button className="btn small" onClick={saveScores} disabled={saving}>{saving ? 'Opslaan…' : 'Scores opslaan'}</button>
        </>
      ) : (
        <>
          <p className="muted" style={{marginTop:8,whiteSpace:'pre-wrap'}}>{station.desc || 'Uitleg volgt nog.'}</p>
          {myResult
            ? <span className="pill green">Jullie: plek {myResult.rank} ({myResult.val} {station.unit})</span>
            : <span className="pill soft">Nog geen score ingevoerd</span>
          }
        </>
      )}
    </div>
  )
}
