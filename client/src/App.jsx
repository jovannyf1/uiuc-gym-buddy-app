import React, { useEffect, useRef, useState } from 'react';
import { ChatsPage, PresencePage } from './Social.jsx';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ACTIVITIES = ['Strength training', 'Cardio', 'General workout', 'Group fitness', 'Stretching & mobility'];
const LOCATIONS = ['ARC', 'CRCE'];
const NAV = [
  { id: 'home', label: 'Overview', icon: 'home' },
  { id: 'matches', label: 'Find a buddy', icon: 'users' },
  { id: 'now', label: 'Working out now', icon: 'bolt' },
  { id: 'chats', label: 'Chats', icon: 'chat' },
  { id: 'availability', label: 'My availability', icon: 'calendar' },
  { id: 'import', label: 'Import schedule', icon: 'upload' },
  { id: 'meetups', label: 'Meetups', icon: 'meetup' },
  { id: 'profile', label: 'My profile', icon: 'user' },
];

async function api(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: isForm ? options.headers : { 'Content-Type': 'application/json', ...options.headers },
  });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || data?.message || `Request failed (${response.status})`);
  return data;
}

function Icon({ name, size = 20, strokeWidth = 1.8, className = '' }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const shapes = {
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="M9 21v-7h6v7" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    upload: <><path d="M12 16V3m0 0L7 8m5-5 5 5" /><path d="M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>,
    meetup: <><path d="M7 3h10a2 2 0 0 1 2 2v16l-7-4-7 4V5a2 2 0 0 1 2-2Z" /><path d="M9 9h6m-6 4h6" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    dumbbell: <><path d="m6.5 6.5 11 11M4 9l5-5m6 16 5-5M2 11l9-9m2 20 9-9" /></>,
    arrow: <><path d="M5 12h14m-6-6 6 6-6 6" /></>,
    back: <><path d="M19 12H5m6 6-6-6 6-6" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    pin: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    spark: <><path d="m12 2 1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2Z" /><path d="m19 17 .7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7L19 17Z" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="M5 5 19 19M19 5 5 19" />,
    check: <path d="m4 12 5 5L20 6" />,
    chevron: <path d="m6 9 6 6 6-6" />,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8m-8 4h8" /></>,
    info: <><circle cx="12" cy="12" r="10" /><path d="M12 11v6m0-10h.01" /></>,
    alert: <><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v4m0 4h.01" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 9A7 7 0 0 1 18 7l2 5M4 12l2 5a7 7 0 0 0 12.5-2" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    menu: <path d="M3 6h18M3 12h18M3 18h18" />,
    chat: <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8A8.5 8.5 0 0 1 12.5 20a8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3 8.5 8.5 0 0 1 21 11.5Z" /><path d="M8 11.5h9" /></>,
    bolt: <path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z" />,
    send: <><path d="m22 2-7 20-4-9-9-4L22 2Z" /><path d="M22 2 11 13" /></>,
    flag: <><path d="M5 21V4m0 1c5-4 9 4 15 0v12c-6 4-10-4-15 0" /></>,
    block: <><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></>,
  };
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...common}>{shapes[name] || shapes.spark}</svg>;
}

function Brand({ compact = false }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}>
    <span className="brand-mark"><Icon name="dumbbell" size={24} strokeWidth={2.1} /></span>
    <span className="brand-copy"><strong>UIUC <span>Gym Buddy</span></strong><small>APP</small></span>
  </div>;
}

function Avatar({ name = '?', index = 0, size = '' }) {
  const initials = String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';
  return <span className={`avatar avatar-${index % 5} ${size && `avatar-${size}`}`} aria-hidden="true">{initials}</span>;
}

