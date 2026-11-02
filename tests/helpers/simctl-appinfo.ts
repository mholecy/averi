/**
 * `simctl appinfo` as it prints (an old-style plist), trimmed to the keys
 * read and two around them — shared by the parser's tests
 * (simctl-appinfo.test.ts) and the launch's foreground wait
 * (ios-foreground.test.ts). `display` is written as given (quote it for a
 * name with spaces); undefined leaves CFBundleDisplayName out.
 */
export const appinfo = (display: string | undefined, name: string): string =>
  '{\n' +
  '    ApplicationType = System;\n' +
  '    CFBundleExecutable = Contacts;\n' +
  (display === undefined ? '' : `    CFBundleDisplayName = ${display};\n`) +
  '    CFBundleIdentifier = "com.apple.MobileAddressBook";\n' +
  `    CFBundleName = ${name};\n` +
  '    GroupContainers =     {\n        "group.com.apple.contacts" = "file:///tmp/x/";\n    };\n' +
  '}\n';

/**
 * The bank app's `simctl appinfo`, verbatim as recorded on 2026-10-09
 * (docs/bugs/2026-10-09-ios-launch-app-reads-previous-apps-tree.md, a1): a
 * user app on simulator 37956039-…, its Path in this simulator's bundle
 * containers.
 */
export const BANK_APPINFO =
  '{\n' +
  '    ApplicationType = User;\n' +
  '    Bundle = "file:///Users/mholecy/Library/Developer/CoreSimulator/Devices/37956039-94EA-4F51-93E5-94F7723A4578/data/Containers/Bundle/Application/95E78B94-6D6B-4B15-8D47-45D88DDC2ABD/Internal.app/";\n' +
  '    BundleContainer = "file:///Users/mholecy/Library/Developer/CoreSimulator/Devices/37956039-94EA-4F51-93E5-94F7723A4578/data/Containers/Bundle/Application/95E78B94-6D6B-4B15-8D47-45D88DDC2ABD/";\n' +
  '    CFBundleDisplayName = "Skeleton Internal";\n' +
  '    CFBundleExecutable = Internal;\n' +
  '    CFBundleIdentifier = "com.finshape.dbosbanking";\n' +
  '    CFBundleName = Internal;\n' +
  '    CFBundleShortVersionString = "0.5.2";\n' +
  '    CFBundleVersion = 0;\n' +
  '    DataContainer = "file:///Users/mholecy/Library/Developer/CoreSimulator/Devices/37956039-94EA-4F51-93E5-94F7723A4578/data/Containers/Data/Application/27AF5801-71E8-4354-A3A8-7C83C4B7FD24/";\n' +
  '    GroupContainers =     {\n' +
  '    };\n' +
  '    IsAppClip = 0;\n' +
  '    IsDeveloperApp = 1;\n' +
  '    IsFirstParty = 0;\n' +
  '    IsHidden = 0;\n' +
  '    IsRemovable = 1;\n' +
  '    Path = "/Users/mholecy/Library/Developer/CoreSimulator/Devices/37956039-94EA-4F51-93E5-94F7723A4578/data/Containers/Bundle/Application/95E78B94-6D6B-4B15-8D47-45D88DDC2ABD/Internal.app";\n' +
  '    SBAppTags =     (\n' +
  '    );\n' +
  '}\n';
