import { readFile } from "node:fs/promises";

export const STARTUP_SPLASH_URL_PREFIX = "data:text/html;charset=utf-8,";

const LIGHT_BACKGROUND = "#fafafa";
const DARK_BACKGROUND = "#0a0a0a";

export interface StartupSplashHtmlOptions {
  imageSrc?: string;
  dark: boolean;
}

export async function loadStartupSplashImageDataUrl(imagePath: string): Promise<string> {
  const image = await readFile(imagePath);
  return `data:image/png;base64,${image.toString("base64")}`;
}

export function createStartupSplashUrl(options: StartupSplashHtmlOptions): string {
  return `${STARTUP_SPLASH_URL_PREFIX}${encodeURIComponent(createStartupSplashHtml(options))}`;
}

export function createStartupSplashHtml(options: StartupSplashHtmlOptions): string {
  const background = options.dark ? DARK_BACKGROUND : LIGHT_BACKGROUND;
  const image = options.imageSrc
    ? `<img class="startup-image" src="${escapeAttribute(options.imageSrc)}" alt="程小帮" />`
    : "";
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'none'; img-src data:; style-src 'unsafe-inline';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>程小帮</title>
    <style>
      :root {
        color-scheme: ${options.dark ? "dark" : "light"};
        background: ${background};
      }

      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: ${background};
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      body {
        display: grid;
        place-items: center;
      }

      .startup-image {
        width: min(260px, 42vw, 40vh);
        height: auto;
        max-height: 56vh;
        object-fit: contain;
        opacity: 0;
        animation: startup-image-in 220ms ease-out forwards;
      }

      @media (max-width: 640px) {
        .startup-image {
          width: min(220px, 58vw, 44vh);
        }
      }

      @keyframes startup-image-in {
        from {
          opacity: 0;
          transform: scale(0.98);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }
    </style>
  </head>
  <body>${image}</body>
</html>`;
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}
