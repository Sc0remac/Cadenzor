/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
<<<<<<< ours
    extend: {
      fontFamily: {
        sans: [
          "'Inter'",
<<<<<<< ours
          "'SF Pro Display'",
=======
          "'General Sans'",
          "'Geist'",
>>>>>>> theirs
          "'SF Pro Text'",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "'Segoe UI'",
          "sans-serif",
        ],
<<<<<<< ours
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
=======
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
>>>>>>> theirs
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
=======
    extend: {},
>>>>>>> theirs
  },
  plugins: [],
};