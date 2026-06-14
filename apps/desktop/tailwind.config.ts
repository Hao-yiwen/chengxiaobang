import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/renderer/**/*.{ts,tsx}",
    "./node_modules/streamdown/dist/**/*.{js,mjs}",
    "./node_modules/@streamdown/code/dist/**/*.{js,mjs}",
    "./node_modules/@streamdown/mermaid/dist/**/*.{js,mjs}",
    "./node_modules/@streamdown/math/dist/**/*.{js,mjs}",
    "./node_modules/@streamdown/cjk/dist/**/*.{js,mjs}"
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" }
    },
    // Vercel 半径刻度：6px 是应用控件基准，100px 是品牌 CTA 胶囊。
    borderRadius: {
      none: "0px",
      xs: "4px",
      sm: "6px",
      DEFAULT: "6px",
      md: "8px",
      lg: "12px",
      xl: "16px",
      "pill-sm": "64px",
      pill: "100px",
      full: "9999px"
    },
    // Vercel 的深度来自 inset hairline 与多层弱阴影，而不是单个重投影。
    boxShadow: {
      none: "none",
      hairline: "inset 0 0 0 1px rgb(0 0 0 / 0.08)",
      subtle: "0 1px 1px rgb(0 0 0 / 0.02), 0 2px 2px rgb(0 0 0 / 0.04), inset 0 0 0 1px rgb(0 0 0 / 0.08)",
      stack: "0 2px 2px rgb(0 0 0 / 0.04), 0 8px 8px -8px rgb(0 0 0 / 0.04), inset 0 0 0 1px rgb(0 0 0 / 0.08)",
      float: "0 2px 2px rgb(0 0 0 / 0.04), 0 8px 16px -4px rgb(0 0 0 / 0.04), inset 0 0 0 1px rgb(0 0 0 / 0.08)",
      modal: "0 1px 1px rgb(0 0 0 / 0.02), 0 8px 16px -4px rgb(0 0 0 / 0.04), 0 24px 32px -8px rgb(0 0 0 / 0.06), inset 0 0 0 1px rgb(0 0 0 / 0.08)",
      // overlay 用于弹层/菜单：无 inset hairline 的环绕柔和投影，弹层不再叠加实体边框。
      overlay: "0 0 8px rgb(0 0 0 / 0.07), 0 2px 6px -2px rgb(0 0 0 / 0.08), 0 8px 24px -6px rgb(0 0 0 / 0.12)"
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
        "surface-hover": "rgb(var(--surface-hover) / <alpha-value>)",
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        "canvas-soft": "rgb(var(--canvas-soft) / <alpha-value>)",
        "canvas-soft-2": "rgb(var(--canvas-soft-2) / <alpha-value>)",
        "plan-surface": "rgb(var(--plan-surface) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        body: "rgb(var(--body) / <alpha-value>)",
        mute: "rgb(var(--mute) / <alpha-value>)",
        cyan: "rgb(var(--cyan) / <alpha-value>)",
        "highlight-pink": "rgb(var(--highlight-pink) / <alpha-value>)",
        violet: "rgb(var(--violet) / <alpha-value>)",
        link: "rgb(var(--link) / <alpha-value>)",
        "link-deep": "rgb(var(--link-deep) / <alpha-value>)",
        "link-bg-soft": "rgb(var(--link-bg-soft) / <alpha-value>)",
        "soft-blue": {
          DEFAULT: "rgb(var(--soft-blue) / <alpha-value>)",
          strong: "rgb(var(--soft-blue-strong) / <alpha-value>)",
          foreground: "rgb(var(--soft-blue-foreground) / <alpha-value>)",
          border: "rgb(var(--soft-blue-border) / <alpha-value>)",
          surface: "rgb(var(--soft-blue-surface) / <alpha-value>)",
          "surface-hover": "rgb(var(--soft-blue-surface-hover) / <alpha-value>)"
        },
        success: "rgb(var(--success) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        "warning-soft": "rgb(var(--warning-soft) / <alpha-value>)",
        "warning-deep": "rgb(var(--warning-deep) / <alpha-value>)",
        "error-soft": "rgb(var(--error-soft) / <alpha-value>)",
        "error-deep": "rgb(var(--error-deep) / <alpha-value>)",
        "gradient-develop-start": "rgb(var(--gradient-develop-start) / <alpha-value>)",
        "gradient-develop-end": "rgb(var(--gradient-develop-end) / <alpha-value>)",
        "gradient-preview-start": "rgb(var(--gradient-preview-start) / <alpha-value>)",
        "gradient-preview-end": "rgb(var(--gradient-preview-end) / <alpha-value>)",
        "gradient-ship-start": "rgb(var(--gradient-ship-start) / <alpha-value>)",
        "gradient-ship-end": "rgb(var(--gradient-ship-end) / <alpha-value>)",
        "hairline-strong": "rgb(var(--hairline-strong) / <alpha-value>)",
        "line": "var(--line)",
        "line-weak": "var(--line-weak)",
        "line-strong": "var(--line-strong)",
        "ink-3": "rgb(var(--ink-3) / <alpha-value>)",
        "ink-4": "rgb(var(--ink-4) / <alpha-value>)",
        cinnabar: "rgb(var(--cinnabar) / <alpha-value>)",
        "cinnabar-soft": "rgb(var(--cinnabar-soft) / <alpha-value>)",
        moss: "rgb(var(--moss) / <alpha-value>)",
        ochre: "rgb(var(--ochre) / <alpha-value>)",
        indigo: "rgb(var(--indigo) / <alpha-value>)",
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
        sidebar: "rgb(var(--sidebar) / <alpha-value>)",
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
        // Geist 的开源替代使用 Inter，技术层使用 JetBrains Mono / SF Mono。
        display: [
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
        mono: ["JetBrains Mono", "SF Mono", "ui-monospace", "Menlo", "Consolas", "monospace"]
      },
      // Vercel 字体层级；保留旧 role 名作为组件兼容入口。
      fontSize: {
        hero: ["48px", { lineHeight: "48px", letterSpacing: "-2.4px", fontWeight: "600" }],
        display: ["32px", { lineHeight: "40px", letterSpacing: "-1.28px", fontWeight: "600" }],
        "section-display": ["32px", { lineHeight: "40px", letterSpacing: "-1.28px", fontWeight: "600" }],
        section: ["48px", { lineHeight: "48px", letterSpacing: "-2.4px", fontWeight: "600" }],
        "card-heading": ["24px", { lineHeight: "32px", letterSpacing: "-0.96px", fontWeight: "600" }],
        feature: ["20px", { lineHeight: "28px", letterSpacing: "-0.6px", fontWeight: "600" }],
        "display-xl": ["48px", { lineHeight: "48px", letterSpacing: "-2.4px", fontWeight: "600" }],
        "display-lg": ["32px", { lineHeight: "40px", letterSpacing: "-1.28px", fontWeight: "600" }],
        "display-md": ["24px", { lineHeight: "32px", letterSpacing: "-0.96px", fontWeight: "600" }],
        "display-sm": ["20px", { lineHeight: "28px", letterSpacing: "-0.6px", fontWeight: "600" }],
        "body-lg": ["18px", { lineHeight: "28px" }],
        body: ["16px", { lineHeight: "24px" }],
        "body-md": ["16px", { lineHeight: "24px" }],
        "body-md-strong": ["16px", { lineHeight: "24px", fontWeight: "500" }],
        "body-sm": ["14px", { lineHeight: "20px", letterSpacing: "-0.28px" }],
        "body-xs": ["13px", { lineHeight: "18px", letterSpacing: "-0.26px" }],
        "body-sm-strong": ["14px", { lineHeight: "20px", letterSpacing: "-0.28px", fontWeight: "500" }],
        button: ["14px", { lineHeight: "20px", fontWeight: "500" }],
        "button-md": ["14px", { lineHeight: "20px", fontWeight: "500" }],
        "button-lg": ["16px", { lineHeight: "24px", fontWeight: "500" }],
        caption: ["12px", { lineHeight: "16px" }],
        "mono-label": ["12px", { lineHeight: "16px" }],
        code: ["13px", { lineHeight: "20px" }],
        micro: ["12px", { lineHeight: "16px" }]
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