function formatTime(value) {
  if (!value) return '';
  const [hour, minute] = value.split(':').map(Number);
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, '0')}` : ''}${hour < 12 ? 'am' : 'pm'}`;
}
function formatWindow(slot, fullDay = false) {
  if (!slot) return '';
  return `${fullDay ? DAYS[slot.day] : SHORT_DAYS[slot.day]} · ${formatTime(slot.start)}–${formatTime(slot.end)}`;
}
function formatDate(date) {
  if (!date) return '';
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function formatCampusTime(dateTime) {
  const parsed = new Date(dateTime);
  return Number.isNaN(parsed.getTime()) ? '' : new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(parsed);
}
function localISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function uiucClock() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}
function nextDateForDay(day, start) {
  const now = uiucClock();
  const result = new Date(`${now.date}T12:00:00`);
  const todayDay = dayFromDate(now.date);
  let daysAhead = (day - todayDay + 7) % 7;
  if (daysAhead === 0 && start && now.minute >= timeMinutes(start)) daysAhead = 7;
  result.setDate(result.getDate() + daysAhead);
  return localISO(result);
}
function dayFromDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? -1 : (date.getDay() + 6) % 7;
}
function normalizeSlots(slots = []) {
  const clean = slots.filter(s => Number.isInteger(Number(s.day)) && Number(s.day) >= 0 && Number(s.day) <= 6 && s.start && s.end && s.start < s.end)
    .map(s => ({ day: Number(s.day), start: s.start, end: s.end }))
    .sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  const merged = [];
  for (const slot of clean) {
    const last = merged.at(-1);
    if (last && last.day === slot.day && slot.start <= last.end) last.end = slot.end > last.end ? slot.end : last.end;
    else merged.push({ ...slot });
  }
  return merged;
}
function timeMinutes(value) {
  const [hours, minutes] = String(value || '').split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : 0;
}
function minuteTime(value) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
function suggestedWorkoutWindow(slot) {
  const earliest = timeMinutes(slot.start);
  const latest = timeMinutes(slot.end);
  const start = [17 * 60, 18 * 60, 12 * 60, 7 * 60, 9 * 60].find(candidate => candidate >= earliest && candidate + 60 <= latest) ?? earliest;
  return { day: /^\d{4}-\d{2}-\d{2}$/.test(String(slot.day)) ? dayFromDate(slot.day) : Number(slot.day), start: minuteTime(start), end: minuteTime(Math.min(latest, start + 60)) };
}
function previewDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? formatDate(value) : DAYS[Number(value)] || 'Unknown day';
}
function personName(person) { return typeof person === 'string' ? person : person?.name || 'Student'; }
function personId(person) { return typeof person === 'object' ? person?.id : person; }
function labelForGender(value) {
  return ({ male: 'Man', female: 'Woman', nonbinary: 'Nonbinary', 'prefer-not-to-say': 'Not specified' })[value] || '';
}
function SectionTitle({ eyebrow, title, description, action }) {
  return <div className="section-head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}
function EmptyState({ icon, title, description, action }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={27} /></span><h3>{title}</h3><p>{description}</p>{action}</div>;
}
function Notice({ type = 'success', children, onClose }) {
  return <div className={`notice notice-${type}`} role="status"><Icon name={type === 'error' ? 'alert' : 'check'} size={18} /><span>{children}</span><button type="button" className="icon-button" aria-label="Dismiss message" onClick={onClose}><Icon name="close" size={16} /></button></div>;
}

function AuthScreen({ onAuth, error, busy, authOptions }) {
  const [mode, setMode] = useState('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  function submit(event) {
    event.preventDefault();
    onAuth(mode, { name: name.trim(), email: email.trim(), password });
  }
  return <main className="auth-shell">
    <div className="auth-visual">
      <div className="auth-visual-top"><Brand /><span className="campus-pill">BUILT FOR UIUC STUDENTS</span></div>
      <div className="auth-visual-center">
        <div className="auth-orbit orbit-one" /><div className="auth-orbit orbit-two" />
        <div className="auth-large-icon"><Icon name="dumbbell" size={80} strokeWidth={1.25} /></div>
        <span className="auth-floating-card card-a"><span className="mini-avatar">A</span><span><strong>Example match</strong><small>Same time, same gym</small></span><Icon name="check" size={16} /></span>
        <span className="auth-floating-card card-b"><Icon name="spark" size={19} /><span><strong>Better together.</strong><small>Find your workout partner</small></span></span>
      </div>
      <div className="auth-visual-bottom"><span className="hero-kicker">YOUR CAMPUS. YOUR PACE. YOUR PEOPLE.</span><h1>Show up stronger,<br /><em>together.</em></h1><p>Find a workout buddy who fits your schedule, your goals, and your way of moving.</p></div>
    </div>
    <div className="auth-panel"><div className="auth-panel-inner"><div className="auth-mobile-brand"><Brand /></div><span className="eyebrow">WELCOME TO UIUC GYM BUDDY</span><h2>{mode === 'login' && authOptions.pilotAuthEnabled && !authOptions.netidEnabled ? 'Welcome back.' : 'Find your people.'}</h2><p className="auth-lede">Meet students who are ready to work out when you are.</p>
      {authOptions.loading ? <p className="auth-lede" role="status">Checking sign-in options…</p> : authOptions.netidEnabled ? <div className="netid-login"><a className="button button-primary button-full" href="/api/auth/netid/start">Sign in with Illinois NetID <Icon name="arrow" size={18} /></a><p>Your university sign-in opens next. You’ll return here when it’s complete.</p>{error && <p className="inline-error" role="alert"><Icon name="alert" size={16} />{error}</p>}</div> : authOptions.pilotAuthEnabled ? <><p className="auth-pilot-notice"><Icon name="info" size={18} /> Pilot sign-in: an @illinois.edu email address is required, but ownership is not verified yet.</p><div className="auth-tabs" role="group" aria-label="Account action"><button type="button" aria-pressed={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Create account</button><button type="button" aria-pressed={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Sign in</button></div>
      <form className="auth-form" onSubmit={submit}>{mode === 'register' && <label>Full name<input type="text" autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" required maxLength={80} /></label>}<label>Email address<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@illinois.edu" required /></label><label>Password<input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'register' ? 'At least 8 characters' : 'Your password'} required minLength={mode === 'register' ? 8 : 1} /></label>{error && <p className="inline-error" role="alert"><Icon name="alert" size={16} />{error}</p>}<button className="button button-primary button-full" type="submit" disabled={busy}>{busy ? 'Just a moment…' : mode === 'register' ? 'Create my pilot account' : 'Sign in'}<Icon name="arrow" size={18} /></button></form></> : <div className="auth-pending" role="status"><Icon name="lock" size={23} /><h3>Sign-in setup pending</h3><p>Illinois NetID sign-in has not been connected yet. Please check back after the app is configured.</p></div>}
      <p className="auth-footnote"><Icon name="shield" size={17} /> Your schedule is reviewed before any free times are added to your profile.</p>
    </div></div>
  </main>;
}

function Sidebar({ view, setView, me, onLogout, mobileOpen, setMobileOpen, pendingCount }) {
  return <><div className={`sidebar-backdrop ${mobileOpen ? 'show' : ''}`} onClick={() => setMobileOpen(false)} /><aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
    <div className="sidebar-brand"><Brand /><button type="button" className="icon-button sidebar-close" aria-label="Close menu" onClick={() => setMobileOpen(false)}><Icon name="close" /></button></div>
    <div className="sidebar-label">YOUR SPACE</div><nav className="sidebar-nav" aria-label="Main navigation">{NAV.map(item => <button key={item.id} type="button" className={`nav-item ${view === item.id ? 'active' : ''}`} aria-current={view === item.id ? 'page' : undefined} onClick={() => { setView(item.id); setMobileOpen(false); }}><Icon name={item.icon} size={20} /><span>{item.label}</span>{item.id === 'meetups' && pendingCount > 0 && <b className="nav-count">{pendingCount}</b>}</button>)}</nav>
    <div className="sidebar-bottom"><div className="sidebar-tip"><span><Icon name="spark" size={19} /></span><strong>Make your next workout count.</strong><p>Good company starts with showing up.</p></div><div className="sidebar-user"><Avatar name={me?.name} /><div><strong>{me?.name || 'Student'}</strong><small>UIUC community</small></div><button type="button" className="icon-button" aria-label="Sign out" title="Sign out" onClick={onLogout}><Icon name="logout" size={19} /></button></div></div>
  </aside></>;
}

function MatchCard({ match, index, onRequest, onChat, compact = false }) {
  const user = match.user || match;
  const sharedActivities = match.sharedActivities || [];
  const sharedLocations = match.sharedLocations || [];
  const overlaps = match.overlaps || [];
  return <article className={`match-card ${compact ? 'match-card-compact' : ''}`}>
    <div className="match-top"><Avatar name={user.name} index={index} size={compact ? '' : 'large'} /><div className="match-identity"><h3>{user.name}</h3><p>{[labelForGender(user.gender), user.experience && `${user.experience[0].toUpperCase()}${user.experience.slice(1)}`].filter(Boolean).join(' · ') || 'Workout buddy'}</p></div>{index === 0 && <span className="match-badge"><Icon name="spark" size={14} /> Great fit</span>}</div>
    {!compact && user.bio && <p className="match-bio">{user.bio}</p>}
    <div className="match-chips">{(sharedActivities.length ? sharedActivities : user.activities || []).slice(0, compact ? 2 : 3).map(activity => <span className="chip" key={activity}>{activity}</span>)}</div>
    <div className="match-details"><div><Icon name="clock" size={16} /><span>{overlaps[0] ? formatWindow(overlaps[0]) : 'No shared time yet'}</span></div><div><Icon name="pin" size={16} /><span>{sharedLocations[0] || (user.locations || [])[0] || 'Choose a location'}</span></div></div>
    <div className="match-actions"><button type="button" className={`button ${compact ? 'button-text' : 'button-outline'}`} onClick={() => onRequest(match)} disabled={!overlaps.length}>{compact ? 'View & invite' : 'Invite to a workout'}<Icon name="arrow" size={17} /></button><button type="button" className="button button-subtle" onClick={() => onChat(user)}><Icon name="chat" size={17} /> Chat</button></div>
  </article>;
}

function Home({ me, slots, matches, meetups, setView, onRequest, onChat }) {
  const first = (me?.name || 'there').split(' ')[0];
  const upcoming = meetups.filter(m => m.status === 'accepted' && (!m.date || m.date >= uiucClock().date)).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))[0];
  const pendingIncoming = meetups.filter(m => m.status === 'pending' && String(personId(m.toUser)) === String(me?.id)).length;
  const nextSlot = slots.map(s => ({ ...s, date: nextDateForDay(s.day, s.start) })).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))[0];
  return <div className="page-content home-page"><div className="page-greeting"><span className="eyebrow">YOUR WORKOUT CONNECTION</span><h1>Hey, {first}<span className="greeting-period">.</span></h1><p>Good things happen when you show up together.</p></div>
    <section className="home-hero"><div className="hero-content"><span className="hero-pill"><Icon name="spark" size={15} /> YOUR NEXT WORKOUT STARTS HERE</span><h2>Better workouts<br />start with <em>better company.</em></h2><p>Find someone whose schedule and goals line up with yours. Make a plan, then make it happen.</p><button type="button" className="button button-cream" onClick={() => setView('matches')}>Find a buddy <Icon name="arrow" size={18} /></button></div><div className="hero-art" aria-hidden="true"><span className="hero-ring hero-ring-a" /><span className="hero-ring hero-ring-b" /><span className="hero-art-circle"><Icon name="dumbbell" size={86} strokeWidth={1.3} /></span><span className="hero-art-label label-one">YOU GOT THIS</span><span className="hero-art-label label-two">LET'S GO →</span></div></section>
    <div className="stats-grid"><div className="stat-card"><span className="stat-icon orange"><Icon name="users" /></span><div><strong>{matches.length}</strong><span>potential {matches.length === 1 ? 'buddy' : 'buddies'}</span></div></div><div className="stat-card"><span className="stat-icon blue"><Icon name="calendar" /></span><div><strong>{slots.length}</strong><span>open {slots.length === 1 ? 'time' : 'times'} added</span></div></div><div className="stat-card"><span className="stat-icon green"><Icon name="meetup" /></span><div><strong>{pendingIncoming}</strong><span>{pendingIncoming === 1 ? 'invite' : 'invites'} waiting</span></div></div></div>
    <div className="home-columns"><section><SectionTitle eyebrow="PEOPLE FOR YOUR PACE" title="Students you could meet" action={<button type="button" className="link-button" onClick={() => setView('matches')}>See all <Icon name="arrow" size={16} /></button>} />{matches.length ? <div className="home-matches">{matches.slice(0, 2).map((match, i) => <MatchCard key={match.user?.id || i} match={match} index={i} compact onRequest={onRequest} onChat={onChat} />)}</div> : <EmptyState icon="users" title="Your people are on the way" description="Add a few available times and profile details so students can find a good match with you." action={<button type="button" className="button button-outline" onClick={() => setView('availability')}>Add availability <Icon name="arrow" size={16} /></button>} />}</section>
      <section><SectionTitle eyebrow="YOUR NEXT MOVE" title="Coming up" />{upcoming ? <div className="upcoming-card"><span className="upcoming-label">CONFIRMED WORKOUT</span><h3>{upcoming.activity}</h3><p>With {String(personId(upcoming.fromUser)) === String(me?.id) ? personName(upcoming.toUser) : personName(upcoming.fromUser)}</p><div className="upcoming-meta"><span><Icon name="calendar" size={17} />{upcoming.date ? formatDate(upcoming.date) : DAYS[upcoming.day]}</span><span><Icon name="clock" size={17} />{formatTime(upcoming.start)}–{formatTime(upcoming.end)}</span><span><Icon name="pin" size={17} />{upcoming.location}</span></div><button type="button" className="link-button" onClick={() => setView('meetups')}>View meetup <Icon name="arrow" size={16} /></button></div> : <div className="next-step-card"><span className="next-step-icon"><Icon name={nextSlot ? 'clock' : 'calendar'} size={25} /></span><h3>{nextSlot ? 'You have time to move' : 'Make room for a workout'}</h3><p>{nextSlot ? `Your next open window is ${formatDate(nextSlot.date)}, ${formatTime(nextSlot.start)}–${formatTime(nextSlot.end)}. Find someone to join you.` : 'Add the times you are free so we can show you students who are free then too.'}</p><button type="button" className="button button-outline" onClick={() => setView(nextSlot ? 'matches' : 'availability')}>{nextSlot ? 'Find a buddy' : 'Add availability'} <Icon name="arrow" size={16} /></button></div>}</section></div>
  </div>;
}

