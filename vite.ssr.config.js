import { defineConfig } from 'vite'
import frappeui from 'frappe-ui/vite'

export default defineConfig({
  plugins: [
    frappeui({ lucideIcons: true }),
  ],
})
