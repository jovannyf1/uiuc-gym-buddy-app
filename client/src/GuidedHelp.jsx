import { useEffect, useRef, useState } from 'react';
import './guided-help.css';

const TOUR_STEPS = [
  {
    title: 'Make your profile yours',
    text: 'Choose the workouts and campus gyms that suit you, set your partner preferences, and add a short introduction. Your full name and public username help other members recognize you.',
    next: 'My profile',
  },
  {
    title: 'Add the times you are free',
    text: 'Enter weekly free times by hand, or import an .ics calendar or schedule screenshot. Review every suggestion before saving it. Imports are one-time snapshots, not live calendar sync.',
    next: 'My availability',
  },
  {
    title: 'Find a compatible buddy',
    text: 'Find a buddy compares shared free times, workout interests, gym locations, and partner preferences. Add your profile and availability first so matches have useful information.',
    next: 'Find a buddy',
  },
  {
    title: 'Start a conversation',
    text: 'Open a match and choose Chat to plan a workout together. Messages are saved for both people. New messages refresh while the app is open; there are no push alerts yet.',
    next: 'Chats',
  },
  {
    title: 'Make a dated workout plan',
    text: 'From a match, send an invitation with a real date, time, activity, and campus gym. The other person can accept or decline it in Meetups.',
    next: 'Meetups',
  },
  {
    title: 'Share now, and stay in control',
    text: 'Working out now is optional and expires automatically. You can block a member or report a concern. Reports are saved, but a human review process is not set up yet.',
    next: 'Working out now',
  },
];

export default function GuidedHelp({ open, onClose, onNavigate }) {
  const [tab, setTab] = useState('tour');
  const [step, setStep] = useState(0);
  const [assistantState, setAssistantState] = useState('checking');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [answeredQuestion, setAnsweredQuestion] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const closeButton = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setTab('tour');
    setStep(0);
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
    function onKeyDown(event) { if (event.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKeyDown);
    return () => { controller.abort(); window.removeEventListener('keydown', onKeyDown); };
  }, [open, onClose]);

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

  const current = TOUR_STEPS[step];
  function close() { onClose(); }
  function goToSection() {
    const destinations = {
      'My profile': 'profile',
      'My availability': 'availability',
      'Find a buddy': 'matches',
      Chats: 'chats',
      Meetups: 'meetups',
      'Working out now': 'now',
    };
    onNavigate(destinations[current.next]);
    close();
  }

  return <div className="help-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" aria-describedby="help-subtitle">
      <header className="help-header">
        <div><span className="eyebrow">YOUR WORKOUT BUDDY GUIDE</span><h2 id="help-title">Get started</h2><p id="help-subtitle">A quick tour, plus an optional Gemini question box.</p></div>
        <button ref={closeButton} type="button" className="icon-button" onClick={close} aria-label="Close help">×</button>
      </header>
      <div className="help-tabs" role="tablist" aria-label="Help options">
        <button id="help-tour-tab" type="button" role="tab" aria-selected={tab === 'tour'} aria-controls="help-tour-panel" className={tab === 'tour' ? 'active' : ''} onClick={() => setTab('tour')}>App tour</button>
        <button id="help-ask-tab" type="button" role="tab" aria-selected={tab === 'ask'} aria-controls="help-ask-panel" className={tab === 'ask' ? 'active' : ''} onClick={() => setTab('ask')}>Ask Gemini</button>
      </div>
      {tab === 'tour' ? <div id="help-tour-panel" role="tabpanel" aria-labelledby="help-tour-tab" className="help-tour-panel" aria-live="polite">
        <div className="help-step-count">Step {step + 1} of {TOUR_STEPS.length}</div>
        <h3>{current.title}</h3>
        <p>{current.text}</p>
        <button type="button" className="button button-outline help-go-button" onClick={goToSection}>Open {current.next}</button>
        <div className="help-actions">
          <button type="button" className="link-button" onClick={close}>Skip tour</button>
          <div>
            <button type="button" className="button button-subtle" disabled={step === 0} onClick={() => setStep(index => Math.max(0, index - 1))}>Back</button>
            {step < TOUR_STEPS.length - 1
              ? <button type="button" className="button button-primary" onClick={() => setStep(index => Math.min(TOUR_STEPS.length - 1, index + 1))}>Next</button>
              : <button type="button" className="button button-primary" onClick={close}>Done</button>}
          </div>
        </div>
      </div> : <div id="help-ask-panel" role="tabpanel" aria-labelledby="help-ask-tab" className="help-ask-panel">
        <p className="help-privacy-note">Ask about using the app or general workout planning. Your typed question is sent to Google Gemini. The assistant does not receive your profile, schedule, or chats. Don’t include passwords or sensitive details. Questions are not saved.</p>
        {assistantState === 'checking' ? <p className="help-ai-status" role="status">Checking whether Gemini is available…</p>
          : assistantState === 'unavailable' ? <div className="help-ai-unavailable" role="status"><strong>Gemini isn’t set up yet.</strong><span>The tour works now. AI questions will be available after the app owner configures the Gemini service.</span></div>
            : <form className="help-ask-form" onSubmit={ask}>
              <label htmlFor="help-question">Your question</label>
              <textarea id="help-question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={1000} rows={3} placeholder="How do I find someone with the same free time?" required />
              <button className="button button-primary" type="submit" disabled={sending || !question.trim()}>{sending ? 'Asking Gemini…' : 'Ask Gemini'}</button>
            </form>}
        {error && <p className="inline-error" role="alert">{error}</p>}
        {sending && <p className="help-ai-status" role="status">Thinking…</p>}
        {answeredQuestion && <div className="help-answer" aria-live="polite"><p><strong>You asked:</strong> {answeredQuestion}</p>{answer ? <p><strong>Gemini:</strong> {answer}</p> : <p>Waiting for an answer…</p>}</div>}
        <p className="help-ai-footnote">Gemini can be wrong. For health concerns, ask a qualified professional.</p>
      </div>}
    </section>
  </div>;
}