function Matches({ matches, slots, onRequest, onChat, setView, loading, onRefresh }) {
  const [query, setQuery] = useState('');
  const [activity, setActivity] = useState('all');
  const filtered = matches.filter(match => {
    const user = match.user || match;
    const text = `${user.name || ''} ${(user.activities || []).join(' ')} ${(match.sharedActivities || []).join(' ')}`.toLowerCase();
    return text.includes(query.toLowerCase()) && (activity === 'all' || (user.activities || []).includes(activity));
  });
  return <div className="page-content"><SectionTitle eyebrow="FIND YOUR PEOPLE" title="Workout buddies" description="Students who share your interests and have time to work out when you do." action={<button type="button" className="button button-subtle" onClick={onRefresh} disabled={loading}><Icon name="refresh" size={17} /> Refresh</button>} />
    {!slots.length && <div className="callout"><Icon name="info" size={20} /><div><strong>Add your free times to improve your matches.</strong><p>Matching works best when we know when you could meet.</p></div><button type="button" className="link-button" onClick={() => setView('availability')}>Add times <Icon name="arrow" size={16} /></button></div>}
    <div className="filter-bar"><label className="search-field"><span className="sr-only">Search buddies</span><Icon name="users" size={18} /><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search people or activities" /></label><label className="select-field"><span className="sr-only">Filter by activity</span><select value={activity} onChange={e => setActivity(e.target.value)}><option value="all">All activities</option>{ACTIVITIES.map(item => <option key={item}>{item}</option>)}</select><Icon name="chevron" size={16} /></label></div>
    {loading ? <div className="loading-panel">Finding people who fit your schedule…</div> : filtered.length ? <div className="match-grid">{filtered.map((match, i) => <MatchCard key={match.user?.id || i} match={match} index={i} onRequest={onRequest} onChat={onChat} />)}</div> : <EmptyState icon="users" title={matches.length ? 'No matches for these filters' : 'No buddies found just yet'} description={matches.length ? 'Try a different search or activity.' : 'Add more open times and activities, then check back as more students join.'} action={!matches.length && <button type="button" className="button button-primary" onClick={() => setView('availability')}>Add available times <Icon name="arrow" size={16} /></button>} />}
  </div>;
}

