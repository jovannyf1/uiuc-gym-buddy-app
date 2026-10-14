import React, { useEffect, useRef, useState } from 'react';
import './social.css';

function campusTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(date);
}

function messageTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
}

function ReportDialog({ user, api, onClose }) {
  const [reason, setReason] = useState('harassment');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.focus();
    function onKey(event) {
      if (event.key === 'Escape') onClose(false);
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), select:not(:disabled), textarea:not(:disabled)')];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, []);
  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await api(`/api/users/${encodeURIComponent(user.id)}/report`, { method: 'POST', body: JSON.stringify({ reason, details: details.trim() }) });
      onClose(true);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(false); }}>
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="report-title" tabIndex={-1} ref={dialogRef}>
      <button type="button" className="icon-button modal-close" aria-label="Close report" onClick={() => onClose(false)}>×</button>
      <span className="eyebrow">HELP KEEP MEETUPS SAFE</span><h2 id="report-title">Report {user.name}</h2>
      <p className="modal-lede">Tell us what happened. Reports are private and do not alert this student.</p>
      <form onSubmit={submit}><label>Reason<select value={reason} onChange={event => setReason(event.target.value)}><option value="harassment">Harassment or bullying</option><option value="spam">Spam or unwanted messages</option><option value="unsafe">Unsafe behavior</option><option value="other">Something else</option></select></label><label>Details (optional)<textarea value={details} onChange={event => setDetails(event.target.value)} maxLength={500} rows="4" placeholder="Share anything that will help us understand." /></label>{error && <p className="inline-error" role="alert">{error}</p>}<button type="submit" className="button button-primary button-full" disabled={busy}>{busy ? 'Sending report…' : 'Send report'}</button></form>
    </div>
  </div>;
}

