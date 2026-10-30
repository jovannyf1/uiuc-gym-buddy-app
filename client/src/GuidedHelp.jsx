import { useEffect, useRef, useState } from 'react';
import './guided-help.css';

const TOUR_STEPS = [
  {
    title: 'Make your profile yours',
    text: 'Choose the workouts and campus gyms that suit you, set your partner preferences, and add a short introduction. Your full name and public username help other members recognize you.',
    next: 'My profile',
    destination: 'profile',
  },
  {
    title: 'Add the times you are free',
    text: 'Enter weekly free times by hand, or import an .ics calendar or schedule screenshot. Review every suggestion before saving it. Imports are one-time snapshots, not live calendar sync.',
    next: 'My availability',
    destination: 'availability',
  },
  {
    title: 'Find a compatible buddy',
    text: 'Find a buddy compares shared free times, workout interests, gym locations, and partner preferences. Add your profile and availability first so matches have useful information.',
    next: 'Find a buddy',
    destination: 'matches',
  },
  {
    title: 'Start a conversation',
    text: 'Open a match and choose Chat to plan a workout together. Messages are saved for both people. New messages refresh while the app is open; there are no push alerts yet.',
    next: 'Chats',
    destination: 'chats',
  },
  {
    title: 'Make a dated workout plan',
    text: 'From a match, send an invitation with a real date, time, activity, and campus gym. The other person can accept or decline it in Meetups.',
    next: 'Meetups',
    destination: 'meetups',
  },
  {
    title: 'Share now, and stay in control',
    text: 'Working out now is optional and expires automatically. You can block a member or report a concern. Reports are saved, but a human review process is not set up yet.',
    next: 'Working out now',
    destination: 'now',
  },
];

function tourProgressKey(userId) { return `uiuc-gym-buddy-tour-step-v2:${userId}`; }
function readTourStep(userId) {
  if (userId == null) return 0;
  try {
    const saved = Number(window.localStorage.getItem(tourProgressKey(userId)));
    return Number.isInteger(saved) && saved >= 0 && saved <= TOUR_STEPS.length ? saved : 0;
  } catch { return 0; }
}

function visibleRect(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height || rect.right < 0 || rect.left > window.innerWidth || rect.bottom < 0 || rect.top > window.innerHeight) return null;
  return {
    top: Math.max(8, rect.top - 6),
    left: Math.max(8, rect.left - 6),
    width: Math.min(window.innerWidth - 16, rect.width + 12),
    height: Math.min(window.innerHeight - 16, rect.height + 12),
  };
}

