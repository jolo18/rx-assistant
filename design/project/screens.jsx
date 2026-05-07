// Rx Assistant — screen compositions S-1 through S-8.
// Each screen is a self-contained frame embedded into a DCArtboard.

const {
  Caret, FirstTokenIndicator, UserMessage, ReasoningPanel, ToolCall,
  MessageFooter, CappedNotice, ErrorPill, Composer, AudioPlayer,
  LoadingSkeleton, Sidebar, PromptSuggestions, Ic,
} = window;

const SAMPLE_Q = "What does lisinopril do, and what are the key warnings?";
const SAMPLE_Q2 = "Is the dry cough I've had for a few weeks something to worry about?";

function AnswerBody({ caret, partial = false }) {
  if (partial) {
    return (
      <div className="rx-text t-body-md">
        <p>
          Lisinopril is an <strong>ACE inhibitor</strong> used primarily to treat high blood pressure and heart failure, and to improve survival after a heart attack. It works by relaxing the blood vessels so the heart doesn't have to push as hard
          {caret}
        </p>
      </div>
    );
  }
  return (
    <div className="rx-text t-body-md">
      <p>
        Lisinopril is an <strong>ACE inhibitor</strong> used primarily to treat high blood pressure and heart failure, and to improve survival after a heart attack. It works by relaxing blood vessels so the heart doesn't have to push as hard.
      </p>
      <h2>Typical use</h2>
      <ul>
        <li>Adults usually start at 10&nbsp;mg once daily, titrated up to 40&nbsp;mg based on response.</li>
        <li>Take at the same time each day; with or without food.</li>
      </ul>
      <h2>Key warnings</h2>
      <ul>
        <li><strong>Angioedema</strong> — rare but serious swelling of the face, lips or throat. Stop the medication and seek care immediately.</li>
        <li><strong>Pregnancy</strong> — contraindicated; can harm the fetus, especially in the second and third trimesters.</li>
        <li><strong>Persistent dry cough</strong> is a known side effect; if bothersome, ask your prescriber about an ARB alternative.</li>
      </ul>
    </div>
  );
}

function ChatPaneTop({ title, action }) {
  return (
    <div className="rx-pane__top">
      <span className="t-label rx-pane__crumb" style={{ color: "var(--text-secondary)" }}>Conversation</span>
      <span className="rx-pane__crumb" aria-hidden="true">›</span>
      <span className="rx-pane__title">{title}</span>
      <div style={{ flex: 1 }}/>
      {action}
    </div>
  );
}

function MobileTop({ title = "Rx Assistant" }) {
  return (
    <div className="rx-mobiletop">
      <button className="rx-mobiletop__btn" aria-label="Open menu"><Ic.Menu size={18}/></button>
      <div className="rx-mobiletop__brand">
        <span className="rx-brand__mark" aria-hidden="true" style={{ width: 18, height: 18 }}/>
        <span className="t-label">{title}</span>
      </div>
      <button className="rx-mobiletop__btn" aria-label="New chat"><Ic.Edit size={18}/></button>
    </div>
  );
}

function Frame({ children, mobile = false, hideSidebar = false, sidebarProps = {}, top, mobileTitle }) {
  // rx-app already provides the grid (280px 1fr desktop, 1fr mobile).
  // We render its children DIRECTLY — no inner wrapper — so the grid tracks
  // map onto sidebar + main correctly.
  const cls = "rx-root rx-app"
    + (mobile ? " rx-app--mobile" : "")
    + (!mobile && hideSidebar ? " rx-app--no-sidebar" : "");
  return (
    <div className={cls}>
      {!mobile && !hideSidebar && <Sidebar {...sidebarProps}/>}
      <main className="rx-pane">
        {mobile ? <MobileTop title={mobileTitle}/> : top}
        {children}
      </main>
    </div>
  );
}

/* S-1 · Empty / first run */
function S1Empty({ mobile = false }) {
  return (
    <Frame mobile={mobile} sidebarProps={{ empty: true }}
      top={<ChatPaneTop title="New conversation"/>} mobileTitle="Rx Assistant">
      <div className="rx-list">
        <div className="rx-firstrun">
          <h1 className="rx-firstrun__greeting">Ask about a medication or a symptom.</h1>
          <p className="rx-firstrun__sub">Answers are informational, not medical advice.</p>
          <PromptSuggestions/>
        </div>
      </div>
      <div className="rx-composerwrap">
        <div className="rx-composerwrap__inner">
          <Composer focused={!mobile}/>
        </div>
      </div>
    </Frame>
  );
}

