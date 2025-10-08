/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "'Inter'",
          "'SF Pro Display'",
          "'SF Pro Text'",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "'Segoe UI'",
          "sans-serif",
        ],
      },
      colors: {
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
        },
        surface: {
          50: "rgba(255, 255, 255, 0.55)",
          100: "rgba(255, 255, 255, 0.7)",
        },
        midnight: "#0f172a",
        aurora: "#14b8a6",
      },
      backgroundImage: {
        "grid-light":
          "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.25) 1px, transparent 0)",
        "hero-gradient":
          "linear-gradient(140deg, rgba(99,102,241,0.85) 0%, rgba(14,165,233,0.75) 45%, rgba(236,72,153,0.75) 100%)",
      },
      boxShadow: {
        glow: "0 25px 50px -12px rgba(99, 102, 241, 0.35)",
        elevation: "0 18px 40px -20px rgba(15, 23, 42, 0.4)",
      },
      dropShadow: {
        glow: "0 10px 35px rgba(99, 102, 241, 0.35)",
      },
      transitionTimingFunction: {
        "gentle-spring": "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      keyframes: {
        shimmer: {
          "0%": { "background-position": "-200% 0" },
          "50%": { "background-position": "200% 0" },
          "100%": { "background-position": "200% 0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-6px)" },
        },
        pulseGlow: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(99, 102, 241, 0.45)" },
          "50%": { boxShadow: "0 0 0 12px rgba(99, 102, 241, 0)" },
        },
      },
      animation: {
        shimmer: "shimmer 2.75s linear infinite",
        float: "float 8s ease-in-out infinite",
        pulseGlow: "pulseGlow 3s ease-in-out infinite",
      },
      borderRadius: {
        "2xl": "1.25rem",
      },
      blur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};