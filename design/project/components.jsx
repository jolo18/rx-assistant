// Rx Assistant — atomic UI components
// All visual states for §4: ToolCall pill, ReasoningPanel, MessageFooter,
// User/Assistant Message, Composer, AudioPlayer, Sidebar, Skeletons, etc.
//
// Components are presentational — they take a `state` prop and render that
// frame. Streaming animation lives in screens.jsx where it's wired to the
// stream simulator.

const { Ic } = window;

/* ───────────────────────── helpers ───────────────────────── */

const fmt = {
  tokens: (n) => n.toLocaleString("en-US"),
  cost: (n) => (n < 0.0001 ? "<$0.0001" : "$" + n.toFixed(4)),
  time: (d) => {
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  },
  rel: (d, now = new Date()) => {
    const diff = (now - d) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    if (diff < 172800) return "Yesterday";
    if (diff < 7 * 86400) return Math.floor(diff / 86400) + "d ago";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  },
};

/* ───────────────────────── Caret ─────────────────────────── */

function Caret({ paused }) {
  // 1.0s square-wave blink. When paused (e.g. tool running) the caret holds
  // solid on so the user still sees position.
  return (
    <span
      className={"rx-caret" + (paused ? " is-paused" : "")}
      aria-hidden="true"
    />
  );
}

/* ─────────────────── FirstTokenIndicator ────────────────── */

function FirstTokenIndicator() {
  return (
    <div className="rx-firsttoken" role="status" aria-label="Assistant is preparing a response">
      <span /><span /><span />
    </div>
  );
}

/* ───────────────────── User message ──────────────────────── */

function UserMessage({ text, time = "14:31", showHover = false }) {
  return (
    <div className={"rx-msg rx-msg--user" + (showHover ? " is-hover" : "")}>
      <div className="rx-bubble">
        <div className="t-body-md">{text}</div>
      </div>
      <div className="rx-msg__footer">
        <span className="t-caption" style={{ color: "var(--text-secondary)" }}>{time}</span>
        <button className="rx-iconbtn rx-msg__more" title="More" aria-label="More actions">
          <Ic.More size={16}/>
        </button>
      </div>
    </div>
  );
}

/* ─────────────────── Reasoning panel ─────────────────────── */

function ReasoningPanel({ state = "settled-collapsed", text, reducedMotion }) {
  // states: streaming-collapsed, streaming-expanded, settled-collapsed, settled-expanded
  const streaming = state.startsWith("streaming");
  const expanded = state.endsWith("expanded");
  return (
    <div className={"rx-reasoning" + (expanded ? " is-expanded" : "")}>
      <button className="rx-reasoning__head" aria-expanded={expanded}>
        <span className={"rx-reasoning__dot" + (streaming ? " is-streaming" : "") + (reducedMotion ? " is-reduced" : "")} aria-hidden="true"/>
        <span className="t-label">{streaming ? "Thinking…" : "Thoughts"}</span>
        <span className="rx-reasoning__chev" aria-hidden="true">
          <Ic.ChevronDown size={14}/>
        </span>
      </button>
      {expanded && (
        <div className="rx-reasoning__body">
          <p className="t-body-sm">
            {text || (streaming
              ? "Considering whether the user is asking about brand or generic naming. Lisinopril is the generic; common brands include Prinivil and Zestril. I should cover indication, typical dosage, and key warnings, then check whether they want symptom guidance too."
              : "Considered brand vs. generic. Lisinopril is the generic; common brands include Prinivil and Zestril. Covered indication, dosage range, and the principal warnings (angioedema, pregnancy category). Decided not to over-explain pharmacokinetics unless asked.")}
            {streaming && <Caret/>}
          </p>
        </div>
      )}
    </div>
  );
}

/* ───────────────────── Tool call pill ────────────────────── */

const TOOL_META = {
  drug_info: { label: "drug_info", icon: Ic.Beaker },
  symptom_lookup: { label: "symptom_lookup", icon: Ic.Stethoscope },
};

