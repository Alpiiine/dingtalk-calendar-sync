// How the page is organised:
//   - a status card on top: what the bridge is doing, the DingTalk ⇄ Google ⇄ Calendly picture,
//     and, once everything is connected, the numbers and the "Sync now" button;
//   - three steps that open one after the other while setting up and fold away when done;
//   - recent activity and the options.
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { Effect } from '@animate-ui/react/primitives/effects/effect';
import { Fade } from '@animate-ui/react/primitives/effects/fade';
import { BOOT, CF } from '../lib/boot';
import { tagOf, translate } from '../lib/i18n';
import { Button, StatusButton } from '../ui/button';
import { Html, TextField } from '../ui/field';
import { Reveal } from '../ui/motion';
import { ARRIVE, CARD } from '../ui/styles';
import { actions, progress, useApp, useT } from './store';
import { Hero } from './Hero';
import { LanguageMenu } from './LanguageMenu';
import { Steps } from './Steps';
import { Activity } from './Activity';
import { Options } from './Options';

function Gate() {
  const s = useApp();
  const T = useT();
  const [password, setPassword] = useState('');
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (await actions.signIn(password)) setPassword('');
  };
  const error = s.gateError ? translate(s.lang, s.gateError.key!, s.gateError.vars) : '';
  return (
    <>
      <Reveal show={s.gate === 'login'} bleed>
        <form onSubmit={submit} className={`${CARD} mt-3 p-5 max-[34rem]:p-4`}>
          <TextField
            first secret id="pw" name="password" autoComplete="current-password" required
            label={T('gate.password')} showLabel={T('pw.show')} value={password} onChange={setPassword}
            hints={[T('gate.hint'), T(CF ? 'gate.forgot.cf' : 'gate.forgot.node')]} error={error} shake={s.shakes.pw}
          />
          <div className="mt-4 flex">
            <StatusButton type="submit" variant="solid" label={T('gate.signin')} busy={s.busy.signin} />
          </div>
        </form>
      </Reveal>
      <Reveal show={s.gate === 'nopass'} bleed>
        <div className={`${CARD} manual mt-3 p-5 leading-[1.6] max-[34rem]:p-4`}><Html as="p" html={T(CF ? 'gate.nopass.cf' : 'gate.nopass.node')} /></div>
      </Reveal>
    </>
  );
}

export function App() {
  const s = useApp();
  const T = useT();
  useEffect(() => { document.documentElement.lang = tagOf(s.lang); document.title = `dtsync — ${T('brand.sub')}`; }, [s.lang, T]);

  const signedIn = s.gate === 'in' && Boolean(s.S);
  const p = progress(s);
  const ready = signedIn && p.ready;
  // The sentence of the footer, cut where the version goes, so the version can be set as a tag.
  const foot = T('foot', { version: '\u0001' }).split('\u0001').map((part) => part.trim());

  return (
    <div className="mx-auto max-w-[42rem] px-4 pt-4 pb-16 sm:pt-6">
      {/* The bar above the page stays out of the way of the status card: a small mark, the name,
          a slash and what the bridge does in muted text, and two controls with no surface of
          their own until the pointer is on them. */}
      <header className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 ps-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-accent bg-linear-to-b from-white/12 to-white/0 text-on-accent shadow-primary"><ArrowLeftRight size={14} strokeWidth={2.25} /></span>
          <b className="text-[.9375rem] tracking-[-.02em]">dtsync</b>
          <span aria-hidden className="text-ink/20 select-none max-[34rem]:hidden">/</span>
          <span className="min-w-0 truncate text-[.8125rem] text-muted max-[34rem]:hidden">{T('brand.sub')}</span>
        </div>
        <div className="ms-auto flex items-center gap-0.5">
          <LanguageMenu />
          {s.gate === 'in' && <Fade><Button variant="ghost" size="sm" onClick={actions.signOut}>{T('signout')}</Button></Fade>}
        </div>
      </header>

      <Hero />
      <Gate />

      {signedIn && (
        <main>
          <Reveal show={ready} bleed>
            <Activity lines={s.S!.status.lines} lang={s.lang} />
          </Reveal>
          <Effect {...ARRIVE}>
            {/* Capitals and wide tracking make an overline in Latin. Chinese has neither: there the
                same line is told by its size, weight and a firmer shade. */}
            <h2 className="mx-1 mt-7 mb-2.5 text-[.6875rem] font-medium tracking-[.07em] text-muted uppercase max-[34rem]:mt-6 zh:text-[.8125rem] zh:leading-[1.35] zh:font-semibold zh:tracking-[.02em] zh:text-overline">
              {T(p.ready && p.s3 ? 'steps.live' : 'steps.setup')}
            </h2>
          </Effect>
          <Steps />
          <Effect {...ARRIVE} delay={120}><Options /></Effect>
        </main>
      )}

      {/* The colophon: the name, the version set as a small tag, and the licence after a dot. */}
      <Effect {...ARRIVE} delay={180}>
        <footer className="mx-1 mt-7 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
          {foot[0] && <span className="font-medium">{foot[0]}</span>}
          <span className="rounded-[5px] border border-line bg-tint/60 px-1.5 font-mono text-[11px] leading-[1.125rem] tracking-[-.01em] tabular-nums">{BOOT.version}</span>
          {foot[1] && <span>{foot[1]}</span>}
        </footer>
      </Effect>
    </div>
  );
}
