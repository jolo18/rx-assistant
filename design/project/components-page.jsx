// Rx Assistant — components reference page (every state variant)
// and tokens reference page. Embedded into DCArtboards.

const {
  Caret, FirstTokenIndicator, UserMessage, ReasoningPanel, ToolCall,
  MessageFooter, CappedNotice, ErrorPill, Composer, AudioPlayer,
  LoadingSkeleton, Sidebar, PromptSuggestions, JumpToLatest, Ic,
} = window;

function CardDemo({ label, children }) {
  return (
    <div className="rx-card">
      <div className="rx-card__label">{label}</div>
      <div className="rx-card__demo">{children}</div>
    </div>
  );
}

function ComponentsPage() {
  return (
    <div className="rx-root rx-cpage">
      <div>
        <h1 className="rx-cpage__hed">Components</h1>
        <p className="rx-cpage__sub">Every variant called out in §4 — at-a-glance, ready to spot-check.</p>
      </div>

      <section className="rx-section">
        <div className="rx-section__head">
          <h2 className="rx-section__title">Tool call · pill</h2>
          <p className="rx-section__desc">Inline pill anchored to the assistant turn. Four states; expanded view reveals input & output.</p>
        </div>
        <div className="rx-grid rx-grid--4">
          <CardDemo label="Pending"><ToolCall name="drug_info" state="pending"/></CardDemo>
          <CardDemo label="Running"><ToolCall name="drug_info" state="running"/></CardDemo>
          <CardDemo label="Success"><ToolCall name="drug_info" state="complete-success" duration="0.7s"/></CardDemo>
          <CardDemo label="Error"><ToolCall name="drug_info" state="complete-error"/></CardDemo>
        </div>
        <div className="rx-grid rx-grid--2">
          <CardDemo label="Expanded · formatted"><ToolCall name="drug_info" state="complete-success" duration="0.7s" expanded/></CardDemo>
          <CardDemo label="Expanded · raw JSON"><ToolCall name="drug_info" state="complete-success" duration="0.7s" expanded rawView/></CardDemo>
        </div>
      </section>

      <section className="rx-section">
        <div className="rx-section__head">
          <h2 className="rx-section__title">Reasoning panel</h2>
          <p className="rx-section__desc">Streaming dot pulses; settled dot is muted. Expanded body uses dashed-rule separation.</p>
        </div>
        <div className="rx-grid rx-grid--2">
          <CardDemo label="Streaming · collapsed"><ReasoningPanel state="streaming-collapsed"/></CardDemo>
          <CardDemo label="Streaming · expanded"><ReasoningPanel state="streaming-expanded"/></CardDemo>
          <CardDemo label="Settled · collapsed"><ReasoningPanel state="settled-collapsed"/></CardDemo>
          <CardDemo label="Settled · expanded"><ReasoningPanel state="settled-expanded"/></CardDemo>
        </div>
      </section>

      <section className="rx-section">
        <div className="rx-section__head">
          <h2 className="rx-section__title">Composer</h2>
          <p className="rx-section__desc">Five states. Mic permission denied surfaces a single banner above the disclaimer.</p>
        </div>
        <div className="rx-grid rx-grid--2">
          <CardDemo label="Idle"><div style={{ width: "100%" }}><Composer/></div></CardDemo>
          <CardDemo label="Focused · with text"><div style={{ width: "100%" }}><Composer focused value="Can I take ibuprofen with lisinopril?" showSendActive/></div></CardDemo>
          <CardDemo label="Recording"><div style={{ width: "100%" }}><Composer state="recording"/></div></CardDemo>
          <CardDemo label="Mic denied"><div style={{ width: "100%" }}><Composer state="denied"/></div></CardDemo>
          <CardDemo label="Submitting"><div style={{ width: "100%" }}><Composer state="submitting" value="…" showSendActive/></div></CardDemo>
          <CardDemo label="TTS enabled"><div style={{ width: "100%" }}><Composer ttsOn/></div></CardDemo>
        </div>
      </section>

      <section className="rx-section">
        <div className="rx-section__head">
          <h2 className="rx-section__title">Message footer</h2>
          <p className="rx-section__desc">Time · model · tokens (in/cached/out) · cost · overflow menu (revealed on hover).</p>
        </div>
        <div className="rx-grid rx-grid--2">
          <CardDemo label="Default"><div style={{ width: "100%" }}><MessageFooter/></div></CardDemo>
          <CardDemo label="With cached + menu"><div style={{ width: "100%" }}><MessageFooter cached={832} showMenu/></div></CardDemo>
        </div>
      </section>

      <section className="rx-section">
        <div className="rx-section__head">
          <h2 className="rx-section__title">User message</h2>
          <p className="rx-section__desc">Right-aligned bubble + footer with timestamp. Hover reveals the overflow.</p>
        </div>
        <div className="rx-grid rx-grid--2">
          <CardDemo label="Default"><div style={{ width: "100%" }}><UserMessage text="What does lisinopril do, and what are the key warnings?"/></div></CardDemo>
          <CardDemo label="Hovered"><div style={{ width: "100%" }}><UserMessage text="Difference between metoprolol tartrate and succinate?" showHover/></div></CardDemo>
        </div>
      </section>

      <section className="rx-section">
        <div className="rx-section__head">
          <h2 className="rx-section__title">Audio player</h2>
          <p className="rx-section__desc">Inline player attached to a TTS reply. Compact for inline, full for the dedicated audio rail.</p>
        </div>
        <div className="rx-grid rx-grid--2">
          <CardDemo label="Compact · playing"><AudioPlayer variant="compact" playing elapsed={28} total={84}/></CardDemo>
          <CardDemo label="Compact · paused"><AudioPlayer variant="compact" playing={false} elapsed={45} total={84}/></CardDemo>
          <CardDemo label="Full · playing"><div style={{ width: "100%" }}><AudioPlayer variant="full" playing elapsed={28} total={84}/></div></CardDemo>
          <CardDemo label="Full · paused"><div style={{ width: "100%" }}><AudioPlayer variant="full" playing={false} elapsed={62} total={84}/></div></CardDemo>
        </div>
      </section>

      <section className="rx-section">
        <div className="rx-section__head">
          <h2 className="rx-section__title">Status</h2>
          <p className="rx-section__desc">First-token indicator, jump-to-latest, capped notice, and the in-stream error pill.</p>
        </div>
        <div className="rx-grid rx-grid--2">
          <CardDemo label="First-token indicator"><FirstTokenIndicator/></CardDemo>
          <CardDemo label="Jump to latest"><div style={{ position: "relative", height: 56, width: "100%" }}><JumpToLatest/></div></CardDemo>
          <CardDemo label="Capped notice"><CappedNotice/></CardDemo>
          <CardDemo label="Error pill"><ErrorPill/></CardDemo>
        </div>
      </section>

      <section className="rx-section">
        <div className="rx-section__head">
          <h2 className="rx-section__title">Sidebar</h2>
          <p className="rx-section__desc">Expanded list, collapsed rail, and empty state.</p>
        </div>
        <div className="rx-grid" style={{ gridTemplateColumns: "320px 80px 320px" }}>
          <CardDemo label="Expanded"><div style={{ width: 280, height: 440, display: "flex" }}><Sidebar/></div></CardDemo>
          <CardDemo label="Collapsed"><div style={{ width: 56, height: 200, display: "flex" }}><Sidebar collapsed/></div></CardDemo>
          <CardDemo label="Empty"><div style={{ width: 280, height: 440, display: "flex" }}><Sidebar empty/></div></CardDemo>
        </div>
      </section>

      <section className="rx-section">
        <div className="rx-section__head">
          <h2 className="rx-section__title">Loading skeleton</h2>
          <p className="rx-section__desc">Shown when restoring a long conversation.</p>
        </div>
        <CardDemo label="History restoring"><div style={{ width: "100%" }}><LoadingSkeleton/></div></CardDemo>
      </section>

      <section className="rx-section">
        <div className="rx-section__head">
          <h2 className="rx-section__title">Caret</h2>
          <p className="rx-section__desc">1.0s blink while text streams; holds solid when the model pauses to call a tool.</p>
        </div>
        <div className="rx-grid rx-grid--2">
          <CardDemo label="Blinking"><span className="t-body-md">streaming text<Caret/></span></CardDemo>
          <CardDemo label="Paused (tool running)"><span className="t-body-md">tool call active<Caret paused/></span></CardDemo>
        </div>
      </section>
    </div>
  );
}

window.ComponentsPage = ComponentsPage;
