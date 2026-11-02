import { describe, expect, it } from 'vitest';
import { appInfoBundle, appInfoNames } from '../../src/adapters/simctl-appinfo.js';
import { appinfo, BANK_APPINFO } from '../helpers/simctl-appinfo.js';

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

describe('appInfoBundle — where the app\'s executable lives, from `simctl appinfo`', () => {
  it('the top-level Path (quoted, with spaces) and CFBundleExecutable of the recorded output', () => {
    expect(appInfoBundle(BANK_APPINFO)).toEqual({
      path: '/Users/mholecy/Library/Developer/CoreSimulator/Devices/37956039-94EA-4F51-93E5-94F7723A4578/data/Containers/Bundle/Application/95E78B94-6D6B-4B15-8D47-45D88DDC2ABD/Internal.app',
      executable: 'Internal',
    });
    expect(appInfoBundle('{\n    CFBundleExecutable = "My App";\n    Path = "/a b/My App.app";\n}\n')).toEqual({ path: '/a b/My App.app', executable: 'My App' });
  });

  it("only TOP-LEVEL keys: an extension's nested CFBundleExecutable / Path listed first is not the app's", () => {
    const nested =
      '{\n' +
      '    Extensions =     {\n        "com.app.widget" =         {\n            CFBundleExecutable = WidgetExt;\n            Path = "/w/WidgetExt.appex";\n        };\n    };\n' +
      '    CFBundleExecutable = Internal;\n' +
      '    Path = "/x/Internal.app";\n' +
      '}\n';
    expect(appInfoBundle(nested)).toEqual({ path: '/x/Internal.app', executable: 'Internal' });
  });

  it('a missing key is undefined, not empty; a dictionary or array value is no value', () => {
    expect(appInfoBundle('')).toEqual({});
    expect(appInfoBundle('{\n    CFBundleExecutable = Internal;\n}\n')).toEqual({ executable: 'Internal' });
    expect(appInfoBundle('{\n    Path = "/x/A.app";\n}\n')).toEqual({ path: '/x/A.app' });
    expect(appInfoBundle('{\n    Path =     {\n    };\n    CFBundleExecutable =     (\n    );\n}\n')).toEqual({});
  });
});
