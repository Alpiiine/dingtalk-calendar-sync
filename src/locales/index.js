// Every language the bridge speaks. To add one: copy en.js to <code>.js, translate the values,
// and list it here. Nothing else needs to change; the setup page shows the new language in its
// menu without a rebuild, and `npm test` checks that no message is missing.
//
// The key is the code that is saved as the event language and matched against the browser and
// the terminal (LANG=pt_BR.UTF-8 finds 'pt-BR', then 'pt'). The order here is the order of the menu.
import en from './en.js';
import zh from './zh.js';

export const LOCALES = { en, zh };
