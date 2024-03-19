import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { compileTemplate, compileScript, parse } from 'vue/compiler-sfc'
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

let templatePath = resolve('./src/App.vue')
let template = readFileSync(templatePath, 'utf-8')

// let parsed = parse(template)
// console.log(parsed)

// example of compileTemplate
const result = compileTemplate({
  source: template,
  filename: 'App.vue',
  id: 'App.vue',
  compilerOptions: {
    // mode: 'module',
    // prefixIdentifiers: true,
  },
})

console.log(result)

writeFileSync(resolve('./src/App.vue.js'), result.code)

import('./App.vue.js').then((module) => {
  const app = createSSRApp(module)
  renderToString(app).then((html) => {
    let htmlTemplate = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Vue SSR Example</title>
      </head>
      <body>
        <div id="app">${html}</div>
      </body>
    </html>
    `
    console.log(htmlTemplate)
  })
})

// console.log(result.code)

function getHTML() {
  const app = createSSRApp({
    data: () => ({ count: 1 }),
    template: `<button @click="count++">{{ count }}</button>`,
  })
}
