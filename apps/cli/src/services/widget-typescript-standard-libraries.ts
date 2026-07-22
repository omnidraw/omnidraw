/// <reference lib="esnext" />
/// <reference lib="dom" />

// TypeScript's library declarations are static text imports so Bun embeds them in
// compiled npm executables. The compiler receives this virtual map and never reads
// declaration files from the host filesystem.
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libDecorators from 'typescript/lib/lib.decorators.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libDecoratorsLegacy from 'typescript/lib/lib.decorators.legacy.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libDom from 'typescript/lib/lib.dom.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2015 from 'typescript/lib/lib.es2015.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2015Collection from 'typescript/lib/lib.es2015.collection.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2015Core from 'typescript/lib/lib.es2015.core.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2015Generator from 'typescript/lib/lib.es2015.generator.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2015Iterable from 'typescript/lib/lib.es2015.iterable.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2015Promise from 'typescript/lib/lib.es2015.promise.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2015Proxy from 'typescript/lib/lib.es2015.proxy.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2015Reflect from 'typescript/lib/lib.es2015.reflect.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2015Symbol from 'typescript/lib/lib.es2015.symbol.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2015SymbolWellknown from 'typescript/lib/lib.es2015.symbol.wellknown.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2016 from 'typescript/lib/lib.es2016.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2016ArrayInclude from 'typescript/lib/lib.es2016.array.include.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2016Intl from 'typescript/lib/lib.es2016.intl.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2017 from 'typescript/lib/lib.es2017.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2017Arraybuffer from 'typescript/lib/lib.es2017.arraybuffer.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2017Date from 'typescript/lib/lib.es2017.date.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2017Intl from 'typescript/lib/lib.es2017.intl.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2017Object from 'typescript/lib/lib.es2017.object.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2017Sharedmemory from 'typescript/lib/lib.es2017.sharedmemory.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2017String from 'typescript/lib/lib.es2017.string.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2017Typedarrays from 'typescript/lib/lib.es2017.typedarrays.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2018 from 'typescript/lib/lib.es2018.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2018Asyncgenerator from 'typescript/lib/lib.es2018.asyncgenerator.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2018Asynciterable from 'typescript/lib/lib.es2018.asynciterable.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2018Intl from 'typescript/lib/lib.es2018.intl.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2018Promise from 'typescript/lib/lib.es2018.promise.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2018Regexp from 'typescript/lib/lib.es2018.regexp.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2019 from 'typescript/lib/lib.es2019.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2019Array from 'typescript/lib/lib.es2019.array.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2019Intl from 'typescript/lib/lib.es2019.intl.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2019Object from 'typescript/lib/lib.es2019.object.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2019String from 'typescript/lib/lib.es2019.string.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2019Symbol from 'typescript/lib/lib.es2019.symbol.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2020 from 'typescript/lib/lib.es2020.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2020Bigint from 'typescript/lib/lib.es2020.bigint.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2020Date from 'typescript/lib/lib.es2020.date.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2020Intl from 'typescript/lib/lib.es2020.intl.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2020Number from 'typescript/lib/lib.es2020.number.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2020Promise from 'typescript/lib/lib.es2020.promise.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2020Sharedmemory from 'typescript/lib/lib.es2020.sharedmemory.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2020String from 'typescript/lib/lib.es2020.string.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2020SymbolWellknown from 'typescript/lib/lib.es2020.symbol.wellknown.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2021 from 'typescript/lib/lib.es2021.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2021Intl from 'typescript/lib/lib.es2021.intl.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2021Promise from 'typescript/lib/lib.es2021.promise.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2021String from 'typescript/lib/lib.es2021.string.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2021Weakref from 'typescript/lib/lib.es2021.weakref.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2022 from 'typescript/lib/lib.es2022.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2022Array from 'typescript/lib/lib.es2022.array.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2022Error from 'typescript/lib/lib.es2022.error.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2022Intl from 'typescript/lib/lib.es2022.intl.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2022Object from 'typescript/lib/lib.es2022.object.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2022Regexp from 'typescript/lib/lib.es2022.regexp.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs2022String from 'typescript/lib/lib.es2022.string.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import libEs5 from 'typescript/lib/lib.es5.d.ts' with { type: 'text' };

