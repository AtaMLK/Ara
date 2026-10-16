# Interface languages

English is the default. `arat-language` is a validated `en`/`tr` preference cookie shared by the admin, customer and sign-in screens. The root layout seeds `LanguageProvider`, so the first render and refresh use the selected language. Switching updates React context without refreshing the page or losing form edits.

- Wrap interface copy in `<T>…</T>` and add its English key and Turkish translation to `tr.json`.
- Use `<Localized as="input" … />` (or another native element) for translated placeholders, titles and accessible labels. Values, option IDs, event handlers and refs pass through unchanged.
- Use `useI18n().t()` for confirmation prompts and toast copy, and `DateText` for displayed dates. Dates use the selected locale and Europe/Istanbul time zone.
- Keep customer wording, supplier replies, product descriptions, company names and document content outside translation wrappers. These are business data, not interface copy. Supplier email language is controlled separately by the existing correspondence rules.
- Missing keys fall back to English. Do not infer a language from arbitrary cookie values or translate the DOM with a mutation observer.

Theme preferences use the existing local storage setting and a matching cookie. The root bootstrap applies the preference before hydration. `dark-surfaces.css` supplies dark variants for legacy hard-coded colors; `display-preferences.css` owns the final semantic color tokens and shared controls. Keep document/email attachment content in its intended print/email format.

Validation: `node --test tests/language.test.cjs`, `node tests/portal-audit.cjs --display` (disposable test accounts, no emails), and the existing quote UI/workflow tests.
