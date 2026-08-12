/**
 * iOS element `type` → normalized role vocabulary, shared by both tree
 * sources: idb's flat AX list (ios.ts) and WDA's nested /source
 * (wda-source.ts, which extends it with structural types only the nested
 * tree has). One owner per rule — the two copies this replaces were
 * identical and would have drifted.
 *
 * Lives in its own module (not ios.ts) because ios.ts imports the WDA
 * parser — exporting from there would make the import circular.
 */
export const IOS_ROLE_MAP: Record<string, string> = {
  Button: 'button',
  StaticText: 'text',
  TextField: 'textfield',
  SecureTextField: 'textfield',
  TextView: 'textfield',
  Image: 'image',
  Switch: 'switch',
  Toggle: 'switch',
  CheckBox: 'checkbox',
  RadioButton: 'radiobutton',
  Slider: 'slider',
  ProgressIndicator: 'progress',
  WebView: 'webview',
  ScrollView: 'scrollable',
  Table: 'scrollable',
  CollectionView: 'scrollable',
  Cell: 'container',
  Window: 'container',
  Other: 'container',
};
