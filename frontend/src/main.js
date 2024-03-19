import './index.css'

import { createApp } from './app.js'
import router from './router'

let app = createApp()

app.use(router)
app.mount('#app')
