/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#C8102E',
          secondary: '#FF781F',
          dark: '#222222',
          light: '#FFF4EF',
          accent: '#FFD129',
        },
        pav: {
          red: '#C8102E',
          redDeep: '#B70726',
          redBright: '#E52429',
          orange: '#FF781F',
          gold: '#FFD129',
          whiteWarm: '#FFFCFA',
          cream: '#FFF4EF',
          rose: '#F8D6D3',
          grayLight: '#F5F5F5',
          ink: '#222222',
          muted: '#666666',
          border: '#E5E5E5',
        },
      },
      fontFamily: {
        sans: ['Poppins', 'system-ui', '-apple-system', 'sans-serif'],
        poppins: ['Poppins', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
