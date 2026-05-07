// Rx Assistant — design-token reference page

function Swatch({ name, varName }) {
  return (
    <div className="rx-swatch">
      <div className="rx-swatch__chip" style={{ background: `var(${varName})` }}/>
      <div className="rx-swatch__name">{name}</div>
      <div className="rx-swatch__val">{varName}</div>
    </div>
  );
}

function TypeSpec({ cls, label, sample, meta }) {
  return (
    <div className="rx-typespecimen">
      <div className="rx-swatch__name">{label}</div>
      <div className={cls}>{sample}</div>
      <div className="rx-typespecimen__meta">{meta}</div>
    </div>
  );
}

function TokensPage() {
  return (
    <div className="rx-root rx-cpage">
      <div>
        <h1 className="rx-cpage__hed">Tokens</h1>
        <p className="rx-cpage__sub">Color, type, spacing, radius, motion. Light-mode values; dark-mode mirrors with preserved warmth.</p>
      </div>

      <section className="rx-section">
        <div className="rx-section__head">
          <h2 className="rx-section__title">Surfaces</h2>
          <p className="rx-section__desc">Three-tier surface system on warm cream.</p>
        </div>
        <div className="rx-grid rx-grid--4">
          <Swatch name="canvas"        varName="--bg-canvas"/>
          <Swatch name="surface"       varName="--bg-surface"/>
          <Swatch name="surface-raised" varName="--bg-surface-raised"/>
          <Swatch name="user-bubble"   varName="--bg-user-bubble"/>
        </div>
      </section>

      <section className="rx-section">
        <div className="rx-section__head"><h2 className="rx-section__title">Borders & text</h2></div>
        <div className="rx-grid rx-grid--4">
          <Swatch name="border-subtle" varName="--border-subtle"/>
          <Swatch name="border-strong" varName="--border-strong"/>
          <Swatch name="text-primary"  varName="--text-primary"/>
          <Swatch name="text-secondary" varName="--text-secondary"/>
        </div>
      </section>

      <section className="rx-section">
        <div className="rx-section__head">
          <h2 className="rx-section__title">Accent — single warm</h2>
          <p className="rx-section__desc">Used sparingly: streaming caret, send button when active, focus ring, conversation rail accent.</p>
        </div>
        <div className="rx-grid rx-grid--4">
          <Swatch name="accent-primary"        varName="--accent-primary"/>
          <Swatch name="accent-primary-hover"  varName="--accent-primary-hover"/>
          <Swatch name="accent-streaming"      varName="--accent-streaming"/>
          <Swatch name="focus-ring"            varName="--focus-ring"/>
        </div>
      </section>

      <section className="rx-section">
        <div className="rx-section__head">
          <h2 className="rx-section__title">State pills</h2>
          <p className="rx-section__desc">Each tool/pill state has paired bg / fg / border tokens to keep contrast in check on cream paper.</p>
        </div>
        <div className="rx-grid rx-grid--4">
          <Swatch name="pending · bg" varName="--tool-pending-bg"/>
          <Swatch name="running · bg" varName="--tool-running-bg"/>
          <Swatch name="success · bg" varName="--tool-success-bg"/>
          <Swatch name="warn · bg"    varName="--tool-warn-bg"/>
        </div>
        <div className="rx-grid rx-grid--4">
          <Swatch name="pending · fg" varName="--tool-pending-fg"/>
          <Swatch name="running · fg" varName="--tool-running-fg"/>
          <Swatch name="success · fg" varName="--tool-success-fg"/>
          <Swatch name="warn · fg"    varName="--tool-warn-fg"/>
        </div>
        <div className="rx-grid rx-grid--3">
          <Swatch name="error · bg" varName="--error-bg"/>
          <Swatch name="error · fg" varName="--error-fg"/>
          <Swatch name="error · bd" varName="--error-bd"/>
        </div>
      </section>

      <section className="rx-section">
        <div className="rx-section__head">
          <h2 className="rx-section__title">Type ramp</h2>
          <p className="rx-section__desc">Source Serif 4 for display & headings; Inter for body & chrome; JetBrains Mono for code & token names.</p>
        </div>
        <TypeSpec cls="t-display-lg" label="Display · L" sample="Ask about a medication or a symptom." meta="Source Serif 4 · 40 / 48 · 400 · letter-spacing -0.01em"/>
        <TypeSpec cls="t-display-md" label="Display · M" sample="Lisinopril dosage and key warnings"      meta="Source Serif 4 · 28 / 36 · 400 · letter-spacing -0.01em"/>
        <TypeSpec cls="t-heading-lg" label="Heading · L" sample="Key warnings"                            meta="Source Serif 4 · 22 / 30 · 500"/>
        <TypeSpec cls="t-heading-md" label="Heading · M" sample="Typical use"                              meta="Source Serif 4 · 19 / 28 · 500"/>
        <TypeSpec cls="t-heading-sm" label="Heading · S" sample="Rx Assistant"                            meta="Inter · 16 / 24 · 600"/>
        <TypeSpec cls="t-body-md"    label="Body"        sample="Lisinopril is an ACE inhibitor used primarily to treat high blood pressure." meta="Inter · 15 / 24 · 400"/>
        <TypeSpec cls="t-body-sm"    label="Body · S"    sample="Considered brand vs. generic; covered indication and dosage." meta="Inter · 13.5 / 22 · 400 · text-secondary"/>
        <TypeSpec cls="t-label"      label="Label"       sample="drug_info"                                meta="Inter · 13 / 18 · 500"/>
        <TypeSpec cls="t-caption"    label="Caption"     sample="14:32  ·  sonnet-4.6  ·  1,204 in / 387 out  ·  $0.0072" meta="Inter · 12 / 18 · 500 · tabular-nums"/>
        <TypeSpec cls="t-code-i"     label="Code · inline" sample={`{"name": "lisinopril"}`}              meta="JetBrains Mono · 13.5 / 22 · 400"/>
      </section>

      <section className="rx-section">
        <div className="rx-section__head"><h2 className="rx-section__title">Spacing</h2></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[["s-1",4],["s-2",8],["s-3",12],["s-4",16],["s-5",24],["s-6",32],["s-7",48],["s-8",64]].map(([n,v]) => (
            <div key={n} style={{ display: "grid", gridTemplateColumns: "80px 80px 1fr", alignItems: "center", gap: 12 }}>
              <span className="rx-swatch__name">--{n}</span>
              <span className="rx-swatch__val">{v}px</span>
              <div style={{ height: 14, width: v, background: "var(--accent-primary)", opacity: 0.7, borderRadius: 2 }}/>
            </div>
          ))}
        </div>
      </section>

      <section className="rx-section">
        <div className="rx-section__head"><h2 className="rx-section__title">Radius</h2></div>
        <div className="rx-grid rx-grid--4">
          {[["xs",4],["sm",6],["md",8],["lg",12]].map(([n,v]) => (
            <div key={n} className="rx-card">
              <div className="rx-card__label">--r-{n}</div>
              <div style={{ width: 80, height: 80, background: "var(--bg-surface-raised)", border: "1px solid var(--border-strong)", borderRadius: v }}/>
              <div className="rx-swatch__val">{v}px</div>
            </div>
          ))}
        </div>
      </section>

      <section className="rx-section">
        <div className="rx-section__head"><h2 className="rx-section__title">Motion</h2></div>
        <div className="rx-grid rx-grid--3">
          <div className="rx-card"><div className="rx-card__label">--dur-fast</div><div className="rx-swatch__val">120ms · ease-std</div></div>
          <div className="rx-card"><div className="rx-card__label">--dur-normal</div><div className="rx-swatch__val">200ms · ease-std</div></div>
          <div className="rx-card"><div className="rx-card__label">--dur-slow</div><div className="rx-swatch__val">320ms · ease-emph</div></div>
        </div>
      </section>
    </div>
  );
}

window.TokensPage = TokensPage;
