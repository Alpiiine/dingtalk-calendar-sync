// The status card: what the bridge is doing right now, the picture of the three calendars, and
// once everything is connected the numbers and the "Sync now" button.
import { ArrowLeft, ArrowRight, ChevronRight, History, RefreshCw } from 'lucide-react';
import { Fade } from '@animate-ui/react/primitives/effects/fade';
import { Collapsible } from '@animate-ui/react/primitives/radix-ui';
import { CF, type Lang } from '../lib/boot';
import { cn } from '../lib/cn';
import { ago, agoParts, counts, spaced, type Translate } from '../lib/i18n';
import { describe } from '../lib/log';
import { Button, StatusButton } from '../ui/button';
import { Reveal, SwapText } from '../ui/motion';
import { Notice } from '../ui/notice';
import { actions, progress, useApp, useT, type Run, type ServerState, type State } from './store';
import { CARD } from '../ui/styles';
import { CalendlyLogo, DingTalkLogo, GoogleCalendarLogo } from './Logos';

type NodeState = '' | 'set' | 'ok' | 'err';
type Tone = '' | 'ok' | 'bad' | 'warn';

/** The badge beside the headline: a tint of its tone, a hairline of the same, a dot and a word. */
const BADGE: Record<Tone, string> = {
  '': 'border-accent/15 bg-accent-soft text-accent', ok: 'border-ok-line bg-ok-soft text-ok',
  bad: 'border-bad/15 bg-bad-soft text-bad', warn: 'border-warn/20 bg-warn-soft text-warn',
};

type App = 'dingtalk' | 'google' | 'calendly';
/** What stands for each app: its own mark (see Logos.tsx for where each comes from). */
const LOGO = { dingtalk: DingTalkLogo, google: GoogleCalendarLogo, calendly: CalendlyLogo } as const;

/**
 * One calendar in the picture: a tile for the app with its name centred under it. A tile that
 * is not connected yet lies flat on the canvas with its mark washed out; a connected one is
 * lifted off it in full colour. Whether a connection works is said once, by the badge beside the
 * headline and by the list of connections: a tile only gets a mark of its own when its test failed.
 */
function Tile({ app, state, label }: { app: App; state: NodeState; label: string }) {
  const Logo = LOGO[app];
  return (
    <div className="flex w-[3.125rem] shrink-0 flex-col items-center max-[34rem]:w-11">
      <div className={cn(
        'relative grid size-[3.125rem] place-items-center rounded-[14px] transition-[background-color,box-shadow] duration-200 max-[34rem]:size-11 max-[34rem]:rounded-xl',
        state === '' ? 'bg-surface/60 shadow-tile-flat' : 'bg-surface shadow-tile',
      )}>
        <Logo className={cn('size-[1.625rem] transition-[opacity,filter] duration-200 max-[34rem]:size-[1.375rem]', state === '' && 'opacity-50 grayscale-[40%]')} />
        <span className={cn('absolute -end-1.5 -top-1.5 grid size-4 place-items-center rounded-full bg-bad text-[.625rem] leading-none font-bold text-surface ring-2 ring-surface transition-[scale,opacity] duration-150', state !== 'err' && 'scale-50 opacity-0')}>!</span>
      </div>
      {/* Wider than its tile, and centred on it all the same. */}
      <span className="mt-2.5 w-max max-w-[7.5rem] text-center text-xs leading-tight font-medium">{label}</span>
    </div>
  );
}

/**
 * The two lanes between a pair of tiles: a hairline track each. Each carries its name and its
 * arrow on a small tag, so the picture needs no legend under it, the direction does not rest on
 * the colour, and the track needs no arrowhead of its own. (A phone is too narrow for the tags:
 * there each track ends in an arrowhead and the picture in one line of legend.) The dashes of a
 * live lane drift the way it travels. Between DingTalk and Google the tags name where the events
 * go; between Google and Calendly (`calendly`) what Calendly reads and what it adds.
 */
