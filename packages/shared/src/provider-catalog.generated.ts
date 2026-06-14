// 此文件由 scripts/generate-provider-catalog.mjs 生成，请修改 provider-catalog.yaml 后重新生成。
export const PROVIDER_CATALOG_SETTINGS = {
  "runtimeDefaults": {
    "maxToolIterations": 500,
    "autoCompactThresholdRatio": 0.8
  },
  "currency": {
    "usdToCnyExchangeRate": 6.7625
  }
} as const;

export const PROVIDER_KINDS = [
  "deepseek",
  "kimi",
  "minimax",
  "doubao",
  "qwen",
  "zhipu",
  "hunyuan",
  "qianfan",
  "xiaomi",
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "litellm",
  "openai-compatible",
  "custom"
] as const;

export const PROVIDER_CATALOG = {
  "deepseek": {
    "kind": "deepseek",
    "label": "DeepSeek",
    "name": "DeepSeek",
    "region": "cn",
    "api": "openai-completions",
    "auth": {
      "type": "bearer"
    },
    "defaultBaseURL": "https://api.deepseek.com",
    "defaultModel": "deepseek-v4-flash",
    "builtinDefault": true,
    "apiKeyUrl": "https://platform.deepseek.com/api_keys",
    "piProviderSlug": "deepseek",
    "models": [
      {
        "id": "deepseek-v4-flash",
        "label": "DeepSeek V4 Flash",
        "enabled": true,
        "reasoningModes": [
          "off",
          "high",
          "xhigh"
        ],
        "defaultReasoningMode": "off",
        "contextWindowTokens": 1000000,
        "autoCompactThresholdTokens": 800000,
        "inputModalities": [
          "text"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0.14,
          "outputCostPerMillion": 0.28,
          "cacheReadCostPerMillion": 0.0028,
          "pricingSource": "DeepSeek API pricing, 2026-06"
        }
      },
      {
        "id": "deepseek-v4-pro",
        "label": "DeepSeek V4 Pro",
        "enabled": true,
        "reasoningModes": [
          "off",
          "high",
          "xhigh"
        ],
        "defaultReasoningMode": "off",
        "contextWindowTokens": 1000000,
        "autoCompactThresholdTokens": 800000,
        "inputModalities": [
          "text"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0.435,
          "outputCostPerMillion": 0.87,
          "cacheReadCostPerMillion": 0.003625,
          "pricingSource": "DeepSeek API pricing, 2026-06"
        }
      }
    ],
    "modelFallbacks": [
      {
        "pattern": "^deepseek-v4-",
        "reasoningModes": [
          "off",
          "high",
          "xhigh"
        ],
        "defaultReasoningMode": "off",
        "contextWindowTokens": 1000000,
        "autoCompactThresholdTokens": 800000,
        "inputModalities": [
          "text"
        ]
      }
    ]
  },
  "kimi": {
    "kind": "kimi",
    "label": "Kimi",
    "name": "Kimi",
    "region": "cn",
    "api": "openai-completions",
    "auth": {
      "type": "bearer"
    },
    "defaultBaseURL": "https://api.moonshot.ai/v1",
    "defaultModel": "kimi-k2.7-code",
    "builtinDefault": true,
    "apiKeyUrl": "https://platform.kimi.ai/console/api-keys",
    "piProviderSlug": "moonshotai",
    "models": [
      {
        "id": "kimi-k2.7-code",
        "label": "Kimi K2.7 Code",
        "enabled": true,
        "reasoningModes": [],
        "reasoningAlwaysOn": true,
        "contextWindowTokens": 262144,
        "inputModalities": [
          "text",
          "image",
          "video"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0.95,
          "outputCostPerMillion": 4,
          "cacheReadCostPerMillion": 0.19,
          "pricingSource": "Kimi API pricing, 2026-06"
        }
      },
      {
        "id": "kimi-k2.6",
        "label": "Kimi K2.6",
        "enabled": true,
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "auto",
        "contextWindowTokens": 262144,
        "inputModalities": [
          "text",
          "image",
          "video"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0.95,
          "outputCostPerMillion": 4,
          "cacheReadCostPerMillion": 0.16,
          "pricingSource": "Kimi API pricing, 2026-06"
        }
      },
      {
        "id": "kimi-k2.5",
        "label": "Kimi K2.5",
        "enabled": true,
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "auto",
        "contextWindowTokens": 262144,
        "inputModalities": [
          "text",
          "image",
          "video"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0.6,
          "outputCostPerMillion": 3,
          "cacheReadCostPerMillion": 0.1,
          "pricingSource": "Kimi API pricing, 2026-06"
        }
      }
    ],
    "modelFallbacks": [
      {
        "pattern": "^kimi-k2\\.(5|6)\\b",
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "auto",
        "contextWindowTokens": 262144,
        "inputModalities": [
          "text",
          "image",
          "video"
        ]
      },
      {
        "pattern": "^kimi-k2\\.7-code$",
        "reasoningModes": [],
        "reasoningAlwaysOn": true,
        "contextWindowTokens": 262144,
        "inputModalities": [
          "text",
          "image",
          "video"
        ],
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0.95,
          "outputCostPerMillion": 4,
          "cacheReadCostPerMillion": 0.19,
          "pricingSource": "Kimi API pricing, 2026-06"
        }
      }
    ]
  },
  "minimax": {
    "kind": "minimax",
    "label": "MiniMax",
    "name": "MiniMax",
    "region": "cn",
    "api": "openai-completions",
    "auth": {
      "type": "bearer"
    },
    "defaultBaseURL": "https://api.minimaxi.com/v1",
    "defaultModel": "MiniMax-M3",
    "builtinDefault": true,
    "apiKeyUrl": "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    "piProviderSlug": "minimax",
    "models": [
      {
        "id": "MiniMax-M3",
        "label": "MiniMax M3",
        "enabled": true,
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "auto",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text",
          "image",
          "video"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0.3,
          "outputCostPerMillion": 1.2,
          "cacheReadCostPerMillion": 0.06,
          "pricingSource": "MiniMax API pricing, 2026-06"
        }
      }
    ],
    "modelFallbacks": [
      {
        "pattern": "^minimax-m3$",
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "auto",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text",
          "image",
          "video"
        ],
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0.3,
          "outputCostPerMillion": 1.2,
          "cacheReadCostPerMillion": 0.06,
          "pricingSource": "MiniMax API pricing, 2026-06"
        }
      },
      {
        "pattern": "^minimax-m2\\.",
        "reasoningModes": [],
        "reasoningAlwaysOn": true
      }
    ]
  },
  "doubao": {
    "kind": "doubao",
    "label": "豆包",
    "name": "豆包",
    "region": "cn",
    "api": "openai-completions",
    "auth": {
      "type": "bearer"
    },
    "defaultBaseURL": "https://ark.cn-beijing.volces.com/api/v3",
    "defaultModel": "doubao-seed-2.0-pro",
    "builtinDefault": true,
    "apiKeyUrl": "https://console.volcengine.com/ark",
    "piProviderSlug": "doubao",
    "models": [
      {
        "id": "doubao-seed-2.0-pro",
        "label": "Doubao Seed 2.0 Pro",
        "enabled": true,
        "reasoningModes": [
          "off",
          "minimal",
          "low",
          "medium",
          "high"
        ],
        "defaultReasoningMode": "off",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text",
          "image",
          "video"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "Volcengine ModelArk pricing 未在目录中固化，先按 0 处理"
        }
      },
      {
        "id": "doubao-seed-2.0-code",
        "label": "Doubao Seed 2.0 Code",
        "enabled": true,
        "reasoningModes": [
          "off",
          "minimal",
          "low",
          "medium",
          "high"
        ],
        "defaultReasoningMode": "high",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text",
          "image",
          "video"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "Volcengine ModelArk Coding Plan pricing 可变，先按 0 处理"
        }
      },
      {
        "id": "doubao-seed-2.0-lite",
        "label": "Doubao Seed 2.0 Lite",
        "enabled": true,
        "reasoningModes": [
          "off",
          "minimal",
          "low",
          "medium",
          "high"
        ],
        "defaultReasoningMode": "off",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "Volcengine ModelArk pricing 未在目录中固化，先按 0 处理"
        }
      }
    ],
    "modelFallbacks": [
      {
        "pattern": "seed",
        "reasoningModes": [
          "off",
          "minimal",
          "low",
          "medium",
          "high"
        ],
        "defaultReasoningMode": "off"
      },
      {
        "pattern": "seed-2\\.0",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text",
          "image",
          "video"
        ]
      }
    ]
  },
  "qwen": {
    "kind": "qwen",
    "label": "千问",
    "name": "千问",
    "region": "cn",
    "api": "openai-completions",
    "auth": {
      "type": "bearer"
    },
    "defaultBaseURL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "defaultModel": "qwen3.7-max",
    "builtinDefault": true,
    "apiKeyUrl": "https://bailian.console.aliyun.com/?apiKey=1",
    "piProviderSlug": "qwen",
    "models": [
      {
        "id": "qwen3.7-max",
        "label": "Qwen3.7 Max",
        "enabled": true,
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "auto",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 1.774,
          "outputCostPerMillion": 5.323,
          "pricingSource": "Alibaba Cloud Model Studio pricing, 2026-06"
        }
      },
      {
        "id": "qwen3.7-plus",
        "label": "Qwen3.7 Plus",
        "enabled": true,
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "off",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text",
          "image",
          "video"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0.287,
          "outputCostPerMillion": 1.147,
          "pricingSource": "Alibaba Cloud Model Studio pricing, 2026-06"
        }
      },
      {
        "id": "qwen3.6-plus",
        "label": "Qwen3.6 Plus",
        "enabled": true,
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "off",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text",
          "image",
          "video"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0.287,
          "outputCostPerMillion": 1.721,
          "pricingSource": "Alibaba Cloud Model Studio pricing, 2026-06"
        }
      },
      {
        "id": "qwen3.6-flash",
        "label": "Qwen3.6 Flash",
        "enabled": true,
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "off",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text",
          "image",
          "video"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0.043,
          "outputCostPerMillion": 0.359,
          "pricingSource": "Alibaba Cloud Model Studio pricing, 2026-06"
        }
      },
      {
        "id": "qwen3-coder-plus",
        "label": "Qwen3 Coder Plus",
        "enabled": true,
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "off",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "Alibaba Cloud Coding Plan pricing 可变，先按 0 处理"
        }
      },
      {
        "id": "qwen3-coder-next",
        "label": "Qwen3 Coder Next",
        "enabled": true,
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "off",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "Alibaba Cloud Coding Plan pricing 可变，先按 0 处理"
        }
      }
    ],
    "modelFallbacks": [
      {
        "pattern": "(qwen|qwq)",
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "off"
      },
      {
        "pattern": "^qwen3\\.7-max\\b",
        "defaultReasoningMode": "auto",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text"
        ],
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 1.774,
          "outputCostPerMillion": 5.323,
          "pricingSource": "Alibaba Cloud Model Studio pricing, 2026-06"
        }
      },
      {
        "pattern": "^qwen3\\.7-plus\\b",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text",
          "image",
          "video"
        ],
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0.287,
          "outputCostPerMillion": 1.147,
          "pricingSource": "Alibaba Cloud Model Studio pricing, 2026-06"
        }
      },
      {
        "pattern": "^qwen3\\.6-plus\\b",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text",
          "image",
          "video"
        ],
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0.287,
          "outputCostPerMillion": 1.721,
          "pricingSource": "Alibaba Cloud Model Studio pricing, 2026-06"
        }
      },
      {
        "pattern": "^qwen3\\.6-flash\\b",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text",
          "image",
          "video"
        ],
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0.043,
          "outputCostPerMillion": 0.359,
          "pricingSource": "Alibaba Cloud Model Studio pricing, 2026-06"
        }
      }
    ]
  },
  "zhipu": {
    "kind": "zhipu",
    "label": "智谱 GLM",
    "name": "智谱 GLM",
    "region": "cn",
    "api": "openai-completions",
    "auth": {
      "type": "bearer"
    },
    "defaultBaseURL": "https://open.bigmodel.cn/api/paas/v4",
    "defaultModel": "glm-5.1",
    "builtinDefault": true,
    "apiKeyUrl": "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
    "piProviderSlug": "zai",
    "models": [
      {
        "id": "glm-5.1",
        "label": "GLM 5.1",
        "enabled": true,
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "auto",
        "contextWindowTokens": 200000,
        "inputModalities": [
          "text"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "智谱公开价格未在目录中固化，先按 0 处理"
        }
      },
      {
        "id": "glm-5",
        "label": "GLM 5",
        "enabled": true,
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "auto",
        "contextWindowTokens": 200000,
        "inputModalities": [
          "text"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "智谱公开价格未在目录中固化，先按 0 处理"
        }
      },
      {
        "id": "glm-4.7",
        "label": "GLM 4.7",
        "enabled": true,
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "auto",
        "contextWindowTokens": 200000,
        "inputModalities": [
          "text"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0.431,
          "outputCostPerMillion": 2.011,
          "pricingSource": "智谱 API pricing, 2026-06"
        }
      },
      {
        "id": "glm-4.7-flashx",
        "label": "GLM 4.7 FlashX",
        "enabled": true,
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "off",
        "contextWindowTokens": 200000,
        "inputModalities": [
          "text"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "智谱公开价格未在目录中固化，先按 0 处理"
        }
      }
    ],
    "modelFallbacks": [
      {
        "pattern": "^glm-5",
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "auto",
        "contextWindowTokens": 200000,
        "inputModalities": [
          "text"
        ]
      },
      {
        "pattern": "^glm-4\\.7",
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "auto",
        "contextWindowTokens": 200000,
        "inputModalities": [
          "text"
        ]
      }
    ]
  },
  "hunyuan": {
    "kind": "hunyuan",
    "label": "腾讯混元",
    "name": "腾讯混元",
    "region": "cn",
    "api": "openai-completions",
    "auth": {
      "type": "bearer"
    },
    "defaultBaseURL": "https://api.hunyuan.cloud.tencent.com/v1",
    "defaultModel": "hunyuan-turbos-latest",
    "builtinDefault": true,
    "apiKeyUrl": "https://console.cloud.tencent.com/hunyuan/api-key",
    "models": [
      {
        "id": "hunyuan-turbos-latest",
        "label": "Hunyuan Turbos Latest",
        "enabled": true,
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "off",
        "contextWindowTokens": 32768,
        "inputModalities": [
          "text",
          "image"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "腾讯混元公开价格未在目录中固化，先按 0 处理"
        }
      },
      {
        "id": "hunyuan-large",
        "label": "Hunyuan Large",
        "enabled": true,
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "off",
        "contextWindowTokens": 256000,
        "inputModalities": [
          "text"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "腾讯混元公开价格未在目录中固化，先按 0 处理"
        }
      },
      {
        "id": "hunyuan-lite",
        "label": "Hunyuan Lite",
        "enabled": true,
        "reasoningModes": [],
        "contextWindowTokens": 256000,
        "inputModalities": [
          "text"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "腾讯混元公开价格未在目录中固化，先按 0 处理"
        }
      }
    ],
    "modelFallbacks": [
      {
        "pattern": "^hunyuan-turbos",
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "off",
        "contextWindowTokens": 32768,
        "inputModalities": [
          "text",
          "image"
        ]
      },
      {
        "pattern": "^hunyuan",
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "off",
        "contextWindowTokens": 256000,
        "inputModalities": [
          "text"
        ]
      }
    ]
  },
  "qianfan": {
    "kind": "qianfan",
    "label": "百度千帆",
    "name": "百度千帆",
    "region": "cn",
    "api": "openai-completions",
    "auth": {
      "type": "bearer"
    },
    "defaultBaseURL": "https://qianfan.baidubce.com/v2",
    "defaultModel": "ernie-5.1",
    "builtinDefault": true,
    "apiKeyUrl": "https://console.bce.baidu.com/iam/#/iam/apikey/list",
    "models": [
      {
        "id": "ernie-5.1",
        "label": "ERNIE 5.1",
        "enabled": true,
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "auto",
        "contextWindowTokens": 131072,
        "inputModalities": [
          "text",
          "image",
          "video"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "百度千帆公开价格未在目录中固化，先按 0 处理"
        }
      },
      {
        "id": "ernie-5.0-thinking-latest",
        "label": "ERNIE 5.0 Thinking Latest",
        "enabled": true,
        "reasoningModes": [],
        "reasoningAlwaysOn": true,
        "contextWindowTokens": 131072,
        "inputModalities": [
          "text"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "百度千帆公开价格未在目录中固化，先按 0 处理"
        }
      },
      {
        "id": "ernie-x1.1-preview",
        "label": "ERNIE X1.1 Preview",
        "enabled": true,
        "reasoningModes": [],
        "reasoningAlwaysOn": true,
        "contextWindowTokens": 65536,
        "inputModalities": [
          "text"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "百度千帆公开价格未在目录中固化，先按 0 处理"
        }
      },
      {
        "id": "ernie-4.5-turbo-128k",
        "label": "ERNIE 4.5 Turbo 128K",
        "enabled": true,
        "reasoningModes": [],
        "contextWindowTokens": 131072,
        "inputModalities": [
          "text",
          "image"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "百度千帆公开价格未在目录中固化，先按 0 处理"
        }
      }
    ],
    "modelFallbacks": [
      {
        "pattern": "^ernie-5\\.",
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "auto",
        "contextWindowTokens": 131072,
        "inputModalities": [
          "text",
          "image",
          "video"
        ]
      },
      {
        "pattern": "^ernie-.*thinking",
        "reasoningModes": [],
        "reasoningAlwaysOn": true,
        "contextWindowTokens": 131072,
        "inputModalities": [
          "text"
        ]
      },
      {
        "pattern": "^ernie-",
        "reasoningModes": [],
        "contextWindowTokens": 131072,
        "inputModalities": [
          "text"
        ]
      }
    ]
  },
  "xiaomi": {
    "kind": "xiaomi",
    "label": "小米 MiMo",
    "name": "小米 MiMo",
    "region": "cn",
    "api": "openai-completions",
    "auth": {
      "type": "bearer"
    },
    "defaultBaseURL": "https://api.xiaomimimo.com/v1",
    "defaultModel": "mimo-v2.5-pro",
    "builtinDefault": true,
    "apiKeyUrl": "https://platform.mimomodel.com/",
    "piProviderSlug": "xiaomi",
    "models": [
      {
        "id": "mimo-v2.5-pro",
        "label": "MiMo V2.5 Pro",
        "enabled": true,
        "reasoningModes": [
          "off",
          "high"
        ],
        "defaultReasoningMode": "high",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0.435,
          "outputCostPerMillion": 0.87,
          "pricingSource": "Xiaomi MiMo V2.5 Pro API pricing, 2026-06"
        }
      },
      {
        "id": "mimo-v2.5",
        "label": "MiMo V2.5",
        "enabled": true,
        "reasoningModes": [
          "off",
          "high"
        ],
        "defaultReasoningMode": "off",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text",
          "image",
          "video"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "小米 MiMo 公开价格未在目录中固化，先按 0 处理"
        }
      },
      {
        "id": "mimo-v2.5-pro-ultraspeed",
        "label": "MiMo V2.5 Pro UltraSpeed",
        "enabled": true,
        "reasoningModes": [
          "off",
          "high"
        ],
        "defaultReasoningMode": "off",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "小米 MiMo 公开价格未在目录中固化，先按 0 处理"
        }
      }
    ],
    "modelFallbacks": [
      {
        "pattern": "^mimo-v2\\.5",
        "reasoningModes": [
          "off",
          "high"
        ],
        "defaultReasoningMode": "off",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text"
        ]
      }
    ]
  },
  "openai": {
    "kind": "openai",
    "label": "OpenAI",
    "name": "OpenAI",
    "region": "global",
    "api": "openai-responses",
    "auth": {
      "type": "bearer"
    },
    "defaultBaseURL": "https://api.openai.com/v1",
    "defaultModel": "gpt-5.5",
    "builtinDefault": true,
    "apiKeyUrl": "https://platform.openai.com/api-keys",
    "piProviderSlug": "openai",
    "models": [
      {
        "id": "gpt-5.5",
        "label": "GPT-5.5",
        "enabled": true,
        "reasoningModes": [
          "minimal",
          "low",
          "medium",
          "high"
        ],
        "defaultReasoningMode": "medium",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text",
          "image"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 5,
          "outputCostPerMillion": 30,
          "cacheReadCostPerMillion": 0.5,
          "pricingSource": "OpenAI API pricing, 2026-06"
        }
      },
      {
        "id": "gpt-5.5-pro",
        "label": "GPT-5.5 Pro",
        "enabled": true,
        "reasoningModes": [
          "minimal",
          "low",
          "medium",
          "high"
        ],
        "defaultReasoningMode": "high",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text",
          "image"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 30,
          "outputCostPerMillion": 180,
          "pricingSource": "OpenAI API pricing, 2026-06"
        }
      },
      {
        "id": "gpt-5.4",
        "label": "GPT-5.4",
        "enabled": true,
        "reasoningModes": [
          "minimal",
          "low",
          "medium",
          "high"
        ],
        "defaultReasoningMode": "medium",
        "contextWindowTokens": 400000,
        "inputModalities": [
          "text",
          "image"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "OpenAI 价格未在目录中固化，先按 0 处理"
        }
      },
      {
        "id": "gpt-4.1",
        "label": "GPT-4.1",
        "enabled": true,
        "reasoningModes": [],
        "contextWindowTokens": 1047576,
        "inputModalities": [
          "text",
          "image"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 2,
          "outputCostPerMillion": 8,
          "pricingSource": "OpenAI API pricing, 2026-06"
        }
      }
    ],
    "modelFallbacks": [
      {
        "pattern": "^gpt-5",
        "reasoningModes": [
          "minimal",
          "low",
          "medium",
          "high"
        ],
        "defaultReasoningMode": "medium",
        "contextWindowTokens": 400000,
        "inputModalities": [
          "text",
          "image"
        ]
      },
      {
        "pattern": "^gpt-5\\.5",
        "contextWindowTokens": 1000000
      },
      {
        "pattern": "^gpt-5\\.5-pro",
        "defaultReasoningMode": "high",
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 30,
          "outputCostPerMillion": 180,
          "pricingSource": "OpenAI API pricing, 2026-06"
        }
      },
      {
        "pattern": "^gpt-4\\.1",
        "reasoningModes": [],
        "contextWindowTokens": 1047576,
        "inputModalities": [
          "text",
          "image"
        ]
      }
    ]
  },
  "anthropic": {
    "kind": "anthropic",
    "label": "Anthropic",
    "name": "Anthropic",
    "region": "global",
    "api": "anthropic-messages",
    "auth": {
      "type": "anthropic",
      "header": "x-api-key",
      "versionHeader": "anthropic-version",
      "version": "2023-06-01"
    },
    "defaultBaseURL": "https://api.anthropic.com/v1",
    "defaultModel": "claude-fable-5",
    "builtinDefault": true,
    "apiKeyUrl": "https://console.anthropic.com/settings/keys",
    "piProviderSlug": "anthropic",
    "models": [
      {
        "id": "claude-fable-5",
        "label": "Claude Fable 5",
        "enabled": true,
        "reasoningModes": [],
        "reasoningAlwaysOn": true,
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text",
          "image"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 10,
          "outputCostPerMillion": 50,
          "pricingSource": "Anthropic API pricing, 2026-06"
        }
      },
      {
        "id": "claude-opus-4-8",
        "label": "Claude Opus 4.8",
        "enabled": true,
        "reasoningModes": [
          "low",
          "medium",
          "high",
          "xhigh"
        ],
        "defaultReasoningMode": "medium",
        "contextWindowTokens": 200000,
        "inputModalities": [
          "text",
          "image"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "Anthropic 价格未在目录中固化，先按 0 处理"
        }
      },
      {
        "id": "claude-sonnet-4-6",
        "label": "Claude Sonnet 4.6",
        "enabled": true,
        "reasoningModes": [
          "low",
          "medium",
          "high"
        ],
        "defaultReasoningMode": "medium",
        "contextWindowTokens": 200000,
        "inputModalities": [
          "text",
          "image"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 3,
          "outputCostPerMillion": 15,
          "pricingSource": "Anthropic API pricing, 2026-06"
        }
      }
    ],
    "modelFallbacks": [
      {
        "pattern": "^claude-fable-",
        "reasoningModes": [],
        "reasoningAlwaysOn": true,
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text",
          "image"
        ]
      },
      {
        "pattern": "^claude-",
        "reasoningModes": [
          "low",
          "medium",
          "high"
        ],
        "defaultReasoningMode": "medium",
        "contextWindowTokens": 200000,
        "inputModalities": [
          "text",
          "image"
        ]
      }
    ]
  },
  "gemini": {
    "kind": "gemini",
    "label": "Gemini",
    "name": "Gemini",
    "region": "global",
    "api": "google-generative-ai",
    "auth": {
      "type": "x-api-key",
      "header": "x-goog-api-key"
    },
    "defaultBaseURL": "https://generativelanguage.googleapis.com/v1beta",
    "defaultModel": "gemini-3.5-flash",
    "builtinDefault": true,
    "apiKeyUrl": "https://aistudio.google.com/app/apikey",
    "piProviderSlug": "google",
    "models": [
      {
        "id": "gemini-3.5-flash",
        "label": "Gemini 3.5 Flash",
        "enabled": true,
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "auto",
        "contextWindowTokens": 1048576,
        "inputModalities": [
          "text",
          "image",
          "video"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0.125,
          "outputCostPerMillion": 0.75,
          "cacheReadCostPerMillion": 0.0125,
          "pricingSource": "Google Gemini API pricing, 2026-06"
        }
      },
      {
        "id": "gemini-3.1-pro-preview",
        "label": "Gemini 3.1 Pro Preview",
        "enabled": true,
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "auto",
        "contextWindowTokens": 1048576,
        "inputModalities": [
          "text",
          "image",
          "video"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 2,
          "outputCostPerMillion": 12,
          "cacheReadCostPerMillion": 0.2,
          "pricingSource": "Google Gemini API pricing, 2026-06"
        }
      },
      {
        "id": "gemini-3-flash",
        "label": "Gemini 3 Flash",
        "enabled": true,
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "auto",
        "contextWindowTokens": 1048576,
        "inputModalities": [
          "text",
          "image",
          "video"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0.125,
          "outputCostPerMillion": 0.75,
          "cacheReadCostPerMillion": 0.0125,
          "pricingSource": "Google Gemini API pricing, 2026-06"
        }
      }
    ],
    "modelFallbacks": [
      {
        "pattern": "^gemini-",
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "auto",
        "contextWindowTokens": 1048576,
        "inputModalities": [
          "text",
          "image",
          "video"
        ]
      }
    ]
  },
  "openrouter": {
    "kind": "openrouter",
    "label": "OpenRouter",
    "name": "OpenRouter",
    "region": "gateway",
    "api": "openai-completions",
    "auth": {
      "type": "bearer"
    },
    "defaultBaseURL": "https://openrouter.ai/api/v1",
    "defaultModel": "openai/gpt-5.5",
    "builtinDefault": true,
    "apiKeyUrl": "https://openrouter.ai/settings/keys",
    "piProviderSlug": "openrouter",
    "models": [
      {
        "id": "openai/gpt-5.5",
        "label": "OpenAI GPT-5.5",
        "enabled": true,
        "reasoningModes": [
          "minimal",
          "low",
          "medium",
          "high"
        ],
        "defaultReasoningMode": "medium",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text",
          "image"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "OpenRouter 模型价格随路由变化，先按 0 处理"
        }
      },
      {
        "id": "openai/gpt-5.5-pro",
        "label": "OpenAI GPT-5.5 Pro",
        "enabled": true,
        "reasoningModes": [
          "minimal",
          "low",
          "medium",
          "high"
        ],
        "defaultReasoningMode": "high",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text",
          "image"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "OpenRouter 模型价格随路由变化，先按 0 处理"
        }
      },
      {
        "id": "anthropic/claude-fable-5",
        "label": "Claude Fable 5",
        "enabled": true,
        "reasoningModes": [],
        "reasoningAlwaysOn": true,
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text",
          "image"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "OpenRouter 模型价格随路由变化，先按 0 处理"
        }
      },
      {
        "id": "google/gemini-3.5-flash",
        "label": "Gemini 3.5 Flash",
        "enabled": true,
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "auto",
        "contextWindowTokens": 1048576,
        "inputModalities": [
          "text",
          "image",
          "video"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "OpenRouter 模型价格随路由变化，先按 0 处理"
        }
      }
    ],
    "modelFallbacks": [
      {
        "pattern": "^openai/gpt-5",
        "reasoningModes": [
          "minimal",
          "low",
          "medium",
          "high"
        ],
        "defaultReasoningMode": "medium",
        "contextWindowTokens": 400000,
        "inputModalities": [
          "text",
          "image"
        ]
      },
      {
        "pattern": "^openai/gpt-5\\.5",
        "contextWindowTokens": 1000000
      },
      {
        "pattern": "^openai/gpt-5\\.5-pro",
        "defaultReasoningMode": "high"
      },
      {
        "pattern": "^anthropic/claude-",
        "reasoningModes": [
          "low",
          "medium",
          "high"
        ],
        "defaultReasoningMode": "medium",
        "contextWindowTokens": 200000,
        "inputModalities": [
          "text",
          "image"
        ]
      },
      {
        "pattern": "^anthropic/claude-fable-",
        "reasoningModes": [],
        "reasoningAlwaysOn": true,
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text",
          "image"
        ]
      },
      {
        "pattern": "^google/gemini-",
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "auto",
        "contextWindowTokens": 1048576,
        "inputModalities": [
          "text",
          "image",
          "video"
        ]
      }
    ]
  },
  "litellm": {
    "kind": "litellm",
    "label": "LiteLLM",
    "name": "LiteLLM",
    "region": "gateway",
    "api": "openai-completions",
    "auth": {
      "type": "bearer"
    },
    "defaultBaseURL": "http://localhost:4000/v1",
    "defaultModel": "gpt-5.5",
    "builtinDefault": true,
    "apiKeyUrl": "https://docs.litellm.ai/docs/proxy/virtual_keys",
    "models": [
      {
        "id": "gpt-5.5",
        "label": "GPT-5.5",
        "enabled": true,
        "reasoningModes": [
          "minimal",
          "low",
          "medium",
          "high"
        ],
        "defaultReasoningMode": "medium",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text",
          "image"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "LiteLLM 后端路由可变，先按 0 处理"
        }
      },
      {
        "id": "gpt-5.5-pro",
        "label": "GPT-5.5 Pro",
        "enabled": true,
        "reasoningModes": [
          "minimal",
          "low",
          "medium",
          "high"
        ],
        "defaultReasoningMode": "high",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text",
          "image"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "LiteLLM 后端路由可变，先按 0 处理"
        }
      },
      {
        "id": "claude-fable-5",
        "label": "Claude Fable 5",
        "enabled": true,
        "reasoningModes": [],
        "reasoningAlwaysOn": true,
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text",
          "image"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "LiteLLM 后端路由可变，先按 0 处理"
        }
      },
      {
        "id": "gemini-3.5-flash",
        "label": "Gemini 3.5 Flash",
        "enabled": true,
        "reasoningModes": [
          "off",
          "auto"
        ],
        "defaultReasoningMode": "auto",
        "contextWindowTokens": 1048576,
        "inputModalities": [
          "text",
          "image",
          "video"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "LiteLLM 后端路由可变，先按 0 处理"
        }
      }
    ],
    "modelFallbacks": [
      {
        "pattern": ".",
        "reasoningModes": [],
        "contextWindowTokens": 131072,
        "inputModalities": [
          "text"
        ]
      }
    ]
  },
  "openai-compatible": {
    "kind": "openai-compatible",
    "label": "OpenAI-compatible",
    "name": "OpenAI-compatible",
    "region": "custom",
    "api": "openai-completions",
    "auth": {
      "type": "bearer"
    },
    "defaultBaseURL": "https://api.openai.com/v1",
    "defaultModel": "gpt-5.5",
    "builtinDefault": false,
    "apiKeyUrl": "https://platform.openai.com/api-keys",
    "models": [
      {
        "id": "gpt-5.5",
        "label": "GPT-5.5",
        "enabled": true,
        "reasoningModes": [
          "minimal",
          "low",
          "medium",
          "high"
        ],
        "defaultReasoningMode": "medium",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text",
          "image"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 5,
          "outputCostPerMillion": 30,
          "cacheReadCostPerMillion": 0.5,
          "pricingSource": "OpenAI API pricing, 2026-06"
        }
      },
      {
        "id": "gpt-5.5-pro",
        "label": "GPT-5.5 Pro",
        "enabled": true,
        "reasoningModes": [
          "minimal",
          "low",
          "medium",
          "high"
        ],
        "defaultReasoningMode": "high",
        "contextWindowTokens": 1000000,
        "inputModalities": [
          "text",
          "image"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 30,
          "outputCostPerMillion": 180,
          "pricingSource": "OpenAI API pricing, 2026-06"
        }
      }
    ],
    "modelFallbacks": [
      {
        "pattern": "^gpt-5",
        "reasoningModes": [
          "minimal",
          "low",
          "medium",
          "high"
        ],
        "defaultReasoningMode": "medium",
        "contextWindowTokens": 400000,
        "inputModalities": [
          "text",
          "image"
        ]
      },
      {
        "pattern": "^gpt-5\\.5",
        "contextWindowTokens": 1000000
      },
      {
        "pattern": "^gpt-5\\.5-pro",
        "defaultReasoningMode": "high",
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 30,
          "outputCostPerMillion": 180,
          "pricingSource": "OpenAI API pricing, 2026-06"
        }
      },
      {
        "pattern": ".",
        "reasoningModes": [],
        "contextWindowTokens": 131072,
        "inputModalities": [
          "text"
        ]
      }
    ]
  },
  "custom": {
    "kind": "custom",
    "label": "自定义",
    "name": "Custom",
    "region": "custom",
    "api": "openai-completions",
    "auth": {
      "type": "bearer"
    },
    "defaultBaseURL": "https://api.example.com/v1",
    "defaultModel": "custom-model",
    "builtinDefault": false,
    "models": [
      {
        "id": "custom-model",
        "label": "Custom Model",
        "enabled": true,
        "reasoningModes": [],
        "contextWindowTokens": 131072,
        "inputModalities": [
          "text"
        ],
        "maxToolIterations": 500,
        "pricing": {
          "currency": "USD",
          "inputCostPerMillion": 0,
          "outputCostPerMillion": 0,
          "pricingSource": "自定义模型默认不估算费用"
        }
      }
    ],
    "modelFallbacks": [
      {
        "pattern": ".",
        "reasoningModes": [],
        "contextWindowTokens": 131072,
        "inputModalities": [
          "text"
        ]
      }
    ]
  }
} as const;
