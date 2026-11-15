// The page's `lang`, set before its body is parsed (#40).
//
// Firefox keeps the language an element had when its accessible object was
// created: a `lang` changed on <html> once the body is being built is not
// passed on to screen readers, which then read a Japanese interface as English.
// This file is loaded by a plain <script> at the top of <head>, so it runs
// before any of the body exists. It is a separate file, not inline, because
// an extension page's CSP admits only scripts from the extension itself.
//
// It mirrors lib/i18n/document-language.ts and resolveLocale in
// lib/i18n/locale.ts; tests/document-language.test.ts runs this file and
// checks that the two agree.
(() => {
  let setting = 'auto';
  try {
    const stored = localStorage.getItem('apv-ui-language');
    if (stored === 'en' || stored === 'ja' || stored === 'auto') setting = stored;
  } catch {
    // Storage refused: follow the browser, which is the default setting.
  }
  let locale = setting;
  if (setting === 'auto') {
    locale = 'en';
    for (const tag of navigator.languages || []) {
      if (String(tag).toLowerCase().split('-')[0] === 'ja') {
        locale = 'ja';
        break;
      }
    }
  }
  document.documentElement.lang = locale;
})();