function Availability({ slots, onSave, setView }) {
  const [day, setDay] = useState(0);
  const [start, setStart] = useState('17:00');
  const [end, setEnd] = useState('18:00');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function save(next) {
    setSaving(true); setError('');
    try { await onSave(normalizeSlots(next)); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  function add(event) {
    event.preventDefault();
    if (start >= end) { setError('End time must be later than start time.'); return; }
    save([...slots, { day: Number(day), start, end }]);
  }
  return <div className="page-content"><SectionTitle eyebrow="MAKE TIME TO MOVE" title="My availability" description="Add windows when you could go to the gym. Other students only see shared free times, not your full schedule." action={<button type="button" className="button button-subtle" onClick={() => setView('import')}><Icon name="upload" size={17} /> Import schedule</button>} />
    <div className="availability-layout"><section className="panel add-time-panel"><div className="panel-heading"><span className="panel-icon"><Icon name="plus" size={21} /></span><div><h3>Add an open time</h3><p>Pick a day and time you are usually free.</p></div></div><form className="add-time-form" onSubmit={add}><label>Day of the week<select value={day} onChange={e => setDay(Number(e.target.value))}>{DAYS.map((d, i) => <option value={i} key={d}>{d}</option>)}</select></label><div className="form-pair"><label>From<input type="time" value={start} onChange={e => setStart(e.target.value)} required /></label><label>Until<input type="time" value={end} onChange={e => setEnd(e.target.value)} required /></label></div>{error && <p className="inline-error" role="alert"><Icon name="alert" size={16} />{error}</p>}<button type="submit" className="button button-primary button-full" disabled={saving}>{saving ? 'Saving…' : 'Add open time'}<Icon name="plus" size={18} /></button></form><div className="privacy-note"><Icon name="lock" size={18} /><p>You control the times in your profile. Imported commitments are never shown to matches.</p></div></section>
      <section className="panel weekly-panel"><div className="panel-heading weekly-heading"><span className="panel-icon cool"><Icon name="calendar" size={21} /></span><div><h3>Your weekly open times</h3><p>{slots.length} {slots.length === 1 ? 'window' : 'windows'} available to match</p></div></div>{slots.length ? <div className="weekly-list">{DAYS.map((d, i) => { const daySlots = slots.filter(s => Number(s.day) === i); return <div key={d} className={`weekly-row ${!daySlots.length ? 'weekly-row-empty' : ''}`}><span className="weekly-day">{SHORT_DAYS[i]}</span><div className="weekly-slots">{daySlots.length ? daySlots.map((slot, j) => <div className="time-pill" key={`${slot.start}-${j}`}><span>{formatTime(slot.start)} – {formatTime(slot.end)}</span><button type="button" aria-label={`Remove ${d} ${formatTime(slot.start)} to ${formatTime(slot.end)}`} title="Remove time" onClick={() => save(slots.filter(s => s !== slot))} disabled={saving}><Icon name="close" size={14} /></button></div>) : <span className="weekly-no-time">No time added</span>}</div></div>; })}</div> : <EmptyState icon="calendar" title="Your week is a blank canvas" description="Add your first free time to start connecting with students who can work out then too." />}</section></div>
  </div>;
}

function ImportSchedule({ slots, onAdd }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [repeatConfirmed, setRepeatConfirmed] = useState(false);
  function chooseFile(value) { if (!value) return; setFile(value); setResult(null); setSelected([]); setDrafts([]); setRepeatConfirmed(false); setError(''); }
  async function preview() {
    if (!file) return;
    setBusy(true); setError(''); setResult(null);
    const body = new FormData(); body.append('file', file);
    try { const data = await api('/api/import/preview', { method: 'POST', body }); setResult(data); setDrafts((data.suggestedSlots || []).map(suggestedWorkoutWindow)); setSelected([]); setRepeatConfirmed(false); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function addSelected() {
    const proposed = selected.map(i => drafts[i]).filter(Boolean);
    if (!proposed.length) return;
    const invalid = selected.find(i => !result.suggestedSlots[i] || drafts[i].start < result.suggestedSlots[i].start || drafts[i].end > result.suggestedSlots[i].end || drafts[i].start >= drafts[i].end);
    if (invalid !== undefined) { setError('Each selected workout must stay within its suggested free window, with an end time after its start.'); return; }
    setSaving(true); setError('');
    try { await onAdd(normalizeSlots([...slots, ...proposed])); setResult(null); setFile(null); if (inputRef.current) inputRef.current.value = ''; }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  function toggle(index) { setSelected(prev => prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]); }
  function edit(index, key, value) { setDrafts(prev => prev.map((draft, i) => i === index ? { ...draft, [key]: value } : draft)); setError(''); }
  return <div className="page-content"><SectionTitle eyebrow="YOUR SCHEDULE, SIMPLIFIED" title="Find time to work out" description="Upload a calendar export or screenshot, review suggested free windows, then choose which times to save." />
    <div className="import-layout"><section className="panel import-main"><div className="import-intro"><span className="import-icon"><Icon name="spark" size={28} /></span><h3>Turn your schedule into gym time.</h3><p>We’ll look for gaps and suggest times you could meet a workout buddy.</p></div><input ref={inputRef} id="schedule-file" className="sr-only" tabIndex={-1} type="file" accept=".ics,text/calendar,image/png,image/jpeg,image/webp" onChange={e => chooseFile(e.target.files?.[0])} /><div className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={e => { e.preventDefault(); setDragging(false); }} onDrop={e => { e.preventDefault(); setDragging(false); chooseFile(e.dataTransfer.files?.[0]); }}><span className="dropzone-icon"><Icon name={file ? (file.type.startsWith('image/') ? 'image' : 'file') : 'upload'} size={27} /></span>{file ? <><strong>{file.name}</strong><span>{(file.size / 1024).toFixed(0)} KB · Ready to review</span></> : <><strong>Drop your schedule here</strong><span>or choose a file from your device</span></>}<button type="button" className="button button-outline" onClick={() => inputRef.current?.click()}>{file ? 'Choose another file' : 'Choose a file'}</button><small>Supports .ics calendars and PNG, JPG, or WEBP screenshots</small></div><button type="button" className="button button-primary button-full import-submit" onClick={preview} disabled={!file || busy}>{busy ? 'Finding your free times…' : 'Find my free times'}<Icon name="arrow" size={18} /></button>{error && <p className="inline-error" role="alert"><Icon name="alert" size={16} />{error}</p>}</section>
      <aside className="import-side"><div className="panel source-panel"><span className="eyebrow">WORKS WITH YOUR CALENDAR</span><div className="source-list"><div><span className="source-letter google">G</span><span><strong>Google Calendar</strong><small>Export an .ics file</small></span></div><div><span className="source-letter outlook">O</span><span><strong>Outlook</strong><small>Export an .ics file</small></span></div><div><span className="source-letter apple">●</span><span><strong>Apple Calendar</strong><small>Export an .ics file</small></span></div><div><span className="source-letter screenshot"><Icon name="image" size={18} /></span><span><strong>Schedule screenshot</strong><small>Upload an image</small></span></div></div></div><div className="import-privacy"><Icon name="shield" size={22} /><div><strong>A one-time import</strong><p>Calendar export or screenshot → suggested free times → review → save. Your schedule is not kept in sync, so update your times when it changes. Event titles are not shown to matches. Screenshots are sent to the configured AI service to read busy times; calendar exports are parsed without AI.</p></div></div></aside></div>
    {result && <section className="panel import-results" aria-live="polite"><div className="results-head"><div><span className="eyebrow">READY FOR YOUR REVIEW</span><h3>Suggested workout times</h3><p>Based on {result.source || 'your uploaded schedule'} · next seven days</p></div><span className="results-count">{result.suggestedSlots?.length || 0} found</span></div><p className="import-review-note">We suggest one-hour workouts inside the free gaps we found. Check the extracted busy times and adjust each suggestion before saving it.</p>{(result.warnings || []).map((warning, i) => <p className="result-warning" key={i}><Icon name="info" size={17} />{warning}</p>)}<details className="busy-review"><summary>Review {result.busy?.length || 0} extracted busy {result.busy?.length === 1 ? 'time' : 'times'}</summary>{result.busy?.length ? <ul>{result.busy.map((slot, i) => <li key={`${slot.day}-${slot.start}-${i}`}>{previewDay(slot.day)}: {formatTime(slot.start)}–{formatTime(slot.end)}</li>)}</ul> : <p>No busy times were detected. Make sure your file shows your commitments before saving suggestions.</p>}</details>{result.suggestedSlots?.length ? <><div className="suggestion-grid">{result.suggestedSlots.map((slot, i) => <div className={`suggestion ${selected.includes(i) ? 'selected' : ''}`} key={`${slot.day}-${slot.start}-${i}`}><label className="suggestion-select"><input type="checkbox" checked={selected.includes(i)} onChange={() => toggle(i)} /><span className="custom-check"><Icon name="check" size={14} /></span><span><strong>{previewDay(slot.day)}</strong><small>Free gap: {formatTime(slot.start)}–{formatTime(slot.end)}</small></span></label><div className="suggestion-times"><label>Workout from<input type="time" value={drafts[i]?.start || ''} min={slot.start} max={slot.end} onChange={e => edit(i, 'start', e.target.value)} /></label><label>Until<input type="time" value={drafts[i]?.end || ''} min={slot.start} max={slot.end} onChange={e => edit(i, 'end', e.target.value)} /></label></div></div>)}</div><label className="repeat-confirm"><input type="checkbox" checked={repeatConfirmed} onChange={e => setRepeatConfirmed(e.target.checked)} /><span>Save my selected times as <strong>weekly recurring availability</strong>. I’ll update them if my schedule changes.</span></label><button type="button" className="button button-primary" onClick={addSelected} disabled={!selected.length || !repeatConfirmed || saving}>{saving ? 'Adding times…' : `Add ${selected.length} selected ${selected.length === 1 ? 'time' : 'times'}`}<Icon name="arrow" size={17} /></button></> : <EmptyState icon="clock" title="No open windows found" description="Try a clearer screenshot or add free times manually in My availability." />}{error && <p className="inline-error" role="alert"><Icon name="alert" size={16} />{error}</p>}</section>}
  </div>;
}

function Meetups({ meetups, me, onStatus, saving }) {
  const [filter, setFilter] = useState('upcoming');
  const visible = meetups.filter(m => filter === 'all' || (filter === 'upcoming' ? ['pending', 'accepted'].includes(m.status) && (!m.date || m.date >= uiucClock().date) : m.status === filter));
  const sorted = [...visible].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.start || '').localeCompare(String(b.start || '')));
  return <div className="page-content"><SectionTitle eyebrow="PLANS THAT HAPPEN" title="My meetups" description="Keep track of invites and confirmed workouts in one place." /><div className="segmented" aria-label="Filter meetups">{[['upcoming', 'Upcoming'], ['pending', 'Invites'], ['accepted', 'Confirmed'], ['all', 'All']].map(([value, label]) => <button type="button" className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)} key={value}>{label}</button>)}</div>{sorted.length ? <div className="meetup-list">{sorted.map(meetup => { const incoming = String(personId(meetup.toUser)) === String(me?.id); const buddy = incoming ? meetup.fromUser : meetup.toUser; return <article className="meetup-card" key={meetup.id}><div className="meetup-datebox"><strong>{meetup.date ? new Date(`${meetup.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short' }).toUpperCase() : SHORT_DAYS[meetup.day]}</strong><span>{meetup.date ? new Date(`${meetup.date}T12:00:00`).getDate() : '·'}</span></div><div className="meetup-main"><div className="meetup-heading"><h3>{meetup.activity}</h3><span className={`status status-${meetup.status}`}>{meetup.status === 'accepted' ? 'Confirmed' : meetup.status === 'pending' ? (incoming ? 'Needs your reply' : 'Awaiting reply') : meetup.status}</span></div><p>With {personName(buddy)}</p><div className="meetup-info"><span><Icon name="calendar" size={16} />{meetup.date ? formatDate(meetup.date) : DAYS[meetup.day]}</span><span><Icon name="clock" size={16} />{formatTime(meetup.start)} – {formatTime(meetup.end)}</span><span><Icon name="pin" size={16} />{meetup.location}</span></div>{meetup.note && <p className="meetup-note">“{meetup.note}”</p>}</div><div className="meetup-actions">{meetup.status === 'pending' && incoming && <><button className="button button-primary" type="button" disabled={saving} onClick={() => onStatus(meetup.id, 'accepted')}>Accept</button><button className="button button-outline" type="button" disabled={saving} onClick={() => onStatus(meetup.id, 'declined')}>Decline</button></>}{(meetup.status === 'accepted' || (meetup.status === 'pending' && !incoming)) && <button className="button button-subtle" type="button" disabled={saving} onClick={() => onStatus(meetup.id, 'cancelled')}>Cancel plan</button>}</div></article>; })}</div> : <EmptyState icon="meetup" title={filter === 'all' ? 'No meetups yet' : 'Nothing here yet'} description={filter === 'upcoming' ? 'Find a buddy and send an invite to make your first plan.' : 'Your meetup plans will appear here.'} />}</div>;
}

function Profile({ me, onSave }) {
  const [form, setForm] = useState(() => ({ name: me.name || '', gender: me.gender || 'prefer-not-to-say', partnerPreference: me.partnerPreference || 'any', activities: me.activities || [], experience: me.experience || 'beginner', locations: me.locations || [], bio: me.bio || '' }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  useEffect(() => { setForm({ name: me.name || '', gender: me.gender || 'prefer-not-to-say', partnerPreference: me.partnerPreference || 'any', activities: me.activities || [], experience: me.experience || 'beginner', locations: me.locations || [], bio: me.bio || '' }); }, [me]);
  function update(key, value) { setForm(prev => ({ ...prev, [key]: value })); setSuccess(false); }
  function toggle(key, value) { update(key, form[key].includes(value) ? form[key].filter(x => x !== value) : [...form[key], value]); }
  async function submit(event) { event.preventDefault(); setError(''); setBusy(true); try { await onSave(form); setSuccess(true); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  return <div className="page-content"><SectionTitle eyebrow="MAKE IT YOURS" title="My profile" description="Show potential buddies what you enjoy and who you feel comfortable working out with." /><form className="profile-layout" onSubmit={submit}><section className="panel profile-main"><div className="profile-intro"><Avatar name={form.name} size="large" /><div><h3>{form.name || 'Your profile'}</h3><p>{me.email}</p></div></div><div className="profile-fields"><label>Full name<input type="text" value={form.name} onChange={e => update('name', e.target.value)} required maxLength={80} /></label><div className="form-pair"><label>Gender<select value={form.gender} onChange={e => update('gender', e.target.value)}><option value="prefer-not-to-say">Prefer not to say</option><option value="female">Woman</option><option value="male">Man</option><option value="nonbinary">Nonbinary</option></select></label><label>Partner preference<select value={form.partnerPreference} onChange={e => update('partnerPreference', e.target.value)}><option value="any">Any gender</option><option value="female">Women</option><option value="male">Men</option><option value="nonbinary">Nonbinary people</option></select></label></div><p className="field-help">Your partner preference helps decide which matches you see.</p><label>Experience level<select value={form.experience} onChange={e => update('experience', e.target.value)}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label><label>About you<textarea rows="4" maxLength={300} value={form.bio} onChange={e => update('bio', e.target.value)} placeholder="What kind of workout buddy are you looking for?" /></label><span className="char-count">{form.bio.length}/300</span></div></section><section className="profile-side"><div className="panel selection-panel"><h3>Activities</h3><p>Pick what you’re open to doing.</p><div className="option-grid">{ACTIVITIES.map(item => <label className={`option-chip ${form.activities.includes(item) ? 'selected' : ''}`} key={item}><input type="checkbox" checked={form.activities.includes(item)} onChange={() => toggle('activities', item)} /><span>{item}</span><Icon name="check" size={15} /></label>)}</div></div><div className="panel selection-panel"><h3>Meeting places</h3><p>Choose locations that work for you.</p><div className="option-grid">{LOCATIONS.map(item => <label className={`option-chip ${form.locations.includes(item) ? 'selected' : ''}`} key={item}><input type="checkbox" checked={form.locations.includes(item)} onChange={() => toggle('locations', item)} /><span>{item}</span><Icon name="check" size={15} /></label>)}</div></div><div className="profile-save">{error && <p className="inline-error" role="alert"><Icon name="alert" size={16} />{error}</p>}{success && <p className="inline-success" role="status"><Icon name="check" size={16} />Profile saved.</p>}<button type="submit" className="button button-primary button-full" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}<Icon name="arrow" size={17} /></button></div></section></form></div>;
}

function RequestModal({ match, onClose, onSubmit, busy }) {
  const user = match.user || match;
  const overlaps = match.overlaps || [];
  const activities = match.sharedActivities?.length ? match.sharedActivities : user.activities || [];
  const locations = match.sharedLocations?.length ? match.sharedLocations : user.locations || [];
  const [slotIndex, setSlotIndex] = useState(0);
  const slot = overlaps[slotIndex];
  const initialWorkout = slot ? suggestedWorkoutWindow(slot) : { start: '17:00', end: '18:00' };
  const [date, setDate] = useState(() => slot ? nextDateForDay(slot.day, initialWorkout.start) : uiucClock().date);
  const [start, setStart] = useState(initialWorkout.start);
  const [end, setEnd] = useState(initialWorkout.end);
  const [activity, setActivity] = useState(activities[0] || 'Strength training');
  const [location, setLocation] = useState(locations[0] || 'ARC');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const dialogRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.focus();
    function onKey(event) {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, []);
  function changeSlot(index) {
    const nextIndex = Number(index);
    const selected = overlaps[nextIndex];
    setSlotIndex(nextIndex);
    if (selected) {
      const workout = suggestedWorkoutWindow(selected);
      setStart(workout.start);
      setEnd(workout.end);
      setDate(nextDateForDay(selected.day, workout.start));
    }
    setError('');
  }
  async function submit(event) {
    event.preventDefault();
    if (!slot) return;
    if (dayFromDate(date) !== Number(slot.day)) { setError(`Choose a ${DAYS[slot.day]} date for this shared time.`); return; }
    if (date < uiucClock().date) { setError('Choose a future date.'); return; }
    if (start < slot.start || end > slot.end || timeMinutes(end) - timeMinutes(start) < 30) {
      setError('Choose at least 30 minutes within your shared free time.'); return;
    }
    setError('');
    try { await onSubmit({ toUserId: user.id, activity, date, day: Number(slot.day), start, end, location, note: note.trim() }); }
    catch (e) { setError(e.message); }
  }
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="invite-title" tabIndex={-1} ref={dialogRef}><button type="button" className="icon-button modal-close" aria-label="Close invitation" onClick={onClose}><Icon name="close" /></button><span className="eyebrow">MAKE A PLAN</span><h2 id="invite-title">Invite {user.name} to work out</h2><p className="modal-lede">Pick a day, time, activity, and place you can both make. They can accept or decline your invite.</p><form onSubmit={submit}><label>Shared free window<select value={slotIndex} onChange={e => changeSlot(e.target.value)}>{overlaps.map((overlap, i) => <option value={i} key={`${overlap.day}-${overlap.start}-${i}`}>{formatWindow(overlap, true)}</option>)}</select></label><label>Date<input type="date" value={date} min={uiucClock().date} onChange={e => { setDate(e.target.value); setError(''); }} required /></label><p className="field-help">Choose a {slot ? DAYS[slot.day] : 'matching'} date for this weekly free window.</p><div className="form-pair"><label>Start time<input type="time" value={start} min={slot?.start} max={slot?.end} onChange={e => setStart(e.target.value)} required /></label><label>End time<input type="time" value={end} min={slot?.start} max={slot?.end} onChange={e => setEnd(e.target.value)} required /></label></div><p className="field-help">The workout must last at least 30 minutes and fit within {slot ? formatTime(slot.start) : ''}–{slot ? formatTime(slot.end) : ''}.</p><div className="form-pair"><label>Activity<select value={activity} onChange={e => setActivity(e.target.value)}>{(activities.length ? activities : ACTIVITIES).map(item => <option key={item}>{item}</option>)}</select></label><label>Meet at<select value={location} onChange={e => setLocation(e.target.value)}>{(locations.length ? locations : LOCATIONS).map(item => <option key={item}>{item}</option>)}</select></label></div><label>Message (optional)<textarea value={note} onChange={e => setNote(e.target.value)} maxLength={240} rows="3" placeholder="I’m thinking a light upper-body workout. Interested?" /></label>{error && <p className="inline-error" role="alert"><Icon name="alert" size={16} />{error}</p>}<button type="submit" className="button button-primary button-full" disabled={busy || !slot}>{busy ? 'Sending invite…' : 'Send workout invite'}<Icon name="arrow" size={17} /></button></form></div></div>;
}

export default function App() {
  const [checking, setChecking] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authOptions, setAuthOptions] = useState({ loading: true, netidEnabled: false, pilotAuthEnabled: false });
  const [me, setMe] = useState(null);
  const [view, setView] = useState('home');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [slots, setSlots] = useState([]);
  const [matches, setMatches] = useState([]);
  const [meetups, setMeetups] = useState([]);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [activeChatId, setActiveChatId] = useState(null);
  const [meetupBusy, setMeetupBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  async function refreshData() {
    setLoadingMatches(true);
    const [availability, buddyData, meetupData] = await Promise.allSettled([api('/api/availability'), api('/api/matches'), api('/api/meetups')]);
    if (availability.status === 'fulfilled') setSlots(availability.value?.slots || []);
    if (buddyData.status === 'fulfilled') setMatches(buddyData.value?.matches || []);
    if (meetupData.status === 'fulfilled') setMeetups(meetupData.value?.meetups || []);
    setLoadingMatches(false);
    const failed = [availability, buddyData, meetupData].find(r => r.status === 'rejected');
    if (failed) setNotice({ type: 'error', text: failed.reason.message || 'Some information could not load.' });
  }
  useEffect(() => { let active = true; (async () => { try { const data = await api('/api/me'); if (active) { setMe(data?.user || data?.me || data); await refreshData(); } } catch (e) { if (active && !/401|unauthorized|not authenticated|sign in to continue/i.test(e.message)) setAuthError(e.message); } finally { if (active) setChecking(false); } })(); return () => { active = false; }; }, []);
  useEffect(() => { let active = true; api('/api/auth/netid/config').then(data => { if (active) setAuthOptions({ loading: false, netidEnabled: Boolean(data?.enabled), pilotAuthEnabled: Boolean(data?.pilotAuthEnabled) }); }).catch(() => { if (active) setAuthOptions({ loading: false, netidEnabled: false, pilotAuthEnabled: false }); }); return () => { active = false; }; }, []);
  useEffect(() => {
    if (!me?.id) return undefined;
    let active = true;
    async function syncInvites() {
      if (document.visibilityState !== 'visible') return;
      const [buddyData, meetupData] = await Promise.allSettled([api('/api/matches'), api('/api/meetups')]);
      if (!active) return;
      if (buddyData.status === 'fulfilled') setMatches(buddyData.value?.matches || []);
      if (meetupData.status === 'fulfilled') setMeetups(meetupData.value?.meetups || []);
    }
    const interval = window.setInterval(syncInvites, 30000);
    window.addEventListener('focus', syncInvites);
    document.addEventListener('visibilitychange', syncInvites);
    return () => { active = false; window.clearInterval(interval); window.removeEventListener('focus', syncInvites); document.removeEventListener('visibilitychange', syncInvites); };
  }, [me?.id]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [view]);
  async function auth(mode, values) { setAuthBusy(true); setAuthError(''); try { await api(`/api/auth/${mode === 'register' ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(mode === 'register' ? values : { email: values.email, password: values.password }) }); const data = await api('/api/me'); setMe(data?.user || data?.me || data); await refreshData(); setView(mode === 'register' ? 'profile' : 'home'); } catch (e) { setAuthError(e.message); } finally { setAuthBusy(false); } }
  async function logout() { try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* Clear the local session even if the network fails. */ } setMe(null); setSlots([]); setMatches([]); setMeetups([]); setActiveChatId(null); setView('home'); setMobileOpen(false); }
  async function saveProfile(values) { const data = await api('/api/me', { method: 'PATCH', body: JSON.stringify(values) }); setMe(data?.user || data?.me || data); const buddyData = await api('/api/matches'); setMatches(buddyData.matches || []); setNotice({ type: 'success', text: 'Your profile is updated.' }); }
  async function saveSlots(next) { const data = await api('/api/availability', { method: 'PUT', body: JSON.stringify({ slots: next }) }); setSlots(data?.slots || next); const buddyData = await api('/api/matches'); setMatches(buddyData.matches || []); setNotice({ type: 'success', text: 'Your available times are saved.' }); }
  async function addImported(next) { await saveSlots(next); setView('availability'); }
  async function sendInvite(values) { setMeetupBusy(true); try { await api('/api/meetups', { method: 'POST', body: JSON.stringify(values) }); const data = await api('/api/meetups'); setMeetups(data.meetups || []); setSelectedMatch(null); setNotice({ type: 'success', text: 'Workout invite sent. You’ll see the reply in Meetups.' }); setView('meetups'); } finally { setMeetupBusy(false); } }
  async function updateMeetup(id, status) { setMeetupBusy(true); try { await api(`/api/meetups/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) }); const data = await api('/api/meetups'); setMeetups(data.meetups || []); setNotice({ type: 'success', text: status === 'accepted' ? 'Workout confirmed!' : status === 'declined' ? 'Invite declined.' : 'Plan cancelled.' }); } catch (e) { setNotice({ type: 'error', text: e.message }); } finally { setMeetupBusy(false); } }
  async function startChat(user) { try { const data = await api('/api/chats', { method: 'POST', body: JSON.stringify({ toUserId: user.id }) }); setActiveChatId(data.chat.id); setView('chats'); } catch (e) { setNotice({ type: 'error', text: e.message }); } }
  const pendingCount = meetups.filter(m => m.status === 'pending' && String(personId(m.toUser)) === String(me?.id)).length;
  if (checking) return <div className="startup"><Brand /><div className="spinner" aria-label="Loading" /><p>Getting your space ready…</p></div>;
  if (!me) return <AuthScreen onAuth={auth} error={authError} busy={authBusy} authOptions={authOptions} />;
  return <div className="app-shell"><a className="skip-link" href="#main-content">Skip to main content</a><Sidebar view={view} setView={setView} me={me} onLogout={logout} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} pendingCount={pendingCount} /><main className="app-main" id="main-content" tabIndex={-1}><header className="topbar"><button type="button" className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setMobileOpen(true)}><Icon name="menu" /></button><div className="topbar-context"><span className="topbar-dot" /> UIUC STUDENT COMMUNITY</div><div className="topbar-right"><span className="topbar-message">Make today a good day to move.</span><Avatar name={me.name} size="small" /></div></header>{notice && <div className="notice-wrap"><Notice type={notice.type} onClose={() => setNotice(null)}>{notice.text}</Notice></div>}{view === 'home' && <Home me={me} slots={slots} matches={matches} meetups={meetups} setView={setView} onRequest={setSelectedMatch} onChat={startChat} />}{view === 'matches' && <Matches matches={matches} slots={slots} onRequest={setSelectedMatch} onChat={startChat} setView={setView} loading={loadingMatches} onRefresh={refreshData} />}{view === 'now' && <PresencePage me={me} api={api} onChat={startChat} setView={setView} Avatar={Avatar} Icon={Icon} />}{view === 'chats' && <ChatsPage me={me} api={api} activeChatId={activeChatId} setActiveChatId={setActiveChatId} setView={setView} Avatar={Avatar} Icon={Icon} />}{view === 'availability' && <Availability slots={slots} onSave={saveSlots} setView={setView} />}{view === 'import' && <ImportSchedule slots={slots} onAdd={addImported} />}{view === 'meetups' && <Meetups meetups={meetups} me={me} onStatus={updateMeetup} saving={meetupBusy} />}{view === 'profile' && <Profile me={me} onSave={saveProfile} />}</main>{selectedMatch && <RequestModal key={selectedMatch.user?.id || selectedMatch.id} match={selectedMatch} onClose={() => setSelectedMatch(null)} onSubmit={sendInvite} busy={meetupBusy} />}</div>;
}