export const WIDGET_TYPESCRIPT_STANDARD_LIBRARY_FILES = Object.freeze({
  'lib.decorators.d.ts': libDecorators as unknown as string,
  'lib.decorators.legacy.d.ts': libDecoratorsLegacy as unknown as string,
  'lib.dom.d.ts': libDom as unknown as string,
  'lib.es2015.d.ts': libEs2015 as unknown as string,
  'lib.es2015.collection.d.ts': libEs2015Collection as unknown as string,
  'lib.es2015.core.d.ts': libEs2015Core as unknown as string,
  'lib.es2015.generator.d.ts': libEs2015Generator as unknown as string,
  'lib.es2015.iterable.d.ts': libEs2015Iterable as unknown as string,
  'lib.es2015.promise.d.ts': libEs2015Promise as unknown as string,
  'lib.es2015.proxy.d.ts': libEs2015Proxy as unknown as string,
  'lib.es2015.reflect.d.ts': libEs2015Reflect as unknown as string,
  'lib.es2015.symbol.d.ts': libEs2015Symbol as unknown as string,
  'lib.es2015.symbol.wellknown.d.ts': libEs2015SymbolWellknown as unknown as string,
  'lib.es2016.d.ts': libEs2016 as unknown as string,
  'lib.es2016.array.include.d.ts': libEs2016ArrayInclude as unknown as string,
  'lib.es2016.intl.d.ts': libEs2016Intl as unknown as string,
  'lib.es2017.d.ts': libEs2017 as unknown as string,
  'lib.es2017.arraybuffer.d.ts': libEs2017Arraybuffer as unknown as string,
  'lib.es2017.date.d.ts': libEs2017Date as unknown as string,
  'lib.es2017.intl.d.ts': libEs2017Intl as unknown as string,
  'lib.es2017.object.d.ts': libEs2017Object as unknown as string,
  'lib.es2017.sharedmemory.d.ts': libEs2017Sharedmemory as unknown as string,
  'lib.es2017.string.d.ts': libEs2017String as unknown as string,
  'lib.es2017.typedarrays.d.ts': libEs2017Typedarrays as unknown as string,
  'lib.es2018.d.ts': libEs2018 as unknown as string,
  'lib.es2018.asyncgenerator.d.ts': libEs2018Asyncgenerator as unknown as string,
  'lib.es2018.asynciterable.d.ts': libEs2018Asynciterable as unknown as string,
  'lib.es2018.intl.d.ts': libEs2018Intl as unknown as string,
  'lib.es2018.promise.d.ts': libEs2018Promise as unknown as string,
  'lib.es2018.regexp.d.ts': libEs2018Regexp as unknown as string,
  'lib.es2019.d.ts': libEs2019 as unknown as string,
  'lib.es2019.array.d.ts': libEs2019Array as unknown as string,
  'lib.es2019.intl.d.ts': libEs2019Intl as unknown as string,
  'lib.es2019.object.d.ts': libEs2019Object as unknown as string,
  'lib.es2019.string.d.ts': libEs2019String as unknown as string,
  'lib.es2019.symbol.d.ts': libEs2019Symbol as unknown as string,
  'lib.es2020.d.ts': libEs2020 as unknown as string,
  'lib.es2020.bigint.d.ts': libEs2020Bigint as unknown as string,
  'lib.es2020.date.d.ts': libEs2020Date as unknown as string,
  'lib.es2020.intl.d.ts': libEs2020Intl as unknown as string,
  'lib.es2020.number.d.ts': libEs2020Number as unknown as string,
  'lib.es2020.promise.d.ts': libEs2020Promise as unknown as string,
  'lib.es2020.sharedmemory.d.ts': libEs2020Sharedmemory as unknown as string,
  'lib.es2020.string.d.ts': libEs2020String as unknown as string,
  'lib.es2020.symbol.wellknown.d.ts': libEs2020SymbolWellknown as unknown as string,
  'lib.es2021.d.ts': libEs2021 as unknown as string,
  'lib.es2021.intl.d.ts': libEs2021Intl as unknown as string,
  'lib.es2021.promise.d.ts': libEs2021Promise as unknown as string,
  'lib.es2021.string.d.ts': libEs2021String as unknown as string,
  'lib.es2021.weakref.d.ts': libEs2021Weakref as unknown as string,
  'lib.es2022.d.ts': libEs2022 as unknown as string,
  'lib.es2022.array.d.ts': libEs2022Array as unknown as string,
  'lib.es2022.error.d.ts': libEs2022Error as unknown as string,
  'lib.es2022.intl.d.ts': libEs2022Intl as unknown as string,
  'lib.es2022.object.d.ts': libEs2022Object as unknown as string,
  'lib.es2022.regexp.d.ts': libEs2022Regexp as unknown as string,
  'lib.es2022.string.d.ts': libEs2022String as unknown as string,
  'lib.es5.d.ts': libEs5 as unknown as string,
});
