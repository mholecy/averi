import { describe, expect, it } from 'vitest';
import { appInfoNames } from '../../src/adapters/simctl-appinfo.js';
import { appinfo } from '../helpers/simctl-appinfo.js';

describe('appInfoNames — the names an app\'s Application may carry, from `simctl appinfo`', () => {
  it('CFBundleDisplayName then CFBundleName, quoted or bare; a repeat is listed once', () => {
    expect(appInfoNames(appinfo('"Skeleton Internal"', 'Skeleton'))).toEqual(['Skeleton Internal', 'Skeleton']);
    expect(appInfoNames(appinfo('Contacts', 'Contacts'))).toEqual(['Contacts']);
  });

  it('without a display name, the bundle name alone', () => {
    expect(appInfoNames(appinfo(undefined, 'Runner'))).toEqual(['Runner']);
  });

  it('decodes the plist escapes inside quotes — \\U for non-ASCII, \\" and \\\\', () => {
    expect(appInfoNames(appinfo('"Caf\\U00e9 \\"Bar\\" \\\\ 1"', 'Cafe'))).toEqual(['Café "Bar" \\ 1', 'Cafe']);
  });

  it('an output with neither key — not installed, or not a plist at all — is no names', () => {
    expect(appInfoNames('')).toEqual([]);
    expect(appInfoNames('An error was encountered processing the command (domain=NSPOSIXErrorDomain, code=2)')).toEqual([]);
  });

  it("only TOP-LEVEL keys count: a nested dictionary's CFBundleName (an extension's) is not the app's, before or after", () => {
    const nested =
      '{\n' +
      '    Extensions =     {\n        "com.app.widget" =         {\n            CFBundleName = WidgetExt;\n            CFBundleDisplayName = "Widget; Ext";\n        };\n    };\n' +
      '    Path = "/x/{y;z";\n' + // a brace and a `;` inside a string are text
      '    CFBundleName = Skeleton;\n' +
      '}\n';
    expect(appInfoNames(nested)).toEqual(['Skeleton']);
  });

  it('a key is matched whole: CFBundleNameSuffix-like keys are not CFBundleName', () => {
    expect(appInfoNames('{\n    CFBundleNameSomething = Wrong;\n    CFBundleName = Right;\n}\n')).toEqual(['Right']);
  });
});
