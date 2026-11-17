// Options, debug mode and "Disconnect": one card that stays folded until it is needed. Its
// header says what is inside, and the three kinds of thing it holds stand apart: the rules of
// the sync (a form with its own Save), the debug switch, and the one action that deletes.
// The rules are a list of rows: what a setting is and when to change it on one side, its
// control on the other, each box as wide as what goes into it. Debug mode and "Disconnect" are
// split the same way: the text, and the one button beside it.
import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Collapsible } from '@animate-ui/react/primitives/radix-ui';
import { cn } from '../lib/cn';
import { BOOT } from '../lib/boot';
import { LANGS, dateTime, translate } from '../lib/i18n';
import { Button, StatusButton } from '../ui/button';
import { RadioGroup, RadioItem, Switch } from '../ui/controls';
import { ConfirmDialog } from '../ui/dialog';
import { FieldError, HINT, Html, LABEL, TextField } from '../ui/field';
import { Reveal } from '../ui/motion';
import { CARD } from '../ui/styles';
import { actions, browserZone, useApp, useT, type Note, type PushMode } from './store';

const H3 = 'font-semibold tracking-[-.01em] zh:tracking-normal';
/** A section with one action: the text on one side, its button on the other; stacked on a phone. */
const SPLIT = 'sm:flex sm:justify-between sm:gap-x-8';
/** The fields behind the "Advanced" fold. */
const ADVANCED = ['LOOKBACK_DAYS', 'FULL_SYNC_MINUTES', 'MAX_WRITES', 'DEFAULT_TZ'];

function Message({ note }: { note: Note }) {
  return (
    <Reveal show={Boolean(note)}>
      <p role="status" className={cn('pt-3.5 font-medium', note?.tone === 'bad' ? 'text-bad' : 'text-ok')}>{note?.text}</p>
    </Reveal>
  );
}

