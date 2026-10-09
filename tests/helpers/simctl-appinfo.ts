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
