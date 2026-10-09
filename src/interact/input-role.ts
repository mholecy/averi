/**
 * The normalised role of every text input (adapters/ios-node.ts: TextField,
 * SecureTextField, TextView; adapters/android.ts: EditText,
 * AutoCompleteTextView and the Compose input that dumps as a focusable,
 * long-clickable scroll view). The one role a fill expects to type into.
 *
 * A leaf of its own (2026-10-09, code review of the fill-verdict branch):
 * fill.ts acts on it and fill-verdict.ts names it in the not-an-input
 * caveat. It sat in fill.ts until the caveat's sentence moved out, then
 * briefly in fill-verdict.ts — which made fill.ts import its own domain
 * constant from the judgement module.
 */
export const INPUT_ROLE = 'textfield';