/* S-2 · Streaming snapshot */
function S2Streaming({ mobile = false, reducedMotion = false }) {
  return (
    <Frame mobile={mobile} top={<ChatPaneTop title="Lisinopril dosage and key warnings"/>} mobileTitle="Lisinopril…">
      <div className="rx-list">
        <div className="rx-list__inner">
          <UserMessage text={SAMPLE_Q} time="14:31"/>
          <article className="rx-amsg">
            <div className="rx-amsg__blocks">
              <ReasoningPanel state="streaming-expanded" reducedMotion={reducedMotion}/>
              <ToolCall name="drug_info" state="running" reducedMotion={reducedMotion}/>
              <AnswerBody caret={<Caret paused/>} partial/>
            </div>
          </article>
        </div>
      </div>
      <div className="rx-composerwrap">
        <div className="rx-composerwrap__inner">
          <Composer ttsOn/>
        </div>
      </div>
    </Frame>
  );
}

/* S-2-LIVE · replayable simulator */
function S2LiveFrame({ children, action }) {
  return (
    <div className="rx-root rx-app">
      <Sidebar/>
      <main className="rx-pane">
        <ChatPaneTop title="Lisinopril dosage and key warnings" action={action}/>
        {children}
      </main>
    </div>
  );
}

function S2Live() {
  const [phase, setPhase] = React.useState("idle");
  const [reasoningText, setReasoningText] = React.useState("");
  const [toolState, setToolState] = React.useState(null);
  const [answer, setAnswer] = React.useState("");
  const [showFooter, setShowFooter] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const tRef = React.useRef([]);

  const FULL_REASONING = "Considering whether the user is asking about brand or generic naming. Lisinopril is the generic; common brands include Prinivil and Zestril. I should cover the indication, typical dosage, and the key warnings before suggesting follow-ups.";
  const FULL_ANSWER = "Lisinopril is an ACE inhibitor used primarily to treat high blood pressure and heart failure, and to improve survival after a heart attack. It works by relaxing the blood vessels so the heart doesn't have to push as hard.";

  const clear = () => { tRef.current.forEach(clearTimeout); tRef.current = []; };
  const at = (ms, fn) => { tRef.current.push(setTimeout(fn, ms)); };

  const reset = () => {
    clear(); setPhase("idle"); setReasoningText(""); setToolState(null);
    setAnswer(""); setShowFooter(false); setRunning(false);
  };

  const play = () => {
    reset(); setRunning(true); setPhase("submitting");
    at(800, () => setPhase("reasoning-start"));
    const reasoningStart = 1000;
    const rChunks = FULL_REASONING.match(/.{1,3}/g) || [];
    rChunks.forEach((c, i) => at(reasoningStart + i * 18, () => setReasoningText((s) => s + c)));
    const reasoningEnd = reasoningStart + rChunks.length * 18;
    at(reasoningEnd + 200, () => { setPhase("reasoning-end"); setToolState("pending"); });
    at(reasoningEnd + 800, () => setToolState("running"));
    at(reasoningEnd + 2200, () => { setToolState("complete-success"); setPhase("text-streaming"); });
    const answerStart = reasoningEnd + 2500;
    const aChunks = FULL_ANSWER.match(/.{1,4}/g) || [];
    aChunks.forEach((c, i) => at(answerStart + i * 16, () => setAnswer((s) => s + c)));
    const answerEnd = answerStart + aChunks.length * 16;
    at(answerEnd + 200, () => { setPhase("done"); setShowFooter(true); setRunning(false); });
  };

  React.useEffect(() => () => clear(), []);

  const showFirstToken = phase === "submitting";
  const showReasoning = ["reasoning-start","reasoning-end","text-streaming","done"].includes(phase);
  const showTool = toolState !== null;
  const showAnswer = answer.length > 0;

  return (
    <S2LiveFrame action={
      <button className="rx-replay-btn" onClick={play} disabled={running}>
        <Ic.Play size={13}/>
        <span className="t-label">{phase === "idle" ? "Play stream" : running ? "Streaming…" : "Replay stream"}</span>
      </button>
    }>
      <div className="rx-list">
        <div className="rx-list__inner">
          <UserMessage text={SAMPLE_Q} time="14:31"/>
          {phase === "idle" && (
            <p className="t-body-sm" style={{ alignSelf: "center", color: "var(--text-secondary)", textAlign: "center" }}>
              Press <strong style={{ color: "var(--text-primary)" }}>Play stream</strong> above to replay the SSE event sequence —<br/>
              first-token indicator → reasoning → tool call → text streaming → settled.
            </p>
          )}
          {phase !== "idle" && (
            <article className="rx-amsg">
              <div className="rx-amsg__blocks">
                {showFirstToken && <FirstTokenIndicator/>}
                {showReasoning && (
                  <div className="rx-reasoning is-expanded">
                    <button className="rx-reasoning__head">
                      <span className={"rx-reasoning__dot" + (phase === "reasoning-start" ? " is-streaming" : "")}/>
                      <span className="t-label">{phase === "reasoning-start" ? "Thinking…" : "Thoughts"}</span>
                      <span className="rx-reasoning__chev"><Ic.ChevronDown size={14}/></span>
                    </button>
                    <div className="rx-reasoning__body">
                      <p className="t-body-sm">{reasoningText}{phase === "reasoning-start" && <Caret/>}</p>
                    </div>
                  </div>
                )}
                {showTool && <ToolCall name="drug_info" state={toolState} duration="0.7s"/>}
                {showAnswer && (
                  <div className="rx-text t-body-md">
                    <p>{answer}{phase === "text-streaming" && <Caret/>}</p>
                  </div>
                )}
                {showFooter && <MessageFooter time="14:32" model="sonnet-4.6" tokensIn={1204} tokensOut={387} cost={0.0072}/>}
              </div>
            </article>
          )}
        </div>
      </div>
      <div className="rx-composerwrap">
        <div className="rx-composerwrap__inner">
          <Composer state={running ? "submitting" : "idle"} ttsOn/>
        </div>
      </div>
    </S2LiveFrame>
  );
}

