/**
 * Dev-only component gallery — DoD for Slice 12. Mounts every state for the
 * design's S-1…S-8 screens plus exhaustive ErrorPill codes and the new
 * FormattedToolOutput branches. Not shipped in production builds (gated on
 * import.meta.env.DEV in App.tsx).
 */

import type { ReactNode } from 'react'
import type { ErrorCode } from '../lib/chat-events'

import { useState } from 'react'

import { AudioPlayer } from '../components/AudioPlayer'
import { Caret } from '../components/Caret'
import { FirstTokenIndicator } from '../components/FirstTokenIndicator'
import { UserMessage } from '../components/UserMessage'
import { ReasoningPanel } from '../components/ReasoningPanel'
import { ToolCall } from '../components/ToolCall'
import { FormattedToolOutput } from '../components/FormattedToolOutput'
import { MessageFooter } from '../components/MessageFooter'
import { CappedNotice } from '../components/CappedNotice'
import { ErrorPill } from '../components/ErrorPill'
import { LoadingSkeleton } from '../components/LoadingSkeleton'
import { PromptSuggestions } from '../components/PromptSuggestions'
import { useTts } from '../hooks/useTts'

const ALL_ERROR_CODES: ErrorCode[] = [
  'UPSTREAM_TIMEOUT',
  'UPSTREAM_TRUNCATED',
  'CONTENT_FILTERED',
  'RATE_LIMITED',
  'NETWORK_ERROR',
  'UPSTREAM_ERROR',
  'INTERNAL',
]