function SafetyActions({ user, api, onBlocked }) {
  const [reportOpen, setReportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function block() {
    if (!window.confirm(`Block ${user.name}? You will no longer see each other in matches, active workouts, or chats.`)) return;
    setBusy(true); setMessage('');
    try {
      await api(`/api/users/${encodeURIComponent(user.id)}/block`, { method: 'POST' });
      onBlocked?.();
    } catch (e) { setMessage(e.message); }
    finally { setBusy(false); }
  }
  const reported = message.startsWith('Report sent');
  return <><div className="safety-actions"><button type="button" className="link-button" onClick={() => setReportOpen(true)}>Report</button><button type="button" className="link-button" onClick={block} disabled={busy}>{busy ? 'Blocking…' : 'Block'}</button></div>{message && <p className={reported ? 'inline-success' : 'inline-error'} role={reported ? 'status' : 'alert'}>{message}</p>}{reportOpen && <ReportDialog user={user} api={api} onClose={sent => { setReportOpen(false); if (sent) setMessage('Report sent. Thank you for letting us know.'); }} />}</>;
}

export function PresencePage({ me, api, onChat, setView, Avatar, Icon }) {
  const [mine, setMine] = useState(null);
  const [people, setPeople] = useState([]);
  const [activity, setActivity] = useState(me.activities?.[0] || '');
  const [location, setLocation] = useState(me.locations?.[0] || '');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [chattingId, setChattingId] = useState(null);
  const canShare = Boolean(me.activities?.length && me.locations?.length);
  async function refresh(silent = false) {
    if (!silent) setLoading(true);
    const [myResult, peopleResult] = await Promise.allSettled([api('/api/presence/me'), api('/api/presence/nearby')]);
    if (myResult.status === 'fulfilled') setMine(myResult.value.presence || null);
    if (peopleResult.status === 'fulfilled') setPeople(peopleResult.value.people || []);
    const failed = [myResult, peopleResult].find(result => result.status === 'rejected');
    if (failed) setError(failed.reason.message || 'Could not load active workouts.');
    else setError('');
    setLoading(false);
  }
  useEffect(() => {
    refresh();
    const update = () => { if (document.visibilityState === 'visible') refresh(true); };
    const timer = window.setInterval(update, 30000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, []);
  async function share(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const data = await api('/api/presence', { method: 'PUT', body: JSON.stringify({ activity, location, durationMinutes }) });
      setMine(data.presence);
      await refresh(true);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function stop() {
    setBusy(true); setError('');
    try { await api('/api/presence', { method: 'DELETE' }); setMine(null); await refresh(true); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function beginChat(user) {
    setChattingId(user.id);
    try { await onChat(user); }
    finally { setChattingId(null); }
  }
  const active = mine && new Date(mine.expiresAt).getTime() > Date.now();
  const currentPeople = people.filter(person => new Date(person.expiresAt).getTime() > Date.now());
  return <div className="page-content social-page"><div className="section-head"><div><span className="eyebrow">FIND COMPANY IN THE MOMENT</span><h2>Working out now</h2><p>See compatible students who opted in to find a gym buddy at their chosen location right now. We do not track anyone’s location.</p></div><button type="button" className="button button-subtle" onClick={() => refresh()} disabled={loading}><Icon name="refresh" size={17} /> Refresh</button></div>
    <div className="presence-layout"><section className="panel presence-own"><div className="panel-heading"><span className="panel-icon"><Icon name="bolt" size={21} /></span><div><h3>Your workout status</h3><p>Let a compatible buddy know you’re open to company.</p></div></div>
      {!canShare ? <div className="social-note"><p>Choose at least one activity and meeting place in your profile before sharing that you’d be open to a workout.</p><button type="button" className="button button-outline" onClick={() => setView('profile')}>Update profile</button></div> : <><form className="add-time-form" onSubmit={share}><label>Activity<select value={activity} onChange={event => setActivity(event.target.value)}>{me.activities.map(item => <option key={item}>{item}</option>)}</select></label><label>Gym<select value={location} onChange={event => setLocation(event.target.value)}>{me.locations.map(item => <option key={item}>{item}</option>)}</select></label><label>Share for<select value={durationMinutes} onChange={event => setDurationMinutes(Number(event.target.value))}><option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={90}>1½ hours</option><option value={120}>2 hours</option></select></label><button type="submit" className="button button-primary button-full" disabled={busy}>{busy ? 'Saving…' : active ? 'Update workout status' : 'I’m open to a workout now'}</button></form>{active && <div className="presence-active" role="status"><strong>Your workout status is visible at {mine.location}</strong><span>{mine.activity} · Until {campusTime(mine.expiresAt)}</span><button type="button" className="button button-outline" onClick={stop} disabled={busy}>Stop sharing now</button></div>}</>}
      <p className="presence-privacy"><Icon name="lock" size={17} /> Only your chosen gym and activity appear here. Sharing ends automatically.</p>{error && <p className="inline-error" role="alert">{error}</p>}</section>
      <section className="presence-community"><div className="presence-list-heading"><h3>Students open to a buddy</h3><span>{currentPeople.length} sharing</span></div>{loading ? <div className="loading-panel">Checking active workout posts…</div> : currentPeople.length ? <div className="presence-list">{currentPeople.map((person, index) => <article className="panel presence-card" key={person.user.id}><div className="presence-card-top"><Avatar name={person.user.name} index={index} /><div><h4>{person.user.name}</h4><p>{person.activity} · {person.location}</p></div><span className="presence-live"><span /> Open now</span></div><p>Sharing until {campusTime(person.expiresAt)}</p><div className="presence-card-actions"><button type="button" className="button button-outline" onClick={() => beginChat(person.user)} disabled={chattingId === person.user.id}><Icon name="chat" size={17} /> {chattingId === person.user.id ? 'Opening…' : 'Chat about a workout'}</button><SafetyActions user={person.user} api={api} onBlocked={() => refresh(true)} /></div></article>)}</div> : <div className="panel social-empty"><Icon name="users" size={29} /><h4>No one is sharing right now</h4><p>Check back later, or browse students whose weekly free times overlap yours.</p><button type="button" className="button button-outline" onClick={() => setView('matches')}>Find a buddy</button></div>}</section></div>
  </div>;
}

export function ChatsPage({ me, api, activeChatId, setActiveChatId, setView, Avatar, Icon }) {
  const [chats, setChats] = useState([]);
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [unblockingId, setUnblockingId] = useState(null);
  const [error, setError] = useState('');
  const logRef = useRef(null);
  const selected = chats.find(chat => String(chat.id) === String(activeChatId));
  async function refreshChats(silent = false) {
    if (!silent) setLoadingChats(true);
    try { const data = await api('/api/chats'); setChats(data.chats || []); setError(''); }
    catch (e) { setError(e.message); }
    finally { setLoadingChats(false); }
  }
  async function refreshBlocked() {
    try { const data = await api('/api/blocks'); setBlockedUsers(data.blockedUsers || []); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => {
    refreshChats();
    refreshBlocked();
    const update = () => { if (document.visibilityState === 'visible') { refreshChats(true); refreshBlocked(); } };
    const timer = window.setInterval(update, 20000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, []);
  useEffect(() => {
    if (!activeChatId) { setMessages([]); return undefined; }
    let current = true;
    async function refreshMessages(silent = false) {
      if (document.visibilityState !== 'visible') return;
      if (!silent) setLoadingMessages(true);
      try { const data = await api(`/api/chats/${encodeURIComponent(activeChatId)}/messages`); if (current) { setMessages(data.messages || []); setError(''); } }
      catch (e) { if (current) setError(e.message); }
      finally { if (current) setLoadingMessages(false); }
    }
    refreshMessages();
    const timer = window.setInterval(() => refreshMessages(true), 8000);
    const onFocus = () => refreshMessages(true);
    window.addEventListener('focus', onFocus);
    return () => { current = false; window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [activeChatId]);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }); }, [messages.length, activeChatId]);
  async function send(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !activeChatId) return;
    setSending(true); setError('');
    try {
      const data = await api(`/api/chats/${encodeURIComponent(activeChatId)}/messages`, { method: 'POST', body: JSON.stringify({ text }) });
      setMessages(previous => previous.some(message => message.id === data.message.id) ? previous : [...previous, data.message]);
      setDraft('');
      await refreshChats(true);
    } catch (e) { setError(e.message); }
    finally { setSending(false); }
  }
  async function unblock(user) {
    setUnblockingId(user.id); setError('');
    try {
      await api(`/api/users/${encodeURIComponent(user.id)}/block`, { method: 'DELETE' });
      await Promise.all([refreshBlocked(), refreshChats(true)]);
    } catch (e) { setError(e.message); }
    finally { setUnblockingId(null); }
  }
  function afterBlock() { setActiveChatId(null); setMessages([]); refreshChats(true); refreshBlocked(); }
  return <div className="page-content social-page"><div className="section-head"><div><span className="eyebrow">MAKE A PLAN TOGETHER</span><h2>Chats</h2><p>Talk with compatible students before you meet. Keep your workout plans in Meetups.</p></div></div>
    {error && <p className="inline-error social-error" role="alert">{error}</p>}
    <div className={`chat-layout panel ${activeChatId ? 'chat-layout-active' : ''}`}><section className="chat-sidebar" aria-label="Conversations"><div className="chat-sidebar-head"><h3>Conversations</h3><button type="button" className="icon-button" aria-label="Refresh chats" title="Refresh chats" onClick={() => { refreshChats(); refreshBlocked(); }}><Icon name="refresh" size={18} /></button></div>{loadingChats ? <p className="chat-wait">Loading chats…</p> : chats.length ? <div className="chat-list">{chats.map(chat => <button type="button" key={chat.id} className={`chat-list-item ${String(chat.id) === String(activeChatId) ? 'active' : ''}`} aria-current={String(chat.id) === String(activeChatId) ? 'true' : undefined} onClick={() => setActiveChatId(chat.id)}><Avatar name={chat.otherUser?.name || 'Student'} /><span><strong>{chat.otherUser?.name || 'Student'}</strong><small>{chat.lastMessage?.text || 'Start the conversation'}</small></span><Icon name="chevron" size={16} /></button>)}</div> : <div className="chat-sidebar-empty"><p>No conversations yet.</p><button type="button" className="button button-outline" onClick={() => setView('matches')}>Find a buddy</button></div>}<details className="blocked-list"><summary>Blocked students ({blockedUsers.length})</summary>{blockedUsers.length ? <ul>{blockedUsers.map(user => <li key={user.id}><span>{user.name}</span><button type="button" className="link-button" onClick={() => unblock(user)} disabled={unblockingId === user.id}>{unblockingId === user.id ? 'Unblocking…' : 'Unblock'}</button></li>)}</ul> : <p>No one blocked.</p>}</details></section>
      <section className="chat-thread" aria-label="Messages">{selected ? <><div className="chat-thread-head"><button type="button" className="icon-button chat-back" aria-label="Back to conversations" onClick={() => setActiveChatId(null)}><Icon name="back" size={20} /></button><Avatar name={selected.otherUser?.name || 'Student'} /><div><h3>{selected.otherUser?.name || 'Student'}</h3><p>Plan your workout here</p></div><SafetyActions user={selected.otherUser} api={api} onBlocked={afterBlock} /></div><div className="chat-messages" ref={logRef} role="log" aria-label={`Messages with ${selected.otherUser?.name || 'student'}`} aria-live="polite" aria-relevant="additions text">{loadingMessages && !messages.length ? <p className="chat-wait">Loading messages…</p> : messages.length ? messages.map(message => <div className={`chat-message ${String(message.senderUserId) === String(me.id) ? 'mine' : ''}`} key={message.id}><p>{message.text}</p><time dateTime={message.createdAt}>{messageTime(message.createdAt)}</time></div>) : <div className="chat-start"><Icon name="chat" size={28} /><h4>Start with a hello</h4><p>Ask about their workout, preferred time, or meeting place.</p></div>}</div><form className="chat-compose" onSubmit={send}><label className="sr-only" htmlFor="chat-draft">Message {selected.otherUser?.name || 'student'}</label><textarea id="chat-draft" rows="2" maxLength={1000} value={draft} onChange={event => setDraft(event.target.value)} placeholder="Write a message…" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><button type="submit" className="button button-primary" disabled={sending || !draft.trim()} aria-label="Send message"><Icon name="send" size={18} /><span>{sending ? 'Sending…' : 'Send'}</span></button></form></> : <div className="chat-placeholder"><Icon name="chat" size={36} /><h3>Choose a conversation</h3><p>Messages stay between you and the student you’re chatting with.</p></div>}</section></div>
  </div>;
}
