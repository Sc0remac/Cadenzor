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
          "'General Sans'",
          "'Geist'",
          "'SF Pro Text'",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "'Segoe UI'",
          "sans-serif",
        ],
        display: [
          "'Satoshi Variable'",
          "'Aeonik Pro'",
          "'Space Grotesk'",
          "'Inter'",
          "system-ui",
          "sans-serif",
        ],
      },
      colors: {
        depth: {
          950: "#020309",
          900: "#04050A",
          800: "#060813",
          700: "#0E1120",
          650: "#131728",
          600: "#171B2A",
          500: "#1E2433",
        },
        accent: {
          cyan: "#3BC9F5",
          "cyan-soft": "#7DD3FC",
          "cyan-deep": "#1F7AE0",
          magenta: "#D946EF",
        },
        ink: {
          100: "#FFFFFF",
          200: "#A9B3D1",
          300: "#9199BD",
          400: "#777DAF",
        },
      },
      backgroundImage: {
        "hero-gradient":
          "linear-gradient(140deg, rgba(31,122,224,0.9) 0%, rgba(66,130,245,0.75) 45%, rgba(217,70,239,0.6) 100%)",
        "plasma-blue":
          "radial-gradient(circle at 30% 20%, rgba(59,201,245,0.28), transparent 55%), radial-gradient(circle at 80% 0%, rgba(122,90,255,0.22), transparent 45%)",
      },
      boxShadow: {
        glow: "0 25px 60px -20px rgba(59, 201, 245, 0.5)",
        elevation: "0 18px 40px -20px rgba(5, 8, 24, 0.6)",
        "ambient-xl": "0 60px 140px -50px rgba(4, 7, 20, 0.95)",
        "ambient-md": "0 32px 80px -40px rgba(5, 8, 24, 0.75)",
        "ambient-sm": "0 18px 40px -24px rgba(8, 12, 28, 0.7)",
      },
      dropShadow: {
        glow: "0 12px 45px rgba(59, 201, 245, 0.35)",
        "nav-glow": "0 0 45px rgba(59, 201, 245, 0.2)",
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