function Lanes({ on, working, calendly, T }: { on: boolean; working: boolean; calendly?: boolean; T: Translate }) {
  const line = <svg className="lane-line"><line x1="0" y1="50%" x2="100%" y2="50%" /></svg>;
  return (
    <div className={cn('grid h-[3.125rem] min-w-6 flex-1 grid-cols-[minmax(0,1fr)] content-center gap-2.5 px-2.5 max-[34rem]:h-11 max-[34rem]:gap-1 max-[34rem]:px-2', on && 'lanes-on', working && 'lanes-working')}>
      <div className="lane lane-busy">
        {line}<svg className="lane-head" viewBox="0 0 6 8"><path d="M1.5 1 5 4 1.5 7" /></svg>
        <span className="lane-tag" title={T('legend.busy')}>{T(calendly ? 'lane.busy' : 'act.busy')}<ArrowRight size={10} strokeWidth={2.5} /></span>
      </div>
      <div className="lane lane-book">
        <svg className="lane-head" viewBox="0 0 6 8"><path d="M4.5 1 1 4 4.5 7" /></svg>{line}
        <span className="lane-tag" title={T('legend.book')}><ArrowLeft size={10} strokeWidth={2.5} />{T(calendly ? 'lane.book' : 'act.book')}</span>
      </div>
    </div>
  );
}

/** How far setting up has come: one bar per step, filled once that step is done, and the count. */
function Meter({ done, label }: { done: boolean[]; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium text-muted tabular-nums">
      <span aria-hidden className="flex gap-1">
        {done.map((d, i) => <span key={i} className={cn('h-1 w-4 rounded-full transition-colors duration-150', d ? 'bg-accent' : 'bg-ink/12')} />)}
      </span>
      <span aria-hidden>{done.filter(Boolean).length}/{done.length}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** One number of the bridge. The three share one strip; on a phone each becomes a row. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-3 max-[34rem]:flex max-[34rem]:items-baseline max-[34rem]:justify-between max-[34rem]:gap-x-3 max-[34rem]:px-3.5 max-[34rem]:py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-[1.375rem] leading-7 font-semibold tracking-[-.02em] break-words max-[34rem]:mt-0 max-[34rem]:text-lg max-[34rem]:leading-6">{children}</dd>
    </div>
  );
}

/**
 * "3 minutes ago" beside two bare counts: the number is set like them, and the words around it
 * small and muted, so a sentence does not outweigh a digit. Wording without a number ("this
 * minute", "not yet") is set as text, not as a figure.
 */
function Since({ lang, at, never }: { lang: Lang; at: number; never: string }) {
  const parts = at ? agoParts(lang, at) : [{ text: never, num: false }];
  const figure = parts.some((p) => p.num);
  return (
    <SwapText text={parts.map((p) => p.text).join('')}>
      {parts.map((p, i) => (p.num ? <span key={i}>{p.text}</span>
        // A language that writes no space after the number ("8分钟前") still gets room (3 to 4px),
        // or the large numeral runs into its unit.
        : <span key={i} className={cn('font-medium tracking-normal whitespace-pre-wrap', figure ? 'text-sm text-muted' : 'text-[.9375rem]', i > 0 && !/^\s/.test(p.text) && 'ms-[.25em]')}>{p.text}</span>))}
    </SwapText>
  );
}