export function ComponentGallery() {
  return (
    <div style={{ padding: 32, maxWidth: 920, margin: '0 auto' }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'Source Serif 4, serif', fontSize: 28, margin: 0 }}>
          Rx Assistant — component gallery
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>
          Dev-only surface used to eyeball every component branch in the design system.
          Open with <code>?gallery=1</code> or visit <code>/__components</code>.
        </p>
      </header>

      <Section title="Caret">
        <Row>
          <Caret /> <span style={{ marginLeft: 8 }}>blinking</span>
        </Row>
        <Row>
          <Caret paused /> <span style={{ marginLeft: 8 }}>paused (tool running)</span>
        </Row>
      </Section>

      <Section title="FirstTokenIndicator">
        <FirstTokenIndicator />
      </Section>

      <Section title="UserMessage">
        <UserMessage text="What's the dosage range for ibuprofen?" time="14:31" />
        <UserMessage text="Hover state shown" time="14:32" showHover />
      </Section>

      <Section title="ReasoningPanel — every state">
        <Stack>
          <ReasoningPanel state="streaming-collapsed" />
          <ReasoningPanel state="streaming-expanded" text="…considering NSAID class" />
          <ReasoningPanel state="settled-collapsed" />
          <ReasoningPanel state="settled-expanded" text="Considered NSAID class; covered indication, dosage, and key warnings." />
          <ReasoningPanel state="streaming-collapsed" reducedMotion />
        </Stack>
      </Section>

      <Section title="ToolCall — every state">
        <Stack>
          <ToolCall name="drug_info" state="pending" />
          <ToolCall name="drug_info" state="running" />
          <ToolCall name="drug_info" state="complete-success" duration="0.7s" />
          <ToolCall name="drug_info" state="complete-error" />
          <ToolCall name="symptom_lookup" state="running" />
          <ToolCall name="custom_tool" state="running" />
        </Stack>
      </Section>

      <Section title="ToolCall — expanded (formatted)">
        <ToolCall
          name="drug_info"
          state="complete-success"
          duration="0.7s"
          expanded
          input={'{\n  "query": "lisinopril"\n}'}
        />
      </Section>

      <Section title="ToolCall — expanded (raw)">
        <ToolCall
          name="drug_info"
          state="complete-success"
          duration="0.7s"
          expanded
          rawView
          input={'{\n  "query": "lisinopril"\n}'}
          output={'{\n  "name": "Lisinopril",\n  "class": "ACE inhibitor"\n}'}
        />
      </Section>

      <Section title="FormattedToolOutput — spec-gap branches">
        <Stack>
          <Labeled label="symptom_lookup empty result ({found: false})">
            <FormattedToolOutput
              name="symptom_lookup"
              state="complete-success"
              output={{ type: 'json', value: { found: false } }}
            />
          </Labeled>
          <Labeled label="drug_info DRUG_NOT_FOUND">
            <FormattedToolOutput
              name="drug_info"
              state="complete-success"
              output={{ type: 'json', value: { error: { code: 'DRUG_NOT_FOUND' } } }}
            />
          </Labeled>
          <Labeled label="upstream-error with derived message">
            <FormattedToolOutput
              name="drug_info"
              state="complete-error"
              output={{ type: 'error-text', value: 'openFDA 503' }}
            />
          </Labeled>
        </Stack>
      </Section>

      <Section title="MessageFooter">
        <Stack>
          <MessageFooter
            time="14:32"
            model="sonnet-4.6"
            tokensIn={1204}
            tokensOut={387}
            cost={0.0072}
          />
          <MessageFooter
            time="14:33"
            model="sonnet-4.6"
            tokensIn={1204}
            tokensOut={387}
            cached={500}
            cost={0.0072}
          />
          <MessageFooter
            time="14:34"
            model="sonnet-4.6"
            tokensIn={1204}
            tokensOut={387}
            cost={0.00005}
            showMenu
          />
        </Stack>
      </Section>

      <Section title="CappedNotice">
        <CappedNotice />
      </Section>

      <Section title="ErrorPill — every code">
        <Stack>
          {ALL_ERROR_CODES.map((code) => (
            <Labeled key={code} label={code}>
              <ErrorPill code={code} onRetry={() => {}} />
            </Labeled>
          ))}
          <Labeled label="unknown code → message fallback">
            <ErrorPill code="FUTURE_CODE" message="Custom override copy" onRetry={() => {}} />
          </Labeled>
        </Stack>
      </Section>

      <Section title="AudioPlayer — compact + full">
        <AudioPlayerLiveDemo />
      </Section>

      <Section title="LoadingSkeleton (S-8)">
        <LoadingSkeleton />
      </Section>

      <Section title="PromptSuggestions (S-1)">
        <PromptSuggestions />
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      style={{
        marginBottom: 32,
        paddingBottom: 24,
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <h2
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--text-secondary)',
          margin: '0 0 12px 0',
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

function Stack({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
}

function Row({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', minHeight: 28, marginBottom: 8 }}>
      {children}
    </div>
  )
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace' }}>
        {label}
      </span>
      {children}
    </div>
  )
}

/**
 * Live demo: clicking play actually speaks the text via the OS TTS engine.
 * State (status, charIndex, totalChars) drives the AudioPlayer's `playing`
 * + `progress` props.
 */
function AudioPlayerLiveDemo() {
  const tts = useTts()
  const [text] = useState(
    'Lisinopril is an ACE inhibitor used primarily to treat high blood pressure ' +
      'and heart failure, and to improve survival after a heart attack.',
  )
  const isSpeaking = tts.state.status === 'speaking'
  const isPaused = tts.state.status === 'paused'
  const progress =
    (tts.state.status === 'speaking' || tts.state.status === 'paused') &&
    tts.state.totalChars > 0
      ? tts.state.charIndex / tts.state.totalChars
      : 0

  function toggle() {
    if (tts.state.status === 'idle' || tts.state.status === 'unsupported' || tts.state.status === 'error') {
      tts.play(text)
    } else if (isPaused) {
      tts.resume()
    } else if (isSpeaking) {
      tts.pause()
    }
  }

  return (
    <Stack>
      <Labeled label={`status: ${tts.state.status}`}>
        <AudioPlayer variant="compact" playing={isSpeaking} progress={progress} onPlayPause={toggle} />
      </Labeled>
      <Labeled label="full variant (read-only scrub)">
        <AudioPlayer variant="full" playing={isSpeaking} progress={progress} onPlayPause={toggle} />
      </Labeled>
      {tts.state.status === 'unsupported' && (
        <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
          (speechSynthesis not exposed in this browser)
        </span>
      )}
    </Stack>
  )
}
