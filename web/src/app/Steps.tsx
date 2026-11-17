// The three steps: DingTalk, Google Calendar, Calendly. An accordion whose items open one after
// the other while setting up and fold away when done. Each row leads with the mark of its app.
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Check, ChevronRight, Copy, FileCheck, FileUp } from 'lucide-react';
import { Accordion, Collapsible } from '@animate-ui/react/primitives/radix-ui';
import { CopyButton, CopyButtonIcon, useCopyButton } from '@animate-ui/react/primitives/buttons/copy';
import { Effect } from '@animate-ui/react/primitives/effects/effect';
import { AutoHeight } from '@animate-ui/react/primitives/effects/auto-height';
import { scale, spring, transition, useTempoTransition } from '@animate-ui/react/utils/motion';
import { cn } from '../lib/cn';
import type { Translate } from '../lib/i18n';
import { Button, buttonClass, PRESS, StatusButton } from '../ui/button';
import { Checkbox } from '../ui/controls';
import { FieldError, HINT, Html, TextField } from '../ui/field';
import { Reveal, SwapText, useShake } from '../ui/motion';
import { LEVEL, NoticeLine, type Level } from '../ui/notice';
import { ARRIVE, ASIDE, CARD, MANUAL, MANUAL_LIST } from '../ui/styles';
import { actions, fieldOf, missing, partState, progress, useApp, useT, verified, type FormStep, type Note, type Result, type State, type StepId } from './store';
import { CalendlyLogo, DingTalkLogo, GoogleCalendarLogo } from './Logos';

const KEY = 'GOOGLE_SERVICE_ACCOUNT_JSON';
/** To do, filled in but not known to work, known to work, failed its test. */
type StepState = '' | 'set' | 'done' | 'err';
type Face = 'todo' | 'done' | 'err';

/** The explanation under a field, unless the field is only marked. */
const errorText = (s: State, T: Translate, k: string) => (s.errors[k] && !s.errors[k].quiet ? T(s.errors[k].key, s.errors[k].vars) : undefined);

