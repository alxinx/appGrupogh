/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./views/**/*.pug",
    "./public/**/*.js",
    "./**/*.pug"
  ],
  theme: {
    extend: {
      colors: {
        gh: {
          primary: '#EC5FA3',
          primaryHover: '#E24C95',
          primarySoft: '#FDE7F2',
          grayText: '#4B5563',
          grayBorder: '#E5E7EB',
        },
      },
      borderRadius: {
        gh: '12px',
      },
    },
  },
  plugins: [],
}