/* S-3 · Settled */
function S3Settled({ mobile = false, showHover = false, showAudio = false }) {
  return (
    <Frame mobile={mobile} top={<ChatPaneTop title="Lisinopril dosage and key warnings"/>} mobileTitle="Lisinopril…">
      <div className="rx-list">
        <div className="rx-list__inner">
          <UserMessage text={SAMPLE_Q} time="14:31" showHover={showHover}/>
          <article className="rx-amsg">
            <div className="rx-amsg__blocks">
              <ReasoningPanel state="settled-collapsed"/>
              <ToolCall name="drug_info" state="complete-success" duration="0.7s"/>
              <AnswerBody/>
              {showAudio && <AudioPlayer variant="full" elapsed={28} total={84}/>}
            </div>
            <MessageFooter time="14:32" model="sonnet-4.6" tokensIn={1204} cached={832} tokensOut={387} cost={0.0072} showMenu={showHover}/>
          </article>
        </div>
      </div>
      <div className="rx-composerwrap">
        <div className="rx-composerwrap__inner"><Composer ttsOn/></div>
      </div>
    </Frame>
  );
}

/* S-4 · Sidebar focus */
function S4Sidebar({ mobile = false }) {
  if (mobile) {
    return (
      <div className="rx-root" style={{ position: "relative", background: "var(--bg-canvas)" }}>
        <div style={{ position: "absolute", inset: 0, background: "rgba(20,18,14,0.45)" }}/>
        <div style={{ position: "absolute", inset: 0, display: "flex" }}>
          <div style={{ width: "82%", maxWidth: 320, background: "var(--bg-surface)", borderRight: "1px solid var(--border-subtle)", display: "flex" }}>
            <Sidebar mobile/>
          </div>
        </div>
      </div>
    );
  }
  return (
    <Frame top={<ChatPaneTop title="Lisinopril dosage and key warnings"/>}>
      <div className="rx-list">
        <div className="rx-list__inner">
          <UserMessage text={SAMPLE_Q} time="14:31"/>
          <article className="rx-amsg">
            <div className="rx-amsg__blocks">
              <ReasoningPanel state="settled-collapsed"/>
              <ToolCall name="drug_info" state="complete-success" duration="0.7s"/>
              <AnswerBody/>
            </div>
            <MessageFooter time="14:32" tokensIn={1204} tokensOut={387} cost={0.0072}/>
          </article>
        </div>
      </div>
      <div className="rx-composerwrap"><div className="rx-composerwrap__inner"><Composer/></div></div>
    </Frame>
  );
}