/** Numbers and "Sync now". Everything it shows is handed in, so it can still fold away after sign-out. */
function Live({ S, lang, T, busy, run, linesOpen }: {
  S: ServerState; lang: Lang; T: Translate; busy: State['busy']; run: Run; linesOpen: boolean;
}) {
  const st = S.status;
  const running = Boolean(busy.run || busy.dry);
  const checked = Math.max(st.okAt, st.fullAt);
  // The lines of a real run are in "Recent activity" a moment later. They are only repeated here
  // when they are nowhere else: a preview (nothing happened), debug mode (more detail), a failure.
  const lines = run?.lines || [];
  const inline = lines.length > 0 && Boolean(run?.dry || run?.failed || S.debug.on);
  const toActivity = () => {
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('activity')?.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
  };
  return (
    <div>
      <dl className="mt-3 grid grid-cols-3 divide-x divide-line rounded-[10px] border border-line max-[34rem]:grid-cols-1 max-[34rem]:divide-x-0 max-[34rem]:divide-y">
        <Fact label={T('stat.bookings')}>{st.bookings}</Fact>
        <Fact label={T('stat.busy')}>{st.busy === null ? '–' : st.busy}</Fact>
        <Fact label={T('stat.checked')}><Since lang={lang} at={checked} never={T('stat.never')} /></Fact>
      </dl>
      {/* A footnote to the numbers, not a line of the log. */}
      {st.last && (
        <p className="mt-2.5 flex items-start gap-1.5 px-0.5 text-xs leading-[1.5] text-muted">
          <History size={12} aria-hidden className="mt-[.1875rem] shrink-0 opacity-70" />
          <span className="min-w-0 tabular-nums">{spaced(lang, T('stat.last', { ago: ago(lang, st.last.at), what: counts(lang, st.last) }))}</span>
        </p>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <StatusButton variant="primary" icon={<RefreshCw size={14} strokeWidth={2.25} />} label={T('run.now')} busyLabel={T('run.running')} busy={busy.run} disabled={running} onClick={() => actions.runPass(false)} />
        <StatusButton label={T('run.dry')} busyLabel={T('run.running')} busy={busy.dry} disabled={running} onClick={() => actions.runPass(true)} />
      </div>
      <Reveal show={Boolean(run)}>
        <div role="status" className="pt-3.5">{run && <Notice level={run.level}>{run.text}</Notice>}</div>
      </Reveal>
      <Reveal show={lines.length > 0 && !inline}>
        <div className="pt-1.5"><Button variant="text" size="sm" onClick={toActivity}>{T('run.activity')}</Button></div>
      </Reveal>
      <Reveal show={inline}>
        <Collapsible.Root open={linesOpen} onOpenChange={actions.setRunLinesOpen} className="pt-2.5">
          <Collapsible.Trigger className="group flex min-h-8 items-center gap-1 rounded-md text-sm text-muted transition-colors duration-150 hover:text-ink">
            <ChevronRight size={14} aria-hidden className="transition-transform duration-150 ease-out group-data-[state=open]:rotate-90" />
            {T(run?.dry ? 'run.details.dry' : 'run.details')}
          </Collapsible.Trigger>
          <Collapsible.Content>
            <ol tabIndex={0} className="mt-1.5 grid max-h-72 gap-1 overflow-auto rounded-box border border-line bg-sunken px-3 py-2.5 text-sm leading-normal break-words">
              {lines.map((l, i) => { const told = describe(lang, l); return <li key={i} title={l}>{told.text}{told.when && ` · ${told.when}`}</li>; })}
            </ol>
          </Collapsible.Content>
        </Collapsible.Root>
      </Reveal>
    </div>
  );
}

/** Which side a failing sync points at, read from the error the bridge kept. */
function causeOf(message: string) {
  if (/DingTalk/.test(message) && /-> 40[13]\b/.test(message)) return 'hero.error.dingtalk';
  if (/Google/.test(message) && /(-> 40[134]\b|token request failed)/.test(message)) return 'hero.error.google';
  return 'hero.error.other';
}

export function Hero() {
  const s = useApp();
  const T = useT();
  const { S, gate, tested } = s;
  const p = progress(s);
  const signedIn = gate === 'in' && Boolean(S);

  // A test that just failed is the answer to what was pressed a moment ago: it leads the page.
  const failed = !signedIn ? null : tested.dingtalk === 'err' ? 's1' : tested.google === 'err' ? 's2' : null;
  let head = '', sub = '', tone: Tone = '', badge = '', live = false, details = '', meter = false;
  if (gate === 'loading' || (gate === 'in' && !S)) head = T('hero.loading');
  else if (gate === 'login') { head = T('hero.signin'); sub = T('hero.signin.sub'); }
  else if (gate === 'nopass') { head = T('hero.nopass'); sub = T('hero.nopass.sub'); }
  else if (S!.locked && !p.ready) { head = T('hero.locked'); sub = T('hero.locked.sub'); tone = 'bad'; badge = T('badge.action'); }
  else if (failed) {
    head = T('hero.failed'); sub = T('hero.failed.sub', { n: failed === 's1' ? 1 : 2, step: T(`${failed}.title`) }); tone = 'bad'; badge = T('badge.action');
  } else if (!p.ready) {
    const next = p.s1 ? 's2' : 's1';
    head = T('hero.todo'); sub = T('hero.todo.sub', { n: next === 's1' ? 1 : 2, step: T(`${next}.title`) }); badge = T('badge.setup', { n: p.n }); meter = true;
  } else if (S!.status.err) {
    const err = S!.status.err;
    head = T('hero.error'); sub = `${spaced(s.lang, T('hero.error.since', { ago: ago(s.lang, err.since || err.at) }))} ${T(causeOf(err.msg))}`; details = err.msg; tone = 'bad'; badge = T('badge.error');
  } else if (!p.s3) {
    head = T('hero.calendly'); sub = T('hero.calendly.sub'); badge = T('badge.setup', { n: p.n }); meter = true; live = Boolean(S!.status.fullAt);
  } else if (S!.status.fullAt && S!.status.catchingUp) {
    // Not green yet: until everything is copied, Google lacks events and Calendly can still offer a time that is taken.
    head = T('hero.backlog'); sub = T('hero.backlog.sub'); tone = 'warn'; badge = T('badge.backlog'); live = true;
  } else if (S!.status.fullAt) {
    head = T('hero.ok'); sub = T(CF ? 'hero.ok.cf' : 'hero.ok.node'); tone = 'ok'; badge = T('badge.live'); live = true;
  } else {
    head = T('hero.waiting'); sub = T(CF ? 'hero.waiting.cf' : 'hero.waiting.node'); badge = T('badge.ready');
  }

  const node = (set: boolean, part: 'dingtalk' | 'google'): NodeState =>
    (tested[part] === 'err' ? 'err' : tested[part] === 'ok' || (set && live) ? 'ok' : set ? 'set' : '');
  // DingTalk ⇄ Google is the bridge's own work. Google ⇄ Calendly is Calendly's and optional: it
  // only counts once step 3 says Calendly was set up, not when that step was skipped.
  const left = live || s.working;
  const right = left && p.calendly;

  return (
    <section id="hero" className={`${CARD} scroll-mt-4 p-5 max-[34rem]:p-4`}>
      {/* What the bridge is doing on one side, how it stands on the other: the count of steps
          while setting up, a badge afterwards. On a phone the badge goes above the headline. */}
      <div aria-live="polite" className="flex items-start justify-between gap-x-5 gap-y-2 max-[34rem]:flex-col-reverse">
        <h1 id="hero-h" tabIndex={-1} className={cn('min-w-0 text-xl leading-[1.25] font-semibold tracking-[-.02em] zh:tracking-normal outline-none transition-colors duration-150', tone === 'bad' && 'text-bad')}>
          <SwapText block text={head} />
        </h1>
        {badge && (
          <Fade className="shrink-0 sm:mt-0.5">
            {meter ? <Meter done={[p.s1, p.s2, p.s3]} label={badge} /> : (
              <span className={cn('inline-flex items-center gap-[.4375rem] rounded-full border py-px ps-2 pe-2.5 text-xs font-medium whitespace-nowrap transition-colors duration-150', BADGE[tone])}>
                <span className={cn('size-1.5 rounded-full bg-current', tone === 'ok' && 'dot-live')} />
                <SwapText text={badge} />
              </span>
            )}
          </Fade>
        )}
      </div>
      <Reveal show={Boolean(sub)}>
        <p aria-live="polite" className="max-w-[36rem] pt-1.5 break-words text-muted"><SwapText block text={sub} /></p>
      </Reveal>
      {/* What the bridge itself reported, for a bug report: folded away under the plain explanation. */}
      <Reveal show={Boolean(details)}>
        <details className="max-w-[36rem] pt-2 text-sm text-muted">
          <summary className="cursor-pointer rounded-md py-1 font-medium">{T('hero.error.details')}</summary>
          <p className="mt-1 rounded-box border border-line bg-sunken px-3 py-2 font-mono text-xs break-words">{details}</p>
        </details>
      </Reveal>

      <div aria-hidden className="stage mt-4 rounded-[10px] px-7 pt-5 pb-4 max-[34rem]:px-5 max-[34rem]:pt-4 max-[34rem]:pb-3">
        <div className="flex items-start">
          <Tile app="dingtalk" state={node(p.s1, 'dingtalk')} label={T('node.dt')} />
          <Lanes on={left} working={s.working} T={T} />
          <Tile app="google" state={node(p.s2, 'google')} label={T('node.g')} />
          <Lanes on={right} working={s.working && right} calendly T={T} />
          <Tile app="calendly" state={p.calendly ? (live ? 'ok' : 'set') : ''} label={T('node.c')} />
        </div>
        <div className="mt-3 hidden justify-center gap-x-5 border-t border-line pt-2.5 text-xs font-medium text-muted max-[34rem]:flex">
          <span className="inline-flex items-center gap-1"><ArrowRight size={11} strokeWidth={2.5} className="text-busy" />{T('act.busy')}</span>
          <span className="inline-flex items-center gap-1"><ArrowLeft size={11} strokeWidth={2.5} className="text-book" />{T('act.book')}</span>
        </div>
      </div>
      {/* The picture is for the eye. The same thing in words, for a screen reader. */}
      <ul className="sr-only"><li>{T('legend.busy')}</li><li>{T('legend.book')}</li></ul>

      <Reveal show={signedIn && p.ready}>
        {signedIn && p.ready && <Live S={S!} lang={s.lang} T={T} busy={s.busy} run={s.run} linesOpen={s.runLinesOpen} />}
      </Reveal>
    </section>
  );
}
