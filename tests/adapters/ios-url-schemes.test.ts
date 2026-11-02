import { describe, expect, it } from 'vitest';
import { isWebScheme, linkScheme, NO_SUCH_KEY, urlSchemes } from '../../src/adapters/ios-url-schemes.js';

describe('linkScheme', () => {
  it('the scheme before the first colon, lower-cased', () => {
    expect(linkScheme('averilab://d49')).toBe('averilab');
    expect(linkScheme('AveriLab://x')).toBe('averilab');
    expect(linkScheme('tel:+421900')).toBe('tel');
    expect(linkScheme('my-app.v2+x://a:b')).toBe('my-app.v2+x');
  });

  it('none when the text does not start with a scheme', () => {
    expect(linkScheme('home')).toBeUndefined();
    expect(linkScheme('/path:x')).toBeUndefined();
    expect(linkScheme(':x')).toBeUndefined();
    expect(linkScheme('2app://x')).toBeUndefined();
    expect(linkScheme(' averilab://x')).toBeUndefined();
  });
});

describe('isWebScheme', () => {
  it('http and https only', () => {
    expect(isWebScheme('http')).toBe(true);
    expect(isWebScheme('https')).toBe(true);
    expect(isWebScheme('averilab')).toBe(false);
    expect(isWebScheme('httpx')).toBe(false);
  });
});

describe('urlSchemes — plutil -extract CFBundleURLTypes json', () => {
  it("the lab app's, as measured", () => {
    expect(urlSchemes('[{"CFBundleURLName":"dev.averi.lab","CFBundleURLSchemes":["averilab"]}]')).toEqual(['averilab']);
  });

  it('every scheme of every entry, lower-cased; an entry without schemes adds none', () => {
    expect(urlSchemes('[{"CFBundleURLSchemes":["One","two"]},{"CFBundleURLName":"x"},{"CFBundleURLSchemes":["Three"]}]')).toEqual([
      'one',
      'two',
      'three',
    ]);
    expect(urlSchemes('[]')).toEqual([]);
  });

  it('any other shape throws, saying what it is not', () => {
    expect(() => urlSchemes('not json')).toThrow();
    expect(() => urlSchemes('{"CFBundleURLSchemes":["a"]}')).toThrow('CFBundleURLTypes is not an array');
    expect(() => urlSchemes('["a"]')).toThrow('a CFBundleURLTypes entry is not a dictionary');
    expect(() => urlSchemes('[null]')).toThrow('a CFBundleURLTypes entry is not a dictionary');
    expect(() => urlSchemes('[["a"]]')).toThrow('a CFBundleURLTypes entry is not a dictionary');
    expect(() => urlSchemes('[{"CFBundleURLSchemes":"a"}]')).toThrow('CFBundleURLSchemes is not an array of strings');
    expect(() => urlSchemes('[{"CFBundleURLSchemes":["a",1]}]')).toThrow('CFBundleURLSchemes is not an array of strings');
  });
});

describe('NO_SUCH_KEY', () => {
  it("matches plutil's missing-key message (measured), not another failure", () => {
    expect(NO_SUCH_KEY.test('Info.plist: Could not extract value, error: No value at that key path or invalid key path: CFBundleURLTypes')).toBe(true);
    expect(NO_SUCH_KEY.test('/x/Info.plist: (The file “Info.plist” couldn’t be opened because there is no such file.)')).toBe(false);
  });
});