/** A letter that turns into a tick once its part is known to work, or into a warning. */
function Mark({ label, face, className }: { label: string; face: Face; className?: string }) {
  const swap = useTempoTransition(transition.swap);
  return (
    <span aria-hidden className={cn('grid shrink-0 place-items-center rounded-full border font-semibold transition-colors duration-150', className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={face} className="inline-flex"
          initial={{ opacity: 0, scale: scale.icon }}
          animate={{ opacity: 1, scale: 1, transition: swap }}
          exit={{ opacity: 0, scale: scale.icon, transition: swap }}
        >
          {face === 'done' ? <Check size={12} strokeWidth={3} /> : face === 'err' ? '!' : label}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** What stands for each step: the mark of the app it connects. */
const LOGO = { s1: DingTalkLogo, s2: GoogleCalendarLogo, s3: CalendlyLogo } as const;

/** How a step stands, said once: a dot and a word at the end of its row. */
const PILL: Record<StepState, string> = {
  done: 'border-ok-line bg-ok-soft text-ok', err: 'border-bad/15 bg-bad-soft text-bad',
  set: 'border-warn/20 bg-warn-soft text-warn', '': 'border-line bg-tint text-muted',
};

function Step({ id, n, state, live, title, sub, pill, children }: {
  id: StepId; n: number; state: StepState; live: boolean; title: string; sub: string; pill: string; children: ReactNode;
}) {
  const Logo = LOGO[id];
  return (
    // The three steps are rows of one card, a hairline between them; an open one unfolds in place.
    <Accordion.Item value={id} id={id} className="scroll-mt-4 border-t border-line first:border-t-0">
      <Accordion.Header>
        <Accordion.Trigger
          id={`${id}-btn`}
          className="group grid w-full grid-cols-[auto_1fr_auto_auto] items-center gap-x-3 gap-y-1.5 px-5 py-3 text-start transition-colors duration-150 hover:bg-tint/50 focus-visible:-outline-offset-2 max-[34rem]:grid-cols-[auto_1fr_auto] max-[34rem]:px-4"
        >
          {/* The app's own mark, washed out until its step is filled in. The pill carries the state. */}
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-surface shadow-[var(--sh-tile-flat),var(--sh-ctl)]">
            <Logo className={cn('size-5 transition-[opacity,filter] duration-200', state === '' && 'opacity-55 grayscale-[40%]')} />
          </span>
          <span className="grid min-w-0 gap-0.5">
            <span className="leading-[1.3] font-semibold tracking-[-.01em] zh:tracking-normal">
              {/* While setting up the steps are counted, because the page refers to them by number. */}
              {!live && <span aria-hidden className="me-1.5 font-normal text-muted tabular-nums">{n}.</span>}{title}
            </span>
            <span className="text-sm leading-[1.35] text-muted">{sub}</span>
          </span>
          <span className={cn('inline-flex items-center gap-1.5 rounded-full border py-px ps-2 pe-2.5 text-xs font-medium whitespace-nowrap transition-colors duration-150 max-[34rem]:col-start-2 max-[34rem]:row-start-2 max-[34rem]:justify-self-start', PILL[state])}>
            <span className={cn('size-1.5 rounded-full bg-current', state === '' && 'opacity-45')} />
            <SwapText text={pill} />
          </span>
          <ChevronRight size={15} aria-hidden className="text-muted/80 transition-transform duration-150 ease-out group-data-[state=open]:rotate-90 max-[34rem]:col-start-3 max-[34rem]:row-start-1" />
        </Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Content>
        <div className="px-5 pt-1.5 pb-5 max-[34rem]:px-4">{children}</div>
      </Accordion.Content>
    </Accordion.Item>
  );
}

/**
 * "DingTalk › Calendar › Calendar settings": where in the other app to look. The places are flat
 * tags with a chevron between them: they are read, not pressed.
 */
function Where({ label, path }: { label: string; path: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
      <span className="text-[.6875rem] font-medium tracking-[.07em] text-muted uppercase zh:text-xs zh:font-semibold zh:tracking-[.02em] zh:text-overline">{label}</span>
      <ol className="path flex flex-wrap items-center gap-1 text-xs font-medium text-ink/80">
        {path.split('|').map((part) => (
          <li key={part} className="flex items-center gap-1"><span className="rounded-[5px] bg-chip px-1.5 py-0.5">{part}</span></li>
        ))}
      </ol>
    </div>
  );
}

/**
 * What the tests found. Lines of the same kind that follow each other share one box, so a test
 * that passed and was saved reads as one result, not as a stack of green bars.
 */
function Results({ results, T }: { results: Result[]; T: Translate }) {
  const rise = useTempoTransition(spring.entrance);
  const fade = useTempoTransition(transition.reveal);
  const groups: Array<{ level: Level; lines: string[] }> = [];
  for (const r of results) {
    const text = r.key ? T(r.key, r.vars) : r.text || '';
    const last = groups[groups.length - 1];
    if (last && last.level === r.level) last.lines.push(text); else groups.push({ level: r.level, lines: [text] });
  }
  return (
    <AutoHeight>
      <ul role="status" className={cn('grid gap-1.5', groups.length > 0 && 'pt-3.5')}>
        {groups.map((g, i) => {
          const delay = Math.min(i, 4) * 0.08;
          return (
            <motion.li
              key={`${i}|${g.level}|${g.lines[0]}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { ...rise, delay, opacity: { ...fade, delay } } }}
              className={cn('grid gap-1.5 rounded-box px-3 py-2.5', LEVEL[g.level].row)}
            >
              {g.lines.map((text) => <NoticeLine key={text} level={g.level}>{text}</NoticeLine>)}
            </motion.li>
          );
        })}
      </ul>
    </AutoHeight>
  );
}

/**
 * "Save and test" is the one way forward. Saving without the test is for a service that cannot
 * be reached right now: it sits folded away, says what it costs, and opens by itself when a test
 * could not get through.
 */
function SaveButtons({ id, s, T }: { id: FormStep; s: State; T: Translate }) {
  return (
    <div className="mt-4">
      {/* Once saved, the way forward is "Continue": this button steps back. */}
      <StatusButton type="submit" variant={s.savedForm[id] ? 'outline' : 'solid'} label={T('btn.test')} busyLabel={T('btn.testing')} busy={s.busy[id]} />
      <Collapsible.Root open={Boolean(s.skipOpen[id])} onOpenChange={(on) => actions.setSkipOpen(id, on)} className="mt-2">
        {/* A way round, not a button: muted text that opens what it costs. */}
        <Collapsible.Trigger className="group flex min-h-7 items-center gap-1 rounded-md pe-1 text-start text-sm text-muted transition-colors duration-150 hover:text-ink">
          <ChevronRight size={14} aria-hidden className="shrink-0 opacity-70 transition-transform duration-150 ease-out group-data-[state=open]:rotate-90" />
          {T(`skip.${id}`)}
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div className={`${ASIDE} mt-1 ms-[.4rem] max-w-[36rem] py-1`}>
            <p className="text-sm text-muted">{T('skip.help')}</p>
            <Button className="mt-2.5" disabled={s.busy[id]} onClick={() => actions.saveStep(id, false)}>{T('btn.saveonly')}</Button>
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  );
}

function Continue({ id, show, label, onClick }: { id: StepId; show: boolean; label: string; onClick: () => void }) {
  return (
    <Reveal show={show}>
      <div className="pt-4">
        <Button id={`${id}-next`} variant="solid" onClick={onClick}>{label}<ArrowRight size={14} strokeWidth={2.25} aria-hidden /></Button>
      </div>
    </Reveal>
  );
}

function Step1({ s, T, done }: { s: State; T: Translate; done: boolean }) {
  const pass = fieldOf(s, 'DINGTALK_PASSWORD');
  return (
    <form onSubmit={(ev) => { ev.preventDefault(); actions.saveStep('s1', true); }}>
      <Where label={T('where')} path={T('s1.path')} />
      <p className="max-w-[36rem] text-muted">{T('s1.help')}</p>
      <TextField
        mono id="f-DINGTALK_USERNAME" name="DINGTALK_USERNAME" label={T('s1.user')} required
        autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        value={s.forms.DINGTALK_USERNAME} onChange={(v) => actions.setForm('DINGTALK_USERNAME', v)}
        error={errorText(s, T, 'DINGTALK_USERNAME')} invalid={Boolean(s.errors.DINGTALK_USERNAME)} shake={s.shakes.DINGTALK_USERNAME}
      />
      <TextField
        secret id="f-DINGTALK_PASSWORD" name="DINGTALK_PASSWORD" label={T('s1.pass')} showLabel={T('pw.show')} required={!pass.set}
        autoComplete="off" value={s.forms.DINGTALK_PASSWORD} onChange={(v) => actions.setForm('DINGTALK_PASSWORD', v)}
        hints={[pass.set && T('secret.keep')]}
        error={errorText(s, T, 'DINGTALK_PASSWORD')} invalid={Boolean(s.errors.DINGTALK_PASSWORD)} shake={s.shakes.DINGTALK_PASSWORD}
      />
      <SaveButtons id="s1" s={s} T={T} />
      <Results results={s.results.s1} T={T} />
      <Continue id="s1" show={Boolean(s.fresh.s1) && done} label={T('btn.next2')} onClick={() => actions.next('s2')} />
    </form>
  );
}

const PART_MARK: Record<'' | 'set' | 'ok' | 'err', string> = {
  '': 'border-rim bg-surface text-muted shadow-ctl',
  set: 'border-rim bg-surface text-ink shadow-ctl',
  ok: 'border-ok-line bg-ok-soft text-ok',
  err: 'border-bad/30 bg-bad-soft text-bad',
};

/**
 * One of the three parts of step 2. The letters stand in a column of their own, joined by a thin
 * rule that runs from one to the next, so the three read as one sequence. A phone has no width
 * to spare for that column: there the letter sits on the line of its title, the content starts
 * at the same edge, and a hairline parts one part from the next. The tick only comes from a test
 * that passed. A part that waits for the key shows one line instead of its content.
 */
function Part({ id, letter, title, state, first, last, waiting, T, children }: {
  id: string; letter: string; title: string; state: '' | 'set' | 'ok' | 'err'; first?: boolean; last?: boolean; waiting?: boolean; T: Translate; children: ReactNode;
}) {
  return (
    <li id={id} className={cn('relative scroll-mt-4 min-[34rem]:ps-9', !last && 'min-[34rem]:pb-6', !first && 'max-[34rem]:mt-5 max-[34rem]:border-t max-[34rem]:border-line max-[34rem]:pt-5')}>
      {!last && <span aria-hidden className="absolute start-[.6875rem] top-[1.875rem] bottom-1.5 w-px bg-rim max-[34rem]:hidden" />}
      <div className="flex items-center gap-2.5 min-[34rem]:min-h-6">
        <Mark label={letter} face={state === 'ok' ? 'done' : state === 'err' ? 'err' : 'todo'} className={cn('size-6 text-[.6875rem] min-[34rem]:absolute min-[34rem]:start-0 min-[34rem]:top-0', PART_MARK[waiting ? '' : state])} />
        <h4 className={cn('leading-snug font-semibold tracking-[-.01em] zh:tracking-normal transition-colors duration-150', waiting && 'text-muted')}>
          {title}
          {(state === 'ok' || state === 'err') && <span className="sr-only"> ({T(`part.${state}`)})</span>}
        </h4>
      </div>
      <Reveal show={Boolean(waiting)}><p className="pt-0.5 text-sm text-muted max-[34rem]:ps-[2.125rem]">{T('part.locked')}</p></Reveal>
      <Reveal show={!waiting}>{children}</Reveal>
    </li>
  );
}

/**
 * The copy icon turns into a green tick for a moment. A screen reader is told in words. With a
 * `label` the words change with it ("Copy service account email" becomes "Copied"): the button keeps
 * the width of the longer of the two, and the shorter stays beside the tick. The label is in
 * the page once; the button that holds it is named by `aria-label`, so its name stays put.
 */
function CopyMark({ T, label }: { T: Translate; label?: string }) {
  const { copied } = useCopyButton();
  return (
    <>
      <CopyButtonIcon icon={<Copy size={13} />} copiedIcon={<Check size={13} strokeWidth={2.75} className="text-ok" />} />
      {label && <SwapText text={copied ? T('s2.copied') : label} reserve={[label, T('s2.copied')]} className="justify-items-start!" />}
      {/* Empty until something was copied: it holds no text of its own while it waits. */}
      <span role="status" className="sr-only">{copied ? T('s2.copied') : ''}</span>
    </>
  );
}

/** The service account email, shown once where it first exists: right under the key it comes from. */
function AccountEmail({ email, T }: { email: string; T: Translate }) {
  return (
    <div className="mt-3 max-w-[32rem]">
      <span className="mb-1.5 block text-sm font-medium">{T('s2.account')}</span>
      {/* One line of code in a well, its copy button at the end. */}
      <div className="flex items-center gap-1 rounded-box border border-line bg-sunken py-0.5 ps-2.5 pe-0.5 shadow-well">
        <code className="min-w-0 flex-1 py-1.5 text-[.8125rem] tracking-[-.01em] break-all">{email}</code>
        <CopyButton
          type="button" content={email} delay={1500} tapScale={PRESS} aria-label={T('s2.copy')} title={T('s2.copy')}
          className="grid size-9 shrink-0 place-items-center rounded-ctl text-muted transition-colors duration-150 hover:bg-tint hover:text-ink pointer-fine:size-7"
        >
          <CopyMark T={T} />
        </CopyButton>
      </div>
      <span className="mt-1.5 block text-sm text-muted">{T('s2.account.hint')}</span>
    </div>
  );
}

/**
 * Parts B and C need the address again: a small button is enough there. It stands in the
 * instructions, under the line that says to add the service account email, where the address is wanted.
 */
function CopyAccountEmail({ email, T }: { email: string; T: Translate }) {
  if (!email) return null;
  return (
    <span className="mt-1.5 mb-0.5 flex">
      <CopyButton type="button" content={email} delay={1500} tapScale={PRESS} aria-label={T('s2.copy.account')} title={email} className={buttonClass('outline', 'sm', 'gap-1.5 font-medium')}>
        <CopyMark T={T} label={T('s2.copy.account')} />
      </CopyButton>
    </span>
  );
}

/**
 * The key file. The browser's own file field is never shown: without a key the box is a place
 * to press or to drop the file on; once there is a key it is one row that says so, and the file
 * dialog only opens from "Replace key". A file can be dropped on the box either way.
 */
function KeyDrop({ s, T, keySet }: { s: State; T: Translate; keySet: boolean }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const scope = useShake<HTMLDivElement>(s.shakes[KEY]);
  const swap = useTempoTransition(transition.swap);
  const drag = (on: boolean) => (ev: DragEvent) => { ev.preventDefault(); setOver(on); };
  const drop = (ev: DragEvent) => {
    ev.preventDefault(); setOver(false);
    const file = ev.dataTransfer?.files?.[0];
    if (file) actions.readKey(file);
  };
  const choose = () => input.current?.click();
  const hint = s.key ? T('s2.file.loaded') : '';
  return (
    <>
      {/* With a key saved the field is `hidden`, so neither the keyboard nor a screen reader
          meets it: "Replace key" is then the control, a real button, and it still opens the
          file dialog of this field. */}
      <input
        ref={input} key={s.keyInput} type="file" id="keyfile" accept=".json,application/json"
        aria-describedby="key-hint keyfile-err" aria-invalid={s.errors[KEY] ? true : undefined}
        hidden={keySet}
        onChange={(ev) => actions.readKey(ev.target.files?.[0])} className="peer sr-only"
      />
      <div
        ref={scope} onDragEnter={drag(true)} onDragOver={drag(true)} onDragLeave={drag(false)} onDrop={drop}
        // The text is the label of the field and opens it by itself; the rest of the empty box does the same.
        onClick={keySet ? undefined : (ev) => { if (!(ev.target as HTMLElement).closest('label')) choose(); }}
        className={cn(
          'mt-3 flex max-w-[32rem] items-center rounded-box border transition-colors duration-150',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:cursor-default peer-disabled:opacity-60',
          over ? 'border-accent bg-accent-soft' : keySet ? 'bg-surface shadow-ctl' : 'bg-sunken/50 hover:bg-sunken',
          keySet ? 'gap-2.5 border-solid py-[3px] ps-3 pe-[3px]' : 'cursor-pointer gap-3 border-dashed px-3.5 py-3',
          !over && (s.errors[KEY] ? 'border-bad' : keySet ? 'border-rim' : 'border-edge/80 hover:border-edge'),
        )}
      >
        <span className="relative inline-flex text-accent">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={keySet ? 'set' : 'none'} className="inline-flex"
              initial={{ opacity: 0, scale: scale.icon }}
              animate={{ opacity: 1, scale: 1, y: over ? -3 : 0, transition: swap }}
              exit={{ opacity: 0, scale: scale.icon, transition: swap }}
            >
              {keySet ? <FileCheck size={15} strokeWidth={2} aria-hidden className="text-ok" /> : <FileUp size={18} strokeWidth={1.75} aria-hidden />}
            </motion.span>
          </AnimatePresence>
        </span>
        {keySet ? (
          // Once there is a key the box is one row: which key, and the way to replace it.
          <>
            <span className="min-w-0 flex-1 py-1 font-medium break-words"><SwapText text={s.key ? s.key.name : T('s2.file.saved')} /></span>
            <Button className="shrink-0" aria-describedby="key-hint keyfile-err" onClick={choose}>{T('s2.file.replace')}</Button>
          </>
        ) : (
          <label htmlFor="keyfile" className="min-w-0 flex-1 cursor-pointer">
            <b className="block leading-snug font-medium break-words">{T('s2.file.choose')}</b>
            {/* Nothing can be dropped onto a touch screen. */}
            <small className="block text-sm text-muted">{T('s2.file.sub')}<span className="pointer-coarse:hidden"> {T('s2.file.drop')}</span></small>
          </label>
        )}
      </div>
      <Reveal show={Boolean(hint)}><p id="key-hint" className={`${HINT} pt-1.5`}>{hint}</p></Reveal>
      <FieldError id="keyfile-err" text={errorText(s, T, KEY)} />
    </>
  );
}

function Step2({ s, T, done }: { s: State; T: Translate; done: boolean }) {
  const signedIn = s.gate === 'in' && Boolean(s.S);
  const keySet = Boolean(s.key) || (signedIn && !missing(s, KEY));
  const email = s.key?.email || (signedIn ? s.S!.serviceAccountEmail : '');
  // B and C are about sharing calendars with the service account: they open once there is one.
  const waiting = !keySet;
  // Once all three parts passed, the step itself says "Connected": the parts go back to their
  // letters, so the green stays with the one mark that speaks for the whole step. A part only
  // shows its own tick or warning while the three disagree.
  const parts = { google: partState(s, 'google'), mirror: partState(s, 'mirror'), source: partState(s, 'source') };
  const calm = Object.values(parts).every((p) => p === 'ok');
  const part = (id: keyof typeof parts) => (calm ? 'set' : parts[id]);
  // An ID is longer than its box, and what tells the two calendars apart is at its end: the
  // page checks the ending itself, where the eye cannot.
  const met = (name: string, value: string) => name === 'GOOGLE_MIRROR_CALENDAR' && /@group\.calendar\.google\.com$/i.test(value.trim());
  const calendar = (name: 'GOOGLE_MIRROR_CALENDAR' | 'GOOGLE_SOURCE_CALENDAR', label: string, hint: string) => (
    <TextField
      mono id={`f-${name}`} name={name} label={label} required
      autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
      value={s.forms[name]} onChange={(v) => actions.setForm(name, v)}
      hints={[hint]} met={met(name, s.forms[name])}
      error={errorText(s, T, name)} shake={s.shakes[name]}
    />
  );
  return (
    <form onSubmit={(ev) => { ev.preventDefault(); actions.saveStep('s2', true); }}>
      <p className="max-w-[36rem] text-muted">{T('s2.lead')}</p>
      <ol className="mt-5">
        <Part first id="part-a" letter="A" title={T('s2.a')} state={part('google')} T={T}>
          {/* The one fold that is a box: what it holds is done in Google Cloud, not here. */}
          <Collapsible.Root open={s.howOpen} onOpenChange={actions.setHowOpen} className={`${MANUAL} mt-2.5 max-w-[32rem]`}>
            <Collapsible.Trigger className="group flex min-h-9 w-full items-center gap-1.5 rounded-[7px] px-3 text-start font-medium transition-colors duration-150 hover:bg-tint/60 focus-visible:-outline-offset-2">
              <ChevronRight size={14} aria-hidden className="shrink-0 text-muted transition-transform duration-150 ease-out group-data-[state=open]:rotate-90" />
              {T('s2.how')}
            </Collapsible.Trigger>
            <Collapsible.Content>
              <ol className={`${MANUAL_LIST} px-3.5 pt-0.5 pb-3 ps-[2.35rem]`}>
                {[1, 2, 3, 4].map((i) => <Html key={i} as="li" html={T(`s2.how.${i}`)} />)}
              </ol>
            </Collapsible.Content>
          </Collapsible.Root>
          <KeyDrop s={s} T={T} keySet={keySet} />
          <Reveal show={Boolean(email)}>{email && <AccountEmail email={email} T={T} />}</Reveal>
        </Part>
        <Part id="part-b" letter="B" title={T('s2.b')} state={part('mirror')} waiting={waiting} T={T}>
          <div className={`${MANUAL} mt-2.5 max-w-[32rem] px-3.5 py-3`}>
            <ol className={MANUAL_LIST}>
              <Html as="li" html={T('s2.b.1')} />
              <li><Html html={T('s2.b.2')} /><CopyAccountEmail email={email} T={T} /></li>
              <Html as="li" html={T('s2.b.3')} />
            </ol>
          </div>
          {calendar('GOOGLE_MIRROR_CALENDAR', T('s2.mirror'), T('s2.mirror.hint'))}
        </Part>
        <Part last id="part-c" letter="C" title={T('s2.c')} state={part('source')} waiting={waiting} T={T}>
          <div className={`${MANUAL} mt-2.5 max-w-[32rem] px-3.5 py-3`}>
            <ol className={MANUAL_LIST}>
              <li>{T('s2.c.1')}</li>
              <li><Html html={T('s2.c.2')} /><CopyAccountEmail email={email} T={T} /></li>
            </ol>
          </div>
          {calendar('GOOGLE_SOURCE_CALENDAR', T('s2.source'), T('s2.source.hint'))}
        </Part>
      </ol>
      <SaveButtons id="s2" s={s} T={T} />
      <Results results={s.results.s2} T={T} />
      <Continue id="s2" show={Boolean(s.fresh.s2) && done} label={T('btn.next3')} onClick={() => actions.next('s3')} />
    </form>
  );
}

function Message({ note }: { note: Note }) {
  return (
    <Reveal show={Boolean(note)}>
      <p role="status" className={cn('pt-3 font-medium', note?.tone === 'bad' ? 'text-bad' : 'text-ok')}>{note?.text}</p>
    </Reveal>
  );
}

/**
 * Calendly is optional. The bridge cannot look into it, so the owner confirms it: both lines
 * ticked, then "Complete setup". Without Calendly the step is skipped instead, and the same
 * place says how to copy everyday events from the main calendar. Only one of those two presses
 * settles the step, and the server remembers which.
 */
function Step3({ s, T, done, skipped }: { s: State; T: Translate; done: boolean; skipped: boolean }) {
  const on = (id: 'c1' | 'c2') => done || s[id];
  const both = on('c1') && on('c2');
  const tick = (id: 'c1' | 'c2') => (
    <label className={cn('manual mt-2 flex cursor-pointer items-start gap-2.5 rounded-box border px-3 py-2.5 leading-[1.6] transition-colors duration-150', on(id) ? 'border-ok-line bg-ok-soft' : 'border-rim bg-surface shadow-ctl hover:bg-sunken/60')}>
      <Checkbox id={id} checked={on(id)} disabled={s.busy.s3} onCheckedChange={(v) => actions.setCheck(id, v === true)} className="mt-px" />
      <Html html={T(`s3.${id}`)} />
    </label>
  );
  return (
    <div>
      <Where label={T('where')} path={T('s3.path')} />
      <Html as="p" className="max-w-[36rem] text-muted" html={T('s3.help')} />
      {tick('c1')}
      {tick('c2')}
      <p className={`${ASIDE} mt-3.5 text-sm text-muted`}>{T('s3.note')}</p>
      <Reveal show={!done}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-4">
          <StatusButton id="s3-next" variant="solid" label={T('btn.finish')} busy={s.busy.s3} disabled={!both} aria-describedby="s3-why" onClick={() => actions.finish()} />
          <span id="s3-why" className={cn('text-sm text-muted', both && 'invisible')}>{T('s3.tickboth')}</span>
        </div>
        {/* The way out for a setup without Calendly, and what to change so that more than bookings is copied. */}
        <div className={`${ASIDE} manual mt-5 max-w-[36rem] text-sm text-muted`}>
          <Html as="p" html={T('s3.skip.help')} />
          {skipped
            ? <p className="pt-2 font-medium text-ink/80">{T('s3.skipped')}</p>
            : <Button id="s3-skip" className="mt-2.5" disabled={s.busy.s3} onClick={() => actions.finish(true)}>{T('s3.skip.btn')}</Button>}
        </div>
      </Reveal>
      <Message note={s.s3Note} />
    </div>
  );
}

export function Steps() {
  const s = useApp();
  const T = useT();
  const p = progress(s);
  // Once everything is connected the cards are a list of connections, named after what they connect.
  const live = p.ready && p.s3;
  const partOf = (id: StepId) => (id === 's1' ? 'dingtalk' : id === 's2' ? 'google' : null);
  const stateOf = (id: StepId): StepState => {
    const part = partOf(id);
    if (part && s.tested[part] === 'err') return 'err';
    if (!p[id]) return '';
    // A skipped step 3 stays as quiet as one that is still to do: only its word differs.
    if (id === 's3') return p.calendly ? 'done' : '';
    return verified(s, id) ? 'done' : 'set';
  };
  const pillOf = (id: StepId) => {
    const state = stateOf(id);
    if (id === 's3' && p.s3) return T(p.calendly ? 'state.done' : 'state.skipped');
    return T(state === 'err' ? 'state.err' : state === '' ? 'state.todo' : state === 'set' ? 'state.saved' : 'state.ok');
  };
  const step = (id: StepId, n: number, children: ReactNode) => (
    <Step id={id} n={n} state={stateOf(id)} live={live} title={T(live ? `${id}.name` : `${id}.title`)} sub={T(`${id}.sub`)} pill={pillOf(id)}>
      {children}
    </Step>
  );
  return (
    <Effect {...ARRIVE} delay={60}>
      <Accordion.Root type="multiple" value={s.open} onValueChange={actions.setOpen} className={`${CARD} overflow-hidden`}>
        {step('s1', 1, <Step1 s={s} T={T} done={p.s1} />)}
        {step('s2', 2, <Step2 s={s} T={T} done={p.s2} />)}
        {step('s3', 3, <Step3 s={s} T={T} done={p.calendly} skipped={p.s3 && !p.calendly} />)}
      </Accordion.Root>
    </Effect>
  );
}
