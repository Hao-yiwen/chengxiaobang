import type zh from "./locales/zh.json";

// Make t() keys type-safe against the zh resource shape.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: {
      translation: typeof zh;
    };
  }
}
