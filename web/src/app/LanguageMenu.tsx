// The language of the page: one icon in the header that opens the list of languages. The icon
// reads the same whatever the page is set to, and each language is named in its own words, so
// the way back is always findable. The list comes from the server (src/locales/).
import { Check, Languages } from 'lucide-react';
import { DropdownMenu } from '@animate-ui/react/primitives/radix-ui';
import { BOOT } from '../lib/boot';
import { LANGS } from '../lib/i18n';
import { Button } from '../ui/button';
import { actions, useApp, useT } from './store';

const ITEM = 'relative flex min-h-10 cursor-pointer items-center rounded-[.375rem] pointer-fine:min-h-7.5 pointer-fine:text-sm py-1.5 ps-8 pe-4 outline-none select-none '
  + 'data-[highlighted]:bg-tint data-[state=checked]:font-medium';

export function LanguageMenu() {
  const { lang } = useApp();
  const T = useT();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        {/* px-0! because the size already sets a padding, which would squeeze the icon. */}
        <Button variant="ghost" size="sm" className="w-9 px-0! pointer-fine:w-7" aria-label={T('lang')} title={T('lang')}><Languages size={15} aria-hidden /></Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-44 rounded-[10px] border border-line bg-surface p-1 shadow-pop">
          <DropdownMenu.RadioGroup value={lang} onValueChange={actions.setLang}>
            {LANGS.map((code) => (
              <DropdownMenu.RadioItem key={code} value={code} lang={BOOT.locales[code].tag} className={ITEM}>
                <DropdownMenu.ItemIndicator className="absolute start-2.5 grid place-content-center text-accent"><Check size={14} strokeWidth={2.5} /></DropdownMenu.ItemIndicator>
                {BOOT.locales[code].name}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
