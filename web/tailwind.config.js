/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        pumpkin: '#D65A1F', burnt: '#B64013', ivory: '#FFF9F0', espresso: '#2D241F', gold: '#E8B66A',
        cream: '#FBEFD9', bark: '#6B5547', leaf: '#1F6F54', alarm: '#9B1C1C',
      },
      fontFamily: { display: ['Fraunces', 'Georgia', 'serif'], sans: ['"Nunito Sans"', 'system-ui', 'sans-serif'] },
      boxShadow: { cozy: '0 6px 20px rgba(45,36,31,.10)' },
    },
  },
  plugins: [],
};
