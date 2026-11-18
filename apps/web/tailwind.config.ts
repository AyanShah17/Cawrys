import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      colors: {
        brand: "rgb(var(--brand) / <alpha-value>)",
      },
      transitionTimingFunction: {
        "out-quart": "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      animation: { spotlight: "spotlight 2s ease .75s 1 forwards" },
      keyframes: {
        spotlight: {
          "0%": { opacity: "0", transform: "translate(-72%, -62%) scale(0.5)" },
          "100%": { opacity: "1", transform: "translate(-50%,-40%) scale(1)" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