/** What this browser knows about time zones: the one it is in, and the names it accepts. */
function useTimeZones() {
  return useMemo(() => {
    let all: string[] = [];
    try { all = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') || []; } catch { /* no list */ }
    return { here: browserZone, all };
  }, []);
}

export function Options() {
  const s = useApp();
  const T = useT();
  const f = s.forms;
  const zones = useTimeZones();
  const err = (k: string) => (s.errors[k] ? T(s.errors[k].key, s.errors[k].vars) : undefined);
  const d = s.S?.debug || { on: false, until: 0 };
  const [advOpen, setAdvOpen] = useState(false);
  const advWrong = ADVANCED.some((k) => s.errors[k]);

  return (
    <Collapsible.Root open={s.optsOpen} onOpenChange={actions.setOptsOpen} className={`${CARD} mt-3 overflow-hidden`}>
      {/* The arrow stands at the end of the row, on the same line as the arrows of the steps. */}
      <Collapsible.Trigger className="group flex w-full items-center gap-3 px-5 py-3 text-start transition-colors duration-150 hover:bg-tint/50 focus-visible:-outline-offset-2 max-[34rem]:px-4">
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="leading-[1.3] font-semibold tracking-[-.01em] zh:tracking-normal">{T('opt.title')}</span>
          <span className="text-sm leading-[1.35] text-muted">{T('opt.sub')}</span>
        </span>
        <ChevronRight size={15} aria-hidden className="shrink-0 text-muted/80 transition-transform duration-150 ease-out group-data-[state=open]:rotate-90" />
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div className="border-t border-line px-5 pt-5 pb-5 max-[34rem]:px-4">
          <form noValidate onSubmit={(ev) => { ev.preventDefault(); actions.saveOptions(); }}>
            <h3 className={H3}>{T('opt.rules')}</h3>
            <div className="mt-1 divide-y divide-hair">
              {/* One radio per language, each with an example of what it writes, in that language:
                  this is not the language of the page, which the menu in the header changes at once. */}
              <div className="py-4">
                <span id="l-DTSYNC_LANG" className={LABEL}>{T('opt.lang')}</span>
                <RadioGroup aria-labelledby="l-DTSYNC_LANG" aria-describedby="h-DTSYNC_LANG" value={f.DTSYNC_LANG} onValueChange={(v) => actions.setForm('DTSYNC_LANG', v)} className="mt-2 grid gap-2">
                  {LANGS.map((lang) => (
                    <label key={lang} className="flex cursor-pointer items-start gap-2.5">
                      <RadioItem value={lang} id={`evlang-${lang}`} className="mt-0.5" />
                      <span>{T('opt.lang.example', { name: BOOT.locales[lang].name, example: translate(lang, 'event.busyDingTalk') })}</span>
                    </label>
                  ))}
                </RadioGroup>
                <p id="h-DTSYNC_LANG" className={`${HINT} mt-2`}>{T('opt.lang.hint')}</p>
              </div>

              {/* A yes or no: what it is and what it does on one side, the switch on the other. The
                  whole text is the label of the switch, and its second line is what describes it. */}
              <div className="flex items-center justify-between gap-x-8 py-4 max-sm:gap-x-4">
                <label htmlFor="hide" className="min-w-0 flex-1 cursor-pointer">
                  <span className={LABEL}>{T('opt.hide')}</span>
                  <span id="h-hide" className={`${HINT} mt-1 block max-w-[60ch]`}>{T('opt.hide.hint')}</span>
                </label>
                <Switch id="hide" aria-describedby="h-hide" checked={f.hide} onCheckedChange={(v) => actions.setForm('hide', v)} />
              </div>

              <div className="py-4">
                <span id="l-push" className={LABEL}>{T('opt.push')}</span>
                <RadioGroup aria-labelledby="l-push" value={f.push} onValueChange={(v) => actions.setForm('push', v as PushMode)} className="mt-2 grid gap-2">
                  {(['calendly', 'all', 'custom'] as const).map((mode) => (
                    <label key={mode} className="flex cursor-pointer items-start gap-2.5">
                      <RadioItem value={mode} id={`push-${mode}`} className="mt-0.5" />
                      <span>{T(`opt.push.${mode}`)}</span>
                    </label>
                  ))}
                </RadioGroup>
                <Reveal show={f.push === 'custom'} className="pt-3 ps-[1.875rem] pointer-fine:ps-7">
                  <TextField
                    first mono id="pattern" name="pattern" label={T('opt.push.pattern')} width="max-w-80"
                    autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    value={f.pattern} onChange={(v) => actions.setForm('pattern', v)} onBlur={actions.checkPattern}
                    hints={[T('opt.push.pattern.hint')]} error={err('PUSH_MATCH')} shake={s.shakes.PUSH_MATCH}
                  />
                </Reveal>
                {f.push !== 'custom' && <FieldError text={err('PUSH_MATCH')} />}
              </div>

              <TextField
                side width="sm:w-52" id="f-PUSH_PREFIX" name="PUSH_PREFIX" label={T('opt.prefix')} autoComplete="off"
                value={f.PUSH_PREFIX} onChange={(v) => actions.setForm('PUSH_PREFIX', v)}
                hints={[T('opt.prefix.hint')]} error={err('PUSH_PREFIX')} shake={s.shakes.PUSH_PREFIX}
              />
              <TextField
                side unit={T('unit.days')} id="f-HORIZON_DAYS" name="HORIZON_DAYS" type="number" min={1} max={365} inputMode="numeric" placeholder="90" label={T('opt.days')}
                value={f.HORIZON_DAYS} onChange={(v) => actions.setForm('HORIZON_DAYS', v)}
                meta={T('opt.days.range')} hints={[T('opt.days.hint')]} error={err('HORIZON_DAYS')} shake={s.shakes.HORIZON_DAYS}
              />
            </div>
            {/* Rarely needed, so folded: its header says when to look inside. An empty field means
                the default, which its placeholder shows. Each field says what it is for and when to
                change it; its range and default stand apart as a caption under its name. A field
                that was rejected opens the fold. */}
            <Collapsible.Root open={advOpen || advWrong} onOpenChange={setAdvOpen} className="border-t border-hair">
            <Collapsible.Trigger className="group -mx-2 my-1 flex w-[calc(100%+1rem)] items-center gap-3 rounded-ctl px-2 py-2.5 text-start transition-colors duration-150 hover:bg-tint/60">
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className={H3}>{T('opt.adv')}</span>
                <span className={HINT}>{T('opt.adv.sub')}</span>
              </span>
              <ChevronRight size={15} aria-hidden className="shrink-0 text-muted/80 transition-transform duration-150 ease-out group-data-[state=open]:rotate-90" />
            </Collapsible.Trigger>
            <Collapsible.Content>
            <div className="divide-y divide-hair border-t border-hair">
              <TextField
                side unit={T('unit.days')} id="f-LOOKBACK_DAYS" name="LOOKBACK_DAYS" type="number" min={1} max={3650} inputMode="numeric" placeholder="730" label={T('opt.lookback')}
                value={f.LOOKBACK_DAYS} onChange={(v) => actions.setForm('LOOKBACK_DAYS', v)}
                meta={T('opt.lookback.range')} hints={[T('opt.lookback.hint'), T('opt.lookback.when')]} error={err('LOOKBACK_DAYS')} shake={s.shakes.LOOKBACK_DAYS}
              />
              <TextField
                side unit={T('unit.min')} id="f-FULL_SYNC_MINUTES" name="FULL_SYNC_MINUTES" type="number" min={1} max={1440} inputMode="numeric" placeholder="15" label={T('opt.full')}
                value={f.FULL_SYNC_MINUTES} onChange={(v) => actions.setForm('FULL_SYNC_MINUTES', v)}
                meta={T('opt.full.range')} hints={[T('opt.full.hint'), T('opt.full.when')]} error={err('FULL_SYNC_MINUTES')} shake={s.shakes.FULL_SYNC_MINUTES}
              />
              <TextField
                side id="f-MAX_WRITES" name="MAX_WRITES" type="number" min={0} max={10000} inputMode="numeric" placeholder={s.S?.platform === 'cloudflare' ? '30' : '0'} label={T('opt.writes')}
                value={f.MAX_WRITES} onChange={(v) => actions.setForm('MAX_WRITES', v)}
                meta={T('opt.writes.range')} hints={[T('opt.writes.hint'), T('opt.writes.when')]} error={err('MAX_WRITES')} shake={s.shakes.MAX_WRITES}
              />
              {/* DingTalk puts a zone on every timed event, so this is a fallback. It starts as the zone
                  this browser is in (the store saves it when none is saved). A name is hard to type
                  from memory: the field suggests the ones the browser knows, and one press brings
                  back the zone the browser is in. */}
              <TextField
                side width="sm:w-52" mono id="f-DEFAULT_TZ" name="DEFAULT_TZ" placeholder={zones.here || undefined} label={T('opt.tz')} list="tz-names"
                autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                value={f.DEFAULT_TZ} onChange={(v) => actions.setForm('DEFAULT_TZ', v)}
                hints={[T('opt.tz.hint'), T('opt.tz.when'), <Html className="manual" html={T('opt.tz.range')} />]} error={err('DEFAULT_TZ')} shake={s.shakes.DEFAULT_TZ}
                after={zones.here && f.DEFAULT_TZ !== zones.here && (
                  <Button size="sm" variant="text" className="mt-1.5" onClick={() => actions.setForm('DEFAULT_TZ', zones.here)}>{T('opt.tz.use', { zone: zones.here })}</Button>
                )}
              />
            </div>
            </Collapsible.Content>
            </Collapsible.Root>
            <datalist id="tz-names">{zones.all.map((z) => <option key={z} value={z} />)}</datalist>

            {/* No rule above the button: it closes the form, and the rule under it starts debug mode. */}
            <div className="flex pt-3">
              <StatusButton type="submit" variant="solid" label={T('btn.save')} busy={s.busy.opt} />
            </div>
            <Message note={s.optNote} />
          </form>

          {/* What it is and how it stands on one side, the one button on the other. On a phone
              the button goes under the text. */}
          <section className={`mt-6 border-t border-line pt-5 ${SPLIT} sm:items-start`}>
            <div className="min-w-0">
              <h3 className={H3}>{T('dbg.title')}</h3>
              <p className="mt-1 max-w-[60ch] text-sm text-muted">{T('dbg.help')}</p>
              {/* Whether it is on, said like the state of a connection: a dot and a line. */}
              <p className={`${HINT} mt-2 flex items-start gap-2 tabular-nums`}>
                <span aria-hidden className={cn('mt-[.4375rem] size-1.5 shrink-0 rounded-full transition-colors duration-150', d.on ? 'bg-warn' : 'bg-ink/25')} />
                <span className="min-w-0">{d.on ? T('dbg.until', { time: dateTime(s.lang, d.until) }) : T('dbg.isoff')}</span>
              </p>
            </div>
            <div className="flex shrink-0 max-sm:mt-3.5">
              <StatusButton label={T(d.on ? 'dbg.off' : 'dbg.on')} busy={s.busy.dbg} onClick={actions.toggleDebug} />
            </div>
          </section>

          {/* The one thing here that deletes. It is the last section, stands in a faint red box of
              its own, and says what it does in its button, which is quiet until the pointer is on
              it; a dialog then says what stops before anything does. */}
          <section className="mt-6 rounded-[10px] border border-[rgba(239,68,68,.14)] bg-[rgba(239,68,68,.025)] px-4 py-3.5">
            <div className={`${SPLIT} sm:items-center`}>
              <div className="min-w-0">
                <h3 className={H3}>{T('reset.title')}</h3>
                <p className="mt-1 max-w-[60ch] text-sm text-muted">{T('reset.help')}</p>
              </div>
              <div className="flex shrink-0 max-sm:mt-3.5">
                <ConfirmDialog
                  trigger={<Button variant="danger" disabled={s.busy.reset}>{T('reset.btn')}</Button>}
                  title={T('reset.ask')} description={T('reset.body')} confirm={T('reset.confirm')} cancel={T('cancel')} onConfirm={actions.reset}
                />
              </div>
            </div>
            <Message note={s.resetNote} />
          </section>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
