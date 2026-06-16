import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge must learn the DESIGN.md token names, otherwise it
// misclassifies custom font sizes (text-button, text-caption, …) as text
// colors and drops them when merged with a real color class.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "hero",
            "display",
            "section-display",
            "section",
            "card-heading",
            "feature",
            "body-lg",
            "body",
            "body-sm",
            "button",
            "caption",
            "mono-label",
            "micro"
          ]
        }
      ],
      rounded: [{ rounded: ["xs", "pill"] }],
      shadow: [{ shadow: ["overlay"] }]
    }
  }
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
