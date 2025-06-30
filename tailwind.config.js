import frappeui from "frappe-ui/src/tailwind/preset";

/** @type {import('tailwindcss').Config} */
export default {
  presets: [frappeui],
  content: [
    "./frappe_vue_ssr/**/*.{vue,js,ts,jsx,tsx}",
    "./frappe_vue_ssr/www/**/*.{vue,js,ts,jsx,tsx}",
    "./node_modules/frappe-ui/src/components/**/*.{vue,js,ts,jsx,tsx}",
    "../node_modules/frappe-ui/src/components/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
