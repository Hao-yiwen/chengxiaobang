import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/renderer/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" }
    },
    // DESIGN.md radius scale — full override, the spec ladder is the only one.
    borderRadius: {
      none: "0px",
      xs: "4px",
      sm: "8px",
      DEFAULT: "8px",
      md: "16px",
      lg: "22px",
      xl: "30px",
      pill: "32px",
      full: "9999px"
    },
    // Cohere is flat: containment comes from hairline borders. The single
    // overlay shadow is reserved for transient floating layers.
    boxShadow: {
      none: "none",
      overlay: "0 12px 32px -16px rgb(7 24 41 / 0.18)"
    },
    extend: {
      colors: {
        border: "rgb(var(--border) / <alpha-value>)",
        hairline: "rgb(var(--border) / <alpha-value>)",
        input: "rgb(var(--input) / <alpha-value>)",
        ring: "rgb(var(--ring) / <alpha-value>)",
        background: "rgb(var(--background) / <alpha-value>)",
        foreground: "rgb(var(--foreground) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        "deep-green": "rgb(var(--deep-green) / <alpha-value>)",
        "dark-navy": "rgb(var(--dark-navy) / <alpha-value>)",
        "soft-stone": "rgb(var(--soft-stone) / <alpha-value>)",
        "pale-green": "rgb(var(--pale-green) / <alpha-value>)",
        "pale-blue": "rgb(var(--pale-blue) / <alpha-value>)",
        coral: {
          DEFAULT: "rgb(var(--coral) / <alpha-value>)",
          soft: "rgb(var(--coral-soft) / <alpha-value>)"
        },
        "action-blue": "rgb(var(--action-blue) / <alpha-value>)",
        "focus-blue": "rgb(var(--focus-blue) / <alpha-value>)",
        "form-focus": "rgb(var(--form-focus) / <alpha-value>)",
        "muted-slate": "rgb(var(--muted-slate) / <alpha-value>)",
        "body-muted": "rgb(var(--body-muted) / <alpha-value>)",
        "card-border": "rgb(var(--card-border) / <alpha-value>)",
        "bubble-user": "rgb(var(--bubble-user) / <alpha-value>)",
        primary: {
          DEFAULT: "rgb(var(--primary) / <alpha-value>)",
          foreground: "rgb(var(--primary-foreground) / <alpha-value>)"
        },
        secondary: {
          DEFAULT: "rgb(var(--secondary) / <alpha-value>)",
          foreground: "rgb(var(--secondary-foreground) / <alpha-value>)"
        },
        destructive: {
          DEFAULT: "rgb(var(--destructive) / <alpha-value>)",
          foreground: "rgb(var(--destructive-foreground) / <alpha-value>)"
        },
        muted: {
          DEFAULT: "rgb(var(--muted) / <alpha-value>)",
          foreground: "rgb(var(--muted-foreground) / <alpha-value>)"
        },
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          foreground: "rgb(var(--accent-foreground) / <alpha-value>)"
        },
        popover: {
          DEFAULT: "rgb(var(--popover) / <alpha-value>)",
          foreground: "rgb(var(--popover-foreground) / <alpha-value>)"
        },
        card: {
          DEFAULT: "rgb(var(--card) / <alpha-value>)",
          foreground: "rgb(var(--card-foreground) / <alpha-value>)"
        }
      },
      fontFamily: {
        // Display ≈ CohereText; body ≈ Unica77 — bundled fallbacks per DESIGN.md.
        display: [
          "Space Grotesk",
          "Inter",
          "-apple-system",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "ui-sans-serif",
          "system-ui",
          "sans-serif"
        ],
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "ui-sans-serif",
          "sans-serif"
        ],
        mono: ["SF Mono", "ui-monospace", "JetBrains Mono", "Menlo", "Consolas", "monospace"]
      },
      // DESIGN.md 12-role type ladder.
      fontSize: {
        hero: ["96px", { lineHeight: "1", letterSpacing: "-1.92px" }],
        display: ["72px", { lineHeight: "1", letterSpacing: "-1.44px" }],
        "section-display": ["60px", { lineHeight: "1", letterSpacing: "-1.2px" }],
        section: ["48px", { lineHeight: "1.2", letterSpacing: "-0.48px" }],
        "card-heading": ["32px", { lineHeight: "1.2", letterSpacing: "-0.32px" }],
        feature: ["24px", { lineHeight: "1.3" }],
        "body-lg": ["18px", { lineHeight: "1.4" }],
        body: ["16px", { lineHeight: "1.5" }],
        button: ["14px", { lineHeight: "1.71", fontWeight: "500" }],
        caption: ["14px", { lineHeight: "1.4" }],
        "mono-label": ["14px", { lineHeight: "1.4", letterSpacing: "0.28px" }],
        micro: ["12px", { lineHeight: "1.4" }]
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" }
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" }
        },
        "msg-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" }
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" }
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" }
        },
        caret: { "50%": { opacity: "0" } },
        "mic-pulse": {
          "0%,100%": { boxShadow: "0 0 0 0 rgb(var(--destructive) / 0.4)" },
          "50%": { boxShadow: "0 0 0 5px rgb(var(--destructive) / 0)" }
        }
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "msg-in": "msg-in 0.28s cubic-bezier(0.22, 1, 0.36, 1)",
        "fade-in": "fade-in 0.3s ease-out",
        "scale-in": "scale-in 0.18s cubic-bezier(0.22, 1, 0.36, 1)",
        "mic-pulse": "mic-pulse 1.4s ease-in-out infinite"
      }
    }
  },
  plugins: [animate]
} satisfies Config;