function ToolCall({
  name = "drug_info",
  state = "running",
  duration,
  expanded = false,
  input,
  output,
  rawView = false,
  reducedMotion,
  children,
}) {
  // states: pending, running, complete-success, complete-error
  const meta = TOOL_META[name] || { label: name, icon: Ic.Sparkle };
  const Icon = meta.icon;

  const stateClass = "is-" + state.replace("complete-", "done-");
  const stateText = {
    pending: "Preparing input…",
    running: "Calling tool…",
    "complete-success": duration ? `${duration}` : "Complete",
    "complete-error": "Returned an error",
  }[state];

  const StateBadge = () => {
    if (state === "pending")
      return <span className="rx-pill__badge rx-pill__badge--pending" aria-hidden="true"/>;
    if (state === "running")
      return <span className={"rx-pill__spinner" + (reducedMotion ? " is-reduced" : "")} aria-hidden="true"/>;
    if (state === "complete-success")
      return (
        <span className="rx-pill__badge rx-pill__badge--success" aria-hidden="true">
          <Ic.Check size={11}/>
        </span>
      );
    if (state === "complete-error")
      return (
        <span className="rx-pill__badge rx-pill__badge--warn" aria-hidden="true">
          <Ic.Alert size={11}/>
        </span>
      );
    return null;
  };

  return (
    <div className={"rx-tool " + stateClass + (expanded ? " is-expanded" : "")}>
      <button className="rx-tool__pill" aria-expanded={expanded}>
        <span className="rx-tool__icon"><Icon size={14}/></span>
        <span className="rx-tool__name t-label">{meta.label}</span>
        <span className="rx-tool__sep" aria-hidden="true">·</span>
        <StateBadge/>
        <span className="rx-tool__state t-label">{stateText}</span>
        {(state === "complete-success" || state === "complete-error") && (
          <span className="rx-tool__chev" aria-hidden="true">
            <Ic.ChevronDown size={13}/>
          </span>
        )}
      </button>
      {expanded && (
        <div className="rx-tool__body">
          <div className="rx-tool__section">
            <div className="rx-tool__sectionhead">
              <span className="t-label">Input</span>
            </div>
            <pre className="rx-tool__code t-code-b">{input || `{
  "name": "lisinopril"
}`}</pre>
          </div>
          <div className="rx-tool__section">
            <div className="rx-tool__sectionhead">
              <span className="t-label">Output</span>
              <button className="rx-tool__rawtoggle t-caption">
                {rawView ? "View formatted" : "View raw"}
              </button>
            </div>
            {children || (rawView ? (
              <pre className="rx-tool__code t-code-b">{output || sampleRawOutput(name)}</pre>
            ) : (
              <FormattedToolOutput name={name} state={state}/>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function sampleRawOutput(name) {
  if (name === "drug_info")
    return `{
  "name": "Lisinopril",
  "class": "ACE inhibitor",
  "indications": ["Hypertension", "Heart failure", "Post-MI"],
  "dosage": { "adult": "10–40 mg once daily" },
  "warnings": ["Angioedema risk", "Avoid in pregnancy"]
}`;
  return `{
  "symptom": "persistent dry cough",
  "common_causes": ["Postnasal drip", "GERD", "ACE inhibitor side effect"],
  "when_to_seek_care": "Cough lasting > 8 weeks, blood, weight loss, fever",
  "disclaimer": "This information is general and not a substitute for professional medical advice. If symptoms are severe or worsening, contact a clinician."
}`;
}

function FormattedToolOutput({ name, state }) {
  if (state === "complete-error") {
    return (
      <div className="rx-tool__error">
        <span className="t-body-sm" style={{ color: "var(--tool-warn-fg)" }}>
          Upstream service returned <code className="t-code-i">503 Service Unavailable</code>. The assistant will continue with the information it already has.
        </span>
      </div>
    );
  }
  if (name === "drug_info") {
    return (
      <dl className="rx-deflist">
        <div><dt className="t-label">Name</dt><dd className="t-body-sm">Lisinopril <span style={{ color: "var(--text-secondary)" }}>· ACE inhibitor</span></dd></div>
        <div><dt className="t-label">Indications</dt><dd className="t-body-sm">Hypertension, heart failure, post-myocardial infarction.</dd></div>
        <div><dt className="t-label">Adult dosage</dt><dd className="t-body-sm">10–40 mg orally, once daily. Initial 10 mg; titrate to response.</dd></div>
        <div><dt className="t-label">Key warnings</dt><dd className="t-body-sm">Angioedema (rare, more common in Black patients). Contraindicated in pregnancy. Risk of hyperkalemia with potassium-sparing diuretics.</dd></div>
      </dl>
    );
  }
  return (
    <dl className="rx-deflist">
      <div><dt className="t-label">Description</dt><dd className="t-body-sm">A persistent dry cough with no productive component, typically triggered by airway irritation.</dd></div>
      <div><dt className="t-label">Common causes</dt><dd className="t-body-sm">Postnasal drip, gastroesophageal reflux, ACE inhibitor medication, viral aftermath.</dd></div>
      <div><dt className="t-label">When to seek care</dt><dd className="t-body-sm">Cough persisting beyond 8 weeks, blood in sputum, unexplained weight loss, or fever above 38.5 °C.</dd></div>
      <div className="rx-deflist__note">
        <dd className="t-body-sm" style={{ color: "var(--text-secondary)" }}>
          This information is general and not a substitute for professional medical advice. If symptoms are severe or worsening, contact a clinician.
        </dd>
      </div>
    </dl>
  );
}

/* ───────────────────── Message footer ────────────────────── */

function MessageFooter({
  time = "14:32",
  model = "sonnet-4.6",
  tokensIn = 1204,
  tokensOut = 387,
  cached,
  cost = 0.0072,
  capped,
  showMenu = false,
}) {
  return (
    <div className="rx-mfooter">
      <span className="t-caption">{time}</span>
      <span className="rx-mfooter__sep">·</span>
      <span className="t-caption">{model}</span>
      <span className="rx-mfooter__sep">·</span>
      <span className="t-caption">
        {fmt.tokens(tokensIn)} in
        {cached ? <span className="rx-mfooter__cached"> ({fmt.tokens(cached)} cached)</span> : null}
        {" / "}{fmt.tokens(tokensOut)} out
      </span>
      <span className="rx-mfooter__sep">·</span>
      <span className="t-caption">{fmt.cost(cost)}</span>
      <button className="rx-iconbtn rx-mfooter__more" aria-label="Message actions">
        <Ic.More size={14}/>
      </button>
      {showMenu && (
        <div className="rx-menu" role="menu">
          <button role="menuitem" className="rx-menu__item">
            <Ic.Copy size={14}/><span className="t-label">Copy</span>
          </button>
          <button role="menuitem" className="rx-menu__item rx-menu__item--danger">
            <Ic.Trash size={14}/><span className="t-label">Delete</span>
          </button>
        </div>
      )}
    </div>
  );
}

/* ───────────────────── Capped notice ─────────────────────── */

function CappedNotice() {
  return (
    <div className="rx-capped">
      <Ic.Info size={14}/>
      <span className="t-caption">Stopped after the maximum number of reasoning steps.</span>
    </div>
  );
}

/* ───────────────────── Error pill ────────────────────────── */

function ErrorPill({ onRetry }) {
  return (
    <div className="rx-errorpill" role="alert">
      <Ic.Alert size={14}/>
      <span className="t-body-md">Something went wrong while generating.</span>
      <button className="rx-errorpill__retry t-label" onClick={onRetry}>Try again</button>
    </div>
  );
}

/* ───────────────────── Composer ──────────────────────────── */

function Composer({
  value = "",
  state = "idle", // idle | typing | submitting | recording | denied
  ttsOn = false,
  banner,           // explicit banner override
  focused = false,
  showSendActive = false,
}) {
  const recording = state === "recording";
  const denied = state === "denied";
  const submitting = state === "submitting";
  const hasText = value.length > 0 || showSendActive;

  let bannerEl = null;
  if (banner === "denied" || denied) {
    bannerEl = (
      <div className="rx-banner rx-banner--warn" role="alert">
        <Ic.Alert size={14}/>
        <span className="t-body-sm">Microphone permission denied. Enable mic access in browser settings to use voice input.</span>
        <button className="rx-banner__close" aria-label="Dismiss"><Ic.X size={12}/></button>
      </div>
    );
  } else if (banner === "listening" || recording) {
    bannerEl = (
      <div className="rx-banner rx-banner--listening">
        <span className="rx-banner__dot" aria-hidden="true"/>
        <span className="t-body-sm">Listening — say your question.</span>
      </div>
    );
  }

  return (
    <div className={"rx-composer" + (focused ? " is-focused" : "")}>
      <div className="rx-composer__inputwrap">
        <textarea
          className="rx-composer__input t-body-md"
          rows={1}
          value={value}
          placeholder="Ask about a medication or a symptom…"
          readOnly
        />
        <div className="rx-composer__actions">
          <button
            className={"rx-composer__btn rx-composer__mic" + (recording ? " is-recording" : "") + (denied ? " is-denied" : "")}
            aria-label={denied ? "Microphone denied" : recording ? "Stop recording" : "Start voice input"}
            aria-pressed={recording}
            title={denied ? "Microphone permission denied" : recording ? "Stop recording" : "Voice input"}
          >
            {denied ? <Ic.Lock size={16}/> : recording ? (
              <span className="rx-composer__recdot" aria-hidden="true"/>
            ) : <Ic.Mic size={16}/>}
          </button>
          <button
            className={"rx-composer__btn rx-composer__tts" + (ttsOn ? " is-on" : "")}
            aria-label={ttsOn ? "Disable spoken replies" : "Enable spoken replies"}
            aria-pressed={ttsOn}
            title={ttsOn ? "Spoken replies on" : "Spoken replies off"}
          >
            {ttsOn ? <Ic.Speaker size={16}/> : <Ic.SpeakerOff size={16}/>}
          </button>
          <button
            className={"rx-composer__send" + (hasText ? " is-active" : "")}
            disabled={!hasText && !submitting}
            aria-label={submitting ? "Sending" : "Send"}
            title="Send"
          >
            {submitting ? <span className="rx-composer__spin" aria-hidden="true"/> : <Ic.Send size={16}/>}
          </button>
        </div>
      </div>
      <div className="rx-composer__bannerrow">{bannerEl}</div>
      <p className="rx-composer__disclaimer t-caption">
        Informational only — not medical advice. Confirm anything important with a clinician.
      </p>
    </div>
  );
}

/* ───────────────────── Audio player ──────────────────────── */

function AudioPlayer({ variant = "compact", playing = true, elapsed = 28, total = 84 }) {
  const pct = Math.max(0, Math.min(100, (elapsed / Math.max(1, total)) * 100));
  if (variant === "compact") {
    return (
      <div className="rx-audio rx-audio--compact" role="group" aria-label="Spoken reply">
        <button className="rx-audio__pp" aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Ic.Pause size={14}/> : <Ic.Play size={14}/>}
        </button>
        <div className="rx-audio__bar"><span className="rx-audio__fill" style={{ width: pct + "%" }}/></div>
      </div>
    );
  }
  const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  return (
    <div className="rx-audio rx-audio--full" role="group" aria-label="Spoken reply">
      <button className="rx-audio__pp" aria-label={playing ? "Pause" : "Play"}>
        {playing ? <Ic.Pause size={14}/> : <Ic.Play size={14}/>}
      </button>
      <span className="rx-audio__time t-caption">{fmtT(elapsed)}</span>
      <div className="rx-audio__bar rx-audio__bar--scrub">
        <span className="rx-audio__fill" style={{ width: pct + "%" }}/>
        <span className="rx-audio__thumb" style={{ left: pct + "%" }}/>
      </div>
      <span className="rx-audio__time t-caption">{fmtT(total)}</span>
      <button className="rx-audio__vol" aria-label="Volume">
        <Ic.Speaker size={14}/>
      </button>
    </div>
  );
}

/* ───────────────────── Loading skeleton ──────────────────── */

function LoadingSkeleton() {
  return (
    <div className="rx-skeleton" aria-hidden="true">
      <div className="rx-skeleton__row rx-skeleton__row--user">
        <div className="rx-skel rx-skel--bubble" style={{ width: "60%" }}/>
      </div>
      <div className="rx-skeleton__row">
        <div className="rx-skel" style={{ width: "30%", height: 16 }}/>
        <div className="rx-skel" style={{ width: "85%", height: 14, marginTop: 12 }}/>
        <div className="rx-skel" style={{ width: "75%", height: 14, marginTop: 6 }}/>
        <div className="rx-skel" style={{ width: "60%", height: 14, marginTop: 6 }}/>
      </div>
      <div className="rx-skeleton__row rx-skeleton__row--user">
        <div className="rx-skel rx-skel--bubble" style={{ width: "40%" }}/>
      </div>
    </div>
  );
}

/* ───────────────────── Sidebar ───────────────────────────── */

const SAMPLE_CONVS = [
  { id: "c1", title: "Lisinopril dosage and key warnings", updatedAt: -2 * 60_000 },
  { id: "c2", title: "Persistent dry cough — what could cause it?", updatedAt: -47 * 60_000 },
  { id: "c3", title: "Ibuprofen and blood pressure", updatedAt: -3 * 3600_000 },
  { id: "c4", title: "Difference between metoprolol tartrate and succinate", updatedAt: -27 * 3600_000 },
  { id: "c5", title: "Migraine vs. tension headache", updatedAt: -2 * 86400_000 },
  { id: "c6", title: "Statins and grapefruit", updatedAt: -5 * 86400_000 },
  { id: "c7", title: "Common amoxicillin side effects", updatedAt: -8 * 86400_000 },
];

function Sidebar({ activeId = "c1", collapsed = false, empty = false, mobile = false }) {
  if (collapsed) {
    return (
      <aside className="rx-sidebar rx-sidebar--collapsed" aria-label="Sidebar (collapsed)">
        <button className="rx-sidebar__toggle" aria-label="Open sidebar"><Ic.Sidebar size={18}/></button>
        <button className="rx-sidebar__newicon" aria-label="New chat" title="New chat"><Ic.Edit size={18}/></button>
      </aside>
    );
  }
  const now = new Date();
  return (
    <aside className={"rx-sidebar" + (mobile ? " rx-sidebar--mobile" : "")} aria-label="Conversations">
      <div className="rx-sidebar__head">
        <div className="rx-sidebar__brand">
          <span className="rx-brand__mark" aria-hidden="true"/>
          <span className="t-heading-sm">Rx Assistant</span>
        </div>
        <button className="rx-sidebar__toggle" aria-label="Collapse sidebar"><Ic.Sidebar size={16}/></button>
      </div>
      <button className="rx-sidebar__new t-label">
        <Ic.Plus size={14}/><span>New chat</span>
      </button>
      <div className="rx-sidebar__sectionlabel t-caption">Recent</div>
      <nav className="rx-sidebar__list" aria-label="Recent conversations">
        {empty ? (
          <p className="rx-sidebar__empty t-body-sm">No conversations yet.</p>
        ) : (
          SAMPLE_CONVS.map((c) => {
            const t = new Date(now.getTime() + c.updatedAt);
            const active = c.id === activeId;
            return (
              <a key={c.id} href="#" className={"rx-conv" + (active ? " is-active" : "")} aria-current={active ? "page" : undefined}>
                <span className="rx-conv__title t-label">{c.title}</span>
                <span className="rx-conv__time t-caption">{fmt.rel(t, now)}</span>
                <button className="rx-conv__more" aria-label="Conversation actions" tabIndex={-1} onClick={(e) => e.preventDefault()}>
                  <Ic.More size={14}/>
                </button>
              </a>
            );
          })
        )}
      </nav>
      <div className="rx-sidebar__foot t-caption">
        Single-user · informational only
      </div>
    </aside>
  );
}

/* ───────── Suggestion prompts ───────── */

const PROMPTS = [
  "What does lisinopril do, and what are the key warnings?",
  "I have a persistent dry cough — what could cause it?",
  "Can I take ibuprofen with a blood-pressure medication?",
  "Difference between metoprolol tartrate and succinate?",
];

function PromptSuggestions() {
  return (
    <div className="rx-prompts">
      {PROMPTS.map((p, i) => (
        <button key={i} className="rx-prompts__item">
          <span className="t-body-md">{p}</span>
          <span className="rx-prompts__arrow"><Ic.ChevronRight size={14}/></span>
        </button>
      ))}
    </div>
  );
}

/* ───────── Jump-to-latest pill ───────── */

function JumpToLatest() {
  return (
    <button className="rx-jump t-label" aria-label="Jump to latest">
      <Ic.ArrowDown size={14}/>
      <span>Jump to latest</span>
    </button>
  );
}

Object.assign(window, {
  Caret, FirstTokenIndicator, UserMessage, ReasoningPanel, ToolCall,
  MessageFooter, CappedNotice, ErrorPill, Composer, AudioPlayer,
  LoadingSkeleton, Sidebar, PromptSuggestions, JumpToLatest, fmt,
  SAMPLE_CONVS, FormattedToolOutput,
});
