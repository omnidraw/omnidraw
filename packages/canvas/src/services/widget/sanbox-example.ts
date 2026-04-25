import {  html } from '@arrow-js/core'
import {  sandbox } from '@arrow-js/sandbox'
import Hand from 'lucide-static/icons/hand.svg?raw'
import mainjs from '../../../../widget-filesystem/dist/main.js?raw'
import maincss from '../../../../widget-filesystem/dist/main.css?raw'
const source = {
  'main.ts': [
    "import { html, reactive, svg } from '@arrow-js/core'",
    "import { foo } from './test'",
    "import Hand from './hand.ts'",
    'const state = reactive({ count: 0 })',
    'console.log(state, Hand)',
    'export default html`<button @click="${() => state.count++}">',
    '  Count ${() => state.count}: ${foo} ',
    '</button>`',
  ].join('\n'),
  'hand.ts': `export default ${JSON.stringify(Hand)}`,
  'test.ts': `
    export const foo = 'foo2'
  `,
  'main.css': [
    'button {',
    '  font: inherit;',
    '  padding: 0.75rem 1rem;',
    '}',
  ].join('\n'),
}

const o = {
  'main.js': mainjs,
  'main.css': maincss,
}

export function sandboxExample(root: HTMLElement) {
  html`<section>${
  sandbox({
  source: o })}</section>`(
    root)

}