/* S-5 · Mic permission denied */
function S5MicDenied({ mobile = false }) {
  return (
    <Frame mobile={mobile} top={<ChatPaneTop title="Lisinopril dosage and key warnings"/>}>
      <div className="rx-list">
        <div className="rx-list__inner">
          <UserMessage text={SAMPLE_Q} time="14:31"/>
          <article className="rx-amsg">
            <div className="rx-amsg__blocks">
              <ReasoningPanel state="settled-collapsed"/>
              <AnswerBody/>
            </div>
            <MessageFooter time="14:32" tokensIn={1204} tokensOut={387} cost={0.0072}/>
          </article>
        </div>
      </div>
      <div className="rx-composerwrap">
        <div className="rx-composerwrap__inner">
          <Composer state="denied" banner="denied"/>
        </div>
      </div>
    </Frame>
  );
}

/* S-6 · Mid-stream error */
function S6Error({ mobile = false }) {
  return (
    <Frame mobile={mobile} top={<ChatPaneTop title="Persistent dry cough — what could cause it?"/>} mobileTitle="Dry cough…">
      <div className="rx-list">
        <div className="rx-list__inner">
          <UserMessage text={SAMPLE_Q2} time="14:48"/>
          <article className="rx-amsg">
            <div className="rx-amsg__blocks">
              <ReasoningPanel state="settled-collapsed" text="Considered most-likely benign causes first; preparing to call symptom_lookup for a structured rundown when the upstream service failed."/>
              <div className="rx-text t-body-md">
                <p>A persistent dry cough has many ordinary causes — postnasal drip, reflux, leftover irritation from a viral infection — but it's worth a closer look. Let me check</p>
              </div>
              <ErrorPill/>
            </div>
          </article>
        </div>
      </div>
      <div className="rx-composerwrap"><div className="rx-composerwrap__inner"><Composer/></div></div>
    </Frame>
  );
}

/* S-7 · Step cap reached */
function S7Capped({ mobile = false }) {
  return (
    <Frame mobile={mobile} top={<ChatPaneTop title="Persistent dry cough — what could cause it?"/>} mobileTitle="Dry cough…">
      <div className="rx-list">
        <div className="rx-list__inner">
          <UserMessage text={SAMPLE_Q2} time="14:48"/>
          <article className="rx-amsg">
            <div className="rx-amsg__blocks">
              <ReasoningPanel state="settled-collapsed"/>
              <ToolCall name="symptom_lookup" state="complete-success" duration="0.4s"/>
              <ToolCall name="drug_info" state="complete-success" duration="0.6s"/>
              <ToolCall name="symptom_lookup" state="complete-success" duration="0.5s"/>
              <div className="rx-text t-body-md">
                <p>A long-running dry cough usually points to one of a small set of causes — postnasal drip, reflux, or a side effect of an ACE inhibitor — and rarely something more serious. Cross-checking with the symptom database and your medication list is a sensible start.</p>
              </div>
              <CappedNotice/>
            </div>
            <MessageFooter time="14:48" tokensIn={3140} tokensOut={612} cost={0.0184}/>
          </article>
        </div>
      </div>
      <div className="rx-composerwrap"><div className="rx-composerwrap__inner"><Composer/></div></div>
    </Frame>
  );
}

/* S-8 · Loading skeleton */
function S8Loading({ mobile = false }) {
  return (
    <Frame mobile={mobile} top={<ChatPaneTop title="Loading…"/>}>
      <div className="rx-list">
        <div className="rx-list__inner">
          <LoadingSkeleton/>
        </div>
      </div>
      <div className="rx-composerwrap"><div className="rx-composerwrap__inner"><Composer/></div></div>
    </Frame>
  );
}

Object.assign(window, {
  S1Empty, S2Streaming, S2Live, S3Settled, S4Sidebar,
  S5MicDenied, S6Error, S7Capped, S8Loading, AnswerBody,
});