export default function GuidedHelp({ open, onClose, onNavigate, userId, view, helpRequest }) {
  const [tab, setTab] = useState('tour');
  const [step, setStep] = useState(() => readTourStep(userId));
  const [exploring, setExploring] = useState('');
  const [spotlight, setSpotlight] = useState(null);
  const [assistantState, setAssistantState] = useState('checking');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [answeredQuestion, setAnsweredQuestion] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const closeButton = useRef(null);

  useEffect(() => { setStep(readTourStep(userId)); }, [userId]);

  function saveStep(next) {
    const safe = Math.max(0, Math.min(TOUR_STEPS.length, next));
    setStep(safe);
    if (userId == null) return;
    try { window.localStorage.setItem(tourProgressKey(userId), String(safe)); } catch { /* Help still works if local storage is disabled. */ }
  }

  useEffect(() => {
    if (!open) return undefined;
    setTab('tour');
    setQuestion('');
    setAnswer('');
    setAnsweredQuestion('');
    setError('');
    setAssistantState('checking');
    const controller = new AbortController();
    fetch('/api/assistant/config', { credentials: 'same-origin', signal: controller.signal })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || 'Could not check Gemini setup.');
        setAssistantState(data?.available ? 'available' : 'unavailable');
      })
      .catch(error => {
        if (error.name !== 'AbortError') setAssistantState('unavailable');
      });
    closeButton.current?.focus();
    return () => controller.abort();
  }, [open]);

  useEffect(() => {
    if (!open || !helpRequest) return undefined;
    setExploring('');
    setTab('tour');
    return undefined;
  }, [open, helpRequest]);

  useEffect(() => {
    if (open && helpRequest && !exploring) closeButton.current?.focus();
  }, [open, helpRequest, exploring]);

  useEffect(() => {
    if (!open) { setExploring(''); return undefined; }
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setExploring('');
        onClose();
        return;
      }
      if (event.key !== 'Tab' || exploring) return;
      const controls = [...document.querySelectorAll('.help-dialog button:not(:disabled), .help-dialog textarea:not(:disabled)')]
        .filter(element => element.getClientRects().length);
      if (!controls.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, exploring, onClose]);

  useEffect(() => {
    if (!open || tab !== 'tour' || step >= TOUR_STEPS.length) { setSpotlight(null); return undefined; }
    let frame = 0;
    function update() {
      const mobileMenu = document.querySelector('.mobile-menu');
      const mobileSidebarClosed = window.matchMedia('(max-width: 760px)').matches
        && !document.querySelector('.sidebar')?.classList.contains('sidebar-open');
      const target = exploring
        ? document.querySelector('#main-content .page-content .section-head, #main-content .page-content .page-greeting')
        : mobileSidebarClosed ? mobileMenu : document.querySelector(`[data-tour-destination="${TOUR_STEPS[step].destination}"]`);
      const fallback = exploring ? null : mobileMenu;
      setSpotlight(visibleRect(target) || visibleRect(fallback));
    }
    frame = window.requestAnimationFrame(update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, tab, step, exploring, view]);

  if (!open) return null;

  async function ask(event) {
    event.preventDefault();
    const clean = question.trim();
    if (!clean || sending || assistantState !== 'available') return;
    setSending(true);
    setError('');
    setAnswer('');
    setAnsweredQuestion(clean);
    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: clean }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Gemini could not answer just now. Try again later.');
      setAnswer(data?.answer || 'Gemini returned an empty answer. Try asking another way.');
    } catch (requestError) {
      setError(requestError.message || 'Could not reach Gemini. Check your connection and try again.');
      setAnsweredQuestion('');
    } finally { setSending(false); }
  }

  const current = TOUR_STEPS[Math.min(step, TOUR_STEPS.length - 1)];
  function close() { setExploring(''); onClose(); }
  function restartTour() { saveStep(0); setTab('tour'); setExploring(''); }
  function goToSection() {
    setExploring(current.next);
    if (step < TOUR_STEPS.length - 1) saveStep(step + 1);
    onNavigate(current.destination);
    window.requestAnimationFrame(() => document.getElementById('main-content')?.focus());
  }
  function resumeTour() {
    setExploring('');
    window.requestAnimationFrame(() => closeButton.current?.focus());
  }
  function finishTour() { saveStep(TOUR_STEPS.length); close(); }

  return <>
    {spotlight && tab === 'tour' && <div className={`help-spotlight ${exploring ? 'help-spotlight-explore' : ''}`} style={spotlight} aria-hidden="true" />}
    {exploring ? <aside className="help-explore-card" aria-label="Tour progress">
      <span className="eyebrow">TOUR PROGRESS SAVED</span>
      <p>Take a look at {exploring}. Continue when you’re ready.</p>
      <div><button type="button" className="button button-primary" onClick={resumeTour}>Continue tour</button><button type="button" className="link-button" onClick={close}>Save & close</button></div>
    </aside> : <div className={`help-backdrop ${spotlight && tab === 'tour' ? 'has-spotlight' : ''}`} onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" aria-describedby="help-subtitle">
      <header className="help-header">
        <div><span className="eyebrow">YOUR WORKOUT BUDDY GUIDE</span><h2 id="help-title">Get started</h2><p id="help-subtitle">Your tour progress is saved on this device. You can return from Help anytime.</p></div>
        <button ref={closeButton} type="button" className="icon-button" onClick={close} aria-label="Close help">×</button>
      </header>
      <div className="help-tabs" role="tablist" aria-label="Help options">
        <button id="help-tour-tab" type="button" role="tab" aria-selected={tab === 'tour'} aria-controls="help-tour-panel" className={tab === 'tour' ? 'active' : ''} onClick={() => setTab('tour')}>App tour</button>
        <button id="help-ask-tab" type="button" role="tab" aria-selected={tab === 'ask'} aria-controls="help-ask-panel" className={tab === 'ask' ? 'active' : ''} onClick={() => setTab('ask')}>Ask Gemini</button>
      </div>
      {tab === 'tour' ? <div id="help-tour-panel" role="tabpanel" aria-labelledby="help-tour-tab" className="help-tour-panel" aria-live="polite">
        {step < TOUR_STEPS.length ? <>
          <div className="help-step-count">Step {step + 1} of {TOUR_STEPS.length}</div>
          <h3>{current.title}</h3>
          <p>{current.text}</p>
          <button type="button" className="button button-outline help-go-button" onClick={goToSection}>Open {current.next}</button>
          <div className="help-actions">
            <div><button type="button" className="link-button" onClick={close}>Save & close</button><button type="button" className="link-button" onClick={restartTour}>Restart tour</button></div>
            <div>
              <button type="button" className="button button-subtle" disabled={step === 0} onClick={() => saveStep(step - 1)}>Back</button>
              {step < TOUR_STEPS.length - 1
                ? <button type="button" className="button button-primary" onClick={() => saveStep(step + 1)}>Next</button>
                : <button type="button" className="button button-primary" onClick={finishTour}>Done</button>}
            </div>
          </div>
        </> : <div className="help-tour-complete"><div className="help-step-count">TOUR COMPLETE</div><h3>You’re ready to find a workout buddy.</h3><p>You can return to any section whenever you like.</p><div><button type="button" className="button button-primary" onClick={restartTour}>Restart tour</button><button type="button" className="button button-subtle" onClick={close}>Close</button></div></div>}
      </div> : <div id="help-ask-panel" role="tabpanel" aria-labelledby="help-ask-tab" className="help-ask-panel">
        <p className="help-privacy-note">Ask about using the app or general workout planning. Your typed question is sent to Google Gemini. The assistant does not receive your profile, schedule, or chats. Don’t include passwords or sensitive details. Questions are not saved.</p>
        {assistantState === 'checking' ? <p className="help-ai-status" role="status">Checking whether Gemini is available…</p>
          : assistantState === 'unavailable' ? <div className="help-ai-unavailable" role="status"><strong>Gemini isn’t set up yet.</strong><span>The tour works now. AI questions will be available after the app owner configures the Gemini service.</span></div>
            : <form className="help-ask-form" onSubmit={ask}>
              <label htmlFor="help-question">Your question</label>
              <textarea id="help-question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={600} rows={3} placeholder="How do I find someone with the same free time?" required />
              <button className="button button-primary" type="submit" disabled={sending || !question.trim()}>{sending ? 'Asking Gemini…' : 'Ask Gemini'}</button>
            </form>}
        {error && <p className="inline-error" role="alert">{error}</p>}
        {sending && <p className="help-ai-status" role="status">Thinking…</p>}
        {answeredQuestion && <div className="help-answer" aria-live="polite"><p><strong>You asked:</strong> {answeredQuestion}</p>{answer ? <p><strong>Gemini:</strong> {answer}</p> : <p>Waiting for an answer…</p>}</div>}
        <p className="help-ai-footnote">Gemini can be wrong. For health concerns, ask a qualified professional.</p>
      </div>}
    </section>
  </div>}
  </>;
}
